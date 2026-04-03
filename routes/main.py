from flask import Blueprint, render_template
from services.dataset_store import has_data
from services.config_store import load_config

main_bp = Blueprint("main", __name__)


@main_bp.get("/")
def index():
    return render_template("index.html", has_data=has_data(), cfg=load_config())


@main_bp.get("/appender")
def appender():
    return render_template("appender.html", has_data=has_data(), cfg=load_config())
