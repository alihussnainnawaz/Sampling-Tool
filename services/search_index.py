from __future__ import annotations
import re
import pandas as pd

_SEARCH_INDEX: list[dict] = []


def _norm(s) -> str:
    s = str(s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _path_key(parts) -> str:
    return "||".join(str(x) for x in parts)


def build_search_index(df: pd.DataFrame, cfg: dict):
    global _SEARCH_INDEX

    levels = cfg.get("levels") or []
    if df is None or df.empty or not levels:
        _SEARCH_INDEX = []
        return

    usable_levels = [lvl for lvl in levels if lvl in df.columns]
    if not usable_levels:
        _SEARCH_INDEX = []
        return

    items = []
    seen = set()

    for idx, level in enumerate(usable_levels):
        cols = usable_levels[: idx + 1]

        grouped = (
            df[cols]
            .dropna(how="all")
            .drop_duplicates()
            .reset_index(drop=True)
        )

        for _, row in grouped.iterrows():
            path_parts = [str(row[col]) for col in cols]
            label = str(row[level])
            path = " | ".join(path_parts)
            key = _path_key(path_parts)

            selected = {}
            for j, lvl in enumerate(cols):
                if j == len(cols) - 1:
                    # last level uses unique key
                    selected[lvl] = [key]
                else:
                    selected[lvl] = [str(row[lvl])]

            item_id = (level, key)
            if item_id in seen:
                continue
            seen.add(item_id)

            items.append({
                "label": label,
                "label_norm": _norm(label),
                "level": level,
                "level_index": idx,
                "path": path,
                "path_norm": _norm(path),
                "key": key,
                "depth_levels": cols,
                "selected": selected,
            })

    _SEARCH_INDEX = items


def search_index(query: str, limit: int = 12) -> list[dict]:
    q = _norm(query)
    if not q:
        return []

    scored = []

    for item in _SEARCH_INDEX:
        label = item["label_norm"]
        path = item["path_norm"]

        score = None

        if label == q:
            score = 400
        elif label.startswith(q):
            score = 300
        elif any(tok.startswith(q) for tok in label.split()):
            score = 250
        elif q in label:
            score = 200
        elif q in path:
            score = 100

        if score is None:
            continue

        # shorter path and shallower level gets slight priority
        score -= item["level_index"] * 2
        score -= len(item["path"]) * 0.001

        scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)

    out = []
    for _, item in scored[:limit]:
        out.append({
            "label": item["label"],
            "level": item["level"],
            "path": item["path"],
            "key": item["key"],
            "depth_levels": item["depth_levels"],
            "selected": item["selected"],
        })
    return out