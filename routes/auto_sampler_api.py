# routes/auto_sampler_api.py
"""
API endpoints for the automated sampler page.
POST /api/autosampler/run   — run sampling, return sample file + audit PDF
GET  /api/autosampler/columns — get columns from an uploaded file
"""
import uuid
import io
import json
import zipfile
from datetime import datetime
from flask import Blueprint, request, jsonify, send_file
import pandas as pd

from services.auto_sampler import (
    compute_cochran, run_sampling, to_excel_bytes, to_csv_bytes
)
from services.audit_pdf import generate_audit_pdf

autosampler_bp = Blueprint("autosampler", __name__)


def _read_df(storage):
    name = (storage.filename or "").lower()
    if name.endswith(".csv"):
        return pd.read_csv(storage)
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(storage)
    raise ValueError(f"Unsupported file type: {storage.filename}")


@autosampler_bp.post("/api/autosampler/columns")
def get_columns():
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file"}), 400
    try:
        df = _read_df(f)
        return jsonify({
            "ok": True,
            "columns": list(df.columns),
            "rows": len(df),
            "filename": f.filename,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@autosampler_bp.post("/api/autosampler/run")
def run_autosampler():
    # ── Parse multipart form ─────────────────────────────────────────────────
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No dataset file provided"}), 400

    try:
        params_raw = request.form.get("params", "{}")
        params = json.loads(params_raw)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid params JSON"}), 400

    try:
        df = _read_df(f)
        filename = f.filename or "dataset"
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to read file: {e}"}), 400

    # ── Cochran ──────────────────────────────────────────────────────────────
    cochran_p = params.get("cochran", {})
    z = float(cochran_p.get("z", 1.96))
    p = float(cochran_p.get("p", 0.5))
    e = float(cochran_p.get("e", 0.05))
    N_override = cochran_p.get("N") or len(df)  # default to dataset size
    N = int(N_override) if N_override else len(df)

    try:
        cochran_results = compute_cochran(z, p, e, N)
    except Exception as ex:
        return jsonify({"ok": False, "error": f"Cochran error: {ex}"}), 400

    n = cochran_results["n_final"]

    # ── Sampling ─────────────────────────────────────────────────────────────
    method = params.get("method", "simple_random")
    method_params = params.get("method_params", {})
    random_state = int(params.get("random_state", 42))
    run_by = params.get("run_by", "Unknown")
    uuid_col = params.get("uuid_col") or None
    output_format = params.get("output_format", "xlsx")

    try:
        sampled_df, method_info = run_sampling(df, method, n, method_params, random_state)
    except Exception as ex:
        return jsonify({"ok": False, "error": f"Sampling error: {ex}"}), 400

    # ── Build outputs ────────────────────────────────────────────────────────
    run_id = str(uuid.uuid4())[:8].upper()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Sample file
    if output_format == "csv":
        sample_buf = to_csv_bytes(sampled_df)
        sample_mime = "text/csv"
        sample_name = f"sample_{run_id}.csv"
    else:
        sample_buf = to_excel_bytes(sampled_df)
        sample_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        sample_name = f"sample_{run_id}.xlsx"

    # Audit PDF
    try:
        pdf_buf = generate_audit_pdf(
            run_id=run_id,
            timestamp=timestamp,
            filename=filename,
            cochran_params={"z": z, "p": p, "e": e},
            cochran_results=cochran_results,
            method=method,
            method_params=method_params,
            method_info=method_info,
            sampled_df=sampled_df,
            uuid_col=uuid_col,
            run_by=run_by,
        )
    except Exception as ex:
        return jsonify({"ok": False, "error": f"PDF generation error: {ex}"}), 500

    # Zip both together
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(sample_name, sample_buf.read())
        zf.writestr(f"audit_{run_id}.pdf", pdf_buf.read())
    zip_buf.seek(0)

    return send_file(
        zip_buf,
        as_attachment=True,
        download_name=f"sampling_run_{run_id}.zip",
        mimetype="application/zip",
    )
