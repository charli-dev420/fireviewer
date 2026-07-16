"""Serve the standalone LiDAR QA viewer with Brotli asset headers."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ViewerHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        if self.path.split("?", 1)[0].endswith(".br"):
            self.send_header("Content-Encoding", "br")
            self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4178)
    args = parser.parse_args()
    root = args.root.resolve()
    handler = partial(ViewerHandler, directory=str(root))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"LiDAR viewer: http://{args.host}:{args.port}/tools/spatial-lidar-surface/viewer/", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
