"""
backend/routes/auth.py
Flask Blueprint — Authentication
Routes: POST /login  |  GET /me  |  POST /register
"""

import bcrypt
from flask import Blueprint, request, jsonify, g

from backend.database import get_conn
from backend.utils.auth import generate_token, require_auth

auth_bp = Blueprint("auth", __name__, url_prefix="/")


# ── Helpers ────────────────────────────────────────────────────────────────────

VALID_ROLES = {"admin", "teacher", "student"}

def _user_dict(row) -> dict:
    """Serialize a sqlite3.Row to a safe public-facing dict (no password)."""
    return {
        "id":         row["id"],
        "name":       row["name"],
        "email":      row["email"],
        "role":       row["role"],
        "roll_no":    row["roll_no"],
        "department": row["department"],
    }


def _fetch_user_by_id(user_id: int):
    conn = get_conn()
    row  = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row


def _fetch_user_by_email(email: str):
    conn  = get_conn()
    row   = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return row


# ── POST /login ────────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()
    role_req = (data.get("role")     or "").strip()   # optional hint from frontend

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    user = _fetch_user_by_email(email)
    if not user:
        return jsonify({"error": "Invalid email or password"}), 401

    if not bcrypt.checkpw(password.encode(), user["password"].encode()):
        return jsonify({"error": "Invalid email or password"}), 401

    if role_req and user["role"] != role_req:
        return jsonify({
            "error": f"Account role is '{user['role']}', not '{role_req}'"
        }), 403

    token = generate_token(user["id"], user["role"])

    return jsonify({
        "message": "Login successful",
        "token":   token,
        "user":    _user_dict(user),
    }), 200


# ── GET /me ────────────────────────────────────────────────────────────────────

@auth_bp.route("/me", methods=["GET"])
@require_auth()
def me():
    user = _fetch_user_by_id(g.user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify({"user": _user_dict(user)}), 200


# ── POST /register ─────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["POST"])
def register():
    data       = request.get_json(silent=True) or {}
    name       = (data.get("name")       or "").strip()
    email      = (data.get("email")      or "").strip().lower()
    password   = (data.get("password")   or "").strip()
    role       = (data.get("role")       or "").strip().lower()
    roll_no    = (data.get("roll_no")    or "").strip() or None
    department = (data.get("department") or "").strip() or None

    # ── Validation ─────────────────────────────────────────────────────────────
    missing = [f for f, v in [("name", name), ("email", email),
                               ("password", password), ("role", role)] if not v]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    if role not in VALID_ROLES:
        return jsonify({"error": f"role must be one of: {', '.join(sorted(VALID_ROLES))}"}), 400

    if len(password) < 8:
        return jsonify({"error": "password must be at least 8 characters"}), 400

    if role == "student" and not roll_no:
        return jsonify({"error": "roll_no is required for students"}), 400

    # ── Uniqueness checks ──────────────────────────────────────────────────────
    if _fetch_user_by_email(email):
        return jsonify({"error": "An account with that email already exists"}), 409

    if roll_no:
        conn      = get_conn()
        duplicate = conn.execute(
            "SELECT id FROM users WHERE roll_no = ?", (roll_no,)
        ).fetchone()
        conn.close()
        if duplicate:
            return jsonify({"error": "That roll number is already registered"}), 409

    # ── Persist ────────────────────────────────────────────────────────────────
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = get_conn()
    cur  = conn.execute("""
        INSERT INTO users (name, email, password, role, roll_no, department)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (name, email, pw_hash, role, roll_no, department))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()

    token = generate_token(new_id, role)

    return jsonify({
        "message": "Account created",
        "token":   token,
        "user": {
            "id":         new_id,
            "name":       name,
            "email":      email,
            "role":       role,
            "roll_no":    roll_no,
            "department": department,
        },
    }), 201
