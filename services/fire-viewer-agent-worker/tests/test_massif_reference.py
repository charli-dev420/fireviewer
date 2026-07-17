from __future__ import annotations

import pytest
from training.massif_reference import normalize_rows


def test_normalize_rows_keeps_only_massif_membership_and_preserves_partial_status() -> None:
    records = normalize_rows(
        (
            ("01001", "Hors", "Hors massif"),
            ("01002", "Dans le Jura", "Jura"),
            ("2A004", "Dans les Alpes en partie", "Alpes (partiellement)"),
            (None, None, None),
        )
    )

    assert [record.massif_id for record in records] == ["jura", "alpes"]
    assert [record.membership for record in records] == ["full", "partial"]


def test_normalize_rows_refuses_unknown_massifs_and_duplicate_communes() -> None:
    with pytest.raises(ValueError, match="Unknown massif"):
        normalize_rows((("01002", "Commune", "Massif imaginaire"),))
    with pytest.raises(ValueError, match="Duplicate COG 2021 code"):
        normalize_rows((("01002", "A", "Jura"), ("01002", "B", "Jura")))
