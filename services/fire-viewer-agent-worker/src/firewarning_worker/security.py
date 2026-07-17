from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class WorkerSettings:
    allowed_media_hosts: frozenset[str]
    hf_cache_root: str
    max_download_bytes: int

    @classmethod
    def from_environment(cls) -> WorkerSettings:
        hosts = frozenset(
            host.strip().lower()
            for host in os.getenv("FW_ALLOWED_MEDIA_HOSTS", "").split(",")
            if host.strip()
        )
        if not hosts:
            raise ConfigurationError("FW_ALLOWED_MEDIA_HOSTS is required")
        max_bytes = int(os.getenv("FW_MAX_DOWNLOAD_BYTES", str(512 * 1024 * 1024)))
        if not 1_048_576 <= max_bytes <= 2_147_483_648:
            raise ConfigurationError("FW_MAX_DOWNLOAD_BYTES must be between 1 MiB and 2 GiB")
        return cls(
            allowed_media_hosts=hosts,
            hf_cache_root=os.getenv("FW_HF_CACHE_ROOT", "/runpod-volume/huggingface-cache/hub"),
            max_download_bytes=max_bytes,
        )
