# services/auto_sampler.py
"""
Automated sampling engine supporting 4 methods:
  - simple_random
  - stratified
  - cluster
  - systematic
"""
import math
import io
import pandas as pd
import numpy as np
from datetime import datetime


# ── Cochran helpers ─────────────────────────────────────────────────────────

def cochran_n0(z, p, e):
    return (z ** 2 * p * (1 - p)) / (e ** 2)


def finite_correction(n0, N):
    return n0 / (1 + (n0 - 1) / N)


def compute_cochran(z, p, e, N=None):
    n0 = cochran_n0(z, p, e)
    n0_ceil = math.ceil(n0)
    result = {"n0_raw": round(n0, 4), "n0_ceil": n0_ceil, "N": N}
    if N and N > 0:
        nf = finite_correction(n0, N)
        result["n_corrected_raw"] = round(nf, 4)
        result["n_final"] = math.ceil(nf)
    else:
        result["n_final"] = n0_ceil
    return result


# ── Strata parsing ───────────────────────────────────────────────────────────

def parse_strata(strata_list, df):
    """
    strata_list: [{"column": "Gender", "filters": [{"value": "Male", "pct": 60}, ...]}, ...]
    Returns dict of {label: mask} for each stratum cell.
    """
    if not strata_list:
        return None

    # Validate columns exist
    for s in strata_list:
        col = s.get("column")
        if col and col not in df.columns:
            raise ValueError(f"Column '{col}' not found in dataset")
    return strata_list


# ── Sampling methods ─────────────────────────────────────────────────────────

def sample_simple_random(df, n, random_state=42):
    n = min(n, len(df))
    return df.sample(n=n, random_state=random_state).copy()


def sample_stratified(df, n, strata_list, random_state=42):
    """
    strata_list: list of dicts with:
      column: str
      filters: list of {value, pct}  (pct across all filters in this column should sum ~100)
    Multiple columns = nested strata (intersection).
    Returns sampled df + breakdown list.
    """
    rng = np.random.RandomState(random_state)
    parts = []
    breakdown = []

    # Build combined strata from cartesian product of all column filters
    # Flatten: we use all combinations
    if not strata_list:
        return sample_simple_random(df, n, random_state), []

    # Build strata cells
    cells = _build_strata_cells(strata_list)

    total_pct = sum(c["pct"] for c in cells)
    for cell in cells:
        mask = pd.Series(True, index=df.index)
        for col, val in cell["filters"].items():
            mask &= df[col].astype(str).str.strip() == str(val).strip()

        cell_df = df[mask]
        alloc = max(1, round((cell["pct"] / total_pct) * n)) if total_pct > 0 else 0
        alloc = min(alloc, len(cell_df))

        sampled = cell_df.sample(n=alloc, random_state=int(rng.randint(0, 99999))) if alloc > 0 else cell_df.head(0)
        parts.append(sampled)

        breakdown.append({
            "label": cell["label"],
            "group_population": len(cell_df),
            "allocated_pct": cell["pct"],
            "sample_count": alloc,
        })

    result = pd.concat(parts, ignore_index=True) if parts else df.head(0)
    return result, breakdown


def _build_strata_cells(strata_list):
    """Build cartesian product of strata for multiple columns."""
    from itertools import product as iproduct

    cols_filters = []
    for s in strata_list:
        col = s["column"]
        filters = s.get("filters", [])
        cols_filters.append((col, filters))

    # Single column — simple case
    if len(cols_filters) == 1:
        col, filters = cols_filters[0]
        cells = []
        for f in filters:
            cells.append({
                "label": f"{col}: {f['value']}",
                "filters": {col: f["value"]},
                "pct": float(f.get("pct", 0)),
            })
        return cells

    # Multiple columns — cartesian product
    all_filter_lists = [[(col, f) for f in filters] for col, filters in cols_filters]
    cells = []
    for combo in iproduct(*all_filter_lists):
        label_parts = []
        filter_dict = {}
        pct = 100.0
        for col, f in combo:
            label_parts.append(f"{col}: {f['value']}")
            filter_dict[col] = f["value"]
            pct = pct * float(f.get("pct", 0)) / 100.0
        cells.append({
            "label": " | ".join(label_parts),
            "filters": filter_dict,
            "pct": pct,
        })
    return cells


def sample_cluster(df, n, cluster_col, n_clusters=None, random_state=42):
    """
    cluster_col: column to group by as clusters
    n_clusters: how many clusters to randomly pick (if None, auto-calc)
    Returns sampled df + breakdown.
    """
    rng = np.random.RandomState(random_state)

    if cluster_col not in df.columns:
        raise ValueError(f"Cluster column '{cluster_col}' not found")

    all_clusters = df[cluster_col].dropna().unique().tolist()
    total_clusters = len(all_clusters)

    if not n_clusters:
        avg_size = len(df) / max(total_clusters, 1)
        n_clusters = max(1, math.ceil(n / avg_size))

    n_clusters = min(n_clusters, total_clusters)
    chosen = rng.choice(all_clusters, size=n_clusters, replace=False).tolist()

    cluster_df = df[df[cluster_col].isin(chosen)]

    # Sample n from chosen clusters
    sampled = cluster_df.sample(n=min(n, len(cluster_df)), random_state=int(rng.randint(0, 99999)))

    breakdown = []
    for c in chosen:
        cdf = cluster_df[cluster_df[cluster_col] == c]
        sdf = sampled[sampled[cluster_col] == c]
        breakdown.append({
            "cluster": str(c),
            "cluster_population": len(cdf),
            "sampled_from_cluster": len(sdf),
        })

    return sampled.copy(), breakdown, chosen


def sample_systematic(df, n, random_state=42):
    """Interval/systematic sampling."""
    rng = np.random.RandomState(random_state)
    N = len(df)
    if N == 0 or n == 0:
        return df.head(0), {}

    k = max(1, N // n)
    start = int(rng.randint(0, k))

    indices = []
    idx = start
    while len(indices) < n and idx < N:
        indices.append(idx)
        idx += k

    # Wrap around if needed
    if len(indices) < n:
        idx = idx % N
        while len(indices) < n and idx not in indices:
            indices.append(idx)
            idx = (idx + k) % N

    df_reset = df.reset_index(drop=True)
    sampled = df_reset.iloc[sorted(indices)].copy()

    info = {
        "N": N,
        "n": n,
        "k": k,
        "start": start + 1,  # 1-based for display
    }
    return sampled, info


# ── Main entry point ─────────────────────────────────────────────────────────

def run_sampling(df, method, n, params, random_state=42):
    """
    method: 'simple_random' | 'stratified' | 'cluster' | 'systematic'
    params: dict with method-specific config
    Returns: (sampled_df, method_info_dict)
    """
    if method == "simple_random":
        sampled = sample_simple_random(df, n, random_state)
        info = {"rows_in_population": len(df), "rows_sampled": len(sampled)}
        return sampled, info

    elif method == "stratified":
        strata = params.get("strata", [])
        sampled, breakdown = sample_stratified(df, n, strata, random_state)
        info = {"rows_in_population": len(df), "rows_sampled": len(sampled), "breakdown": breakdown}
        return sampled, info

    elif method == "cluster":
        cluster_col = params.get("cluster_column", "")
        n_clusters = params.get("n_clusters") or None
        if not cluster_col:
            raise ValueError("cluster_column is required for cluster sampling")
        sampled, breakdown, chosen = sample_cluster(df, n, cluster_col, n_clusters, random_state)
        info = {
            "rows_in_population": len(df),
            "rows_sampled": len(sampled),
            "cluster_column": cluster_col,
            "clusters_selected": chosen,
            "breakdown": breakdown,
        }
        return sampled, info

    elif method == "systematic":
        sampled, sys_info = sample_systematic(df, n, random_state)
        info = {"rows_in_population": len(df), "rows_sampled": len(sampled), **sys_info}
        return sampled, info

    else:
        raise ValueError(f"Unknown method: {method}")


# ── Output builders ──────────────────────────────────────────────────────────

def to_excel_bytes(df):
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Sample")
    buf.seek(0)
    return buf


def to_csv_bytes(df):
    buf = io.BytesIO()
    buf.write(df.to_csv(index=False).encode("utf-8"))
    buf.seek(0)
    return buf
