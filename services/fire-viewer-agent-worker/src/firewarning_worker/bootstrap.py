"""Cold-start bootstrap for the public FireWarning worker image."""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Protocol, cast

from firewarning_worker.model_provisioning import cache_status, provision_model_cache

DEFAULT_CACHE_ROOT = Path("/runpod-volume/huggingface-cache/hub")
DEFAULT_ROMA_ROOT = Path("/runpod-volume/firewarning-roma")
RUNTIME_MODULES = {
    "serverless": "firewarning_worker.handler",
    "pod_validation": "firewarning_worker.pod_validation",
}


class _PasswdEntry(Protocol):
    pw_gid: int
    pw_uid: int
    pw_dir: str


class _PwdModule(Protocol):
    def getpwnam(self, name: str) -> _PasswdEntry: ...


def _enabled(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _runtime_module() -> str:
    mode = os.getenv("FW_RUN_MODE", "serverless").strip().lower()
    try:
        return RUNTIME_MODULES[mode]
    except KeyError as exc:
        raise RuntimeError(f"unsupported FW_RUN_MODE: {mode}") from exc


@contextmanager
def _volume_lock(path: Path) -> Iterator[None]:
    """Serialize provisioning when several pods share the same model volume."""
    try:
        import fcntl
    except ImportError as exc:  # pragma: no cover - the image runtime is Linux
        raise RuntimeError("the model bootstrap requires a Linux container") from exc

    path.parent.mkdir(parents=True, exist_ok=True)
    stream: BinaryIO
    with path.open("a+b") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)  # type: ignore[attr-defined]
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]


def ensure_model_cache() -> None:
    cache_root = Path(os.getenv("FW_HF_CACHE_ROOT", str(DEFAULT_CACHE_ROOT))).resolve()
    roma_root = Path(os.getenv("FW_ROMA_ROOT", str(DEFAULT_ROMA_ROOT))).resolve()
    lock_path = Path(
        os.getenv(
            "FW_MODEL_PREFETCH_LOCK_PATH",
            str(cache_root.parent / ".firewarning-model-prefetch.lock"),
        )
    ).resolve()
    status = cache_status(cache_root, roma_root)
    if status.ready:
        print("firewarning bootstrap: mounted model cache is ready", flush=True)
        return
    if not _enabled(os.getenv("FW_AUTO_PREFETCH_MODELS"), default=True):
        missing = ", ".join(status.missing)
        raise RuntimeError(
            f"mounted model cache is incomplete and auto-prefetch is disabled: {missing}"
        )

    with _volume_lock(lock_path):
        # Another pod may have completed provisioning while this pod waited.
        status = cache_status(cache_root, roma_root)
        if status.ready:
            print("firewarning bootstrap: shared model cache became ready", flush=True)
            return
        print(
            "firewarning bootstrap: downloading missing pinned weights to mounted storage: "
            + ", ".join(status.missing),
            flush=True,
        )
        os.environ["HF_HUB_OFFLINE"] = "0"
        os.environ["TRANSFORMERS_OFFLINE"] = "0"
        try:
            provision_model_cache(cache_root, roma_root)
        finally:
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
        final_status = cache_status(cache_root, roma_root)
        if not final_status.ready:
            missing = ", ".join(final_status.missing)
            raise RuntimeError(f"mounted model cache remains incomplete: {missing}")


def _drop_runtime_privileges() -> None:
    """Drop the bootstrap's volume-write privileges before starting inference."""
    get_euid = getattr(os, "geteuid", None)
    if get_euid is None or get_euid() != 0:
        return
    try:
        import pwd
    except ImportError as exc:  # pragma: no cover - the image runtime is Linux
        raise RuntimeError("the model bootstrap requires a Linux user database") from exc
    username = os.getenv("FW_RUNTIME_USER", "worker")
    account = cast(_PwdModule, pwd).getpwnam(username)
    os.initgroups(username, account.pw_gid)  # type: ignore[attr-defined]
    os.setgid(account.pw_gid)  # type: ignore[attr-defined]
    os.setuid(account.pw_uid)  # type: ignore[attr-defined]
    os.environ["HOME"] = account.pw_dir
    if get_euid() != account.pw_uid:
        raise RuntimeError(f"failed to drop privileges to {username}")


def main() -> None:
    try:
        runtime_module = _runtime_module()
        ensure_model_cache()
    except Exception as exc:
        print(f"firewarning bootstrap failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(78) from exc

    # A fresh process guarantees that every inference library observes the
    # restored offline flags; the worker can never download a floating model.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    _drop_runtime_privileges()
    os.execv(  # noqa: S606 - fixed executable and argv; shell invocation is intentionally absent
        sys.executable,
        [sys.executable, "-m", runtime_module],
    )


if __name__ == "__main__":
    main()
