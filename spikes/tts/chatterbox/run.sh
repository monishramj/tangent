#!/bin/sh
set -eu
cd "$(dirname "$0")"
export UV_CACHE_DIR="$PWD/.cache/uv"
export HF_HOME="$PWD/.cache/huggingface" TORCH_HOME="$PWD/.cache/torch"
export XDG_CACHE_HOME="$PWD/.cache" PYTHONDONTWRITEBYTECODE=1
uv run --python 3.12 python spike.py
uv run --python 3.12 pytest -q
