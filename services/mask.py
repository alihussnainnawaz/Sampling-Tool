# services/mask.py
import pandas as pd

def build_mask(df: pd.DataFrame, rules: list):
    """Build boolean mask based on conditional filtering rules"""
    if df is None or df.empty:
        return pd.Series([], dtype=bool)

    if not rules:
        return pd.Series(True, index=df.index)

    mask = pd.Series(True, index=df.index)

    for r in rules:
        col = r.get("col")
        op = (r.get("op") or "").lower().strip()
        val = r.get("value") or r.get("values")

        if not col or col not in df.columns or not op:
            continue

        s = df[col].astype(str).str.strip()

        try:
            if op in ["==", "eq", "equals"]:
                mask &= (s == str(val).strip())

            elif op in ["!=", "neq", "not equals"]:
                mask &= (s != str(val).strip())

            elif op in ["in", "isin"]:
                vals = val if isinstance(val, list) else [val]
                mask &= s.isin([str(v).strip() for v in vals])

            elif op in ["not in", "notin"]:
                vals = val if isinstance(val, list) else [val]
                mask &= ~s.isin([str(v).strip() for v in vals])

            # Fixed: ncontains / not contains
            elif op in ["ncontains", "not contains", "notcontains"]:
                if isinstance(val, str):
                    mask &= ~s.str.contains(val, case=False, na=False, regex=False)
                else:
                    # support list of values to exclude
                    for v in (val if isinstance(val, list) else [val]):
                        mask &= ~s.str.contains(str(v), case=False, na=False, regex=False)

            # contains (positive)
            elif op in ["contains"]:
                if isinstance(val, str):
                    mask &= s.str.contains(val, case=False, na=False, regex=False)
                else:
                    for v in (val if isinstance(val, list) else [val]):
                        mask &= s.str.contains(str(v), case=False, na=False, regex=False)

            elif op == ">":
                mask &= (pd.to_numeric(df[col], errors="coerce") > float(val))
            elif op == ">=":
                mask &= (pd.to_numeric(df[col], errors="coerce") >= float(val))
            elif op == "<":
                mask &= (pd.to_numeric(df[col], errors="coerce") < float(val))
            elif op == "<=":
                mask &= (pd.to_numeric(df[col], errors="coerce") <= float(val))

        except Exception as e:
            print(f"Warning: Mask rule failed - {col} {op} {val} | Error: {e}")
            continue

    return mask.fillna(False)


def apply_filters(df: pd.DataFrame, selected: dict, levels: list):
    """Apply hierarchical selected filters"""
    out = df.copy()
    for lvl in (levels or []):
        vals = selected.get(lvl) or []
        if vals:
            out = out[out[lvl].astype(str).isin([str(x) for x in vals])]
    return out