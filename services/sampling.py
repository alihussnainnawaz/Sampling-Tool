#services/sampling.py
import io
import pandas as pd
from services.mask import build_mask, apply_filters


def _path_key(parts) -> str:
    return "||".join(str(x) for x in parts)


def options_for_level(df: pd.DataFrame, cfg: dict, depth_levels: list, level: str, selected: dict, min_count: int = 0):
    if level not in depth_levels:
        return []

    idx = depth_levels.index(level)

    # require parent selection before showing child options
    if idx > 0:
        parent = depth_levels[idx - 1]
        if len(selected.get(parent) or []) == 0:
            return []

    m = build_mask(df, cfg.get("mask_rules", []))
    base = df[m]

    prev_levels = depth_levels[:idx]
    base = apply_filters(base, selected, prev_levels)

    if level not in base.columns:
        return []

    group_cols = depth_levels[:idx + 1]

    counts = (
        base.groupby(group_cols, dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
    )

    # only filter min_count on LAST level
    if idx == len(depth_levels) - 1:
        counts = counts[counts["count"] >= int(min_count)]

    out = []
    for _, r in counts.iterrows():
        path_parts = [str(r[col]) for col in group_cols]
        out.append({
            "value": str(r[level]),
            "count": int(r["count"]),
            "path": " | ".join(path_parts),
            "key": _path_key(path_parts),   # ✅ unique full-path key
        })

    return out


def preview_last_level(df: pd.DataFrame, cfg: dict, depth_levels: list, selected: dict, min_count: int):
    if not depth_levels:
        return []

    last = depth_levels[-1]

    m = build_mask(df, cfg.get("mask_rules", []))
    base = df[m]
    base = apply_filters(base, selected, depth_levels[:-1])

    if last not in base.columns:
        return []

    group_cols = depth_levels

    c = (
        base.groupby(group_cols, dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
    )

    out = []
    for _, r in c.iterrows():
        path_parts = [str(r[col]) for col in group_cols]
        out.append({
            "group": str(r[last]),
            "count": int(r["count"]),
            "eligible": int(r["count"]) >= int(min_count),
            "path": " | ".join(path_parts),
            "key": _path_key(path_parts),
        })
    return out


def sample_download_csv(
    df: pd.DataFrame,
    cfg: dict,
    depth_levels: list,
    selected: dict,
    min_count: int,
    sample_count: int,
    quota=None,
    return_df=False
):
    quota = quota or {}

    if not depth_levels:
        out = df.head(0)
    else:
        last = depth_levels[-1]

        m = build_mask(df, cfg.get("mask_rules", []))
        base = df[m]

        # ✅ apply only parent filters normally
        parent_levels = depth_levels[:-1]
        base = apply_filters(base, selected, parent_levels)

        if last not in base.columns:
            out = base.head(0)
        else:
            parts = []
            selected_last_keys = set(str(x) for x in (selected.get(last) or []))
            group_cols = depth_levels

            for group_values, gdf in base.groupby(group_cols, dropna=False):
                if not isinstance(group_values, tuple):
                    group_values = (group_values,)

                group_key = _path_key(group_values)

                # ✅ only sample selected full-path rows
                if selected_last_keys and group_key not in selected_last_keys:
                    continue

                if len(gdf) < int(min_count):
                    continue

                n = quota.get(group_key, sample_count)
                try:
                    n = int(n)
                except Exception:
                    n = int(sample_count)

                n = max(0, min(len(gdf), n))
                if n == 0:
                    continue

                parts.append(gdf.sample(n=n, random_state=42))

            out = pd.concat(parts, ignore_index=True) if parts else base.head(0)

            out = out.sort_values(depth_levels).reset_index(drop=True)

    buf = io.BytesIO()
    out.to_excel(buf, index=False) #save in excel
    buf.seek(0)

    if return_df:
        return buf, out
    return buf