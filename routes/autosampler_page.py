from flask import Blueprint, render_template

autosampler_bp_page = Blueprint("autosampler_page", __name__)

@autosampler_bp_page.get("/autosampler")
def autosampler():
    return render_template("autosampler.html")
