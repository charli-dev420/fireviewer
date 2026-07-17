from __future__ import annotations

import os
import re
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Literal

ModelRole = Literal["asr", "fire_detection", "visual_grounding", "multimodal_extraction"]
_IMMUTABLE_REVISION = re.compile(r"^[0-9a-f]{40}$")


class RegistryError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ModelSpec:
    role: ModelRole
    model_id: str
    revision: str
    source: Literal["huggingface", "local"] = "huggingface"

    def validate(self) -> None:
        if self.source == "huggingface" and not _IMMUTABLE_REVISION.fullmatch(self.revision):
            raise RegistryError(f"{self.role} must use a 40-character immutable commit SHA")
        if self.source == "local" and not re.fullmatch(r"sha256:[0-9a-f]{64}", self.revision):
            raise RegistryError(f"{self.role} local model must use a sha256 digest")


PUBLIC_MODELS: tuple[ModelSpec, ...] = (
    ModelSpec(
        role="asr",
        model_id="openai/whisper-large-v3-turbo",
        revision="41f01f3fe87f28c78e2fbf8b568835947dd65ed9",
    ),
    ModelSpec(
        role="visual_grounding",
        model_id="microsoft/Florence-2-large-ft",
        revision="4a12a2b54b7016a48a22037fbd62da90cd566f2a",
    ),
    ModelSpec(
        role="multimodal_extraction",
        model_id="Qwen/Qwen3-VL-4B-Instruct",
        revision="ebb281ec70b05090aa6165b016eac8ec08e71b17",
    ),
)


def build_registry() -> dict[ModelRole, ModelSpec]:
    registry = {spec.role: spec for spec in PUBLIC_MODELS}
    checkpoint = os.getenv("FW_RTDETR_CHECKPOINT_PATH")
    digest = os.getenv("FW_RTDETR_CHECKPOINT_SHA256")
    if checkpoint or digest:
        if not checkpoint or not digest:
            raise RegistryError("RT-DETR path and SHA-256 digest must be configured together")
        path = Path(checkpoint)
        if not path.exists():
            raise RegistryError(f"RT-DETR checkpoint does not exist: {path}")
        weights = path / "model.safetensors" if path.is_dir() else path
        if not weights.is_file():
            raise RegistryError("RT-DETR directory must contain model.safetensors")
        digest_value = digest.removeprefix("sha256:")
        actual_digest = sha256()
        with weights.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                actual_digest.update(chunk)
        if actual_digest.hexdigest() != digest_value:
            raise RegistryError("RT-DETR checkpoint SHA-256 does not match configuration")
        spec = ModelSpec(
            role="fire_detection",
            model_id=str(path),
            revision=f"sha256:{digest_value}",
            source="local",
        )
        spec.validate()
        registry[spec.role] = spec
    for spec in registry.values():
        spec.validate()
    return registry


def resolve_cached_snapshot(spec: ModelSpec, cache_root: Path) -> Path:
    """Resolve only the exact pinned snapshot; never fall back to a floating ref or network."""
    if spec.source == "local":
        return Path(spec.model_id)
    repository = cache_root / f"models--{spec.model_id.replace('/', '--')}" / "snapshots"
    snapshot = repository / spec.revision
    if not snapshot.is_dir():
        raise RegistryError(f"pinned model snapshot is absent from cache: {snapshot}")
    return snapshot
