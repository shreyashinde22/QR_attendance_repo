/* ============================================================
   SECURE QR ATTENDANCE SYSTEM — script.js
   UI interactions, dummy data, QR simulation, tab switching
   ============================================================ */

'use strict';

/* ---- Utility Functions ---- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');
const toggle = (el, cls) => el && el.classList.toggle(cls);

/* Format date/time */
function formatTime(date = new Date()) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function timeAgo(secondsAgo) {
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  return `${Math.floor(secondsAgo / 3600)}h ago`;
}

/* =========================================================
   1. LANDING PAGE — Role Card Navigation
   ========================================================= */
function initLanding() {
  const roleBtns = $$('.role-btn');
  roleBtns.forEach(btn => {
    on(btn, 'click', () => {
      const role = btn.dataset.role;
      window.location.href = `login.html?role=${role}`;
    });
  });

  // Animate cards on load
  $$('.role-card').forEach((card, i) => {
    card.style.animationDelay = `${i * 80}ms`;
    card.classList.add('slide-up');
  });
}

/* =========================================================
   2. LOGIN PAGE — Form & Role Detection
   ========================================================= */
function initLogin() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role') || 'student';

  // Role display mapping
  const roleConfig = {
    admin: { label: 'Admin', icon: '🛡️', color: 'var(--error)', dashboard: 'admin.html' },
    teacher: { label: 'Teacher', icon: '👨‍🏫', color: 'var(--blue-400)', dashboard: 'teacher.html' },
    student: { label: 'Student', icon: '🎓', color: 'var(--success)', dashboard: 'student.html' },
  };
  const cfg = roleConfig[role] || roleConfig.student;

  const roleTag = $('#role-tag');
  if (roleTag) {
    roleTag.textContent = cfg.label;
    roleTag.style.color = cfg.color;
  }
  const roleTitle = $('#role-title');
  if (roleTitle) roleTitle.textContent = `${cfg.icon} ${cfg.label} Login`;

  // Prefill other role links
  $$('.switch-role-link').forEach(a => {
    const r = a.dataset.role;
    if (r) a.href = `login.html?role=${r}`;
  });

  // Login form
  const form = $('#login-form');
  const errorBox = $('#login-error');
  const emailInput = $('#email');
  const passInput = $('#password');

  // Demo credentials for quick fill
  const demoCreds = {
    admin: { email: 'admin@school.edu', pass: 'admin123' },
    teacher: { email: 'teacher@school.edu', pass: 'teach123' },
    student: { email: 'student@school.edu', pass: 'stud123' },
  };
  const demoFill = $('#demo-fill');
  if (demoFill) {
    on(demoFill, 'click', () => {
      const creds = demoCreds[role];
      if (emailInput) emailInput.value = creds.email;
      if (passInput) passInput.value = creds.pass;
    });
  }

  on(form, 'submit', e => {
    e.preventDefault();
    const email = emailInput?.value.trim();
    const pass = passInput?.value.trim();
    hide(errorBox);

    if (!email || !pass) {
      showError(errorBox, 'Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(errorBox, 'Enter a valid email address.');
      emailInput.classList.add('error');
      return;
    }

    // Simulate login (in production: API call)
    const submitBtn = form.querySelector('.btn-primary');
    setLoading(submitBtn, true);
    setTimeout(() => {
      setLoading(submitBtn, false);
      // Store role in session
      sessionStorage.setItem('role', role);
      sessionStorage.setItem('user', JSON.stringify({ name: getDummyName(role), email, role }));
      window.location.href = cfg.dashboard;
    }, 1200);
  });

  // Clear error on input
  [emailInput, passInput].forEach(inp => {
    on(inp, 'input', () => {
      if (inp) inp.classList.remove('error');
      hide(errorBox);
    });
  });
}

function showError(box, msg) {
  if (!box) return;
  box.textContent = msg;
  show(box);
  box.classList.add('fade-in');
}

function setLoading(btn, state) {
  if (!btn) return;
  if (state) {
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Authenticating…';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.original || btn.innerHTML;
    btn.disabled = false;
  }
}

function getDummyName(role) {
  return { admin: 'Admin User', teacher: 'Prof. Sharma', student: 'Rahul Mehta' }[role] || 'User';
}

/* =========================================================
   3. TEACHER DASHBOARD
   ========================================================= */
let sessionActive = false;
let qrInterval = null;
let countdownTimer = null;
let attendanceCount = 0;
let sessionSeconds = 0;
let qrRefreshTime = 30;

function initTeacher() {
  populateUserHeader();

  const startBtn = $('#start-session-btn');
  const endBtn = $('#end-session-btn');
  const startModal = $('#start-session-modal');

  on(startBtn, 'click', () => openModal('start-session-modal'));
  on($('#modal-close-btn'), 'click', () => closeModal('start-session-modal'));
  on($('#modal-overlay'), 'click', e => { if (e.target === e.currentTarget) closeModal('start-session-modal'); });

  on($('#create-session-btn'), 'click', () => {
    const subject = $('#session-subject')?.value;
    const room = $('#session-room')?.value;
    if (!subject || !room) {
      showAlert('fill-all-alert', 'Please fill all fields.', 'error');
      return;
    }
    closeModal('start-session-modal');
    startAttendanceSession(subject, room);
  });

  on(endBtn, 'click', () => {
    if (confirm('End the current attendance session?')) {
      endAttendanceSession();
    }
  });

  // Load recent sessions table
  renderRecentSessions();
}

function startAttendanceSession(subject, room) {
  sessionActive = true;
  attendanceCount = 0;
  sessionSeconds = 0;

  const sessionPanel = $('#session-panel');
  const noSessionPanel = $('#no-session-panel');
  hide(noSessionPanel);
  show(sessionPanel);

  // Update session info display
  $('#session-subject-display').textContent = subject;
  $('#session-room-display').textContent = room;
  $('#session-time-display').textContent = formatTime();
  $('#session-date-display').textContent = formatDate();

  // Generate first QR
  generateQR(subject);

  // QR refresh countdown
  qrRefreshTime = 30;
  updateCountdown(qrRefreshTime);
  countdownTimer = setInterval(() => {
    qrRefreshTime--;
    updateCountdown(qrRefreshTime);
    if (qrRefreshTime <= 0) {
      qrRefreshTime = 30;
      generateQR(subject);
    }
  }, 1000);

  // Simulate random attendance submissions
  qrInterval = setInterval(() => {
    const rand = Math.random();
    if (rand > 0.6) simulateStudentScan();
    sessionSeconds++;
  }, 2000);

  // Show live indicator
  show($('#live-indicator'));
  hide($('#end-session-btn'));
  setTimeout(() => show($('#end-session-btn')), 500);
}

function generateQR(label = 'Session') {
  // SVG-based QR placeholder (real impl uses qrcode.js)
  const canvas = $('#qr-canvas');
  if (!canvas) return;
  const token = Math.random().toString(36).substring(2, 10).toUpperCase();
  canvas.innerHTML = buildQRSVG(token, label);
  $('#qr-token-display').textContent = `Token: ${token}`;

  // Flash animation
  canvas.style.opacity = '0.3';
  requestAnimationFrame(() => {
    canvas.style.transition = 'opacity 0.3s';
    canvas.style.opacity = '1';
  });
}

function buildQRSVG(token, label) {
  // Deterministic-looking QR pattern from token
  const seed = token.charCodeAt(0) + token.charCodeAt(1);
  const cells = [];
  const size = 21;
  const cellPx = 10;

  // Seeded pseudo-random for visual variety
  let s = seed;
  function rand() { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s) / 0x7fffffff; }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Finder patterns (corners)
      const inFinder = (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
      let fill = false;
      if (inFinder) {
        const dr = r % (size - 8) < 8 ? r % (size - 8) : r - (size - 8);
        const dc = c % (size - 8) < 8 ? c % (size - 8) : c - (size - 8);
        const mr = r < 8 ? r : r - (size - 8);
        const mc = c < 8 ? c : c - (size - 8);
        const outer = mr === 0 || mr === 6 || mc === 0 || mc === 6;
        const inner = mr >= 2 && mr <= 4 && mc >= 2 && mc <= 4;
        fill = outer || inner;
      } else {
        fill = rand() > 0.5;
      }
      if (fill) {
        cells.push(`<rect x="${c * cellPx}" y="${r * cellPx}" width="${cellPx}" height="${cellPx}" fill="#111"/>`);
      }
    }
  }

  const svgW = size * cellPx;
  return `<svg width="${svgW}" height="${svgW}" viewBox="0 0 ${svgW} ${svgW}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${svgW}" height="${svgW}" fill="white"/>
    ${cells.join('')}
  </svg>`;
}

function updateCountdown(secs) {
  const el = $('#qr-countdown');
  if (!el) return;
  el.textContent = secs;
  el.className = 'qr-countdown';
  if (secs <= 5) el.classList.add('danger');
  else if (secs <= 10) el.classList.add('warning');
}

function simulateStudentScan() {
  attendanceCount++;
  const countEl = $('#live-count');
  if (countEl) {
    countEl.textContent = attendanceCount;
    countEl.style.transform = 'scale(1.3)';
    setTimeout(() => { countEl.style.transform = 'scale(1)'; }, 200);
  }
  // Add to live feed
  addLiveFeedEntry();
}

function addLiveFeedEntry() {
  const feed = $('#live-feed');
  if (!feed) return;
  const names = ['Priya K.', 'Arjun S.', 'Sneha R.', 'Deepak V.', 'Ananya M.', 'Rohan P.', 'Kavya T.', 'Amit D.'];
  const name = names[Math.floor(Math.random() * names.length)];
  const entry = document.createElement('div');
  entry.className = 'alert alert-success fade-in';
  entry.style.marginBottom = '8px';
  entry.innerHTML = `<span>✓</span><span><strong>${name}</strong> marked present · ${formatTime()}</span>`;
  feed.insertBefore(entry, feed.firstChild);
  if (feed.children.length > 5) feed.lastChild.remove();
}

function endAttendanceSession() {
  sessionActive = false;
  clearInterval(qrInterval);
  clearInterval(countdownTimer);
  hide($('#session-panel'));
  show($('#no-session-panel'));
  hide($('#live-indicator'));
  showGlobalAlert(`Session ended. ${attendanceCount} students marked present.`, 'success');
  renderRecentSessions();
}

/* Recent sessions dummy data */
const dummySessions = [
  { subject: 'Data Structures', class: 'CS-301', date: 'Today, 10:00 AM', present: 38, total: 45, status: 'completed' },
  { subject: 'Computer Networks', class: 'CS-401', date: 'Today, 08:00 AM', present: 32, total: 40, status: 'completed' },
  { subject: 'DBMS', class: 'CS-302', date: 'Yesterday, 02:00 PM', present: 29, total: 42, status: 'completed' },
  { subject: 'Operating Systems', class: 'CS-303', date: 'Yesterday, 12:00 PM', present: 44, total: 44, status: 'completed' },
  { subject: 'Machine Learning', class: 'CS-501', date: '06 Apr, 10:00 AM', present: 25, total: 38, status: 'completed' },
];

function renderRecentSessions() {
  const tbody = $('#recent-sessions-tbody');
  if (!tbody) return;
  tbody.innerHTML = dummySessions.map(s => {
    const pct = Math.round((s.present / s.total) * 100);
    const color = pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'error';
    return `
      <tr>
        <td class="bold">${s.subject}</td>
        <td>${s.class}</td>
        <td>${s.date}</td>
        <td><span class="badge badge-${color}">${s.present}/${s.total}</span></td>
        <td>
          <div class="progress-bar" style="width:100px">
            <div class="progress-fill ${color}" style="width:${pct}%"></div>
          </div>
          <span style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;display:block">${pct}%</span>
        </td>
        <td><button class="btn btn-ghost btn-sm">View</button></td>
      </tr>`;
  }).join('');
}

/* =========================================================
   4. STUDENT DASHBOARD
   ========================================================= */
function initStudent() {
  populateUserHeader();
  renderStudentHistory();

  const scanBtn = $('#scan-btn');
  const scanZone = $('#scan-zone');
  const codeInput = $('#qr-code-input');
  const submitScan = $('#submit-scan');

  on(scanBtn, 'click', () => {
    toggle(scanZone, 'active');
    const isActive = scanZone.classList.contains('active');
    if (isActive) {
      show($('#code-input-section'));
      codeInput?.focus();
    } else {
      hide($('#code-input-section'));
    }
  });

  on(submitScan, 'click', () => {
    const code = codeInput?.value.trim();
    if (!code) {
      showGlobalAlert('Please enter a valid QR code.', 'error');
      return;
    }
    processAttendance(code);
  });

  // Allow Enter key
  on(codeInput, 'keydown', e => {
    if (e.key === 'Enter') submitScan?.click();
  });
}

function processAttendance(code) {
  const submitBtn = $('#submit-scan');
  setLoading(submitBtn, true);

  setTimeout(() => {
    setLoading(submitBtn, false);
    // Simulate success/fail (codes starting with 'X' fail)
    const success = !code.toUpperCase().startsWith('X') && code.length >= 4;
    updateAttendanceStatus(success, code);
    hide($('#code-input-section'));
    $('#scan-zone')?.classList.remove('active');
    if ($('#qr-code-input')) $('#qr-code-input').value = '';
  }, 1500);
}

function updateAttendanceStatus(success, code) {
  const panel = $('#status-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="status-display">
      <div class="status-icon-wrap ${success ? 'success' : 'error'}">
        <span>${success ? '✓' : '✗'}</span>
      </div>
      <div class="status-text ${success ? 'success' : 'error'}">
        ${success ? 'Attendance Marked!' : 'Scan Failed'}
      </div>
      <div class="status-subtext">
        ${success
          ? `Successfully recorded at ${formatTime()}`
          : 'Invalid or expired QR code. Try again.'}
      </div>
      ${success ? `
        <div class="alert alert-success" style="margin-top:20px;max-width:340px;margin-left:auto;margin-right:auto">
          <span>📋</span>
          <span>Code: <strong>${code.toUpperCase()}</strong> · ${formatDate()}</span>
        </div>` : ''}
    </div>`;
  panel.className = 'card card-glow fade-in';
}

function renderStudentHistory() {
  const tbody = $('#student-history-tbody');
  if (!tbody) return;
  const history = [
    { subject: 'Data Structures', date: 'Today, 10:00 AM', status: 'present', code: 'AB12CD' },
    { subject: 'Computer Networks', date: 'Today, 08:00 AM', status: 'present', code: 'EF34GH' },
    { subject: 'DBMS', date: 'Yesterday, 02:00 PM', status: 'absent', code: '—' },
    { subject: 'Operating Systems', date: 'Yesterday, 12:00 PM', status: 'present', code: 'IJ56KL' },
    { subject: 'Machine Learning', date: '06 Apr, 10:00 AM', status: 'present', code: 'MN78OP' },
  ];
  tbody.innerHTML = history.map(h => `
    <tr>
      <td class="bold">${h.subject}</td>
      <td>${h.date}</td>
      <td><span class="badge badge-${h.status === 'present' ? 'success' : 'error'} badge-dot">${h.status}</span></td>
      <td style="font-family:monospace;color:var(--text-muted)">${h.code}</td>
    </tr>`).join('');
}

/* =========================================================
   5. ADMIN DASHBOARD
   ========================================================= */
function initAdmin() {
  populateUserHeader();
  renderAdminAttendance();
  renderTeachersList();
  renderStudentsList();
  initAdminSidebar();
  initAdminFilters();

  // Export button
  on($('#export-btn'), 'click', () => {
    showGlobalAlert('Attendance report exported as CSV.', 'success');
  });

  // Add teacher button
  on($('#add-teacher-btn'), 'click', () => openModal('add-teacher-modal'));
  on($('#close-teacher-modal'), 'click', () => closeModal('add-teacher-modal'));
  on($('#save-teacher-btn'), 'click', () => {
    showGlobalAlert('Teacher added successfully!', 'success');
    closeModal('add-teacher-modal');
  });

  // Add student button
  on($('#add-student-btn'), 'click', () => openModal('add-student-modal'));
  on($('#close-student-modal'), 'click', () => closeModal('add-student-modal'));
  on($('#save-student-btn'), 'click', () => {
    showGlobalAlert('Student enrolled successfully!', 'success');
    closeModal('add-student-modal');
  });
}

function initAdminSidebar() {
  const links = $$('.nav-link[data-section]');
  const sections = $$('.admin-section');

  links.forEach(link => {
    on(link, 'click', () => {
      links.forEach(l => l.classList.remove('active'));
      sections.forEach(s => hide(s));
      link.classList.add('active');
      const target = $('#' + link.dataset.section);
      show(target);
    });
  });
}

function initAdminFilters() {
  const filterBtn = $('#apply-filters-btn');
  on(filterBtn, 'click', () => {
    showGlobalAlert('Filters applied.', 'info');
    renderAdminAttendance();
  });

  on($('#clear-filters-btn'), 'click', () => {
    $$('#filter-form .form-input, #filter-form .form-select').forEach(el => el.value = '');
    renderAdminAttendance();
  });
}

/* Attendance dummy data */
const attendanceDummy = [
  { student: 'Rahul Mehta', roll: 'CS21001', subject: 'Data Structures', class: 'CS-301', date: '08 Apr 2026', time: '10:12 AM', status: 'present' },
  { student: 'Priya Kapoor', roll: 'CS21002', subject: 'Data Structures', class: 'CS-301', date: '08 Apr 2026', time: '10:08 AM', status: 'present' },
  { student: 'Arjun Singh', roll: 'CS21003', subject: 'Data Structures', class: 'CS-301', date: '08 Apr 2026', time: '—', status: 'absent' },
  { student: 'Sneha Reddy', roll: 'CS21004', subject: 'Computer Networks', class: 'CS-401', date: '08 Apr 2026', time: '08:05 AM', status: 'present' },
  { student: 'Deepak Verma', roll: 'CS21005', subject: 'Computer Networks', class: 'CS-401', date: '08 Apr 2026', time: '08:22 AM', status: 'late' },
  { student: 'Ananya Mishra', roll: 'CS21006', subject: 'DBMS', class: 'CS-302', date: '07 Apr 2026', time: '—', status: 'absent' },
  { student: 'Rohan Patil', roll: 'CS21007', subject: 'DBMS', class: 'CS-302', date: '07 Apr 2026', time: '02:03 PM', status: 'present' },
  { student: 'Kavya Thomas', roll: 'CS21008', subject: 'OS', class: 'CS-303', date: '07 Apr 2026', time: '12:11 PM', status: 'present' },
];

function renderAdminAttendance() {
  const tbody = $('#attendance-tbody');
  if (!tbody) return;
  tbody.innerHTML = attendanceDummy.map(r => `
    <tr>
      <td class="bold">${r.student}</td>
      <td style="color:var(--text-muted);font-family:monospace">${r.roll}</td>
      <td>${r.subject}</td>
      <td>${r.class}</td>
      <td>${r.date}</td>
      <td>${r.time}</td>
      <td><span class="badge badge-${r.status === 'present' ? 'success' : r.status === 'late' ? 'warning' : 'error'} badge-dot">${r.status}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="showGlobalAlert('Record details coming soon.','info')">Details</button>
      </td>
    </tr>`).join('');
}

const teachersDummy = [
  { name: 'Prof. Ramesh Sharma', email: 'sharma@school.edu', dept: 'Computer Science', subjects: 'DS, Algorithms', sessions: 28, status: 'active' },
  { name: 'Dr. Priya Nair', email: 'nair@school.edu', dept: 'Computer Science', subjects: 'DBMS, Networks', sessions: 22, status: 'active' },
  { name: 'Dr. Amit Joshi', email: 'joshi@school.edu', dept: 'Mathematics', subjects: 'ML, Statistics', sessions: 19, status: 'active' },
  { name: 'Prof. Sunita Rao', email: 'rao@school.edu', dept: 'Computer Science', subjects: 'OS, Compilers', sessions: 31, status: 'inactive' },
];

function renderTeachersList() {
  const tbody = $('#teachers-tbody');
  if (!tbody) return;
  tbody.innerHTML = teachersDummy.map(t => `
    <tr>
      <td>
        <div class="flex gap-12" style="align-items:center">
          <div class="avatar">${t.name.split(' ').slice(-1)[0][0]}</div>
          <div>
            <div style="font-weight:600;color:var(--text-primary)">${t.name}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${t.email}</div>
          </div>
        </div>
      </td>
      <td>${t.dept}</td>
      <td>${t.subjects}</td>
      <td>${t.sessions}</td>
      <td><span class="badge badge-${t.status === 'active' ? 'success' : 'muted'} badge-dot">${t.status}</span></td>
      <td>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="showGlobalAlert('Teacher removed.','error')">Remove</button>
        </div>
      </td>
    </tr>`).join('');
}

const studentsDummy = [
  { name: 'Rahul Mehta', roll: 'CS21001', email: 'rahul@school.edu', class: 'CS-301', attendance: 92 },
  { name: 'Priya Kapoor', roll: 'CS21002', email: 'priya@school.edu', class: 'CS-301', attendance: 88 },
  { name: 'Arjun Singh', roll: 'CS21003', email: 'arjun@school.edu', class: 'CS-301', attendance: 61 },
  { name: 'Sneha Reddy', roll: 'CS21004', email: 'sneha@school.edu', class: 'CS-401', attendance: 95 },
  { name: 'Deepak Verma', roll: 'CS21005', email: 'deepak@school.edu', class: 'CS-401', attendance: 74 },
];

function renderStudentsList() {
  const tbody = $('#students-tbody');
  if (!tbody) return;
  tbody.innerHTML = studentsDummy.map(s => {
    const color = s.attendance >= 80 ? 'success' : s.attendance >= 65 ? 'warning' : 'error';
    return `
    <tr>
      <td>
        <div class="flex gap-12" style="align-items:center">
          <div class="avatar" style="background:linear-gradient(135deg,var(--success),#00ffaa)">${s.name[0]}</div>
          <div>
            <div style="font-weight:600;color:var(--text-primary)">${s.name}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${s.email}</div>
          </div>
        </div>
      </td>
      <td style="font-family:monospace">${s.roll}</td>
      <td>${s.class}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="progress-bar" style="width:80px">
            <div class="progress-fill ${color}" style="width:${s.attendance}%"></div>
          </div>
          <span style="font-size:0.8rem;color:var(--text-${color === 'success' ? 'primary' : 'secondary'})">${s.attendance}%</span>
        </div>
      </td>
      <td>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm">View</button>
          <button class="btn btn-danger btn-sm" onclick="showGlobalAlert('Student removed.','error')">Remove</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* =========================================================
   SHARED UTILITIES
   ========================================================= */

/* Populate user header chip */
function populateUserHeader() {
  const user = JSON.parse(sessionStorage.getItem('user') || 'null');
  const nameEl = $('#header-user-name');
  const roleEl = $('#header-user-role');
  const avatarEl = $('#header-avatar');
  if (!user) return;
  if (nameEl) nameEl.textContent = user.name || 'User';
  if (roleEl) roleEl.textContent = user.role?.charAt(0).toUpperCase() + user.role?.slice(1) || '';
  if (avatarEl) avatarEl.textContent = (user.name || 'U')[0].toUpperCase();
}

/* Modal open/close */
function openModal(id) {
  const m = $('#' + id);
  if (m) { show(m); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = $('#' + id);
  if (m) { hide(m); document.body.style.overflow = ''; }
}

/* Global alert bar */
function showGlobalAlert(msg, type = 'success') {
  let bar = $('#global-alert-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'global-alert-bar';
    bar.style.cssText = 'position:fixed;top:72px;right:24px;z-index:9999;min-width:280px;max-width:420px';
    document.body.appendChild(bar);
  }
  const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
  bar.innerHTML = `<div class="alert alert-${type} fade-in" style="box-shadow:var(--shadow-md)">
    <span>${icons[type] || 'ℹ'}</span><span>${msg}</span>
  </div>`;
  setTimeout(() => { if (bar) bar.innerHTML = ''; }, 4000);
}

/* Logout */
function logout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

/* Mobile sidebar toggle */
function toggleSidebar() {
  const sidebar = $('.sidebar');
  const overlay = $('.sidebar-overlay');
  sidebar?.classList.toggle('mobile-open');
  overlay?.classList.toggle('active');
}

/* Close sidebar overlay */
document.addEventListener('click', e => {
  if (e.target?.classList.contains('sidebar-overlay')) {
    $$('.sidebar').forEach(s => s.classList.remove('mobile-open'));
    $$('.sidebar-overlay').forEach(o => o.classList.remove('active'));
  }
});

/* =========================================================
   PAGE DETECTION — auto-init correct page
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  const inits = {
    landing: initLanding,
    login: initLogin,
    teacher: initTeacher,
    student: initStudent,
    admin: initAdmin,
  };
  if (inits[page]) inits[page]();
});
async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("http://127.0.0.1:5000/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    console.log(data); // DEBUG

    if (data.token) {
      localStorage.setItem("token", data.token);
      alert("Login successful!");
    } else {
      alert(data.error || "Login failed");
    }

  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}