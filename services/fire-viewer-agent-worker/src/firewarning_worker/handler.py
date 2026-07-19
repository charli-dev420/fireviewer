from __future__ import annotations

import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from pydantic import ValidationError

from firewarning_worker.adapters import AdapterFactory, UnavailableAdapterFactory
from firewarning_worker.boot_clock import BOOT_STARTED_AT
from firewarning_worker.contracts import (
    ResearchInputV1,
    ResearchOutputV1,
    WorkerInput,
    WorkerInputV2,
)
from firewarning_worker.model_registry import RegistryError, build_registry
from firewarning_worker.security import ConfigurationError, WorkerSettings
from firewarning_worker.session_runner import SessionRunner
from firewarning_worker.v2_runner import from_legacy_output, to_legacy_input
from firewarning_worker.validation import (
    OutputValidationError,
    validate_internal_urls,
    validate_v2_internal_urls,
)

BOOT_READY_MS = round((perf_counter() - BOOT_STARTED_AT) * 1_000)
_GPU_SESSION_LOCK = threading.Lock()


def _research_failure(
    raw_input: dict[str, Any],
    *,
    detail: str,
    retryable: bool,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    spec = build_registry()["source_research"]
    research_id = raw_input.get("research_id", "INVALID")
    output = ResearchOutputV1.model_validate(
        {
            "research_id": research_id if isinstance(research_id, str) else "INVALID",
            "status": "failed",
            "retryable": retryable,
            "model_run": {
                "model_id": spec.model_id,
                "revision": spec.revision,
                "status": "skipped",
                "started_at": now,
                "finished_at": now,
                "load_ms": 0,
                "inference_ms": 0,
                "error_code": detail[:128],
            },
            "queries": [],
            "candidates": [],
            "validation_errors": [detail[:1_000]],
        }
    )
    return output.model_dump(mode="json")


def _runtime_factory(settings: WorkerSettings) -> AdapterFactory:
    if os.getenv("FW_ENABLE_TRANSFORMERS_RUNTIME", "false").lower() != "true":
        return UnavailableAdapterFactory()
    from firewarning_worker.transformers_adapters import TransformersAdapterFactory

    return TransformersAdapterFactory(
        cache_root=Path(settings.hf_cache_root),
        allowed_hosts=settings.allowed_media_hosts,
        max_download_bytes=settings.max_download_bytes,
    )


def handle_job(job: dict[str, Any], *, factory: AdapterFactory | None = None) -> dict[str, Any]:
    raw_input = job.get("input")
    if not isinstance(raw_input, dict):
        return {
            "schema_version": "1.0",
            "batch_id": "INVALID",
            "status": "failed",
            "retryable": False,
            "model_runs": [],
            "items": [],
            "validation_errors": ["input:missing_or_not_an_object"],
            "boot_ms": BOOT_READY_MS,
        }
    requested_schema = raw_input.get("schema_version", "1.0")
    if requested_schema == "research-1.0":
        try:
            research = ResearchInputV1.model_validate(raw_input)
            if not _GPU_SESSION_LOCK.acquire(blocking=False):
                return _research_failure(
                    raw_input,
                    detail="worker:gpu_session_already_active",
                    retryable=True,
                )
            try:
                from firewarning_worker.research_client import run_isolated_research

                return run_isolated_research(research).model_dump(mode="json")
            finally:
                _GPU_SESSION_LOCK.release()
        except (RegistryError, ValidationError) as exc:
            return _research_failure(
                raw_input,
                detail=f"input:{type(exc).__name__}:{exc}",
                retryable=False,
            )
        except Exception as exc:  # isolated service is the runtime failure boundary
            return _research_failure(
                raw_input,
                detail=f"research:{type(exc).__name__}:{exc}",
                retryable=True,
            )
    try:
        settings = WorkerSettings.from_environment()
        batch_v2 = None
        if requested_schema == "2.0":
            batch_v2 = WorkerInputV2.model_validate(raw_input)
            validate_v2_internal_urls(batch_v2, settings.allowed_media_hosts)
            batch = to_legacy_input(batch_v2)
        else:
            batch = WorkerInput.model_validate(raw_input)
            validate_internal_urls(batch.items, settings.allowed_media_hosts)
        registry = build_registry()
        runner = SessionRunner(
            registry=registry,
            adapter_factory=factory or _runtime_factory(settings),
            boot_ms=BOOT_READY_MS,
        )
        if not _GPU_SESSION_LOCK.acquire(blocking=False):
            return {
                "schema_version": "1.0",
                "batch_id": batch.batch_id,
                "status": "failed",
                "retryable": True,
                "model_runs": [],
                "items": [],
                "validation_errors": ["worker:gpu_session_already_active"],
                "boot_ms": BOOT_READY_MS,
            }
        try:
            legacy_output = runner.run(batch)
            if batch_v2 is not None:
                return from_legacy_output(batch_v2, legacy_output).model_dump(mode="json")
            return legacy_output.model_dump(mode="json")
        finally:
            _GPU_SESSION_LOCK.release()
    except (ConfigurationError, OutputValidationError, RegistryError, ValidationError) as exc:
        batch_id = raw_input.get("batch_id", "INVALID")
        failed: dict[str, Any] = {
            "schema_version": "2.0" if requested_schema == "2.0" else "1.0",
            "batch_id": batch_id if isinstance(batch_id, str) else "INVALID",
            "status": "failed",
            "retryable": False,
            "model_runs": [],
            "items": [],
            "validation_errors": [f"input:{type(exc).__name__}:{exc}"],
            "boot_ms": BOOT_READY_MS,
        }
        if requested_schema == "2.0":
            window = raw_input.get("analysis_window")
            failed["analysis_id"] = (
                window.get("analysis_id", "INVALID") if isinstance(window, dict) else "INVALID"
            )
            failed["report_draft"] = None
        return failed


def main() -> None:
    import runpod

    runpod.serverless.start({"handler": handle_job})


if __name__ == "__main__":
    main()
