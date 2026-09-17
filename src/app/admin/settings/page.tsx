'use client';
/* Administration (Doc §3.7) — Level 3 only.

   The Integrations tab changed shape in this round: the AI key and the
   Lark token are no longer typed in here and saved to localStorage.
   They live in .env.local on the server, so the tab now *reports*
   whether each one is wired up rather than collecting it. */
import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import {
  currentUser,
  getAccessRoles,
  getProposals,
  getNotificationRuleDefinitions,
  getStages,
  getTeam,
  saveWorkspaceConfigValue,
  saveTeam,
  type AccessRole,
  type Stage,
  type TeamMember,
} from '@/lib/data';
import { getSession, setSession, type Level } from '@/lib/role';
import { useIntegrations } from '@/lib/useIntegrations';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';
import {
  getNotificationRules,
  saveNotificationRules,
  type NotificationRules,
  type NotifType,
} from '@/lib/notify';

const TABS = [
  { id: 'profile', label: 'My Profile' },
  { id: 'team', label: 'Team Management' },
  { id: 'pipeline', label: 'Pipeline & SLA' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'notify', label: 'Notifications & Data' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const OK_STYLE = { background: 'rgba(52, 211, 153, 0.2)', color: '#34D399' };
const ERR_STYLE = { background: 'rgba(239, 68, 68, 0.2)', color: '#F87171' };

function LevelBadge({ level, label }: { level: Level; label?: string }) {
  return (
    <span className={`level-badge level-${level}`}>
      L{level}{label ? ` · ${label}` : ''}
    </span>
  );
}

function downloadCSV(name: string, rows: (string | number | undefined)[][]) {
  const csv = rows
    .map((r) => r.map((c) => {
      let value = String(c ?? '');
      if (/^[\t\r\n ]*[=+\-@]/.test(value)) value = `'${value}`;
      return `"${value.replace(/"/g, '""')}"`;
    }).join(','))
    .join('\n');
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.href = url;
  a.download = name;
  a.click();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

function SettingsPage() {
  const [tab, setTab] = useState<TabId>('profile');
  const { ai, supabase, loading } = useIntegrations();

  const [profile, setProfile] = useState({ name: '', email: '', role: '' });
  const [profileStatus, setProfileStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', role: '' });

  const [sla, setSla] = useState<Record<number, number>>({});
  const [slaStatus, setSlaStatus] = useState<string | null>(null);

  const [notify, setNotify] = useState<NotificationRules>(() => getNotificationRules());
  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);

  const loadWorkspace = useCallback(() => {
    setTeam(getTeam());
    const nextRoles = getAccessRoles();
    setRoles(nextRoles);
    setInvite((current) => current.role
      ? current
      : {
          ...current,
          role: nextRoles.find((role) => role.default)?.role || nextRoles[0]?.role || '',
        });
    setStages(getStages());
    setNotify(getNotificationRules());
  }, []);

  useEffect(() => {
    const sess = getSession();
    setProfile({
      name: currentUser(),
      email: sess?.email || '',
      role: sess?.role || '',
    });
    loadWorkspace();
  }, [loadWorkspace]);
  useRemoteDataRefresh(loadWorkspace);

  const levelForRole = (role: string) =>
    roles.find((definition) => definition.role === role)?.level;
  const levelLabel = (level: Level) =>
    roles.find((definition) => definition.level === level)?.label;
  const roleNames = roles.map((definition) => definition.role);
  const profileLevel = levelForRole(profile.role) || getSession()?.level || 1;

  async function saveProfile() {
    const session = getSession();
    const name = profile.name.trim() || currentUser();
    const selectedLevel = levelForRole(profile.role);
    if (!selectedLevel) {
      setProfileStatus({ ok: false, msg: 'Choose a configured role.' });
      return;
    }
    const next = team.map((member) =>
      member.id === session?.userId || member.email === session?.email
        ? { ...member, name, role: profile.role, level: selectedLevel }
        : member
    );
    const saved = await saveTeam(next);
    if (!saved) {
      setProfileStatus({ ok: false, msg: '❌ Profile was not saved to the database.' });
      return;
    }
    setTeam(next);
    const names = name.split(/\s+/);
    if (session) {
      setSession({
        ...session,
        firstName: names[0] || '',
        lastName: names.slice(1).join(' '),
        role: profile.role,
        level: selectedLevel,
      });
    }
    setProfileStatus({ ok: true, msg: '✅ Profile updated.' });
    setTimeout(() => setProfileStatus(null), 2000);
  }

  async function changePassword() {
    if (!pw.current || !pw.next || !pw.confirm) {
      setPwStatus({ ok: false, msg: '❌ Please fill in all password fields.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwStatus({ ok: false, msg: '❌ New passwords do not match.' });
      return;
    }
    const client = createSupabaseBrowserClient();
    const signedIn = await client.auth.signInWithPassword({ email: profile.email, password: pw.current });
    if (signedIn.error) {
      setPwStatus({ ok: false, msg: '❌ Current password is incorrect.' });
      return;
    }
    const updated = await client.auth.updateUser({ password: pw.next });
    if (updated.error) {
      setPwStatus({ ok: false, msg: `❌ ${updated.error.message}` });
      return;
    }
    setPwStatus({ ok: true, msg: '✅ Password updated securely through Supabase Auth.' });
    setPw({ current: '', next: '', confirm: '' });
    setTimeout(() => setPwStatus(null), 2000);
  }

  function removeMember(index: number) {
    void index;
    alert('Remove authentication users in Supabase Auth. This screen only manages application access levels.');
  }

  async function changeMemberRole(index: number, role: string) {
    const level = levelForRole(role);
    if (!level) return;
    const next = team.map((member, memberIndex) =>
      memberIndex === index ? { ...member, role, level } : member
    );
    const saved = await saveTeam(next);
    if (!saved) return;
    setTeam(next);
  }

  function sendInvite() {
    if (!invite.email.trim()) {
      alert('Please enter an email address.');
      return;
    }
    alert('Ask the teammate to create an account first. Their database profile will appear here for role assignment.');
  }

  async function saveStages() {
    const next = stages.map((stage) => ({
      ...stage,
      sla: Number(sla[stage.id] ?? stage.sla),
    }));
    if (next.some((stage) => !Number.isFinite(stage.sla) || stage.sla <= 0)) {
      setSlaStatus('Enter a positive SLA for every stage.');
      return;
    }
    const saved = await saveWorkspaceConfigValue('pipeline_stages', next);
    if (!saved) {
      setSlaStatus('SLA thresholds were not saved to the database.');
      return;
    }
    setStages(next);
    setSla({});
    setSlaStatus('✅ SLA thresholds saved to the database.');
    setTimeout(() => setSlaStatus(null), 2000);
  }

  async function toggleNotify(id: NotifType, value: boolean) {
    const next = { ...notify, [id]: value };
    setNotify(next);
    const saved = await saveNotificationRules(next);
    if (!saved) setNotify(notify);
    setNotifyStatus(saved
      ? '✅ Notification rules saved to the database.'
      : 'Notification rules were not saved to the database.');
    setTimeout(() => setNotifyStatus(null), 1800);
  }

  function exportData(kind: 'proposals' | 'team' | 'stages') {
    if (kind === 'proposals') {
      downloadCSV('proposal_store.csv', [
        ['Proposal ID', 'Case ID', 'Version', 'Opportunity ID', 'Account', 'Value', 'Owner', 'Status', 'Reviewer', 'Rejection Reason', 'Decision Date'],
        ...getProposals().map((p) => [
          p.id, p.caseId, p.version, p.opportunityId, p.company, p.value,
          p.owner || p.submittedBy, p.status, p.reviewer, p.rejectionReason, p.reviewedDate,
        ]),
      ]);
    } else if (kind === 'team') {
      downloadCSV('team_access_levels.csv', [
        ['Name', 'Email', 'Role', 'Access Level', 'Level Name', 'Status'],
        ...team.map((m) => [
          m.name,
          m.email,
          m.role,
          m.level || levelForRole(m.role),
          levelLabel((m.level || levelForRole(m.role) || 1) as Level),
          m.status,
        ]),
      ]);
    } else {
      downloadCSV('pipeline_stages_sla.csv', [
        ['#', 'Stage', 'SLA (days)', 'Win Probability %'],
        ...stages.map((s) => [s.id, s.name, sla[s.id] ?? s.sla, Math.round(s.prob * 100)]),
      ]);
    }
  }

  const panelStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderTop: 'none',
    borderRadius: '0 0 10px 10px',
    padding: 24,
    background: 'var(--card)',
    marginBottom: 24,
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <span className="level-badge level-3">Administrator · Level 3</span>
      </div>

      {/* Doc §3.7: Settings is restricted to Level 3 (Administrator) users. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(201,168,76,0.10)', border: '1px solid var(--gold)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 18,
          fontSize: 12.5, color: 'var(--gold-soft)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>
          <strong>Administrator only.</strong> Full system configuration — changes here affect every
          user in the system.
        </span>
      </div>

      <div
        className="tab-row"
        style={{ borderRadius: '10px 10px 0 0', border: '1px solid var(--border)', borderBottom: 'none', overflow: 'hidden' }}
      >
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PROFILE ── */}
      {tab === 'profile' && (
        <div style={panelStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">Profile Details</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    className="form-input"
                    value={profile.name}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    className="form-input"
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select
                    className="form-input"
                    value={profile.role}
                    onChange={(e) => setProfile((p) => ({ ...p, role: e.target.value }))}
                  >
                    {roleNames.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Access Level</label>
                  <div>
                    <LevelBadge level={profileLevel} label={levelLabel(profileLevel)} />
                  </div>
                </div>
                {profileStatus && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, ...(profileStatus.ok ? OK_STYLE : ERR_STYLE) }}>
                    {profileStatus.msg}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn-primary" onClick={saveProfile}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={14} height={14}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Save Changes
                  </button>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">Change Password</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {(['current', 'next', 'confirm'] as const).map((k) => (
                  <div className="form-group" key={k}>
                    <label className="form-label">
                      {k === 'current' ? 'Current Password' : k === 'next' ? 'New Password' : 'Confirm New Password'}
                    </label>
                    <input
                      className="form-input"
                      type="password"
                      placeholder="••••••••"
                      value={pw[k]}
                      onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))}
                    />
                  </div>
                ))}
                {pwStatus && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, ...(pwStatus.ok ? OK_STYLE : ERR_STYLE) }}>
                    {pwStatus.msg}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn-secondary" onClick={changePassword}>
                    Update Password
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TEAM ── */}
      {tab === 'team' && (
        <div style={panelStyle}>
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Manage who has access to this workspace and their permission level.
            </div>
            <button className="btn-primary" onClick={() => setInviteOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={14} height={14}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Invite Member
            </button>
          </div>

          <div className="deals-table-wrap">
            <table className="deals-table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Role</th><th>Access Level</th>
                  <th>Status</th><th>Last Active</th><th />
                </tr>
              </thead>
              <tbody>
                {team.map((m, i) => (
                  <tr key={`${m.email}-${i}`}>
                    <td>{m.name}</td>
                    <td style={{ color: 'var(--gray-500)' }}>{m.email}</td>
                    <td>
                      <select value={m.role} onChange={(event) => changeMemberRole(i, event.target.value)}>
                        {roleNames.map((role) => <option key={role}>{role}</option>)}
                      </select>
                    </td>
                    <td>
                      <LevelBadge
                        level={(m.level || levelForRole(m.role) || 1) as Level}
                        label={levelLabel((m.level || levelForRole(m.role) || 1) as Level)}
                      />
                    </td>
                    <td>
                      <span className={`status-badge ${m.status === 'active' ? 'status-completed' : 'status-review'}`}>
                        {m.status === 'active' ? 'Active' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--gray-500)' }}>{m.lastActive}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => removeMember(i)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Access model reference (Doc §2) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 16 }}>
            {[1, 2, 3].map((level) => roles.find((role) => role.level === level)).filter(
              (role): role is AccessRole => Boolean(role)
            ).map((r) => (
              <div className="card" style={{ padding: 16 }} key={r.level}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`level-badge level-${r.level}`}>Level {r.level}</span>
                  <strong style={{ fontSize: 13 }}>{r.label}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PIPELINE & SLA ── */}
      {tab === 'pipeline' && (
        <div style={panelStyle}>
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Pipeline stage definitions and SLA day thresholds. Applied across the Pipeline and
              Analytics views.
            </div>
            <button className="btn-primary" onClick={saveStages}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={14} height={14}>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Save SLA Thresholds
            </button>
          </div>
          <div className="deals-table-wrap">
            <table className="deals-table">
              <thead>
                <tr>
                  <th>#</th><th>Stage Name</th><th>SLA (days)</th><th>Win Probability</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{s.id}</td>
                    <td>{s.name}</td>
                    <td>
                      <input
                        className="form-input"
                        style={{ width: 90, padding: '5px 8px' }}
                        type="number"
                        value={sla[s.id] ?? s.sla}
                        onChange={(e) => setSla((prev) => ({ ...prev, [s.id]: Number(e.target.value) }))}
                      />
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--gray-500)' }}>
                      {Math.round(s.prob * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {slaStatus && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, ...OK_STYLE }}>
              {slaStatus}
            </div>
          )}
        </div>
      )}

      {/* ── INTEGRATIONS ── */}
      {tab === 'integrations' && (
        <div style={panelStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">AI API Key</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  The selected AI provider key lives on the server and is used by <code>/api/generate</code>
                  for every AI feature. It is never sent to the browser.
                </div>
                <div className="cfg-row">
                  <span className={`cfg-dot ${ai?.configured ? 'cfg-ok' : 'cfg-warn'}`} />
                  <div className="cfg-info">
                    <div className="cfg-name">{ai?.configured ? 'Server configuration ready' : 'Not configured'}</div>
                    <div className="cfg-sub">
                      {loading
                        ? 'Checking…'
                        : ai?.configured
                          ? `Provider: ${ai.provider} · Model: ${ai.model}. Connectivity is tested only when an AI feature is used.`
                          : `Missing: ${ai?.missing?.join(', ') || 'GEMINI_API_KEY'}.`}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">Supabase Database &amp; Auth</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Set the project URL and publishable key in <code>.env.local</code>, apply the checked-in
                  migrations. Supabase is the application&apos;s only runtime data source.
                  The publishable key is safe for the browser; RLS protects every row.
                </div>
                <div className="cfg-row">
                  <span className={`cfg-dot ${supabase?.ready ? 'cfg-ok' : 'cfg-warn'}`} />
                  <div className="cfg-info">
                    <div className="cfg-name">
                      {supabase?.ready ? 'Supabase ready' : 'Supabase needs configuration'}
                    </div>
                    <div className="cfg-sub">
                      {loading
                        ? 'Checking…'
                        : supabase?.ready
                          ? 'Public configuration is present. Auth and RLS are enforced during use.'
                          : `Missing: ${supabase?.missing?.join(', ') || 'Supabase public values'}.`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS & DATA ── */}
      {tab === 'notify' && (
        <div style={panelStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">Notification Rules</span>
              </div>
              <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                These preferences apply only to this signed-in account. Every listed event has live recipient delivery.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {getNotificationRuleDefinitions().map((r) => (
                  <label
                    key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={!!notify[r.id]}
                      onChange={(e) => toggleNotify(r.id, e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: 'var(--brand-400)' }}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
              {notifyStatus && (
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, ...OK_STYLE }}>
                  {notifyStatus}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 22 }}>
              <div className="card-header">
                <span className="card-title">Data Export</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Export system data as CSV for reporting or backup.
                </div>
                <button className="btn-secondary" onClick={() => exportData('proposals')}>
                  ⬇ Export Proposal Store (CSV)
                </button>
                <button className="btn-secondary" onClick={() => exportData('team')}>
                  ⬇ Export Team &amp; Access Levels (CSV)
                </button>
                <button className="btn-secondary" onClick={() => exportData('stages')}>
                  ⬇ Export Pipeline Stages &amp; SLA (CSV)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Team Member"
        sub="Send an invite to add a new member to this workspace."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={sendInvite}>
              Send Invite
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Email Address</label>
          <input
            className="form-input"
            type="email"
            placeholder="name@company.com"
            value={invite.email}
            onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Role</label>
          <select
            className="form-input"
            value={invite.role}
            onChange={(e) => setInvite((v) => ({ ...v, role: e.target.value }))}
          >
            {roleNames.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={3}>
      <SettingsPage />
    </RequireLevel>
  );
}
