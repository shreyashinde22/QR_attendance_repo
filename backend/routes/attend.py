"""
routes/attend.py — Attendance marking & retrieval
===================================================
POST /mark-attendance            (student only)
GET  /attendance/<session_id>    (teacher / admin)
GET  /my-attendance              (student — their own history)
"""

import datetime
from flask import Blueprint, request, jsonify, g
from backend.database import get_conn
from backend.utils.auth import require_auth
from backend.utils.qr import validate_token

attend_bp = Blueprint("attend", __name__, url_prefix="/")


# ── POST /mark-attendance ──────────────────────────────────────────────────────
@attend_bp.route("/mark-attendance", methods=["POST"])
@require_auth(["student"])
def mark_attendance():
    """
    Student marks their attendance by submitting a QR token.
    Body: { "session_id": 3, "token": "AB12CD" }

    Validation pipeline:
      1. Session exists and is active
      2. QR token is valid (not expired, belongs to session)
      3. UNIQUE constraint prevents double-marking — caught as IntegrityError
    """
    data = request.get_json(force=True, silent=True) or {}

    session_id = data.get("session_id")
    token      = (data.get("token", "") or "").strip().upper()

    # ── Input validation ───────────────────────────────────────────────────────
    if not session_id or not token:
        return jsonify({"error": "session_id and token are required"}), 400

    conn = get_conn()

    # ── Step 1: Check session is active ───────────────────────────────────────
    session = conn.execute("""
        SELECT id, subject, room FROM sessions
        WHERE  id = ? AND is_active = 1
    """, (session_id,)).fetchone()

    if not session:
        conn.close()
        return jsonify({"error": "Session not found or already ended"}), 404

    # ── Step 2: Validate QR token (expiry + session match) ────────────────────
    valid, reason = validate_token(token, session_id)
    if not valid:
        conn.close()
        return jsonify({"error": f"Invalid QR code: {reason}"}), 422

    # ── Step 3: Insert attendance (UNIQUE constraint = one per student/session) ─
    try:
        marked_at = datetime.datetime.utcnow().isoformat(timespec="seconds")
        conn.execute("""
            INSERT INTO attendance (session_id, student_id, token_used, marked_at)
            VALUES (?, ?, ?, ?)
        """, (session_id, g.user_id, token, marked_at))
        conn.commit()
    except Exception as e:
        conn.close()
        # SQLite UNIQUE constraint fires an IntegrityError
        if "UNIQUE" in str(e).upper():
            return jsonify({
                "error": "Attendance already marked for this session",
                "already_marked": True
            }), 409
        raise  # unexpected — re-raise for 500 handler

    # Fetch student name for the response payload
    student = conn.execute(
        "SELECT name, roll_no FROM users WHERE id = ?", (g.user_id,)
    ).fetchone()
    conn.close()

    return jsonify({
        "message":    "Attendance marked successfully ✓",
        "session_id": session_id,
        "subject":    session["subject"],
        "room":       session["room"],
        "student":    {
            "id":      g.user_id,
            "name":    student["name"],
            "roll_no": student["roll_no"],
        },
        "marked_at": marked_at,
    }), 201


# ── GET /attendance/<session_id> ───────────────────────────────────────────────
@attend_bp.route("/attendance/<int:session_id>", methods=["GET"])
@require_auth(["teacher", "admin"])
def get_attendance(session_id: int):
    """
    Return the full attendance list for a session.
    Teachers can only view sessions they own; admins see all.
    """
    conn = get_conn()

    # Ownership check for teachers
    if g.user_role == "teacher":
        owner = conn.execute("""
            SELECT id FROM sessions WHERE id = ? AND teacher_id = ?
        """, (session_id, g.user_id)).fetchone()
        if not owner:
            conn.close()
            return jsonify({"error": "Session not found or access denied"}), 403

    session = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not session:
        conn.close()
        return jsonify({"error": "Session not found"}), 404

    rows = conn.execute("""
        SELECT a.id, a.marked_at, a.token_used,
               u.id AS student_id, u.name, u.email, u.roll_no
        FROM   attendance a
        JOIN   users u ON u.id = a.student_id
        WHERE  a.session_id = ?
        ORDER  BY a.marked_at ASC
    """, (session_id,)).fetchall()
    conn.close()

    records = [
        {
            "record_id":  r["id"],
            "student_id": r["student_id"],
            "name":       r["name"],
            "email":      r["email"],
            "roll_no":    r["roll_no"],
            "marked_at":  r["marked_at"],
            "token_used": r["token_used"],
        }
        for r in rows
    ]

    return jsonify({
        "session": {
            "id":           session["id"],
            "subject":      session["subject"],
            "room":         session["room"],
            "started_at":   session["started_at"],
            "ended_at":     session["ended_at"],
            "is_active":    bool(session["is_active"]),
            "duration_min": session["duration_min"],
        },
        "total_present": len(records),
        "records":       records,
    }), 200


# ── GET /my-attendance ─────────────────────────────────────────────────────────
@attend_bp.route("/my-attendance", methods=["GET"])
@require_auth(["student"])
def my_attendance():
    """
    Return the logged-in student's full attendance history.
    Optionally filter by subject: ?subject=Data+Structures
    """
    subject_filter = request.args.get("subject", "").strip()

    conn = get_conn()
    query = """
        SELECT a.marked_at, a.token_used,
               s.subject, s.room, s.started_at, s.id AS session_id
        FROM   attendance a
        JOIN   sessions   s ON s.id = a.session_id
        WHERE  a.student_id = ?
    """
    params = [g.user_id]
    if subject_filter:
        query  += " AND s.subject LIKE ?"
        params.append(f"%{subject_filter}%")
    query += " ORDER BY a.marked_at DESC"

    rows = conn.execute(query, params).fetchall()

    # Aggregate stats per subject
    stats_rows = conn.execute("""
        SELECT s.subject,
               COUNT(*) AS attended,
               (SELECT COUNT(*) FROM sessions s2
                WHERE  s2.subject = s.subject) AS total
        FROM   attendance a
        JOIN   sessions   s ON s.id = a.session_id
        WHERE  a.student_id = ?
        GROUP  BY s.subject
    """, (g.user_id,)).fetchall()
    conn.close()

    history = [
        {
            "session_id": r["session_id"],
            "subject":    r["subject"],
            "room":       r["room"],
            "marked_at":  r["marked_at"],
            "token_used": r["token_used"],
        }
        for r in rows
    ]

    stats = [
        {
            "subject":  r["subject"],
            "attended": r["attended"],
            "total":    r["total"],
            "pct":      round(r["attended"] / r["total"] * 100, 1) if r["total"] else 0,
        }
        for r in stats_rows
    ]

    return jsonify({
        "student_id":    g.user_id,
        "total_records": len(history),
        "subject_stats": stats,
        "history":       history,
    }), 200
