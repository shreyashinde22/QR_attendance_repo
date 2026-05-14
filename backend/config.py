"""
config.py — Central configuration
==================================
Change DATABASE_URI to a MySQL URL for production:
  mysql+pymysql://user:password@host:3306/qr_attendance
"""

import os

# ── Flask ──────────────────────────────────────────────────────────────────────
SECRET_KEY   = os.environ.get("SECRET_KEY", "change-me-in-production-abc123xyz")
DEBUG        = os.environ.get("DEBUG", "True") == "True"

# ── Database ───────────────────────────────────────────────────────────────────
# SQLite (default — no extra setup needed)
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
DATABASE_URI = os.environ.get(
    "DATABASE_URI",
    f"sqlite:///{os.path.join(BASE_DIR, 'attendance.db')}"
)

# ── QR / Session settings ──────────────────────────────────────────────────────
QR_EXPIRY_SECONDS  = 30        # How long a single QR token is valid
QR_TOKEN_LENGTH    = 6         # Length of the random token string (e.g. AB12CD)
SESSION_DURATION_M = 90        # Default session duration in minutes

# ── JWT settings ──────────────────────────────────────────────────────────────
JWT_EXPIRY_HOURS   = 8         # Login token lifetime
