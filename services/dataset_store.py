import pandas as pd

_ORIGINAL_DF = pd.DataFrame()
_AVAILABLE_DF = pd.DataFrame()
_FILENAME = None

def set_df(df: pd.DataFrame, filename: str | None = None, cfg: dict | None = None, used_uuids: set[str] | None = None):
    global _ORIGINAL_DF, _AVAILABLE_DF, _FILENAME

    _ORIGINAL_DF = df.copy()
    _FILENAME = filename

    if cfg is None:
        _AVAILABLE_DF = _ORIGINAL_DF.copy()
        return

    uuid_col = cfg.get("dataset", {}).get("uuid_col", "uuid")

    if used_uuids and uuid_col in _ORIGINAL_DF.columns:
        s = _ORIGINAL_DF[uuid_col].astype(str).str.strip()
        _AVAILABLE_DF = _ORIGINAL_DF[~s.isin(used_uuids)].copy()
    else:
        _AVAILABLE_DF = _ORIGINAL_DF.copy()

def deduct_sample(sampled_df: pd.DataFrame, uuid_col: str):
    global _AVAILABLE_DF

    if sampled_df is None or sampled_df.empty:
        return
    if _AVAILABLE_DF is None or _AVAILABLE_DF.empty:
        return
    if uuid_col not in _AVAILABLE_DF.columns or uuid_col not in sampled_df.columns:
        return

    used = set(sampled_df[uuid_col].dropna().astype(str).str.strip())
    if not used:
        return

    s = _AVAILABLE_DF[uuid_col].astype(str).str.strip()
    _AVAILABLE_DF = _AVAILABLE_DF[~s.isin(used)].copy()

def get_df():
    return _AVAILABLE_DF

def get_original_df():
    return _ORIGINAL_DF

def has_data():
    return _AVAILABLE_DF is not None and not _AVAILABLE_DF.empty

def dataset_info():
    return {
        "has_data": has_data(),
        "rows": int(len(_AVAILABLE_DF)) if has_data() else 0,
        "filename": _FILENAME
    }