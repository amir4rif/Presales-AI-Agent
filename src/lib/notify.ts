'use client';

import { isRemoteDataSource } from './data-sync';
import { getSession } from './role';
import { createSupabaseBrowserClient } from './supabase/client';
import { scopedStorageKey } from './user-storage';

export type NotifType = 'approve' | 'reject' | 'pending';

export type Notif = {
  id: string | number;
  ts: number;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
};

export type NotificationRules = Record<NotifType, boolean>;

const NKEY = 'ramssolNotifCenter';
const RULES_KEY = 'ramssolNotify';
let legacyStorageCleared = false;

export const NOTIFICATION_RULES: ReadonlyArray<{
  id: NotifType;
  label: string;
  def: boolean;
}> = [
  { id: 'reject', label: 'Notify me when my proposal is rejected', def: true },
  { id: 'approve', label: 'Notify me when my proposal is approved', def: true },
  { id: 'pending', label: 'Notify me when a proposal awaits my review', def: true },
];

export const NOTIF_ICONS: Record<NotifType, string> = {
  approve: '✅',
  reject: '↩',
  pending: '📤',
};

function storageIdentity() {
  const session = getSession();
  return session?.userId || session?.email || 'seed-user';
}

function discardUnscopedLegacyStorage() {
  if (typeof window === 'undefined' || legacyStorageCleared) return;
  // Shared values cannot be assigned safely to whichever account signs in
  // first after this fix, so discard them instead of migrating a data leak.
  localStorage.removeItem(NKEY);
  localStorage.removeItem(RULES_KEY);
  legacyStorageCleared = true;
}

/** Exported for settings and regression coverage. */
export function notificationStorageKey(base: 'messages' | 'rules') {
  discardUnscopedLegacyStorage();
  return scopedStorageKey(base === 'messages' ? NKEY : RULES_KEY, storageIdentity());
}

export function getNotificationRules(): NotificationRules {
  let saved: Partial<NotificationRules> = {};
  if (typeof window !== 'undefined') {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(notificationStorageKey('rules')) || '{}'
      );
      saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Partial<NotificationRules>
        : {};
    } catch {
      saved = {};
    }
  }

  return NOTIFICATION_RULES.reduce<NotificationRules>(
    (rules, definition) => {
      rules[definition.id] = saved[definition.id] ?? definition.def;
      return rules;
    },
    { approve: true, reject: true, pending: true }
  );
}

export function saveNotificationRules(rules: NotificationRules) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(notificationStorageKey('rules'), JSON.stringify(rules));
  window.dispatchEvent(new Event('rams:notif-rules'));
}

function enabledNotificationTypes() {
  const current = getNotificationRules();
  return NOTIFICATION_RULES
    .map((rule) => rule.id)
    .filter((type) => current[type]);
}

export function getNotifs(): Notif[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(
      localStorage.getItem(notificationStorageKey('messages')) || '[]'
    ) as Notif[];
    const enabled = new Set(enabledNotificationTypes());
    return stored.filter((notification) => enabled.has(notification.type));
  } catch {
    return [];
  }
}

export function saveNotifs(list: Notif[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(notificationStorageKey('messages'), JSON.stringify(list.slice(0, 30)));
}

/** Load the current recipient's durable rows, caching only under their key. */
export async function loadNotifs(): Promise<Notif[]> {
  if (!isRemoteDataSource()) return getNotifs();
  const enabled = enabledNotificationTypes();
  if (!enabled.length) return [];

  const response = await createSupabaseBrowserClient()
    .from('notifications')
    .select('id, created_at, event_type, title, body, read_at')
    .in('event_type', enabled)
    .order('created_at', { ascending: false })
    .limit(30);
  if (response.error) {
    throw new Error(`Could not load notifications: ${response.error.message}`);
  }

  const notifications = (response.data || []).map((row) => ({
    id: row.id,
    ts: new Date(row.created_at).getTime(),
    type: row.event_type as NotifType,
    title: row.title,
    body: row.body,
    read: row.read_at != null,
  }));
  saveNotifs(notifications);
  return notifications;
}

export async function markAllNotifsRead() {
  const cached = getNotifs().map((notification) => ({ ...notification, read: true }));
  saveNotifs(cached);
  if (!isRemoteDataSource()) return cached;

  const enabled = enabledNotificationTypes();
  if (!enabled.length) return cached;
  const response = await createSupabaseBrowserClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .in('event_type', enabled);
  if (response.error) {
    throw new Error(`Could not mark notifications as read: ${response.error.message}`);
  }
  return cached;
}

export async function clearNotifs() {
  saveNotifs([]);
  if (!isRemoteDataSource()) return;
  const userId = getSession()?.userId;
  if (!userId) throw new Error('Could not identify the notification recipient.');
  const response = await createSupabaseBrowserClient()
    .from('notifications')
    .delete()
    .eq('recipient_id', userId);
  if (response.error) {
    throw new Error(`Could not clear notifications: ${response.error.message}`);
  }
}

/** Refresh the bell immediately for local changes and remote recipient inserts. */
export function subscribeToNotifications(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener('rams:notif', onChange);
  window.addEventListener('rams:notif-rules', onChange);

  const userId = getSession()?.userId;
  if (!isRemoteDataSource() || !userId) {
    return () => {
      window.removeEventListener('rams:notif', onChange);
      window.removeEventListener('rams:notif-rules', onChange);
    };
  }

  const client = createSupabaseBrowserClient();
  const channel = client
    .channel(`notifications:${userId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
      },
      onChange
    )
    .subscribe();

  return () => {
    window.removeEventListener('rams:notif', onChange);
    window.removeEventListener('rams:notif-rules', onChange);
    void client.removeChannel(channel);
  };
}

export function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
