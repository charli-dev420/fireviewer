from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from time import perf_counter
from typing import Literal

from firewarning_worker.adapters import AdapterFactory, ItemPatch, ModelOutputError
from firewarning_worker.contracts import (
    GeographicMarkerCandidate,
    ItemResult,
    LocationOrigin,
    LocationStatus,
    MetadataResult,
    ModelRun,
    Transcript,
    VisualEvidenceSelection,
    WorkerInput,
    WorkerOutput,
)
from firewarning_worker.memory_manager import MemoryManager, synchronize_cuda
from firewarning_worker.model_registry import ModelRole, ModelSpec
from firewarning_worker.validation import OutputValidationError, validate_item_result

PipelineModelRole = Literal["asr", "fire_detection", "visual_grounding", "multimodal_extraction"]
ROLE_ORDER: tuple[PipelineModelRole, ...] = (
    "asr",
    "fire_detection",
    "visual_grounding",
    "multimodal_extraction",
)


def _now() -> datetime:
    return datetime.now(UTC)


def _initial_result(item: object) -> ItemResult:
    from firewarning_worker.contracts import BatchItem

    assert isinstance(item, BatchItem)
    metadata = item.metadata
    has_coordinates = metadata.latitude is not None
    origin = metadata.location_origin
    marker = None
    status = LocationStatus.NO_LOCATION
    if has_coordinates:
        if origin == LocationOrigin.METADATA:
            status = LocationStatus.CAPTURE_LOCATION_ONLY
        elif origin == LocationOrigin.USER_DECLARED:
            status = LocationStatus.USER_DECLARED_OBSERVATION_LOCATION
        elif origin == LocationOrigin.EXPLICIT_SOURCE_GEOMETRY:
            status = LocationStatus.EXPLICIT_SOURCE_GEOMETRY
        elif origin == LocationOrigin.HUMAN_CONFIRMED:
            status = LocationStatus.HUMAN_CONFIRMED_OBSERVATION_LOCATION
        assert origin is not None
        marker = GeographicMarkerCandidate(type="media_capture", geometry_origin=origin)
    visual_sources = [frame.frame_id for frame in item.frames]
    if not visual_sources and item.working_file_url is not None:
        visual_sources = [item.input_id]
    fallback_selected = set(_temporal_sample(visual_sources, limit=8))
    visual_selection = tuple(
        VisualEvidenceSelection(
            evidence_id=evidence_id,
            selected_for_grounding=evidence_id in fallback_selected,
            selection_reason=(
                "single_image"
                if len(visual_sources) == 1
                else "detector_fallback"
                if evidence_id in fallback_selected
                else "capacity_limit"
            ),
        )
        for evidence_id in visual_sources
    )
    return ItemResult(
        input_id=item.input_id,
        metadata_result=MetadataResult(
            capture_location_available=has_coordinates,
            capture_location_origin=origin,
        ),
        transcript=Transcript(),
        visual_evidence_selection=visual_selection,
        location_status=status,
        geographic_marker_candidate=marker,
    )


def _temporal_sample(evidence_ids: list[str], *, limit: int) -> tuple[str, ...]:
    if len(evidence_ids) <= limit:
        return tuple(evidence_ids)
    if limit == 1:
        return (evidence_ids[len(evidence_ids) // 2],)
    indexes = {round(position * (len(evidence_ids) - 1) / (limit - 1)) for position in range(limit)}
    return tuple(evidence_ids[index] for index in sorted(indexes))


def _as_patch(result: ItemResult) -> ItemPatch:
    return ItemPatch(
        transcript=result.transcript,
        pixel_regions=result.pixel_regions,
        visual_evidence_selection=result.visual_evidence_selection,
        factual_observations=result.factual_observations,
        explicit_places=result.explicit_places,
        explicit_times=result.explicit_times,
    )


def _merge(result: ItemResult, patch: ItemPatch) -> ItemResult:
    updates = {
        field: value
        for field, value in (
            ("transcript", patch.transcript),
            ("pixel_regions", patch.pixel_regions),
            ("visual_evidence_selection", patch.visual_evidence_selection),
            ("factual_observations", patch.factual_observations),
            ("explicit_places", patch.explicit_places),
            ("explicit_times", patch.explicit_times),
        )
        if value is not None
    }
    return result.model_copy(update=updates)


def _validated_candidates(
    batch: WorkerInput,
    results: Mapping[str, ItemResult],
    patches: Mapping[str, ItemPatch],
) -> dict[str, ItemResult]:
    candidate = dict(results)
    for input_id, patch in patches.items():
        if input_id not in candidate:
            raise OutputValidationError(f"adapter returned unknown input_id {input_id}")
        candidate[input_id] = _merge(candidate[input_id], patch)
    for item in batch.items:
        validate_item_result(item, candidate[item.input_id])
    return candidate


def _role_has_work(role: PipelineModelRole, batch: WorkerInput) -> bool:
    if role == "asr":
        return any(item.audio_url is not None for item in batch.items)
    if role in {"fire_detection", "visual_grounding"}:
        return any(item.working_file_url is not None or item.frames for item in batch.items)
    return True


class SessionRunner:
    def __init__(
        self,
        *,
        registry: Mapping[ModelRole, ModelSpec],
        adapter_factory: AdapterFactory,
        memory: MemoryManager | None = None,
        boot_ms: int = 0,
    ) -> None:
        self.registry = registry
        self.adapter_factory = adapter_factory
        self.memory = memory or MemoryManager()
        self.boot_ms = boot_ms

    def run(self, batch: WorkerInput) -> WorkerOutput:
        results = {item.input_id: _initial_result(item) for item in batch.items}
        runs: list[ModelRun] = []
        errors: list[str] = []

        for role in ROLE_ORDER:
            spec = self.registry.get(role)
            if spec is None:
                if role == "fire_detection":
                    errors.append("fire_detection:checkpoint_not_configured")
                    moment = _now()
                    runs.append(
                        ModelRun(
                            model_role=role,
                            model_id="unconfigured",
                            revision="unconfigured",
                            status="skipped",
                            started_at=moment,
                            finished_at=moment,
                            load_ms=0,
                            inference_ms=0,
                            error_code="checkpoint_not_configured",
                        )
                    )
                continue
            started_at = _now()
            if not _role_has_work(role, batch):
                runs.append(
                    ModelRun(
                        model_role=role,
                        model_id=spec.model_id,
                        revision=spec.revision,
                        status="skipped",
                        started_at=started_at,
                        finished_at=_now(),
                        load_ms=0,
                        inference_ms=0,
                    )
                )
                continue

            adapter = self.adapter_factory.create(spec)
            load_started = perf_counter()
            load_ms = 0
            inference_ms = 0
            peak_vram: int | None = None
            error_code: str | None = None
            status: Literal["succeeded", "failed", "skipped"] = "failed"
            try:
                self.memory.reset_peak()
                adapter.load()
                synchronize_cuda()
                load_ms = round((perf_counter() - load_started) * 1_000)
                infer_started = perf_counter()
                try:
                    patches = adapter.infer(
                        batch.items,
                        {input_id: _as_patch(result) for input_id, result in results.items()},
                    )
                    synchronize_cuda()
                    inference_ms = round((perf_counter() - infer_started) * 1_000)
                    candidate = _validated_candidates(batch, results, patches)
                except (ModelOutputError, OutputValidationError) as first_validation_error:
                    if role != "multimodal_extraction":
                        raise
                    correction_started = perf_counter()
                    corrected = adapter.infer(
                        batch.items,
                        {input_id: _as_patch(result) for input_id, result in results.items()},
                        correction=True,
                    )
                    synchronize_cuda()
                    inference_ms += round((perf_counter() - correction_started) * 1_000)
                    try:
                        candidate = _validated_candidates(batch, results, corrected)
                    except OutputValidationError as correction_error:
                        raise correction_error from first_validation_error
                results = candidate
                status = "succeeded"
            except (ModelOutputError, OutputValidationError) as exc:
                error_code = "invalid_model_output"
                errors.append(f"{role}:{error_code}:{exc}")
            except Exception as exc:  # model runtimes expose heterogeneous exception trees
                error_code = "model_runtime_error"
                errors.append(f"{role}:{error_code}:{type(exc).__name__}")
            finally:
                peak_vram = self.memory.peak_vram_bytes()
                self.memory.release(adapter)

            runs.append(
                ModelRun(
                    model_role=role,
                    model_id=spec.model_id,
                    revision=spec.revision,
                    status=status,
                    started_at=started_at,
                    finished_at=_now(),
                    load_ms=load_ms,
                    inference_ms=inference_ms,
                    peak_vram_bytes=peak_vram,
                    error_code=error_code,
                )
            )

        succeeded = sum(run.status == "succeeded" for run in runs)
        failed = sum(run.status == "failed" for run in runs)
        incomplete = any(run.status == "skipped" and run.error_code for run in runs)
        if failed == 0 and not incomplete:
            overall_status: Literal["succeeded", "partial_failure", "failed"] = "succeeded"
        elif succeeded or incomplete:
            overall_status = "partial_failure"
        else:
            overall_status = "failed"
        return WorkerOutput(
            batch_id=batch.batch_id,
            status=overall_status,
            retryable=any("model_runtime_error" in error for error in errors),
            model_runs=tuple(runs),
            items=tuple(results[item.input_id] for item in batch.items),
            validation_errors=tuple(errors),
            boot_ms=self.boot_ms,
        )
