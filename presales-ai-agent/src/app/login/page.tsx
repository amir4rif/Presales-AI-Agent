'use client';
/* ═══════════════════════════════════════════════════════════
   Sign in / register.

   ⚠️ KNOWN, STILL OPEN (carried over from the design doc, deliberately
   not fixed in this round): accounts are kept in localStorage and the
   password is compared in plain text. This needs to move to a real
   auth backend — do not delete this note.
═══════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import GalaxyTransition from '@/components/GalaxyTransition';
import { levelForRole, setSession, getSession, type Session } from '@/lib/role';

type Account = Session & {
  id: string;
  password: string;
  initials: string;
  createdAt: string;
};

function getAccounts(): Account[] {
  try {
    return JSON.parse(localStorage.getItem('ramssolAccounts') || '[]');
  } catch {
    return [];
  }
}
function saveAccounts(accounts: Account[]) {
  localStorage.setItem('ramssolAccounts', JSON.stringify(accounts));
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const Arrow = ({ id }: { id: string }) => (
  <svg id={id} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

type Alert = { type: 'error' | 'success'; msg: string } | null;

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [warping, setWarping] = useState(false);
  const [noAccounts, setNoAccounts] = useState(false);

  const [loginAlert, setLoginAlert] = useState<Alert>(null);
  const [regAlert, setRegAlert] = useState<Alert>(null);
  const [busy, setBusy] = useState<'login' | 'register' | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [role, setRole] = useState('');
  const [regPwd, setRegPwd] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    if (getSession()) {
      router.replace('/');
      return;
    }
    setNoAccounts(getAccounts().length === 0);
  }, [router]);

  function switchTab(next: 'login' | 'register') {
    setTab(next);
    setLoginAlert(null);
    setRegAlert(null);
  }

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password) {
      setLoginAlert({ type: 'error', msg: '⚠️ Please enter your email and password.' });
      return;
    }
    setBusy('login');
    await delay(800);
    // ⚠️ Plain-text comparison — see the file header note.
    const user = getAccounts().find(
      (a) => (a.email || '').toLowerCase() === email.trim().toLowerCase() && a.password === password
    );
    setBusy(null);
    if (!user) {
      setLoginAlert({ type: 'error', msg: '❌ Incorrect email or password.' });
      return;
    }
    setSession(user);
    setWarping(true);
  }, [email, password]);

  const handleRegister = useCallback(async () => {
    if (!first.trim() || !last.trim()) {
      setRegAlert({ type: 'error', msg: '⚠️ Please enter your full name.' });
      return;
    }
    if (!regEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) {
      setRegAlert({ type: 'error', msg: '⚠️ Valid email required.' });
      return;
    }
    if (!role) {
      setRegAlert({ type: 'error', msg: '⚠️ Please select a role.' });
      return;
    }
    if (regPwd.length < 8) {
      setRegAlert({ type: 'error', msg: '⚠️ Password > 8 chars.' });
      return;
    }
    if (regPwd !== regConfirm) {
      setRegAlert({ type: 'error', msg: '⚠️ Passwords do not match.' });
      return;
    }
    if (!terms) {
      setRegAlert({ type: 'error', msg: '⚠️ Accept terms to continue.' });
      return;
    }

    const accounts = getAccounts();
    if (accounts.find((a) => (a.email || '').toLowerCase() === regEmail.toLowerCase())) {
      setRegAlert({ type: 'error', msg: '❌ Account exists.' });
      return;
    }

    setBusy('register');
    await delay(1000);
    // Map the chosen role to its starting access level (Design Doc §2).
    const newUser: Account = {
      id: `usr_${Date.now()}`,
      firstName: first.trim(),
      lastName: last.trim(),
      email: regEmail,
      role,
      password: regPwd,
      level: levelForRole(role),
      initials: (first.trim()[0] + last.trim()[0]).toUpperCase(),
      createdAt: new Date().toISOString(),
    };
    accounts.push(newUser);
    saveAccounts(accounts);
    setSession(newUser);
    router.replace('/');
  }, [first, last, regEmail, role, regPwd, regConfirm, terms, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || busy || warping) return;
      if (tab === 'login') handleLogin();
      else handleRegister();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tab, busy, warping, handleLogin, handleRegister]);

  // Password strength meter
  let score = 0;
  if (regPwd.length >= 8) score++;
  if (/[A-Z]/.test(regPwd)) score++;
  if (/[0-9]/.test(regPwd)) score++;
  if (/[^A-Za-z0-9]/.test(regPwd)) score++;
  const colors = ['', '#EF4444', '#F97316', '#EAB308', '#3B82F6'];
  const labels = ['', 'Too weak', 'Weak', 'Good', 'Strong'];

  return (
    <>
      {warping && <GalaxyTransition onDone={() => router.replace('/')} />}

      <div className="page-bg">
        <div className="orb orb-1" />
        <div className="orb orb-2" />

        <div className={`card${warping ? ' exiting' : ''}`} id="main-card">
          <div className="card-header">
            <div className="logo-wrap">
              <div className="logo-icon-box">
                <Image className="logo-img" src="/logoo.png" alt="Ramssol Group" width={62} height={58} />
              </div>
              <div>
                <div className="logo-name">Ramssol</div>
                <div className="logo-sub">Pre-Sales Copilot</div>
              </div>
            </div>
            <div className="card-tagline">Your AI copilot for winning more deals, faster.</div>
          </div>

          <div className="tab-row">
            <button className={`tab${tab === 'login' ? ' active' : ''}`} onClick={() => switchTab('login')}>
              Sign In
            </button>
            <button className={`tab${tab === 'register' ? ' active' : ''}`} onClick={() => switchTab('register')}>
              Create Account
            </button>
          </div>

          <div className="card-body">
            {/* ── SIGN IN ── */}
            <div className={`form-view${tab === 'login' ? ' active' : ''}`}>
              <div className="form-title">Welcome back</div>
              <div className="form-subtitle">Sign in to your Ramssol workspace.</div>

              {loginAlert && (
                <div className={`alert ${loginAlert.type}`} style={{ display: 'block' }}>
                  {loginAlert.msg}
                </div>
              )}

              <div className="field">
                <label htmlFor="login-email">Work Email</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <MailIcon />
                  </span>
                  <input
                    type="email"
                    id="login-email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="login-password">Password</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <LockIcon />
                  </span>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    id="login-password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    className="pwd-toggle"
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="forgot-row">
                <a
                  className="forgot-link"
                  onClick={() =>
                    setLoginAlert({
                      type: 'success',
                      msg: '🔐 Password reset will be handled via Lark SSO in the final phase. For now, ask your administrator or register a new account.',
                    })
                  }
                >
                  Forgot password?
                </a>
              </div>

              <button className="btn-primary" disabled={busy === 'login'} onClick={handleLogin}>
                <span>{busy === 'login' ? 'Signing in...' : 'Sign In'}</span>
                {busy === 'login' ? <div className="spinner" style={{ display: 'block' }} /> : <Arrow id="login-arrow" />}
              </button>

              {noAccounts && (
                <div className="demo-hint">
                  <strong>Demo accounts ready.</strong> No accounts found yet — register one above,
                  or use any email/password after creating an account.
                </div>
              )}
            </div>

            {/* ── REGISTER ── */}
            <div className={`form-view${tab === 'register' ? ' active' : ''}`}>
              <div className="form-title">Create your account</div>
              <div className="form-subtitle">Join your team on the Ramssol platform.</div>

              {regAlert && (
                <div className={`alert ${regAlert.type}`} style={{ display: 'block' }}>
                  {regAlert.msg}
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label htmlFor="reg-first">First Name</label>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <UserIcon />
                    </span>
                    <input
                      type="text"
                      id="reg-first"
                      placeholder="First"
                      autoComplete="given-name"
                      value={first}
                      onChange={(e) => setFirst(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="reg-last">Last Name</label>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <UserIcon />
                    </span>
                    <input
                      type="text"
                      id="reg-last"
                      placeholder="Last"
                      autoComplete="family-name"
                      value={last}
                      onChange={(e) => setLast(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="reg-email">Work Email</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <MailIcon />
                  </span>
                  <input
                    type="email"
                    id="reg-email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="reg-role">Role / Department</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <rect x="2" y="7" width="20" height="14" rx="2" />
                      <path d="M16 7V5a2 2 0 0 0-4 0v2M8 7V5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                    </svg>
                  </span>
                  <select id="reg-role" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="" disabled>
                      Select your role
                    </option>
                    <optgroup label="Sales Roles (Design Doc §2)">
                      <option value="Sales Representative">Sales Representative — Level 1 (Data Entry)</option>
                      <option value="Sales Manager">Sales Manager — Level 2 (Reviewer)</option>
                      <option value="Sales Operations">Sales Operations — Level 3 (Administrator)</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="Pre-Sales">Pre-Sales</option>
                      <option value="COO Office">COO Office</option>
                      <option value="Business Development">Business Development</option>
                      <option value="Solutions Architect">Solutions Architect</option>
                      <option value="Other">Other</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="reg-password">Password</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <LockIcon />
                  </span>
                  <input
                    type={showRegPwd ? 'text' : 'password'}
                    id="reg-password"
                    placeholder="Create a password"
                    autoComplete="new-password"
                    value={regPwd}
                    onChange={(e) => setRegPwd(e.target.value)}
                  />
                  <button className="pwd-toggle" type="button" tabIndex={-1} onClick={() => setShowRegPwd((v) => !v)}>
                    {showRegPwd ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <div className="pwd-strength">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      className="pwd-bar"
                      key={i}
                      style={{ background: i <= score ? colors[score] : 'var(--gray-200)' }}
                    />
                  ))}
                </div>
                <div className="pwd-label" style={{ color: score > 0 ? colors[score] : 'var(--gray-400)' }}>
                  {score === 0 ? 'At least 8 characters' : labels[score]}
                </div>
              </div>

              <div className="field">
                <label htmlFor="reg-confirm">Confirm Password</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 12l2 2 4-4" />
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type={showRegConfirm ? 'text' : 'password'}
                    id="reg-confirm"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                  />
                  <button
                    className="pwd-toggle"
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowRegConfirm((v) => !v)}
                  >
                    {showRegConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="terms-row">
                <input
                  type="checkbox"
                  id="reg-terms"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <label htmlFor="reg-terms">
                  I agree to the <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>
                </label>
              </div>

              <button className="btn-primary" disabled={busy === 'register'} onClick={handleRegister}>
                <span>{busy === 'register' ? 'Creating account...' : 'Create Account'}</span>
                {busy === 'register' ? (
                  <div className="spinner" style={{ display: 'block' }} />
                ) : (
                  <Arrow id="register-arrow" />
                )}
              </button>
            </div>
          </div>

          <div className="card-footer">
            {tab === 'login' ? (
              <div className="footer-text">
                Don&apos;t have an account?{' '}
                <span className="footer-link" onClick={() => switchTab('register')}>
                  Create one free
                </span>
              </div>
            ) : (
              <div className="footer-text">
                Already have an account?{' '}
                <span className="footer-link" onClick={() => switchTab('login')}>
                  Sign in
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
