'use client';
/* Prospect detail + AI Copilot (Doc §3.3).

   The copilot can answer in chat, or generate a Sales Intelligence
   Report (PDF / editable Word) or an 8-slide Proposal deck (PDF). Intent
   is detected from the message, same as before. */
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { callClaude } from '@/lib/ai';
import {
  detectDocIntent,
  detectProposalIntent,
  downloadProposalPDF,
  downloadReportPDF,
  downloadReportWord,
  parseJsonReply,
} from '@/lib/docExport';
import { buildProposalHTML, buildReportHTML, type ProposalData, type ReportData } from '@/lib/docTemplates';
import { STAGES, currentUser, getDeals, saveProspects, type Deal, type Prospect } from '@/lib/data';

const PAIN_ICONS = ['🟠', '⚠️', '🔴', '📊', '🌐'];

/* Which sections each tab shows (Doc §3.3 detail view). */
const TAB_SECTIONS: Record<string, string[]> = {
  overview: ['overview', 'pain', 'opps'],
  insights: ['overview', 'pain'],
  solutions: ['overview'],
  opportunities: ['opps'],
  documents: ['docs'],
  notes: ['notes'],
};

type ChatItem =
  | { kind: 'user' | 'bot'; text: string }
  | { kind: 'typing' }
  | { kind: 'report'; name: string; html: string; filename: string }
  | { kind: 'proposal'; name: string; html: string; filename: string };

export default function ProspectDetail({
  prospect,
  all,
  onBack,
  onChange,
  onNewDeal,
}: {
  prospect: Prospect;
  all: Prospect[];
  onBack: () => void;
  onChange: (next: Prospect[]) => void;
  onNewDeal: () => void;
}) {
  const toast = useToast();
  const p = prospect;
  const [tab, setTab] = useState('overview');
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState('');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDeals(getDeals());
    setNotes(localStorage.getItem(`ramssolNotes_${p.id}`) || '');
  }, [p.id]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [chat]);

  const show = TAB_SECTIONS[tab] || TAB_SECTIONS.overview;
  const visible = (id: string) => show.includes(id);

  function toggleWatch() {
    const next = all.map((x) => (x.id === p.id ? { ...x, watched: !x.watched } : x));
    saveProspects(next);
    onChange(next);
    toast(p.watched ? 'Removed from watchlist' : '★ Added to your watchlist');
  }

  /* Per-prospect notes stay local until the Lark phase. */
  function onNotes(value: string) {
    setNotes(value);
    localStorage.setItem(`ramssolNotes_${p.id}`, value);
    setNotesSaved('Saved ✓');
    setTimeout(() => setNotesSaved(''), 1500);
  }

  const relatedDeals = deals.filter((d) =>
    d.account.toLowerCase().includes(p.name.split(' ')[0].toLowerCase())
  );

  const push = (item: ChatItem) => setChat((c) => [...c, item]);
  const dropTyping = () => setChat((c) => c.filter((i) => i.kind !== 'typing'));

  async function generateProposal(userMsg: string) {
    push({ kind: 'typing' });
    const system = `You are a Sales Proposal AI for Ramssol Group. Generate a structured JSON proposal for a prospect.
Return ONLY valid JSON — no markdown, no backticks, no other text.
JSON structure:
{
  "proposalTitle": "Short compelling proposal title mentioning the client",
  "proposalSubtitle": "1 sentence subtitle",
  "executiveSummary": "2-3 sentence summary of the opportunity and why Ramssol is a strong fit",
  "employeeSize": "best estimate as number range",
  "engagementType": "e.g. Software Implementation + Managed Services",
  "keyPainPoints": ["pain point 1", "pain point 2", "pain point 3", "pain point 4"],
  "recommendedSolutions": [
    { "product": "Product name", "reason": "Why it fits this client specifically, 1-2 sentences" }
  ],
  "pricing": {
    "items": [
      { "item": "Item name", "description": "short description", "cost": "e.g. RM 120,000 (one-time)" }
    ],
    "total": "e.g. RM 350,000 (Year 1)"
  },
  "timeline": [
    { "phase": "Discovery", "duration": "Weeks 1-2", "description": "short description" },
    { "phase": "Implementation", "duration": "Weeks 3-10", "description": "short description" },
    { "phase": "Go-Live", "duration": "Week 11", "description": "short description" },
    { "phase": "Support", "duration": "Ongoing", "description": "short description" }
  ],
  "whyRamssol": [
    { "title": "Short reason title", "detail": "1 sentence detail" }
  ],
  "nextSteps": ["step 1", "step 2", "step 3"]
}`;

    const prompt = `Generate a sales proposal for:
Company: ${p.name}
Industry: ${p.type}
Country: ${p.country}
Employees: ${p.employees}
Website: ${p.website}
Pain Points: ${(p.painPoints || []).join(', ')}
AI Research available: ${p.aiResearch ? JSON.stringify(p.aiResearch) : 'None'}
User request: ${userMsg}`;

    const raw = await callClaude([{ role: 'user', content: prompt }], system, { maxTokens: 8000 });
    dropTyping();

    const data = parseJsonReply<ProposalData>(raw, {
      proposalTitle: `Partnership Proposal for ${p.name}`,
      executiveSummary:
        p.aiResearch?.companyBackground || `${p.name} is a ${p.type} organisation based in ${p.country}.`,
      employeeSize: p.employees,
      keyPainPoints: p.painPoints || [],
      recommendedSolutions: [],
      pricing: { items: [], total: '—' },
      timeline: [],
      whyRamssol: [],
      nextSteps: [
        'Schedule a follow-up discussion',
        'Confirm scope and pricing',
        'Sign off and kick off implementation',
      ],
    });

    push({
      kind: 'proposal',
      name: p.name,
      html: buildProposalHTML(data, p),
      filename: `Ramssol_Proposal_${p.name.replace(/\s+/g, '_')}`,
    });
  }

  async function generateReport(userMsg: string) {
    push({ kind: 'typing' });
    const system = `You are a Sales Intelligence AI for Ramssol Group. Generate a structured JSON report for a prospect.
Return ONLY valid JSON — no markdown, no backticks, no other text.
JSON structure:
{
  "executiveSummary": "2-3 sentence overview of the company and why they are a good prospect for Ramssol",
  "financials": { "revenue": "e.g. RM 50M–200M/year", "itSpend": "e.g. RM 2M–5M/year", "hrSpend": "e.g. RM 500K–1M/year" },
  "employeeSize": "best estimate as number range",
  "decisionMaker": "most likely decision-maker title and department",
  "buyingPotential": "High or Medium or Low",
  "buyingPotentialReason": "1 sentence explanation",
  "keyPainPoints": ["pain point 1", "pain point 2", "pain point 3", "pain point 4"],
  "recommendedSolutions": [
    { "product": "Product name", "reason": "Why it fits this client specifically" },
    { "product": "Product name", "reason": "Why it fits this client specifically" }
  ],
  "nextSteps": ["step 1", "step 2", "step 3"]
}`;

    const prompt = `Generate a sales intelligence report for:
Company: ${p.name}
Industry: ${p.type}
Country: ${p.country}
Employees: ${p.employees}
Website: ${p.website}
Pain Points: ${(p.painPoints || []).join(', ')}
AI Research available: ${p.aiResearch ? JSON.stringify(p.aiResearch) : 'None'}
User request: ${userMsg}`;

    const raw = await callClaude([{ role: 'user', content: prompt }], system, { maxTokens: 6000 });
    dropTyping();

    // If JSON fails, build a minimal report from existing prospect data.
    const data = parseJsonReply<ReportData>(raw, {
      executiveSummary:
        p.aiResearch?.companyBackground || `${p.name} is a ${p.type} organisation based in ${p.country}.`,
      financials: {
        revenue: p.aiResearch?.estimatedRevenue || '—',
        itSpend: p.aiResearch?.estimatedITSpend || '—',
        hrSpend: p.aiResearch?.estimatedHRSpend || '—',
      },
      employeeSize: p.employees,
      decisionMaker: p.aiResearch?.decisionMaker || '—',
      buyingPotential: p.aiResearch?.buyingPotential || 'Medium',
      buyingPotentialReason: p.aiResearch?.buyingPotentialReason || '—',
      keyPainPoints: p.painPoints || [],
      recommendedSolutions: [],
      nextSteps: [
        'Schedule discovery call',
        'Send introductory proposal',
        'Follow up within 5 business days',
      ],
    });

    push({
      kind: 'report',
      name: p.name,
      html: buildReportHTML(data, p),
      filename: `Ramssol_Intelligence_${p.name.replace(/\s+/g, '_')}`,
    });
  }

  async function ask(preset?: string) {
    const msg = (preset || input).trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    push({ kind: 'user', text: msg });

    try {
      // Proposal is checked first — it is the more specific intent.
      if (detectProposalIntent(msg)) {
        await generateProposal(msg);
        return;
      }
      if (detectDocIntent(msg)) {
        await generateReport(msg);
        return;
      }

      push({ kind: 'typing' });
      const system = `You are an AI Pre-Sales Consultant for Ramssol Group. Current prospect: ${p.name} (${p.type}). Pain points: ${(p.painPoints || []).join(', ')}. Be concise and sales-focused.

IMPORTANT: If the user asks you to generate a PDF, document, report, proposal, or slide deck — tell them to type something like "generate a PDF proposal for this company" (for a proposal slide deck) or "generate a PDF report for this company" (for an intelligence report), and the system will handle it automatically. Do not try to describe what the document would contain as text.`;
      const reply = await callClaude([{ role: 'user', content: msg }], system);
      dropTyping();
      push({ kind: 'bot', text: reply });
    } finally {
      setBusy(false);
    }
  }

  const QUICK = [
    { label: 'Research this organization', msg: `Research ${p.name} and identify their biggest technology needs` },
    { label: 'What are their key challenges?', msg: `What are the key challenges facing ${p.name} and how can Ramssol help?` },
    { label: 'Suggest solutions to pitch', msg: `Suggest the best Ramssol solutions for ${p.name} in the ${p.type} sector` },
    { label: 'Generate proposal outline', msg: `Generate a full proposal outline for ${p.name} in the ${p.type} sector with pricing` },
  ];

  return (
    <>
      <button className="back-btn" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Prospects
      </button>

      <div className="prospect-detail-header">
        <div className="prospect-detail-top">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="prospect-detail-name">{p.name}</div>
              <span className="prospect-tag">{p.type}</span>
            </div>
            <div className="prospect-detail-meta">
              <span className="meta-item">
                🌐{' '}
                {p.website && p.website !== '—' ? (
                  <a
                    href={`https://${p.website.replace(/^https?:\/\//, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {p.website}
                  </a>
                ) : (
                  '—'
                )}
              </span>
              <span className="meta-item">📅 Added {p.added}</span>
              <span className="meta-item">👥 {p.employees}</span>
              {p.contact && p.contact !== '—' && <span className="meta-item">👤 {p.contact}</span>}
              {p.authority && p.authority !== '—' && <span className="meta-item">🔑 {p.authority}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={toggleWatch}>
              {p.watched ? '★ Watching' : '⭐ Watch'}
            </button>
            <button className="btn-primary" onClick={onNewDeal}>
              + New Deal
            </button>
          </div>
        </div>
        <div className="detail-tabs">
          {['overview', 'insights', 'solutions', 'opportunities', 'documents', 'notes'].map((t) => (
            <button
              key={t}
              className={`detail-tab${tab === t ? ' active' : ''}`}
              onClick={() => {
                setTab(t);
                if (t === 'solutions') {
                  toast('💡 Ask the AI Copilot → "Suggest solutions to pitch" for tailored recommendations');
                }
              }}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          {visible('overview') && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Company Overview</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--gray-700)', lineHeight: 1.7, marginBottom: 16 }}>
                {p.aiResearch?.companyBackground ||
                  `${p.name} is a ${p.type} organization based in ${p.country}.`}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Industry</div>
                  <div style={{ fontSize: 13 }}>{p.type}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Country</div>
                  <div style={{ fontSize: 13 }}>{p.country}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Employees</div>
                  <div style={{ fontSize: 13 }}>{p.employees}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Website</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-500)' }}>{p.website}</div>
                </div>
                {p.currentSystem && p.currentSystem !== '—' && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Current System</div>
                    <div style={{ fontSize: 13 }}>{p.currentSystem}</div>
                  </div>
                )}
                {p.itBudget && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>IT Budget</div>
                    <div style={{ fontSize: 13 }}>{p.itBudget}</div>
                  </div>
                )}
                {p.aiResearch?.estimatedRevenue && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Est. Revenue</div>
                    <div style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>
                      {p.aiResearch.estimatedRevenue}
                    </div>
                  </div>
                )}
                {p.aiResearch?.buyingPotential && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Buying Potential</div>
                    <div style={{ fontSize: 13 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          color:
                            p.aiResearch.buyingPotential === 'High'
                              ? 'var(--brand-600)'
                              : p.aiResearch.buyingPotential === 'Low'
                                ? 'var(--red-700)'
                                : 'var(--amber-600)',
                        }}
                      >
                        {p.aiResearch.buyingPotential}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {visible('pain') && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">
                  Key Pain Points{' '}
                  <span
                    style={{
                      fontSize: 11,
                      background: 'var(--amber-50)',
                      color: 'var(--amber-600)',
                      padding: '2px 7px',
                      borderRadius: 20,
                      marginLeft: 6,
                    }}
                  >
                    {(p.painPoints || []).length} identified
                  </span>
                </span>
              </div>
              <ul className="pain-points-list">
                {(p.painPoints || []).map((pt, i) => (
                  <li className="pain-item" key={`${pt}-${i}`}>
                    <span className="picon">{PAIN_ICONS[i % PAIN_ICONS.length]}</span>
                    <p>{pt}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {visible('opps') && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Active Opportunities</span>
              </div>
              <table className="opp-table">
                <thead>
                  <tr>
                    <th>Opportunity</th>
                    <th>Stage</th>
                    <th>Owner</th>
                    <th>Close Date</th>
                    <th>Value (RM)</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedDeals.length ? (
                    relatedDeals.map((d, i) => (
                      <tr key={`${d.account}-${i}`}>
                        <td>{d.account}</td>
                        <td>
                          <span className="stage-badge stage-proposal">
                            Stage {d.stage}
                          </span>
                        </td>
                        <td>{d.rep}</td>
                        <td>
                          {new Date(Date.now() + d.daysToClose * 86400000).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{(d.value / 1000000).toFixed(2)}M</td>
                        <td>{d.status === 'On Track' ? '🟢' : d.status === 'At Risk' ? '🟡' : '🔴'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 16 }}>
                        No active opportunities
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {visible('docs') && (
            <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>📁</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-900)' }}>
                Document storage arrives with Lark Base
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 6, lineHeight: 1.6 }}>
                Proposals, RFP responses and contracts for {p.name} will sync here in the final
                integration phase.
              </div>
            </div>
          )}

          {visible('notes') && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <span className="card-title">Notes</span>
                <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{notesSaved}</span>
              </div>
              <textarea
                className="ft"
                rows={9}
                value={notes}
                onChange={(e) => onNotes(e.target.value)}
                placeholder="Meeting notes, next steps, stakeholder observations… saved automatically."
              />
            </div>
          )}
        </div>

        {/* ── AI COPILOT ── */}
        <div>
          <div className="ai-panel" style={{ height: 580 }}>
            <div className="ai-copilot-header">
              <div className="ai-copilot-title">
                AI Copilot <span className="ai-badge">AI</span>
              </div>
            </div>

            <div className="ai-messages" ref={feedRef}>
              <div className="ai-msg-system">
                Hi {currentUser().split(' ')[0]},
                <br />
                How can I help you with <strong>{p.name}</strong>?
              </div>

              {chat.map((m, i) => {
                if (m.kind === 'typing') {
                  return (
                    <div className="ai-msg-bot" key={i}>
                      <div className="ai-typing">
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                      </div>
                    </div>
                  );
                }
                if (m.kind === 'user') {
                  return (
                    <div className="ai-msg-user" key={i}>
                      {m.text}
                    </div>
                  );
                }
                if (m.kind === 'bot') {
                  return (
                    <div className="ai-msg-bot" key={i} style={{ whiteSpace: 'pre-wrap' }}>
                      {m.text}
                    </div>
                  );
                }
                if (m.kind === 'proposal') {
                  return (
                    <div className="doc-card doc-card-proposal" key={i}>
                      <div className="dc-title">📊 Proposal Slide Deck — {m.name}</div>
                      <div className="dc-sub">
                        8-slide proposal generated (cover, summary, challenges, solution, pricing,
                        timeline, why us, next steps).
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="dc-btn dc-btn-primary"
                          onClick={(e) => {
                            const b = e.currentTarget;
                            b.disabled = true;
                            b.textContent = 'Generating PDF…';
                            downloadProposalPDF(m.html, m.filename)
                              .catch((err) => alert(`Sorry, the PDF failed to generate: ${err.message}`))
                              .finally(() => {
                                b.disabled = false;
                                b.textContent = '⬇ Download PDF';
                              });
                          }}
                        >
                          ⬇ Download PDF
                        </button>
                      </div>
                      <div className="dc-note">Landscape, presentation-ready — one slide per page</div>
                    </div>
                  );
                }
                if (m.kind !== 'report') return null;
                return (
                  <div className="doc-card doc-card-report" key={i}>
                    <div className="dc-title">📄 Sales Intelligence Report — {m.name}</div>
                    <div className="dc-sub">Report generated successfully. Choose your format:</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="dc-btn dc-btn-primary"
                        onClick={() => downloadReportPDF(m.html, m.filename)}
                      >
                        ⬇ PDF
                      </button>
                      <button
                        className="dc-btn dc-btn-ghost"
                        onClick={() => downloadReportWord(m.html, m.filename)}
                      >
                        ⬇ Word (editable)
                      </button>
                    </div>
                    <div className="dc-note">
                      Word file opens in Microsoft Word, Google Docs, or LibreOffice
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ai-quick-actions">
              {QUICK.map((q) => (
                <button className="ai-quick-btn" key={q.label} disabled={busy} onClick={() => ask(q.msg)}>
                  {q.label}
                </button>
              ))}
              <button
                className="ai-quick-btn"
                disabled={busy}
                style={{
                  borderColor: 'var(--gold)',
                  color: 'var(--gold-soft)',
                  background: 'rgba(201,168,76,0.10)',
                  fontWeight: 600,
                }}
                onClick={() => ask(`Generate a PDF proposal slide deck for ${p.name}`)}
              >
                ⬇ Generate PDF Proposal
              </button>
              <button
                className="ai-quick-btn"
                disabled={busy}
                style={{
                  borderColor: 'var(--brand-400)',
                  color: 'var(--brand-500)',
                  background: 'var(--brand-50)',
                  fontWeight: 600,
                }}
                onClick={() => ask(`Generate a PDF report for ${p.name}`)}
              >
                ⬇ Generate PDF / Word report
              </button>
            </div>

            <div className="ai-input-area">
              <textarea
                className="ai-input"
                rows={2}
                value={input}
                placeholder={`Ask anything about ${p.name}...`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
              />
              <button className="ai-send-btn" disabled={busy} onClick={() => ask()}>
                <svg viewBox="0 0 24 24">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22 11 13 2 9l20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export { STAGES };
