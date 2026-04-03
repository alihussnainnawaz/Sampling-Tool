import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.json"


def _normalize_appender(cfg: dict):
    appender = cfg.get("appender") or {}
    conditions = appender.get("sort_conditions") or ["filename"]
    cleaned = []
    for item in conditions:
        val = str(item).strip()
        if val and val not in cleaned:
            cleaned.append(val)
    if not cleaned:
        cleaned = ["filename"]

    appender.setdefault("sheet_name", "AppendedData")
    appender["sort_conditions"] = cleaned
    appender.setdefault("default_sort_condition", cleaned[0])
    if appender["default_sort_condition"] not in cleaned:
        appender["default_sort_condition"] = cleaned[0]
    cfg["appender"] = appender


def load_config():
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    else:
        cfg = {}

    cfg.setdefault("dataset", {"uuid_col": "uuid"})
    cfg.setdefault("levels", ["DISTRICT"])
    cfg.setdefault("defaults", {"min_count": 50, "sample_count": 50})
    cfg.setdefault("mask_rules", [])
    cfg.setdefault("users", ["Shumail Mehmood"])
    cfg.setdefault("default_user", "Shumail Mehmood")
    cfg.setdefault("testing_prompt_enabled", True)

    if cfg["default_user"] not in cfg["users"]:
        cfg["users"].insert(0, cfg["default_user"])

    _normalize_appender(cfg)
    return cfg


def save_config(cfg: dict):
    cfg = dict(cfg or {})
    _normalize_appender(cfg)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
