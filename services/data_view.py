# services/data_view.py
from services.dataset_store import get_df
from services.uuid_store import load_used_uuids
from services.mask import build_mask

def effective_df(cfg: dict):
    """
    Returns DataFrame after applying UUID exclusion + Conditional Filtering (mask)
    """
    df = get_df()
    if df is None or df.empty:
        return df

    # Apply UUID exclusion
    uuid_col = cfg.get("dataset", {}).get("uuid_col", "uuid")
    used = load_used_uuids(uuid_col)
    if used and uuid_col in df.columns:
        s = df[uuid_col].astype(str).str.strip()
        df = df[~s.isin(used)]

    # Apply Conditional Filtering (Mask)
    mask = build_mask(df, cfg.get("mask_rules", []))
    return df[mask]