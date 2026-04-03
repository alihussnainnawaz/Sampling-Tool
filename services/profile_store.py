# services/profile_store.py
import json
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROFILES_PATH = DATA_DIR / "profiles.json"

def _ensure_dir():
    DATA_DIR.mkdir(exist_ok=True)

def _read():
    _ensure_dir()
    if not PROFILES_PATH.exists():
        return {"schema_version": 1, "profiles": {}}
    try:
        return json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
    except Exception:
        # if corrupted, don't crash app; start fresh
        return {"schema_version": 1, "profiles": {}}

def _write(obj: dict):
    _ensure_dir()
    PROFILES_PATH.write_text(json.dumps(obj, indent=2), encoding="utf-8")

def list_profiles():
    obj = _read()
    profiles = obj.get("profiles", {}) or {}
    out = []
    for name, p in profiles.items():
        out.append({
            "name": name,
            "saved_at": p.get("saved_at")
        })
    # newest first if saved_at exists
    out.sort(key=lambda x: x.get("saved_at") or "", reverse=True)
    return out

def get_profile(name: str):
    obj = _read()
    return (obj.get("profiles", {}) or {}).get(name)

def upsert_profile(name: str, profile: dict):
    obj = _read()
    profiles = obj.setdefault("profiles", {})

    profile = profile or {}

    # no timestamp
    profiles[name] = profile

    _write(obj)

def delete_profile(name: str):
    obj = _read()
    profiles = obj.get("profiles", {}) or {}
    if name in profiles:
        del profiles[name]
        _write(obj)
        return True
    return False