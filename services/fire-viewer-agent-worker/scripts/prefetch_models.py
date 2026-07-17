from __future__ import annotations

import argparse
import os
from pathlib import Path

# This is the only network-enabled entry point in the image.  It runs on an
# administration/CPU pod before the billed GPU worker and writes only to the
# mounted persistent volumes.  The handler keeps the image-level offline flags.
os.environ["HF_HUB_OFFLINE"] = "0"
os.environ["TRANSFORMERS_OFFLINE"] = "0"

from firewarning_worker.model_provisioning import provision_model_cache


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Provision immutable model snapshots outside the billed GPU worker."
    )
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument(
        "--roma-root",
        type=Path,
        required=True,
        help="External persistent volume for verified RoMa and DINOv2 weights.",
    )
    parser.add_argument(
        "--skip-qwen",
        action="store_true",
        help="Create an intentionally incomplete cache for media-only smoke tests.",
    )
    args = parser.parse_args()
    manifest = provision_model_cache(
        args.cache_root,
        args.roma_root,
        skip_qwen=args.skip_qwen,
    )
    for model in manifest["models"]:
        print(f"{model['role']}\t{model['revision']}\t{model['model_id']}")
    print(f"spatial_registration\t{manifest['roma_source_revision']}\t{args.roma_root.resolve()}")


if __name__ == "__main__":
    main()
