"""
utils/auth.py — Token & password helpers
=========================================
Lightweight JWT implementation using PyJWT.
A decorator `require_auth` protects any route that needs a logged-in user.
"""

import jwt, datetime, functools, backend.config as config
from flask import request, jsonify, g


# ── Token helpers ──────────────────────────────────────────────────────────────

def generate_token(user_id: int, role: str) -> str:
    """Create a signed JWT valid for JWT_EXPIRY_HOURS hours."""
    payload = {
        "sub":  user_id,
        "role": role,
        "iat":  datetime.datetime.utcnow(),
        "exp":  datetime.datetime.utcnow() + datetime.timedelta(hours=config.JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict:
    """Decode a JWT; raises jwt.ExpiredSignatureError or jwt.InvalidTokenError."""
    return jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])


# ── Route decorator ────────────────────────────────────────────────────────────

def require_auth(roles: list = None):
    """
    Decorator factory.
    Usage:
        @require_auth()                 # any authenticated user
        @require_auth(["teacher"])      # teachers only
        @require_auth(["admin","teacher"])
    Sets g.user_id and g.user_role for use inside the view.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "Missing or malformed token"}), 401
            token = auth_header.split(" ", 1)[1]
            try:
                payload = decode_token(token)
            except jwt.ExpiredSignatureError:
                return jsonify({"error": "Token expired — please log in again"}), 401
            except jwt.InvalidTokenError:
                return jsonify({"error": "Invalid token"}), 401

            if roles and payload["role"] not in roles:
                return jsonify({"error": f"Access denied — requires role: {roles}"}), 403

            # Store caller info so the view can use it without re-decoding
            g.user_id   = payload["sub"]
            g.user_role = payload["role"]
            return fn(*args, **kwargs)
        return wrapper
    return decorator
