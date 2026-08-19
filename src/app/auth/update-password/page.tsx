'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function update() {
    if (password.length < 8) return setMessage('Use at least 8 characters.');
    if (password !== confirm) return setMessage('Passwords do not match.');
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.replace('/dashboard');
  }

  return (
    <div className="page-bg" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(440px, 100%)', padding: 28 }}>
        <div className="form-title">Choose a new password</div>
        <div className="form-subtitle">Your new password must be at least 8 characters.</div>
        {message && <div className="alert error" style={{ display: 'block' }}>{message}</div>}
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" value={password}
            onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
            onChange={(event) => setConfirm(event.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy} onClick={() => void update()}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </div>
  );
}
