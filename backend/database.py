"""
database.py — SQLite setup & shared helpers
============================================
Defines all tables with proper constraints and provides a
thread-safe connection helper used by every route module.

Schema overview
───────────────
  users        – teachers, students, admins (login credentials)
  sessions     – attendance sessions created by a teacher
  qr_tokens    – rotating tokens linked to a session
  attendance   – one row per (student, session) — unique constraint
"""

import sqlite3, os, backend.config as config

DB_PATH = config.DATABASE_URI.replace("sqlite:///", "")


def get_conn() -> sqlite3.Connection:
    """Return a connection with foreign-key enforcement and row_factory set."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row          # rows behave like dicts
    conn.execute("PRAGMA foreign_keys = ON")  # enforce FK constraints
    return conn


def init_db():
    """Create all tables (idempotent — safe to call on every startup)."""
    conn = get_conn()
    cur  = conn.cursor()

    # ── users ──────────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            email      TEXT    NOT NULL UNIQUE,          -- login identifier
            password   TEXT    NOT NULL,                 -- bcrypt hash
            role       TEXT    NOT NULL                  -- 'admin'|'teacher'|'student'
                       CHECK (role IN ('admin','teacher','student')),
            roll_no    TEXT    UNIQUE,                   -- students only (nullable)
            department TEXT,
            created_at TEXT    DEFAULT (datetime('now'))
        )
    """)

    # ── sessions ───────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id   INTEGER NOT NULL
                         REFERENCES users(id) ON DELETE CASCADE,
            subject      TEXT    NOT NULL,
            room         TEXT    NOT NULL,
            started_at   TEXT    DEFAULT (datetime('now')),
            ended_at     TEXT,                           -- NULL while active
            duration_min INTEGER DEFAULT 90,
            is_active    INTEGER DEFAULT 1               -- 1=active, 0=ended
        )
    """)

    # ── qr_tokens ──────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS qr_tokens (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL
                       REFERENCES sessions(id) ON DELETE CASCADE,
            token      TEXT    NOT NULL,                 -- e.g. "AB12CD"
            issued_at  TEXT    DEFAULT (datetime('now')),-- UTC timestamp
            expires_at TEXT    NOT NULL,                 -- issued_at + 30s
            is_used    INTEGER DEFAULT 0                 -- soft invalidation flag
        )
    """)

    # ── attendance ─────────────────────────────────────────────────────────────
    # UNIQUE(session_id, student_id) prevents double-marking
    cur.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL
                       REFERENCES sessions(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL
                       REFERENCES users(id) ON DELETE CASCADE,
            token_used TEXT    NOT NULL,                 -- which token was scanned
            marked_at  TEXT    DEFAULT (datetime('now')),
            UNIQUE (session_id, student_id)             -- ONE entry per student per session
        )
    """)

    conn.commit()
    conn.close()

    # Seed demo users (safe — INSERT OR IGNORE)
    _seed_demo_users()
    print("[DB] Tables ready.")


# ── Demo seed data ─────────────────────────────────────────────────────────────
def _seed_demo_users():
    """Insert demo credentials so the frontend's 'Use demo credentials' works."""
    import bcrypt

    demo_users = [
        ("Admin User",   "admin@demo.edu",   "admin123",   "admin",   None,     "IT Dept"),
        ("Prof. Sharma", "teacher@demo.edu", "teacher123", "teacher", None,     "Computer Science"),
        ("Rahul Mehta",  "student@demo.edu", "student123", "student", "CS3001", "Computer Science"),
        ("Priya Singh",  "priya@demo.edu",   "student123", "student", "CS3002", "Computer Science"),
        ("Amit Patel",   "amit@demo.edu",    "student123", "student", "CS3003", "Computer Science"),
    ]

    conn = get_conn()
    cur  = conn.cursor()
    for name, email, raw_pw, role, roll, dept in demo_users:
        hashed = bcrypt.hashpw(raw_pw.encode(), bcrypt.gensalt()).decode()
        cur.execute("""
            INSERT OR IGNORE INTO users (name, email, password, role, roll_no, department)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, email, hashed, role, roll, dept))
    conn.commit()
    conn.close()
    print("[DB] Demo users seeded.")
