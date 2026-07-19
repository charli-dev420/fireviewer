from __future__ import annotations

from datetime import UTC, datetime, timedelta

from firewarning_worker.contracts import ResearchOutputV1
from firewarning_worker.handler import handle_job


def test_handler_fails_closed_when_input_is_missing() -> None:
    result = handle_job({})
    assert result["status"] == "failed"
    assert result["retryable"] is False
    assert result["items"] == []


def test_handler_rejects_an_external_media_url(monkeypatch) -> None:
    monkeypatch.setenv("FW_ALLOWED_MEDIA_HOSTS", "media.internal")
    result = handle_job(
        {
            "input": {
                "batch_id": "BATCH-1",
                "batch_type": "user_media",
                "priority": "user_deadline",
                "items": [
                    {
                        "input_id": "INPUT-1",
                        "media_type": "image",
                        "working_file_url": "https://example.org/image.jpg",
                    }
                ],
            }
        }
    )
    assert result["status"] == "failed"
    assert "not allowed" in result["validation_errors"][0]


def test_handler_routes_research_contract_to_isolated_service(monkeypatch) -> None:
    now = datetime.now(UTC)
    cutoff = now + timedelta(hours=1)
    captured = []

    def fake_isolated(research):
        captured.append(research)
        return ResearchOutputV1.model_validate(
            {
                "research_id": research.research_id,
                "status": "succeeded",
                "retryable": False,
                "model_run": {
                    "model_id": "Qwen/Qwen3-4B-Instruct-2507",
                    "revision": "e7974da369bd887ad4f10a072ec4f933ac5391bf",
                    "status": "succeeded",
                    "started_at": now,
                    "finished_at": now,
                    "load_ms": 1,
                    "inference_ms": 1,
                },
            }
        )

    monkeypatch.setattr(
        "firewarning_worker.research_client.run_isolated_research",
        fake_isolated,
    )
    result = handle_job(
        {
            "input": {
                "schema_version": "research-1.0",
                "operation": "source_research",
                "research_id": "research-die-0001",
                "analysis_window": {
                    "analysis_id": "analysis-die-0001",
                    "fire_id": "FR-26-00001",
                    "episode_id": "E01",
                    "window_start_at": now.isoformat(),
                    "window_end_at": cutoff.isoformat(),
                    "local_date": now.date().isoformat(),
                    "timezone": "Europe/Paris",
                },
                "incident_name": "Incendie de Die",
                "incident_reference": [5.37, 44.75],
                "cutoff_at": cutoff.isoformat(),
                "location_hint": "Die, massif de Justin",
                "source_registry_version": "firewarning-fr-sources-2026-07-19-v1",
                "allowed_domains": ["mairie-die.fr"],
                "source_policies": {
                    "mairie-die.fr": {
                        "source_name": "Ville de Die",
                        "kind": "authority",
                        "scope": "local",
                        "confidence_level": "A+",
                        "claim_types": [
                            "operational_confirmation",
                            "local_instruction",
                        ],
                        "publication_policy": "per_item_license_check",
                        "minimum_refresh_minutes": 10,
                    }
                },
                "search_templates": {
                    "search.example": "https://search.example/recherche?q={query}"
                },
                "max_fetch_bytes": 1_048_576,
                "request_timeout_seconds": 20,
                "private_upload": {
                    "pathname_prefix": "firewarning/source-packages/upload-test",
                    "upload_grant": "g" * 128,
                    "token_endpoint": "https://fireviewer.example/api/v1/admin/blob-upload-token",
                    "resource_id": "research-die-0001",
                    "maximum_file_size_bytes": 10_485_760,
                    "allowed_content_types": ["image/jpeg", "text/html"],
                },
            }
        }
    )

    assert result["schema_version"] == "research-1.0"
    assert result["status"] == "succeeded"
    assert len(captured) == 1
    assert captured[0].private_upload.upload_grant == "g" * 128
