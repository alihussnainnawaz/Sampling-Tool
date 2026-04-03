from flask import Blueprint, render_template
from services.dataset_store import has_data
from services.config_store import load_config

admin_bp = Blueprint("admin", __name__)

@admin_bp.get("/admin")
def admin():
    return render_template("admin.html", has_data=has_data(), cfg=load_config())