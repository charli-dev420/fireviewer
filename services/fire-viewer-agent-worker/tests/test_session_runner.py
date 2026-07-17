from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from firewarning_worker.adapters import ItemPatch, ModelOutputError
from firewarning_worker.contracts import (
    BatchItem,
    FactualObservation,
    PixelRegion,
    Transcript,
    TranscriptSegment,
    WorkerInput,
)
from firewarning_worker.model_registry import ModelSpec
from firewarning_worker.session_runner import SessionRunner
from firewarning_worker.transformers_adapters import RTDETRAdapter


@dataclass(slots=True)
class FakeAdapter:
    spec: ModelSpec
    calls: list[tuple[str, bool]]
    failing_role: str | None = None

    def load(self) -> None:
        self.calls.append((f"load:{self.spec.role}", False))

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        self.calls.append((f"infer:{self.spec.role}", correction))
        if self.spec.role == self.failing_role:
            raise RuntimeError("planned failure")
        item = items[0]
        if self.spec.role == "asr":
            return {
                item.input_id: ItemPatch(
                    transcript=Transcript(
                        language="fr",
                        segments=(
                            TranscriptSegment(
                                segment_id=f"{item.input_id}:audio:0001",
                                start_s=0,
                                end_s=1,
                                text="fumée visible",
                            ),
                        ),
                    )
                )
            }
        if self.spec.role == "fire_detection":
            return {
                item.input_id: ItemPatch(
                    pixel_regions=(
                        PixelRegion(
                            region_id="frame-1:det:0001",
                            evidence_id="frame-1",
                            label="smoke_visible",
                            bbox_normalized=(0.1, 0.1, 0.5, 0.5),
                            task="fire_detection",
                            model_score=0.8,
                        ),
                    )
                )
            }
        if self.spec.role == "multimodal_extraction":
            description = "Une fumée est directement visible."
            return {
                item.input_id: ItemPatch(
                    factual_observations=(
                        FactualObservation(
                            type="smoke_visible",
                            evidence_kind="frame",
                            evidence_id="frame-1",
                            region_id="frame-1:det:0001",
                            description=description,
                            certainty="directly_visible",
                        ),
                    )
                )
            }
        return {}

    def unload(self) -> None:
        self.calls.append((f"unload:{self.spec.role}", False))


@dataclass(slots=True)
class FakeFactory:
    failing_role: str | None = None
    calls: list[tuple[str, bool]] = field(default_factory=list)

    def create(self, spec: ModelSpec) -> FakeAdapter:
        return FakeAdapter(spec, self.calls, self.failing_role)


class FakeMemory:
    def reset_peak(self) -> None:
        return None

    def peak_vram_bytes(self) -> int:
        return 123

    def release(self, adapter: FakeAdapter) -> None:
        adapter.unload()


def _batch() -> WorkerInput:
    return WorkerInput.model_validate(
        {
            "batch_id": "BATCH-1",
            "batch_type": "user_media",
            "priority": "user_deadline",
            "items": [
                {
                    "input_id": "INPUT-1",
                    "media_type": "video",
                    "working_file_url": "https://media.internal/video.mp4",
                    "audio_url": "https://media.internal/audio.wav",
                    "frames": [
                        {
                            "frame_id": "frame-1",
                            "timestamp_s": 1,
                            "working_file_url": "https://media.internal/frame.jpg",
                        }
                    ],
                }
            ],
        }
    )


def _registry() -> dict[str, ModelSpec]:
    return {
        role: ModelSpec(role=role, model_id=f"org/{role}", revision=index * 40)
        for role, index in (
            ("asr", "a"),
            ("fire_detection", "b"),
            ("visual_grounding", "c"),
            ("multimodal_extraction", "d"),
        )
    }


def test_models_execute_and_release_in_the_required_order() -> None:
    factory = FakeFactory()
    output = SessionRunner(registry=_registry(), adapter_factory=factory, memory=FakeMemory()).run(
        _batch()
    )
    assert output.status == "succeeded"
    assert [run.model_role for run in output.model_runs] == [
        "asr",
        "fire_detection",
        "visual_grounding",
        "multimodal_extraction",
    ]
    assert [name for name, _ in factory.calls if name.startswith(("load", "unload"))] == [
        "load:asr",
        "unload:asr",
        "load:fire_detection",
        "unload:fire_detection",
        "load:visual_grounding",
        "unload:visual_grounding",
        "load:multimodal_extraction",
        "unload:multimodal_extraction",
    ]


def test_a_model_failure_preserves_previous_stage_results() -> None:
    output = SessionRunner(
        registry=_registry(),
        adapter_factory=FakeFactory(failing_role="visual_grounding"),
        memory=FakeMemory(),
    ).run(_batch())
    assert output.status == "partial_failure"
    assert output.items[0].transcript.segments
    assert output.items[0].pixel_regions
    failed = next(run for run in output.model_runs if run.model_role == "visual_grounding")
    assert failed.status == "failed"
    assert failed.error_code == "model_runtime_error"


@dataclass(slots=True)
class CorrectionAdapter(FakeAdapter):
    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        if self.spec.role != "multimodal_extraction" or correction:
            return FakeAdapter.infer(self, items, accumulated, correction=correction)
        self.calls.append((f"infer:{self.spec.role}", correction))
        item = items[0]
        return {
            item.input_id: ItemPatch(
                factual_observations=(
                    FactualObservation(
                        type="smoke_visible",
                        evidence_kind="frame",
                        evidence_id="frame-1",
                        region_id="frame-1:det:0001",
                        description="La fumée pourrait atteindre la route.",
                        certainty="directly_visible",
                    ),
                )
            )
        }


@dataclass(slots=True)
class CorrectionFactory(FakeFactory):
    def create(self, spec: ModelSpec) -> FakeAdapter:
        return CorrectionAdapter(spec, self.calls, self.failing_role)


def test_qwen_gets_one_strict_correction_after_invalid_output() -> None:
    factory = CorrectionFactory()
    output = SessionRunner(registry=_registry(), adapter_factory=factory, memory=FakeMemory()).run(
        _batch()
    )
    qwen_calls = [
        correction for name, correction in factory.calls if name == "infer:multimodal_extraction"
    ]
    assert qwen_calls == [False, True]
    assert output.status == "succeeded"
    assert output.items[0].factual_observations[0].description == (
        "Une fumée est directement visible."
    )


@dataclass(slots=True)
class MalformedAdapter(FakeAdapter):
    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        if self.spec.role == "multimodal_extraction" and not correction:
            self.calls.append((f"infer:{self.spec.role}", correction))
            raise ModelOutputError("invalid JSON")
        return FakeAdapter.infer(self, items, accumulated, correction=correction)


@dataclass(slots=True)
class MalformedFactory(FakeFactory):
    def create(self, spec: ModelSpec) -> FakeAdapter:
        return MalformedAdapter(spec, self.calls, self.failing_role)


def test_malformed_qwen_json_also_gets_one_correction() -> None:
    factory = MalformedFactory()
    output = SessionRunner(registry=_registry(), adapter_factory=factory, memory=FakeMemory()).run(
        _batch()
    )
    qwen_calls = [
        correction for name, correction in factory.calls if name == "infer:multimodal_extraction"
    ]
    assert qwen_calls == [False, True]
    assert output.status == "succeeded"


def test_ten_cycles_release_every_loaded_adapter() -> None:
    factory = FakeFactory()
    runner = SessionRunner(registry=_registry(), adapter_factory=factory, memory=FakeMemory())
    for _ in range(10):
        assert runner.run(_batch()).status == "succeeded"
    loads = sum(name.startswith("load:") for name, _ in factory.calls)
    unloads = sum(name.startswith("unload:") for name, _ in factory.calls)
    assert loads == unloads == 40


def test_rtdetr_prioritizes_targets_without_dropping_all_context() -> None:
    evidence_ids = [f"frame-{index:02d}" for index in range(12)]
    selected = RTDETRAdapter._select_sources(
        evidence_ids,
        {f"frame-{index:02d}": 1 - index / 100 for index in range(10)},
        limit=8,
    )

    assert len(selected) == 8
    assert set(evidence_ids[:6]).issubset(selected)
    assert len(selected - set(evidence_ids[:6])) == 2


def test_missing_detector_checkpoint_marks_visual_package_partial() -> None:
    registry = _registry()
    registry.pop("fire_detection")

    output = SessionRunner(
        registry=registry, adapter_factory=FakeFactory(), memory=FakeMemory()
    ).run(_batch())

    assert output.status == "partial_failure"
    assert output.items[0].visual_evidence_selection[0].selection_reason == "single_image"
    assert "fire_detection:checkpoint_not_configured" in output.validation_errors
