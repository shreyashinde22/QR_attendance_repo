"""
routes/session.py — Session management
========================================
POST /create-session     (teacher only)
GET  /current-session    (teacher — their own active session)
POST /end-session        (teacher only)
GET  /refresh-qr/<id>    (teacher — issue a fresh token on demand)
"""

import datetime
from flask import Blueprint, request, jsonify, g
from backend.database import get_conn
from backend.utils.auth import require_auth
from backend.utils.qr import issue_token, get_latest_token
session_bp = Blueprint("session", __name__, url_prefix="/")


# ── POST /create-session ───────────────────────────────────────────────────────
@session_bp.route("/create-session", methods=["POST"])
@require_auth(["teacher", "admin"])
def create_session():
    """
    Create a new attendance session.
    Body: { "subject": "Data Structures", "room": "CS-Lab-1", "duration_min": 90 }

    Business rules:
      - A teacher may only have ONE active session at a time.
      - A first QR token is issued immediately on session creation.
    """
    data = request.get_json(force=True, silent=True) or {}

    subject      = (data.get("subject",      "") or "").strip()
    room         = (data.get("room",         "") or "").strip()
    duration_min = int(data.get("duration_min", 90))

    if not subject or not room:
        return jsonify({"error": "subject and room are required"}), 400

    conn = get_conn()

    # Guard: only one active session per teacher
    existing = conn.execute("""
        SELECT id FROM sessions
        WHERE  teacher_id = ? AND is_active = 1
    """, (g.user_id,)).fetchone()

    if existing:
        conn.close()
        return jsonify({
            "error": "You already have an active session",
            "active_session_id": existing["id"]
        }), 409

    # Insert session
    cur = conn.execute("""
        INSERT INTO sessions (teacher_id, subject, room, duration_min)
        VALUES (?, ?, ?, ?)
    """, (g.user_id, subject, room, duration_min))
    session_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Issue the first QR token
    token_info = issue_token(session_id)

    return jsonify({
        "message":    "Session created",
        "session_id": session_id,
        "subject":    subject,
        "room":       room,
        "duration_min": duration_min,
        "qr_token":   token_info,
    }), 201


# ── GET /current-session ───────────────────────────────────────────────────────
@session_bp.route("/current-session", methods=["GET"])
@require_auth(["teacher", "admin"])
def current_session():
    """
    Return the teacher's active session + latest QR token info.
    Used by the teacher dashboard to restore state on page refresh.
    """
    conn    = get_conn()
    session = conn.execute("""
        SELECT s.*, u.name AS teacher_name
        FROM   sessions s
        JOIN   users    u ON u.id = s.teacher_id
        WHERE  s.teacher_id = ? AND s.is_active = 1
    """, (g.user_id,)).fetchone()

    if not session:
        conn.close()
        return jsonify({"active": False, "session": None}), 200

    # Count attendees so far
    count = conn.execute("""
        SELECT COUNT(*) AS cnt FROM attendance WHERE session_id = ?
    """, (session["id"],)).fetchone()["cnt"]

    conn.close()

    token_info = get_latest_token(session["id"])

    return jsonify({
        "active": True,
        "session": {
            "id":           session["id"],
            "subject":      session["subject"],
            "room":         session["room"],
            "started_at":   session["started_at"],
            "duration_min": session["duration_min"],
            "present_count": count,
            "qr_token":     token_info,
        }
    }), 200


# ── POST /end-session ──────────────────────────────────────────────────────────
@session_bp.route("/end-session", methods=["POST"])
@require_auth(["teacher", "admin"])
def end_session():
    """
    End an active session.
    Body: { "session_id": 3 }
    Invalidates all QR tokens for that session.
    """
    data       = request.get_json(force=True, silent=True) or {}
    session_id = data.get("session_id")

    if not session_id:
        return jsonify({"error": "session_id is required"}), 400

    conn    = get_conn()
    session = conn.execute("""
        SELECT * FROM sessions WHERE id = ? AND teacher_id = ? AND is_active = 1
    """, (session_id, g.user_id)).fetchone()

    if not session:
        conn.close()
        return jsonify({"error": "No active session found with that id"}), 404

    # Mark session as ended
    ended_at = datetime.datetime.utcnow().isoformat(timespec="seconds")
    conn.execute("""
        UPDATE sessions SET is_active = 0, ended_at = ? WHERE id = ?
    """, (ended_at, session_id))
    conn.commit()
    conn.close()

    # Invalidate all outstanding tokens
    invalidate_session_tokens(session_id)

    return jsonify({
        "message":   "Session ended",
        "session_id": session_id,
        "ended_at":  ended_at,
    }), 200


# ── GET /refresh-qr/<session_id> ───────────────────────────────────────────────
@session_bp.route("/refresh-qr/<int:session_id>", methods=["GET"])
@require_auth(["teacher", "admin"])
def refresh_qr(session_id: int):
    """
    Issue a fresh QR token for the session on demand.
    The teacher frontend calls this every 30 seconds.
    """
    conn    = get_conn()
    session = conn.execute("""
        SELECT * FROM sessions WHERE id = ? AND teacher_id = ? AND is_active = 1
    """, (session_id, g.user_id)).fetchone()
    conn.close()

    if not session:
        return jsonify({"error": "No active session found"}), 404

    token_info = issue_token(session_id)
    return jsonify({"qr_token": token_info}), 200
