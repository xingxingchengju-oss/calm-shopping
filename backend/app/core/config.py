"""极简 .env 加载（避免引入 python-dotenv 依赖）。"""
from __future__ import annotations

import os
from pathlib import Path


def load_env(path: str | Path | None = None) -> None:
    """读取 backend/.env，把键值灌进 os.environ（不覆盖已存在的变量）。"""
    env_path = Path(path) if path else Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
