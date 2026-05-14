"""
Secure QR Attendance System — Flask Backend
==========================================
Entry point. Registers blueprints and initialises the database.
"""

from flask import Flask
from flask_cors import CORS
from backend.database import init_db
from backend.routes.auth import auth_bp
from backend.routes.session import session_bp
from backend.routes.attend import attend_bp
import backend.config as config

app = Flask(__name__)
app.config.from_object(config)

# Allow requests from the frontend (same-origin or localhost dev server)
CORS(app, resources={r"/*": {"origins": "*"}})

# Register route blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(session_bp)
app.register_blueprint(attend_bp)

# ── Bootstrap ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()                           # Create tables if they don't exist
    app.run(debug=True, port=5000)
