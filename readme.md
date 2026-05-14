# Secure QR Attendance System — Flask Backend

## Folder Structure

```
qr_attendance_backend/
├── app.py               ← Flask entry point; registers blueprints
├── config.py            ← All tuneable settings (secret key, DB URI, QR expiry)
├── database.py          ← SQLite schema + init + demo seed
├── requirements.txt
├── routes/
│   ├── auth.py          ← POST /login
│   ├── session.py       ← POST /create-session  GET /current-session
│   │                       POST /end-session     GET /refresh-qr/<id>
│   └── attend.py        ← POST /mark-attendance
│                           GET  /attendance/<session_id>
│                           GET  /my-attendance
└── utils/
    ├── auth.py          ← JWT generate/decode + @require_auth decorator
    └── qr.py            ← Token issue / validate / invalidate helpers
```

---

## Database Schema

```sql
-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,        -- login identifier
    password   TEXT    NOT NULL,               -- bcrypt hash
    role       TEXT    NOT NULL
               CHECK (role IN ('admin','teacher','student')),
    roll_no    TEXT    UNIQUE,                 -- students only
    department TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
);

-- ── sessions ───────────────────────────────────────────────────────────────
CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject      TEXT    NOT NULL,
    room         TEXT    NOT NULL,
    started_at   TEXT    DEFAULT (datetime('now')),
    ended_at     TEXT,                         -- NULL while active
    duration_min INTEGER DEFAULT 90,
    is_active    INTEGER DEFAULT 1
);

-- ── qr_tokens ──────────────────────────────────────────────────────────────
CREATE TABLE qr_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL,               -- e.g. "AB12CD"
    issued_at  TEXT    DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,               -- issued_at + 30 s
    is_used    INTEGER DEFAULT 0
);

-- ── attendance ─────────────────────────────────────────────────────────────
CREATE TABLE attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    token_used TEXT    NOT NULL,
    marked_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE (session_id, student_id)            -- ← prevents proxy / double-mark
);
```

---

## Setup

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run (auto-creates attendance.db and seeds demo users)
python app.py
```

Server starts at **http://localhost:5000**

### MySQL (optional)
In `config.py` change:
```python
DATABASE_URI = "mysql+pymysql://user:password@localhost:3306/qr_attendance"
```
Then `pip install pymysql SQLAlchemy` and replace `sqlite3` calls in
`database.py` with SQLAlchemy sessions.

---

## API Reference

All protected routes require:
```
Authorization: Bearer <token>
```

---

### POST /login
```json
// Request
{ "email": "teacher@demo.edu", "password": "teacher123", "role": "teacher" }

// 200 Response
{
  "message": "Login successful",
  "token": "eyJ...",
  "user": { "id": 2, "name": "Prof. Sharma", "role": "teacher", ... }
}

// 401 — wrong password / email
// 403 — role mismatch
```

---

### POST /create-session  `[teacher]`
```json
// Request
{ "subject": "Data Structures", "room": "CS-Lab-1", "duration_min": 90 }

// 201 Response
{
  "message": "Session created",
  "session_id": 1,
  "qr_token": {
    "token": "AB12CD",
    "issued_at":  "2026-04-08T10:00:00",
    "expires_at": "2026-04-08T10:00:30"
  }
}

// 409 — already has an active session
```

---

### GET /current-session  `[teacher]`
```json
// 200 Response (session active)
{
  "active": true,
  "session": {
    "id": 1, "subject": "Data Structures", "room": "CS-Lab-1",
    "started_at": "2026-04-08T10:00:00", "present_count": 12,
    "qr_token": { "token": "XY99ZZ", "expires_at": "2026-04-08T10:05:30" }
  }
}

// 200 Response (no session)
{ "active": false, "session": null }
```

---

### GET /refresh-qr/<session_id>  `[teacher]`
```json
// 200 Response
{
  "qr_token": {
    "token": "PQ77RS",
    "issued_at":  "2026-04-08T10:05:00",
    "expires_at": "2026-04-08T10:05:30"
  }
}
```
> Call this every 30 seconds from the teacher dashboard to rotate the QR.

---

### POST /mark-attendance  `[student]`
```json
// Request
{ "session_id": 1, "token": "AB12CD" }

// 201 Response
{
  "message": "Attendance marked successfully ✓",
  "subject": "Data Structures",
  "student": { "id": 3, "name": "Rahul Mehta", "roll_no": "CS3001" },
  "marked_at": "2026-04-08T10:00:18"
}

// 422 — token expired or wrong session
// 409 — already marked for this session
// 404 — session not active
```

---

### GET /attendance/<session_id>  `[teacher / admin]`
```json
// 200 Response
{
  "session": { "id": 1, "subject": "Data Structures", "room": "CS-Lab-1", ... },
  "total_present": 2,
  "records": [
    { "name": "Rahul Mehta", "roll_no": "CS3001", "marked_at": "...", "token_used": "AB12CD" },
    { "name": "Priya Singh", "roll_no": "CS3002", "marked_at": "...", "token_used": "XY99ZZ" }
  ]
}
```

---

### POST /end-session  `[teacher]`
```json
// Request
{ "session_id": 1 }

// 200 Response
{ "message": "Session ended", "session_id": 1, "ended_at": "2026-04-08T11:30:00" }
```

---

## Demo Credentials (auto-seeded)

| Role    | Email               | Password    |
|---------|---------------------|-------------|
| Admin   | admin@demo.edu      | admin123    |
| Teacher | teacher@demo.edu    | teacher123  |
| Student | student@demo.edu    | student123  |
| Student | priya@demo.edu      | student123  |
| Student | amit@demo.edu       | student123  |

---

## Security Design

| Threat                 | Mitigation                                                     |
|------------------------|----------------------------------------------------------------|
| Proxy attendance       | UNIQUE(session_id, student_id) — one row max per student       |
| Shared QR screenshot   | Token expires in **30 seconds** — useless after the window     |
| Replay attack          | Unique per-session token; DB timestamp compared server-side    |
| Password theft         | bcrypt hash with per-user salt stored; plain text never saved  |
| Unauthorised access    | JWT with role claims; `@require_auth` decorator on every route |
| Session hijack (JWT)   | Short expiry (8h); rotate SECRET_KEY to invalidate all tokens  |

---

## Connecting the Frontend

In your `script.js`, replace hardcoded demo logic with fetch calls:

```js
// Login
const res  = await fetch('http://localhost:5000/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, role })
});
const { token, user } = await res.json();
localStorage.setItem('token', token);

// Mark attendance (student)
await fetch('http://localhost:5000/mark-attendance', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  },
  body: JSON.stringify({ session_id: 1, token: 'AB12CD' })
});
```
