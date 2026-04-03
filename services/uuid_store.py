#services/uuid_store.py
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import pandas as pd
import threading

_LOCK = threading.Lock()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UUID_PATH = DATA_DIR / "uuid.csv"

def _ensure_dir():
    DATA_DIR.mkdir(exist_ok=True)

def load_used_uuids(uuid_col: str) -> set[str]:
    _ensure_dir()
    if not UUID_PATH.exists():
        return set()

    try:
        df = pd.read_csv(UUID_PATH)
    except Exception:
        return set()

    if uuid_col not in df.columns:
        return set()

    return set(df[uuid_col].dropna().astype(str).str.strip())

def append_downloaded_rows(sampled_df: pd.DataFrame, uuid_col: str, added_by: str, base_columns: list[str]):
    _ensure_dir()

    added_by = (added_by or "").strip() or "Unknown"
    now = datetime.now().isoformat(timespec="seconds")

    if sampled_df is None or sampled_df.empty:
        return
    if uuid_col not in sampled_df.columns:
        return

    cols = list(base_columns) + ["date_added", "added_by"]

    add_df = sampled_df.copy()
    add_df[uuid_col] = add_df[uuid_col].astype(str).str.strip()
    add_df = add_df[add_df[uuid_col].astype(bool)]

    add_df["date_added"] = now
    add_df["added_by"] = added_by

    add_df = add_df.reindex(columns=cols, fill_value="")

    with _LOCK:
        if UUID_PATH.exists():
            try:
                old = pd.read_csv(UUID_PATH)
            except Exception:
                old = pd.DataFrame(columns=cols)
        else:
            old = pd.DataFrame(columns=cols)

        old = old.reindex(columns=cols, fill_value="")

        existing = set(old[uuid_col].dropna().astype(str).str.strip()) if uuid_col in old.columns else set()
        add_df = add_df[~add_df[uuid_col].isin(existing)]

        out = pd.concat([old, add_df], ignore_index=True)

        if uuid_col in out.columns:
            out = out.drop_duplicates(subset=[uuid_col], keep="first")

        out.to_csv(UUID_PATH, index=False)