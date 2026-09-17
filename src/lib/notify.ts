'use client';

import {
  getNotificationPreferences,
  getNotificationRuleDefinitions,
  saveNotificationPreferences,
} from './data';
import { getSession } from './role';
import { createSupabaseBrowserClient } from './supabase/client';

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

let notificationCache: Notif[] = [];

export const NOTIF_ICONS: Record<NotifType, string> = {
  approve: '✅',
  reject: '↩',
  pending: '📤',
};

export function getNotificationRules(): NotificationRules {
  const saved = new Map(
    getNotificationPreferences().map((preference) => [preference.eventType, preference.enabled])
  );
  return getNotificationRuleDefinitions().reduce<NotificationRules>(
    (rules, definition) => {
      rules[definition.id] = saved.get(definition.id) ?? definition.defaultEnabled;
      return rules;
    },
    { approve: false, reject: false, pending: false }
  );
}

export async function saveNotificationRules(rules: NotificationRules) {
  const saved = await saveNotificationPreferences(
    getNotificationRuleDefinitions().map((definition) => ({
      eventType: definition.id,
      enabled: rules[definition.id],
    }))
  );
  if (saved) window.dispatchEvent(new Event('rams:notif-rules'));
  return saved;
}

function enabledNotificationTypes() {
  const current = getNotificationRules();
  return getNotificationRuleDefinitions()
    .map((rule) => rule.id)
    .filter((type) => current[type]);
}

export function getNotifs(): Notif[] {
  const enabled = new Set(enabledNotificationTypes());
  return notificationCache.filter((notification) => enabled.has(notification.type));
}

export function saveNotifs(list: Notif[]) {
  notificationCache = list.slice(0, 30);
}

/** Load the current recipient's durable rows, caching only under their key. */
export async function loadNotifs(): Promise<Notif[]> {
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
  if (!userId) {
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
