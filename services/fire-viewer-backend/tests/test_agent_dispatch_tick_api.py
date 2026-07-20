from __future__ import annotations

from contextlib import contextmanager

from fire_viewer.api import agent_batches as agent_batches_api


def test_dispatcher_tick_rejects_disabled_dispatch(client) -> None:
    response = client.post("/api/v2/admin/agent-batches/dispatcher/tick")

    assert response.status_code == 409, response.text
    assert response.json()["type"].endswith("agent_dispatch_disabled")


def test_dispatcher_tick_runs_the_shared_persisted_dispatcher(
    client,
    settings,
    monkeypatch,
) -> None:
    settings.agent_dispatch_enabled = True
    sentinel_client = object()
    observed: dict[str, object] = {}

    @contextmanager
    def fake_build_runpod_client(actual_settings):
        assert actual_settings is settings
        yield sentinel_client

    def fake_run_dispatcher_once(factory, *, worker_id, settings, client):
        observed.update(
            factory=factory,
            worker_id=worker_id,
            settings=settings,
            client=client,
        )
        return True

    monkeypatch.setattr(agent_batches_api, "build_runpod_client", fake_build_runpod_client)
    monkeypatch.setattr(agent_batches_api, "run_dispatcher_once", fake_run_dispatcher_once)

    response = client.post("/api/v2/admin/agent-batches/dispatcher/tick")

    assert response.status_code == 200, response.text
    assert response.json() == {"processed": True}
    assert observed["factory"] is client.app.state.session_factory
    assert observed["settings"] is settings
    assert observed["client"] is sentinel_client
    assert str(observed["worker_id"]).startswith("admin-dispatcher:tr-")
