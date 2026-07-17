from __future__ import annotations

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit


class MediaFetchError(RuntimeError):
    pass


class MediaFetcher:
    def __init__(self, *, allowed_hosts: frozenset[str], max_bytes: int) -> None:
        self.allowed_hosts = allowed_hosts
        self.max_bytes = max_bytes

    @contextmanager
    def download(self, url: str) -> Iterator[Path]:
        import httpx

        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            raise MediaFetchError("media URL is outside the configured internal HTTPS boundary")
        suffix = Path(parsed.path).suffix[:16]
        target: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix="fw-media-", suffix=suffix, delete=False
            ) as tmp:
                target = Path(tmp.name)
                written = 0
                with httpx.stream(
                    "GET",
                    url,
                    follow_redirects=False,
                    timeout=httpx.Timeout(60, connect=10),
                    headers={"Accept": "application/octet-stream"},
                ) as response:
                    if response.status_code != 200:
                        raise MediaFetchError(
                            f"internal media download returned HTTP {response.status_code}"
                        )
                    declared = response.headers.get("content-length")
                    if declared and int(declared) > self.max_bytes:
                        raise MediaFetchError("declared media size exceeds the download budget")
                    for chunk in response.iter_bytes(1024 * 1024):
                        written += len(chunk)
                        if written > self.max_bytes:
                            raise MediaFetchError("streamed media exceeds the download budget")
                        tmp.write(chunk)
            assert target is not None
            yield target
        finally:
            if target is not None:
                target.unlink(missing_ok=True)
