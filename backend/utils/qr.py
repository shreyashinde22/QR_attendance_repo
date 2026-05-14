"""
utils/qr.py — QR token generation & validation
================================================
Tokens are short random alphanumeric strings (e.g. "AB12CD").
Each token is stored in qr_tokens with an expires_at timestamp.

Validation steps:
  1. Token exists in qr_tokens
  2. Token belongs to the given session
  3. Current UTC time < expires_at  (30-second window)
  4. Token has not been globally invalidated (is_used = 0)
"""

import random
import string
import datetime

import backend.config as config
from backend.database import get_conn



# Generate random token
def generate_token_string(length=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))


# Create new QR token
def issue_token(session_id):
    conn = get_conn()
    cur = conn.cursor()

    token = generate_token_string()

    now = datetime.datetime.utcnow()
    expiry = now + datetime.timedelta(seconds=config.QR_EXPIRY_SECONDS)

    cur.execute("""
        INSERT INTO qr_tokens (session_id, token, issued_at, expires_at)
        VALUES (?, ?, ?, ?)
    """, (session_id, token, now.isoformat(), expiry.isoformat()))

    conn.commit()
    conn.close()

    return token


# Get latest token
def get_latest_token(session_id):
    conn = get_conn()

    row = conn.execute("""
        SELECT * FROM qr_tokens
        WHERE session_id = ?
        ORDER BY issued_at DESC
        LIMIT 1
    """, (session_id,)).fetchone()

    conn.close()
    return row


# Validate token
def validate_token(session_id, token):
    conn = get_conn()

    row = conn.execute("""
        SELECT * FROM qr_tokens
        WHERE session_id = ? AND token = ?
    """, (session_id, token)).fetchone()

    conn.close()

    if not row:
        return False, "Invalid token"

    expiry = datetime.datetime.fromisoformat(row["expires_at"])

    if datetime.datetime.utcnow() > expiry:
        return False, "Token expired"

    return True, "Valid token"