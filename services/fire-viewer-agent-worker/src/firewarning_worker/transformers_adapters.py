from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from firewarning_worker.adapters import ItemPatch, ModelAdapter, ModelOutputError
from firewarning_worker.contracts import (
    BatchItem,
    ExplicitLiteral,
    FactualObservation,
    PixelRegion,
    Transcript,
    TranscriptSegment,
    VisualEvidenceSelection,
)
from firewarning_worker.media_fetcher import MediaFetcher
from firewarning_worker.model_registry import ModelSpec, resolve_cached_snapshot


def _torch_runtime() -> tuple[Any, Any]:
    import torch
    import transformers

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the production worker")
    return torch, transformers


class _BaseAdapter:
    def __init__(self, spec: ModelSpec, *, cache_root: Path, fetcher: MediaFetcher) -> None:
        self.spec = spec
        self.cache_root = cache_root
        self.fetcher = fetcher
        self.model: Any = None
        self.processor: Any = None

    @property
    def model_path(self) -> Path:
        return resolve_cached_snapshot(self.spec, self.cache_root)

    def unload(self) -> None:
        self.model = None
        self.processor = None


class WhisperAdapter(_BaseAdapter):
    def load(self) -> None:
        torch, transformers = _torch_runtime()
        self.processor = transformers.AutoProcessor.from_pretrained(
            self.model_path, local_files_only=True
        )
        self.model = transformers.AutoModelForSpeechSeq2Seq.from_pretrained(
            self.model_path,
            local_files_only=True,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        ).to("cuda")

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        _, transformers = _torch_runtime()
        pipe = transformers.pipeline(
            "automatic-speech-recognition",
            model=self.model,
            tokenizer=self.processor.tokenizer,
            feature_extractor=self.processor.feature_extractor,
            torch_dtype=self.model.dtype,
            device=0,
        )
        patches: dict[str, ItemPatch] = {}
        for item in items:
            if item.audio_url is None:
                continue
            with self.fetcher.download(str(item.audio_url)) as audio_path:
                raw = pipe(
                    str(audio_path),
                    return_timestamps=True,
                    generate_kwargs={"task": "transcribe"},
                )
            segments = []
            for index, chunk in enumerate(raw.get("chunks", []), start=1):
                timestamps = chunk.get("timestamp") or (0.0, 0.0)
                start = float(timestamps[0] or 0.0)
                end = float(timestamps[1] or start + 0.001)
                segments.append(
                    TranscriptSegment(
                        segment_id=f"{item.input_id}:audio:{index:04d}",
                        start_s=start,
                        end_s=max(end, start + 0.001),
                        text=str(chunk.get("text", "")).strip(),
                    )
                )
            patches[item.input_id] = ItemPatch(
                transcript=Transcript(language=raw.get("language"), segments=tuple(segments))
            )
        return patches


class RTDETRAdapter(_BaseAdapter):
    ALLOWED_LABELS = frozenset(
        {
            "smoke_visible",
            "flame_visible",
            "firefighting_aircraft_visible",
            "fire_response_vehicle_visible",
        }
    )

    def load(self) -> None:
        torch, transformers = _torch_runtime()
        self.processor = transformers.AutoImageProcessor.from_pretrained(
            self.model_path, local_files_only=True
        )
        self.model = transformers.AutoModelForObjectDetection.from_pretrained(
            self.model_path,
            local_files_only=True,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        ).to("cuda")

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        from PIL import Image

        torch, _ = _torch_runtime()
        patches: dict[str, ItemPatch] = {}
        for item in items:
            sources = [(frame.frame_id, str(frame.working_file_url)) for frame in item.frames]
            if not sources and item.working_file_url is not None:
                sources = [(item.input_id, str(item.working_file_url))]
            regions: list[PixelRegion] = []
            scores_by_evidence: dict[str, float] = {}
            for evidence_id, url in sources:
                with self.fetcher.download(url) as image_path, Image.open(image_path) as image:
                    rgb = image.convert("RGB")
                    width, height = rgb.size
                    inputs = self.processor(images=rgb, return_tensors="pt").to("cuda")
                    with torch.inference_mode():
                        outputs = self.model(**inputs)
                    predictions = self.processor.post_process_object_detection(
                        outputs, threshold=0.25, target_sizes=[(height, width)]
                    )[0]
                for index, (score, label_id, box) in enumerate(
                    zip(
                        predictions["scores"],
                        predictions["labels"],
                        predictions["boxes"],
                        strict=True,
                    ),
                    start=1,
                ):
                    label = str(self.model.config.id2label[int(label_id)])
                    if label not in self.ALLOWED_LABELS:
                        continue
                    x1, y1, x2, y2 = (float(value) for value in box.tolist())
                    regions.append(
                        PixelRegion(
                            region_id=f"{evidence_id}:det:{index:04d}",
                            evidence_id=evidence_id,
                            label=label,
                            bbox_normalized=(x1 / width, y1 / height, x2 / width, y2 / height),
                            task="fire_detection",
                            model_score=float(score),
                        )
                    )
                    scores_by_evidence[evidence_id] = max(
                        scores_by_evidence.get(evidence_id, 0.0), float(score)
                    )
            selected_ids = self._select_sources(
                [evidence_id for evidence_id, _ in sources], scores_by_evidence, limit=8
            )
            selections = tuple(
                VisualEvidenceSelection(
                    evidence_id=evidence_id,
                    selected_for_grounding=evidence_id in selected_ids,
                    selection_reason=(
                        "single_image"
                        if len(sources) == 1
                        else "target_detection"
                        if evidence_id in selected_ids and evidence_id in scores_by_evidence
                        else "temporal_coverage"
                        if evidence_id in selected_ids
                        else "capacity_limit"
                    ),
                    max_detection_score=scores_by_evidence.get(evidence_id),
                )
                for evidence_id, _ in sources
            )
            patches[item.input_id] = ItemPatch(
                pixel_regions=tuple(regions), visual_evidence_selection=selections
            )
        return patches

    @staticmethod
    def _select_sources(
        evidence_ids: list[str], scores_by_evidence: Mapping[str, float], *, limit: int
    ) -> frozenset[str]:
        if len(evidence_ids) <= limit:
            return frozenset(evidence_ids)
        # RT-DETR prioritizes views; two contextual views remain reserved because a frame
        # without a target can still contain text, landmarks, or localization evidence.
        target_budget = max(limit - 2, 0)
        positions = {evidence_id: index for index, evidence_id in enumerate(evidence_ids)}
        ranked_targets = sorted(
            (evidence_id for evidence_id in evidence_ids if evidence_id in scores_by_evidence),
            key=lambda evidence_id: (-scores_by_evidence[evidence_id], positions[evidence_id]),
        )
        selected = set(ranked_targets[:target_budget])
        remaining = [evidence_id for evidence_id in evidence_ids if evidence_id not in selected]
        slots = limit - len(selected)
        if slots >= len(remaining):
            selected.update(remaining)
        elif slots == 1:
            selected.add(remaining[len(remaining) // 2])
        elif slots > 1:
            indexes = {
                round(position * (len(remaining) - 1) / (slots - 1)) for position in range(slots)
            }
            selected.update(remaining[index] for index in indexes)
        return frozenset(selected)


class FlorenceAdapter(_BaseAdapter):
    def load(self) -> None:
        torch, transformers = _torch_runtime()
        self.processor = transformers.AutoProcessor.from_pretrained(
            self.model_path, local_files_only=True, trust_remote_code=True
        )
        self.model = transformers.AutoModelForCausalLM.from_pretrained(
            self.model_path,
            local_files_only=True,
            trust_remote_code=True,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        ).to("cuda")

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        from PIL import Image

        torch, _ = _torch_runtime()
        patches: dict[str, ItemPatch] = {}
        prompt = (
            "<CAPTION_TO_PHRASE_GROUNDING>smoke. flame. aircraft. "
            "emergency vehicle. road. building."
        )
        for item in items:
            existing = list(accumulated[item.input_id].pixel_regions or ())
            selected = {
                entry.evidence_id
                for entry in (accumulated[item.input_id].visual_evidence_selection or ())
                if entry.selected_for_grounding
            }
            sources = [
                (frame.frame_id, str(frame.working_file_url))
                for frame in item.frames
                if frame.frame_id in selected
            ]
            if not sources and item.working_file_url is not None:
                sources = [(item.input_id, str(item.working_file_url))]
            for evidence_id, url in sources:
                with self.fetcher.download(url) as image_path, Image.open(image_path) as image:
                    rgb = image.convert("RGB")
                    inputs = self.processor(text=prompt, images=rgb, return_tensors="pt")
                    inputs = {key: value.to("cuda") for key, value in inputs.items()}
                    with torch.inference_mode():
                        generated = self.model.generate(
                            **inputs, max_new_tokens=256, do_sample=False
                        )
                    text = self.processor.batch_decode(generated, skip_special_tokens=False)[0]
                    parsed = self.processor.post_process_generation(
                        text, task="<CAPTION_TO_PHRASE_GROUNDING>", image_size=rgb.size
                    ).get("<CAPTION_TO_PHRASE_GROUNDING>", {})
                    width, height = rgb.size
                for index, (label, box) in enumerate(
                    zip(parsed.get("labels", []), parsed.get("bboxes", []), strict=True), start=1
                ):
                    x1, y1, x2, y2 = (float(value) for value in box)
                    existing.append(
                        PixelRegion(
                            region_id=f"{evidence_id}:ground:{index:04d}",
                            evidence_id=evidence_id,
                            label=str(label)[:128],
                            bbox_normalized=(x1 / width, y1 / height, x2 / width, y2 / height),
                            task="phrase_grounding",
                        )
                    )
            patches[item.input_id] = ItemPatch(pixel_regions=tuple(existing))
        return patches


class QwenAdapter(_BaseAdapter):
    SYSTEM_PROMPT = """Extract only directly visible, explicitly written, or explicitly
spoken facts.
Return one JSON object with exactly these arrays: observations, explicit_places, explicit_times.
Every entry must contain evidence_kind and evidence_id. Never infer a geographic position,
forecast, propagation, threatened area, probability, or missing fact. Unknown means omitted.
Observation fields: type, evidence_kind, evidence_id, optional region_id, description, certainty.
Place/time fields: literal, evidence_kind, evidence_id. JSON only."""

    def load(self) -> None:
        torch, transformers = _torch_runtime()
        try:
            import flash_attn  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "Flash Attention 2 is required; an SDPA fallback is forbidden"
            ) from exc

        if torch.cuda.get_device_capability()[0] < 8:
            raise RuntimeError(
                "Flash Attention 2 requires an Ampere, Ada, Hopper, or newer NVIDIA GPU"
            )
        self.processor = transformers.AutoProcessor.from_pretrained(
            self.model_path, local_files_only=True
        )
        self.model = transformers.Qwen3VLForConditionalGeneration.from_pretrained(
            self.model_path,
            local_files_only=True,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
            attn_implementation="flash_attention_2",
        ).to("cuda")

    @staticmethod
    def _parse(
        text: str,
    ) -> tuple[
        tuple[FactualObservation, ...],
        tuple[ExplicitLiteral, ...],
        tuple[ExplicitLiteral, ...],
    ]:
        payload = json.loads(text.strip())
        if not isinstance(payload, dict) or set(payload) != {
            "observations",
            "explicit_places",
            "explicit_times",
        }:
            raise ValueError("Qwen response must use the exact closed object shape")
        return (
            tuple(FactualObservation.model_validate(value) for value in payload["observations"]),
            tuple(ExplicitLiteral.model_validate(value) for value in payload["explicit_places"]),
            tuple(ExplicitLiteral.model_validate(value) for value in payload["explicit_times"]),
        )

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        from PIL import Image
        from qwen_vl_utils import process_vision_info

        torch, _ = _torch_runtime()
        patches: dict[str, ItemPatch] = {}
        for item in items:
            opened: list[Any] = []
            contexts: list[Any] = []
            try:
                selected = {
                    entry.evidence_id
                    for entry in (accumulated[item.input_id].visual_evidence_selection or ())
                    if entry.selected_for_grounding
                }
                sources = [
                    (frame.frame_id, str(frame.working_file_url))
                    for frame in item.frames
                    if frame.frame_id in selected
                ]
                if not sources and item.working_file_url is not None:
                    sources = [(item.input_id, str(item.working_file_url))]
                content: list[dict[str, Any]] = []
                for evidence_id, url in sources:
                    context = self.fetcher.download(url)
                    path = context.__enter__()
                    contexts.append(context)
                    with Image.open(path) as source_image:
                        image = source_image.convert("RGB")
                    opened.append(image)
                    content.extend(
                        [
                            {"type": "text", "text": f"Evidence image id: {evidence_id}"},
                            {"type": "image", "image": image},
                        ]
                    )
                transcript = accumulated[item.input_id].transcript
                context_payload = {
                    "article_text": item.article_text,
                    "transcript": transcript.model_dump(mode="json") if transcript else None,
                    "pixel_regions": [
                        region.model_dump(mode="json")
                        for region in (accumulated[item.input_id].pixel_regions or ())
                    ],
                    "correction": correction,
                }
                if correction:
                    content.append(
                        {
                            "type": "text",
                            "text": (
                                "The previous response was rejected by deterministic validation. "
                                "Return a corrected object using only the exact allowed fields and "
                                "existing evidence identifiers. Remove speculative statements."
                            ),
                        }
                    )
                content.append(
                    {"type": "text", "text": json.dumps(context_payload, ensure_ascii=False)}
                )
                messages = [
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ]
                prompt = self.processor.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
                image_inputs, video_inputs = process_vision_info(messages)
                inputs = self.processor(
                    text=[prompt], images=image_inputs, videos=video_inputs, return_tensors="pt"
                ).to("cuda")
                with torch.inference_mode():
                    generated = self.model.generate(
                        **inputs, max_new_tokens=512, do_sample=False, temperature=None
                    )
                trimmed = generated[:, inputs.input_ids.shape[1] :]
                response = self.processor.batch_decode(
                    trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
                )[0]
                try:
                    observations, places, times = self._parse(response)
                except (TypeError, ValueError) as exc:
                    raise ModelOutputError("Qwen returned invalid JSON or fields") from exc
                patches[item.input_id] = ItemPatch(
                    factual_observations=observations,
                    explicit_places=places,
                    explicit_times=times,
                )
            finally:
                for image in opened:
                    image.close()
                for context in reversed(contexts):
                    context.__exit__(None, None, None)
        return patches


class TransformersAdapterFactory:
    def __init__(
        self,
        *,
        cache_root: Path,
        allowed_hosts: frozenset[str],
        max_download_bytes: int,
        fetcher: MediaFetcher | None = None,
    ) -> None:
        self.cache_root = cache_root
        self.fetcher = fetcher or MediaFetcher(
            allowed_hosts=allowed_hosts, max_bytes=max_download_bytes
        )

    def create(self, spec: ModelSpec) -> ModelAdapter:
        adapter_type: type[_BaseAdapter]
        if spec.role == "asr":
            adapter_type = WhisperAdapter
        elif spec.role == "fire_detection":
            adapter_type = RTDETRAdapter
        elif spec.role == "visual_grounding":
            adapter_type = FlorenceAdapter
        else:
            adapter_type = QwenAdapter
        return adapter_type(spec, cache_root=self.cache_root, fetcher=self.fetcher)
