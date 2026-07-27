/* ═══════════════════════════════════════════════════════════
   Ramssol AI Agent Copilot — app-shell.js
   Shared runtime for every authenticated page:
   · Auth guard (Doc §3.1 — no navigation before sign-in)
   · Live identity (session → sidebar user + greeting)
   · Level-aware sidebar: each tier sees only its own workspace
     and lands on its own dashboard (Doc §2)
   · Notification centre (Doc §3.8)
   · Global search across pages, proposals and prospects
   Wrapped in an IIFE so it never collides with page scripts.
═══════════════════════════════════════════════════════════ */
(function () {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (page === 'login.html') return;

  /* ── AUTH GUARD ─────────────────────────────────────────── */
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('ramssolSession') || 'null'); } catch (e) {}
  if (!session) { location.replace('login.html'); return; }

  /* ── IDENTITY ───────────────────────────────────────────── */
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem('ramssolProfile') || 'null'); } catch (e) {}
  const ROLE_LEVELS = { 'Sales Representative': 1, 'Sales Manager': 2, 'Sales Operations': 3, 'Pre-Sales': 1, 'COO Office': 3 };
  const name  = (((session.firstName || '') + ' ' + (session.lastName || '')).trim()) || (profile && profile.name) || 'Amir Arif';
  const role  = session.role || (profile && profile.role) || 'Sales Representative';
  const level = session.level || ROLE_LEVELS[role] || 1;
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const LEVEL_NAME = { 1: 'Data Entry', 2: 'Reviewer', 3: 'Administrator' };
  const HOME = { 1: 'dashboard-l1.html', 2: 'dashboard-l2.html', 3: 'dashboard-l3.html' }[level];

  const q = (sel) => document.querySelector(sel);

  /* ── ROUTER: index.html sends each tier to its own dashboard ─ */
  if (page === 'index.html' || page === '') { location.replace(HOME); return; }

  /* ── ACCESS CONTROL ─────────────────────────────────────── */
  const PAGE_LEVELS = {
    'settings.html': 3, 'admin-approvals.html': 2, 'analytics.html': 2,
    'dashboard-l1.html': 1, 'dashboard-l2.html': 2, 'dashboard-l3.html': 3
  };
  const need = PAGE_LEVELS[page] || 1;
  if (level < need) { sessionStorage.setItem('ramssolDenied', String(need)); location.replace(HOME); return; }
  // A higher tier landing on a lower tier's dashboard goes to its own
  if (/^dashboard-l[123]\.html$/.test(page) && page !== HOME) { location.replace(HOME); return; }

  /* ── TOAST ──────────────────────────────────────────────── */
  function toast(msg, warn) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:' + (warn ? '#BA7517' : '#085041') +
      ';color:white;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity .3s';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
  }
  const denied = sessionStorage.getItem('ramssolDenied');
  if (denied) {
    sessionStorage.removeItem('ramssolDenied');
    setTimeout(() => toast('🔒 That area is limited to ' + (LEVEL_NAME[denied] || 'a higher level') + ' (Level ' + denied + ').', true), 300);
  }

  /* ── SIDEBAR NAV (built per level — no locked items) ─────── */
  const I = {
    home:  '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    doc:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    edit:  '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    check: '<path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.6 0 3.1.42 4.4 1.15"/><path d="M21 5l-9 9"/>',
    pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    grid:  '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    gear:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    key:   '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  };
  const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + d + '</svg>';

  // min = lowest level that may see the item
  const NAV = [
    { sec: 'Workspace' },
    { label: 'Dashboard',        icon: 'home',  href: HOME,                   min: 1 },
    { label: 'Prospects',        icon: 'users', href: 'prospects.html',       min: 1 },
    { label: 'Compliance (RFP)', icon: 'doc',   href: 'compliance.html',      min: 1 },
    { label: 'My Proposals',     icon: 'edit',  href: 'proposals.html',       min: 1 },
    { label: 'Approvals',        icon: 'check', href: 'admin-approvals.html', min: 2 },
    { sec: 'Insights' },
    { label: 'Pipeline',         icon: 'pulse', href: 'pipeline.html',        min: 1 },
    { label: 'Analytics',        icon: 'grid',  href: 'analytics.html',       min: 2 },
    { sec: 'System' },
    { label: 'Administration',   icon: 'gear',  href: 'settings.html',        min: 3 },
    { label: 'AI Settings',      icon: 'key',   action: 'apikey',             min: 1 }
  ];

  const nav = q('.sidebar-nav');
  if (nav) {
    const visible = NAV.filter(n => n.sec || level >= n.min);
    // drop section labels that ended up with no items under them
    const out = [];
    visible.forEach((n, i) => {
      if (!n.sec) { out.push(n); return; }
      const next = visible[i + 1];                       // keep the label only if
      if (next && !next.sec) out.push('<div class="nav-section-label">' + n.sec + '</div>');
    });
    nav.innerHTML = out.map(n => {
      if (typeof n === 'string') return n;
      if (n.action === 'apikey')
        return '<button class="nav-item" onclick="showApiKeyModal()">' + svg(I[n.icon]) + n.label + '</button>';
      const active = (n.href.toLowerCase() === page) ? ' active' : '';
      return '<a class="nav-item' + active + '" href="' + n.href + '">' + svg(I[n.icon]) + n.label + '</a>';
    }).join('');
  }

  /* ── SIDEBAR IDENTITY ───────────────────────────────────── */
  const av = q('.sidebar-user .user-avatar'); if (av) av.textContent = initials;
  const un = q('.sidebar-user .user-name');   if (un) un.textContent = name;
  const ur = q('.sidebar-user .user-role');   if (ur) ur.textContent = role + ' · L' + level;

  // Time-of-day greeting on dashboards
  const g = q('.greeting');
  if (g) {
    const h = new Date().getHours();
    g.textContent = 'Good ' + (h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening') + ', ' + name.split(' ')[0] + ' 👋';
  }

  /* ── FALLBACK AI-SETTINGS MODAL (for pages without one) ─── */
  if (typeof window.showApiKeyModal !== 'function') {
    window.showApiKeyModal = function () {
      let m = document.getElementById('rs-key-modal');
      if (!m) {
        m = document.createElement('div');
        m.id = 'rs-key-modal';
        m.className = 'modal-overlay';
        m.innerHTML =
          '<div class="modal"><div class="modal-title">AI Settings</div>' +
          '<div class="modal-sub">Enter your Anthropic API key to enable AI features across all modules.</div>' +
          '<div class="form-group"><label class="form-label">Anthropic API Key</label>' +
          '<input class="form-input" type="password" id="rs-key-input" placeholder="sk-ant-api03-..."></div>' +
          '<div id="rs-key-status" style="display:none;padding:8px 12px;border-radius:8px;font-size:12px"></div>' +
          '<div class="modal-actions"><button class="btn-secondary" id="rs-key-cancel">Cancel</button>' +
          '<button class="btn-primary" id="rs-key-save">Save &amp; Test Key</button></div></div>';
        document.body.appendChild(m);
        m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
        m.querySelector('#rs-key-cancel').onclick = () => m.classList.remove('open');
        m.querySelector('#rs-key-save').onclick = async () => {
          const key = m.querySelector('#rs-key-input').value.trim();
          const st = m.querySelector('#rs-key-status');
          const show = (bg, c, t) => { st.style.display = 'block'; st.style.background = bg; st.style.color = c; st.textContent = t; };
          if (!key) { show('var(--red-50)', 'var(--red-700)', '❌ Please enter an API key.'); return; }
          show('var(--surface)', 'var(--text-secondary)', '⏳ Testing key...');
          try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
              body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Say: OK' }] })
            });
            const data = await res.json();
            if (data.error) { show('var(--red-50)', 'var(--red-700)', '❌ ' + data.error.message); return; }
            localStorage.setItem('ramssolApiKey', key);
            show('rgba(52,211,153,0.2)', '#34D399', '✅ Key verified! AI features are now enabled.');
            setTimeout(() => m.classList.remove('open'), 1400);
          } catch (e) { show('var(--red-50)', 'var(--red-700)', '❌ ' + e.message); }
        };
      }
      m.querySelector('#rs-key-input').value = localStorage.getItem('ramssolApiKey') || '';
      m.classList.add('open');
    };
  }

  /* ── NOTIFICATION CENTRE ────────────────────────────────── */
  const NKEY = 'ramssolNotifCenter';
  const getN  = () => { try { return JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch (e) { return []; } };
  const saveN = (l) => localStorage.setItem(NKEY, JSON.stringify(l.slice(0, 30)));
  const rules = () => { try { return JSON.parse(localStorage.getItem('ramssolNotify') || '{}'); } catch (e) { return {}; } };
  const ICONS = { approve: '✅', reject: '↩', pending: '📤' };

  function notify(type, title, body) {
    if (rules()[type] === false) return;          // respect Settings → Notification Rules
    const l = getN();
    l.unshift({ id: Date.now(), ts: Date.now(), type, title, body: body || '', read: false });
    saveN(l); refreshDot();
  }
  function timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
  }

  const bell = q('.badge-notif');
  let panel = null;
  function refreshDot() {
    const dot = bell && bell.querySelector('.notif-dot');
    if (dot) dot.style.display = getN().some(n => !n.read) ? 'block' : 'none';
  }
  function fillPanel() {
    const l = getN();
    panel.innerHTML =
      '<div class="notif-head"><span class="nh-title">Notifications</span><button class="nh-clear" id="rs-notif-clear">Clear all</button></div>' +
      (l.length
        ? l.map(n => '<div class="notif-item' + (n.read ? '' : ' unread') + '"><span class="ni-ico">' + (ICONS[n.type] || '🔔') +
            '</span><div><div class="ni-title">' + n.title + '</div>' + (n.body ? '<div class="ni-body">' + n.body + '</div>' : '') +
            '<div class="ni-time">' + timeAgo(n.ts) + '</div></div></div>').join('')
        : '<div class="notif-empty">You’re all caught up 🎉</div>');
    panel.querySelector('#rs-notif-clear').onclick = () => { saveN([]); fillPanel(); refreshDot(); };
  }
  if (bell) {
    panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);
    bell.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (!open) { fillPanel(); const l = getN(); l.forEach(n => n.read = true); saveN(l); refreshDot(); }
    });
    document.addEventListener('click', e => {
      if (panel.style.display !== 'none' && !panel.contains(e.target) && !bell.contains(e.target)) panel.style.display = 'none';
    });
    refreshDot();
  }

  /* ── GLOBAL SEARCH ──────────────────────────────────────── */
  const sInput = q('.search-box input');
  if (sInput) {
    const dd = document.createElement('div');
    dd.className = 'search-results';
    sInput.closest('.search-box').appendChild(dd);

    function runSearch() {
      const v = sInput.value.trim().toLowerCase();
      if (!v) { dd.classList.remove('open'); return; }
      const res = [];
      NAV.filter(n => !n.sec && n.href && level >= n.min).forEach(n => {
        if (n.label.toLowerCase().includes(v)) res.push({ i: '📄', n: n.label, k: 'Page', u: n.href });
      });
      let proposals = [], prospects = [];
      try { proposals = JSON.parse(localStorage.getItem('ramssolProposals') || '[]'); } catch (e) {}
      try { prospects = JSON.parse(localStorage.getItem('ramssolProspects') || '[]'); } catch (e) {}
      proposals.filter(p => p.status !== 'Superseded').forEach(p => {
        if ([p.company, p.deal, p.caseId].some(x => (x || '').toLowerCase().includes(v)))
          res.push({ i: '📝', n: p.company + ' — ' + p.status, k: 'Proposal', u: 'proposals.html' });
      });
      prospects.forEach(p => {
        if ((p.name || '').toLowerCase().includes(v)) res.push({ i: '👥', n: p.name, k: 'Prospect', u: 'prospects.html' });
      });
      dd.innerHTML = res.slice(0, 8).map(r =>
        '<div class="sr-item" data-u="' + r.u + '"><span class="sr-ico">' + r.i + '</span><span class="sr-name">' + r.n + '</span><span class="sr-kind">' + r.k + '</span></div>'
      ).join('') || '<div class="notif-empty">No matches</div>';
      dd.classList.add('open');
      dd.querySelectorAll('.sr-item').forEach(el => el.addEventListener('mousedown', () => location.href = el.dataset.u));
    }
    sInput.addEventListener('input', runSearch);
    sInput.addEventListener('focus', runSearch);
    sInput.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
    sInput.addEventListener('keydown', e => { if (e.key === 'Escape') dd.classList.remove('open'); });
  }

  /* ── LOGOUT ─────────────────────────────────────────────── */
  if (typeof window.logout !== 'function') {
    window.logout = function () { sessionStorage.removeItem('ramssolSession'); location.href = 'login.html'; };
  }

  /* ── PUBLIC API ─────────────────────────────────────────── */
  window.RSHELL = { notify, toast, home: HOME, user: { name, role, level, initials } };
})();
