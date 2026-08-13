/* Notification centre storage (Doc §3.8). Lifted out of app-shell.js
   so both the bell and any page that raises a notification share it. */

export type NotifType = 'approve' | 'reject' | 'pending';

export type Notif = {
  id: number;
  ts: number;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
};

const NKEY = 'ramssolNotifCenter';
const RULES_KEY = 'ramssolNotify';

export const NOTIF_ICONS: Record<NotifType, string> = {
  approve: '✅',
  reject: '↩',
  pending: '📤',
};

export function getNotifs(): Notif[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(NKEY) || '[]');
  } catch {
    return [];
  }
}

export function saveNotifs(list: Notif[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NKEY, JSON.stringify(list.slice(0, 30)));
}

function rules(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(RULES_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Raise a notification, respecting Settings → Notification Rules. */
export function notify(type: NotifType, title: string, body = '') {
  if (rules()[type] === false) return;
  const list = getNotifs();
  list.unshift({ id: Date.now(), ts: Date.now(), type, title, body, read: false });
  saveNotifs(list);
  window.dispatchEvent(new Event('rams:notif'));
}

export function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
