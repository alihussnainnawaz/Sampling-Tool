from io import BytesIO
from flask import Blueprint, request, jsonify, send_file
import pandas as pd

from services.profile_store import list_profiles, get_profile, upsert_profile, delete_profile
from services.config_store import load_config, save_config
from services.dataset_store import set_df, get_df, get_original_df, deduct_sample, has_data, dataset_info
from services.sampling import options_for_level, preview_last_level, sample_download_csv
from services.uuid_store import load_used_uuids, append_downloaded_rows
from services.search_index import build_search_index, search_index
from services.mask import build_mask   # Added for effective rows
from services.data_view import effective_df

api_bp = Blueprint("api", __name__)


def _read_uploaded_frame(storage):
    name = (storage.filename or "").lower()
    if name.endswith(".csv"):
        return pd.read_csv(storage)
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(storage)
    raise ValueError(f"Unsupported file: {storage.filename}")


@api_bp.get("/config")
def get_config():
    return jsonify(load_config())


@api_bp.post("/config")
def set_config_api():
    cfg = request.get_json(force=True) or {}
    appender = cfg.get("appender") or {}
    sort_conditions = appender.get("sort_conditions") or ["filename"]

    cleaned = {
        "dataset": {
            "uuid_col": (cfg.get("dataset", {}) or {}).get("uuid_col", "uuid")
        },
        "levels": cfg.get("levels") or ["DISTRICT"],
        "defaults": {
            "min_count": int((cfg.get("defaults", {}) or {}).get("min_count", 50)),
            "sample_count": int((cfg.get("defaults", {}) or {}).get("sample_count", 50)),
        },
        "mask_rules": cfg.get("mask_rules") or [],
        "users": cfg.get("users") or ["Shumail Mehmood"],
        "default_user": cfg.get("default_user") or "Shumail Mehmood",
        "testing_prompt_enabled": bool(cfg.get("testing_prompt_enabled", True)),
        "appender": {
            "sort_conditions": [str(x).strip() for x in sort_conditions if str(x).strip()] or ["filename"],
            "default_sort_condition": (appender.get("default_sort_condition") or "filename").strip() or "filename",
            "sheet_name": (appender.get("sheet_name") or "AppendedData").strip() or "AppendedData",
        },
    }

    if cleaned["default_user"] not in cleaned["users"]:
        cleaned["users"].insert(0, cleaned["default_user"])

    if cleaned["appender"]["default_sort_condition"] not in cleaned["appender"]["sort_conditions"]:
        cleaned["appender"]["default_sort_condition"] = cleaned["appender"]["sort_conditions"][0]

    save_config(cleaned)
    return jsonify({"ok": True})


# NEW: Effective rows after conditional filtering
@api_bp.get("/effective_rows")
def effective_rows_api():
    if not has_data():
        return jsonify({"total_rows": 0, "filtered_rows": 0})

    cfg = load_config()
    df = get_df()
    mask = build_mask(df, cfg.get("mask_rules", []))

    total = len(df)
    filtered = int(mask.sum())

    return jsonify({
        "total_rows": total,
        "filtered_rows": filtered
    })


@api_bp.get("/dataset_info")
def dataset_info_api():
    return jsonify(dataset_info())


@api_bp.get("/dataset_columns")
def dataset_columns_api():
    if not has_data():
        return jsonify({"columns": []})
    df = get_df()
    return jsonify({"columns": [str(c) for c in df.columns]})


@api_bp.post("/upload")
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file provided"}), 400

    try:
        df = _read_uploaded_frame(f)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to read file: {e}"}), 400

    cfg = load_config()
    uuid_col = cfg.get("dataset", {}).get("uuid_col", "uuid")

    used = load_used_uuids(uuid_col)
    set_df(df, filename=f.filename, cfg=cfg, used_uuids=used)

    build_search_index(get_df(), cfg)

    info = dataset_info()
    return jsonify({"ok": True, "rows": int(info["rows"]), "filename": info["filename"]})


@api_bp.post("/appender/append")
def append_files_api():
    # (Your existing appender code - unchanged)
    files = request.files.getlist("files")
    if not files:
        return jsonify({"ok": False, "error": "No files provided"}), 400

    cfg = load_config()
    sort_mode = (request.form.get("sort_mode") or "manual").strip().lower()
    sort_direction = (request.form.get("sort_direction") or "asc").strip().lower()
    sort_condition = (request.form.get("sort_condition") or cfg.get("appender", {}).get("default_sort_condition", "filename")).strip()
    sheet_name = cfg.get("appender", {}).get("sheet_name", "AppendedData")

    uploads = []
    for f in files:
        try:
            uploads.append({
                "filename": f.filename or "file",
                "df": _read_uploaded_frame(f),
            })
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to read {f.filename}: {e}"}), 400

    if sort_mode == "conditional":
        reverse = sort_direction == "desc"
        if sort_condition == "filename":
            uploads.sort(key=lambda x: (x["filename"] or "").lower(), reverse=reverse)
        else:
            return jsonify({"ok": False, "error": f"Unsupported sort condition: {sort_condition}"}), 400

    frames = []
    for item in uploads:
        df = item["df"].copy()
        df["__source_file"] = item["filename"]
        frames.append(df)

    combined = pd.concat(frames, ignore_index=True, sort=False) if frames else pd.DataFrame()

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        combined.to_excel(writer, index=False, sheet_name=sheet_name[:31] or "AppendedData")
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name="appended_output.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@api_bp.post("/options")
def options():
    if not has_data():
        return jsonify({"options": []})

    cfg = load_config()
    payload = request.get_json(force=True) or {}

    depth_levels = payload.get("depth_levels") or cfg.get("levels") or []
    level = payload.get("level")
    selected = payload.get("selected") or {}
    min_count = int(payload.get("min_count") or cfg["defaults"]["min_count"])

    if not level:
        return jsonify({"options": []})

    df = get_df()
    opts = options_for_level(df, cfg, depth_levels, level, selected, min_count=min_count)
    return jsonify({"options": opts})


@api_bp.post("/preview")
def preview():
    if not has_data():
        return jsonify({"preview": []})

    cfg = load_config()
    payload = request.get_json(force=True) or {}

    depth_levels = payload.get("depth_levels") or cfg.get("levels") or []
    selected = payload.get("selected") or {}
    min_count = int(payload.get("min_count") or cfg["defaults"]["min_count"])

    df = get_df()
    out = preview_last_level(df, cfg, depth_levels, selected, min_count=min_count)
    return jsonify({"preview": out})


@api_bp.post("/download")
def download():
    if not has_data():
        return jsonify({"ok": False, "error": "No dataset"}), 400

    cfg = load_config()
    payload = request.get_json(force=True) or {}

    depth_levels = payload.get("depth_levels") or []
    selected = payload.get("selected") or {}
    min_count = int(payload.get("min_count") or cfg["defaults"]["min_count"])
    sample_count = int(payload.get("sample_count") or cfg["defaults"]["sample_count"])
    quota = payload.get("quota") or {}

    added_by = payload.get("added_by") or cfg.get("default_user") or "Shumail Mehmood"
    uuid_col = cfg.get("dataset", {}).get("uuid_col", "uuid")
    testing = bool(payload.get("testing", False))

    df = get_df()

    buf, sampled_df = sample_download_csv(
        df, cfg, depth_levels, selected,
        min_count, sample_count,
        quota=quota,
        return_df=True
    )

    if not testing:
        base_columns = list(get_original_df().columns)
        append_downloaded_rows(sampled_df, uuid_col=uuid_col, added_by=added_by, base_columns=base_columns)
        deduct_sample(sampled_df, uuid_col=uuid_col)
        build_search_index(get_df(), cfg)

    filename = "sample.xlsx"
    if depth_levels:
        first_level = depth_levels[0]
        first_selected = selected.get(first_level) or []
        if first_selected:
            safe_name = str(first_selected[0]).strip().replace("/", "_").replace("\\", "_")
            filename = f"{safe_name}.xlsx"

    return send_file(
        buf,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@api_bp.get("/search_options")
def search_options_api():
    if not has_data():
        return jsonify({"results": []})

    q = (request.args.get("q") or "").strip()
    limit = int(request.args.get("limit") or 12)
    return jsonify({"results": search_index(q, limit=limit)})


@api_bp.get("/profiles")
def profiles_list():
    return jsonify({"profiles": list_profiles()})


@api_bp.get("/profiles/<name>")
def profiles_get(name):
    p = get_profile(name)
    if not p:
        return jsonify({"ok": False, "error": "Profile not found"}), 404
    return jsonify({"ok": True, "profile": p})


@api_bp.post("/profiles")
def profiles_save():
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    profile = payload.get("profile") or {}

    if not name:
        return jsonify({"ok": False, "error": "Profile name is required"}), 400

    cleaned = {
        "depth_levels": profile.get("depth_levels") or [],
        "selected": profile.get("selected") or {},
        "min_count": int(profile.get("min_count") or 0),
        "sample_count": int(profile.get("sample_count") or 0),
        "quota": profile.get("quota") or {},
        "added_by": (profile.get("added_by") or "").strip()
    }

    upsert_profile(name, cleaned)
    return jsonify({"ok": True})


@api_bp.delete("/profiles/<name>")
def profiles_delete(name):
    ok = delete_profile(name)
    if not ok:
        return jsonify({"ok": False, "error": "Profile not found"}), 404
    return jsonify({"ok": True})