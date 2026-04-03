from flask import Flask
from routes.main import main_bp
from routes.admin import admin_bp
from routes.api import api_bp

def create_app():
    app = Flask(__name__)
    app.register_blueprint(main_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
    return app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)