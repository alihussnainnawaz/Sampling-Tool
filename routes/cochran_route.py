from flask import Blueprint, render_template

cochran_bp = Blueprint("cochran", __name__)

@cochran_bp.get("/cochran")
def cochran():
    return render_template("cochran.html")
