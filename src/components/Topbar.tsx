'use client';
/* Topbar — global search + notification centre, both lifted out of
   app-shell.js so every page gets them from one place. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { navLinks } from '@/lib/nav';
import type { Level } from '@/lib/role';
import { NOTIF_ICONS, getNotifs, saveNotifs, timeAgo, type Notif } from '@/lib/notify';
import type { Proposal, Prospect } from '@/lib/data';

type Hit = { icon: string; name: string; kind: string; href: string };

export default function Topbar({ title, level }: { title: string; level: Level }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openResults, setOpenResults] = useState(false);
  const [openPanel, setOpenPanel] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setNotifs(getNotifs());
    sync();
    window.addEventListener('rams:notif', sync);
    return () => window.removeEventListener('rams:notif', sync);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (openPanel && !panelRef.current?.contains(t) && !bellRef.current?.contains(t)) {
        setOpenPanel(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openPanel]);

  const results = useMemo<Hit[]>(() => {
    const v = query.trim().toLowerCase();
    if (!v) return [];
    const out: Hit[] = [];

    navLinks(level).forEach((n) => {
      if (n.label.toLowerCase().includes(v)) {
        out.push({ icon: '📄', name: n.label, kind: 'Page', href: n.href });
      }
    });

    let proposals: Proposal[] = [];
    let prospects: Prospect[] = [];
    try {
      proposals = JSON.parse(localStorage.getItem('ramssolProposals') || '[]');
    } catch {}
    try {
      prospects = JSON.parse(localStorage.getItem('ramssolProspects') || '[]');
    } catch {}

    proposals
      .filter((p) => p.status !== 'Superseded')
      .forEach((p) => {
        if ([p.company, p.deal, p.caseId].some((x) => (x || '').toLowerCase().includes(v))) {
          out.push({ icon: '📝', name: `${p.company} — ${p.status}`, kind: 'Proposal', href: '/proposals' });
        }
      });

    prospects.forEach((p) => {
      if ((p.name || '').toLowerCase().includes(v)) {
        out.push({ icon: '👥', name: p.name, kind: 'Prospect', href: '/prospects' });
      }
    });

    return out.slice(0, 8);
  }, [query, level]);

  const unread = notifs.some((n) => !n.read);

  function togglePanel() {
    const next = !openPanel;
    setOpenPanel(next);
    if (next) {
      const list = getNotifs().map((n) => ({ ...n, read: true }));
      saveNotifs(list);
      setNotifs(list);
    }
  }

  return (
    <div className="topbar">
      <span className="topbar-title">{title}</span>
      <div className="topbar-right">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            placeholder="Search anything..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenResults(true);
            }}
            onFocus={() => setOpenResults(true)}
            onBlur={() => setTimeout(() => setOpenResults(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpenResults(false);
            }}
          />
          <div className={`search-results${openResults && query.trim() ? ' open' : ''}`}>
            {results.length ? (
              results.map((r, i) => (
                <div
                  key={`${r.href}-${i}`}
                  className="sr-item"
                  onMouseDown={() => router.push(r.href)}
                >
                  <span className="sr-ico">{r.icon}</span>
                  <span className="sr-name">{r.name}</span>
                  <span className="sr-kind">{r.kind}</span>
                </div>
              ))
            ) : (
              <div className="notif-empty">No matches</div>
            )}
          </div>
        </div>

        <div className="badge-notif" ref={bellRef} onClick={togglePanel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <div className="notif-dot" style={{ display: unread ? 'block' : 'none' }} />
        </div>
      </div>

      {openPanel && (
        <div className="notif-panel" ref={panelRef} style={{ display: 'block' }}>
          <div className="notif-head">
            <span className="nh-title">Notifications</span>
            <button
              className="nh-clear"
              onClick={() => {
                saveNotifs([]);
                setNotifs([]);
              }}
            >
              Clear all
            </button>
          </div>
          {notifs.length ? (
            notifs.map((n) => (
              <div key={n.id} className="notif-item">
                <span className="ni-ico">{NOTIF_ICONS[n.type] || '🔔'}</span>
                <div>
                  <div className="ni-title">{n.title}</div>
                  {n.body && <div className="ni-body">{n.body}</div>}
                  <div className="ni-time">{timeAgo(n.ts)}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="notif-empty">You&rsquo;re all caught up 🎉</div>
          )}
        </div>
      )}
    </div>
  );
}
