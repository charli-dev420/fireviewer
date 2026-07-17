from __future__ import annotations

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
