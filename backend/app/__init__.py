"""冷静购后端。导入即加载本地 .env（密钥）。"""
try:
    from .core.config import load_env

    load_env()
except Exception:  # pragma: no cover - .env 缺失不应阻断导入
    pass
