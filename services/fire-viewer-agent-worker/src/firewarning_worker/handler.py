from __future__ import annotations

import os
import threading
from pathlib import Path
from time import perf_counter
from typing import Any

from pydantic import ValidationError

from firewarning_worker.adapters import AdapterFactory, UnavailableAdapterFactory
from firewarning_worker.boot_clock import BOOT_STARTED_AT
from firewarning_worker.contracts import WorkerInput
from firewarning_worker.model_registry import RegistryError, build_registry
from firewarning_worker.security import ConfigurationError, WorkerSettings
from firewarning_worker.session_runner import SessionRunner
from firewarning_worker.validation import OutputValidationError, validate_internal_urls

BOOT_READY_MS = round((perf_counter() - BOOT_STARTED_AT) * 1_000)
_GPU_SESSION_LOCK = threading.Lock()


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
    try:
        settings = WorkerSettings.from_environment()
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
            return runner.run(batch).model_dump(mode="json")
        finally:
            _GPU_SESSION_LOCK.release()
    except (ConfigurationError, OutputValidationError, RegistryError, ValidationError) as exc:
        batch_id = raw_input.get("batch_id", "INVALID")
        return {
            "schema_version": "1.0",
            "batch_id": batch_id if isinstance(batch_id, str) else "INVALID",
            "status": "failed",
            "retryable": False,
            "model_runs": [],
            "items": [],
            "validation_errors": [f"input:{type(exc).__name__}:{exc}"],
            "boot_ms": BOOT_READY_MS,
        }


def main() -> None:
    import runpod

    runpod.serverless.start({"handler": handle_job})


if __name__ == "__main__":
    main()
