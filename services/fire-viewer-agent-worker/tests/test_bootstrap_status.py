from __future__ import annotations

import json
from http.client import HTTPConnection

from firewarning_worker.bootstrap_status import start_bootstrap_status_server


def _get_health(port: int) -> tuple[int, dict[str, object]]:
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("GET", "/healthz")
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


def test_bootstrap_health_reports_progress_before_worker_is_ready() -> None:
    status_server = start_bootstrap_status_server(0)
    try:
        status_server.status.update("provisioning_models")

        status, payload = _get_health(status_server.port)

        assert status == 503
        assert payload["status"] == "provisioning"
        assert payload["stage"] == "provisioning_models"
        assert payload["ready"] is False
        assert isinstance(payload["elapsed_ms"], int)
    finally:
        status_server.close()


def test_bootstrap_health_redacts_failure_secrets() -> None:
    status_server = start_bootstrap_status_server(0)
    try:
        status_server.status.fail(
            RuntimeError(
                "x" * 600
                + " Bearer private-token hf_private "
                + "a" * 96
                + " https://user:password@example.test/file?token=query-token download failed"
            )
        )

        status, payload = _get_health(status_server.port)

        assert status == 503
        assert payload["status"] == "failed"
        assert payload["stage"] == "failed"
        assert payload["error_type"] == "RuntimeError"
        detail = str(payload["error_detail"])
        assert "private-token" not in detail
        assert "hf_private" not in detail
        assert "a" * 96 not in detail
        assert "password" not in detail
        assert "query-token" not in detail
        assert detail.count("[redacted]") == 5
    finally:
        status_server.close()
