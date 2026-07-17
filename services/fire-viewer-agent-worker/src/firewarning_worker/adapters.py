from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from firewarning_worker.contracts import (
    BatchItem,
    ExplicitLiteral,
    FactualObservation,
    PixelRegion,
    Transcript,
    VisualEvidenceSelection,
)
from firewarning_worker.model_registry import ModelRole, ModelSpec


class ModelOutputError(ValueError):
    """The model answered, but its response could not satisfy the closed contract."""


@dataclass(frozen=True, slots=True)
class ItemPatch:
    transcript: Transcript | None = None
    pixel_regions: tuple[PixelRegion, ...] | None = None
    visual_evidence_selection: tuple[VisualEvidenceSelection, ...] | None = None
    factual_observations: tuple[FactualObservation, ...] | None = None
    explicit_places: tuple[ExplicitLiteral, ...] | None = None
    explicit_times: tuple[ExplicitLiteral, ...] | None = None


class ModelAdapter(Protocol):
    spec: ModelSpec

    def load(self) -> None: ...

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]: ...

    def unload(self) -> None: ...


class AdapterFactory(Protocol):
    def create(self, spec: ModelSpec) -> ModelAdapter: ...


@dataclass(slots=True)
class UnavailableAdapter:
    """Explicit failure used when a production model integration is not installed."""

    spec: ModelSpec

    def load(self) -> None:
        raise RuntimeError(f"runtime adapter unavailable for {self.spec.role}")

    def infer(
        self,
        items: Sequence[BatchItem],
        accumulated: Mapping[str, ItemPatch],
        *,
        correction: bool = False,
    ) -> Mapping[str, ItemPatch]:
        raise RuntimeError(f"runtime adapter unavailable for {self.spec.role}")

    def unload(self) -> None:
        return None


@dataclass(slots=True)
class UnavailableAdapterFactory:
    created: list[ModelRole] = field(default_factory=list)

    def create(self, spec: ModelSpec) -> ModelAdapter:
        self.created.append(spec.role)
        return UnavailableAdapter(spec)
