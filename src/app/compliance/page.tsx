'use client';
/* Compliance Assistant (RFP) — upload a form, AI fills it from the
   knowledge base, the rep reviews the low-confidence rows. */
import { useEffect, useRef, useState } from 'react';
import RequireLevel from '@/components/RequireLevel';
import { callClaude } from '@/lib/ai';

type Row = { id: number; req: string; answer: string; conf: 'High' | 'Medium' | 'Low'; reason: string };

const SAMPLE_RFP_ROWS: Row[] = [
  { id: 18, req: 'Do you have ISO 27001 certification?', answer: 'Comply', conf: 'Medium', reason: 'Similar but not exact match' },
  { id: 23, req: 'Provide details of data backup location.', answer: 'Comply with Configuration', conf: 'Low', reason: 'No close match in KB' },
  { id: 31, req: 'Do you support disaster recovery site?', answer: 'Comply', conf: 'Medium', reason: 'Needs confirmation' },
  { id: 47, req: 'Provide your financial statements.', answer: 'WIP – RAMS to confirm', conf: 'Low', reason: 'Information not available' },
  { id: 4, req: 'Does the system support multi-tenancy?', answer: 'Comply', conf: 'High', reason: 'Exact match from EdgePoint RFP 2024' },
  { id: 7, req: 'SSL/TLS encryption for data in transit?', answer: 'Comply', conf: 'High', reason: 'Close match – Security KB' },
  { id: 12, req: 'Role-based access control (RBAC)?', answer: 'Comply', conf: 'High', reason: 'Standard feature confirmed' },
  { id: 15, req: 'On-premise deployment option?', answer: 'Comply with Configuration', conf: 'Medium', reason: 'Adapted – cloud-first but can be discussed' },
  { id: 29, req: '24/7 support SLA?', answer: 'Comply with Configuration', conf: 'Medium', reason: 'Depends on contract tier' },
  { id: 36, req: 'Mobile application available?', answer: 'Comply', conf: 'High', reason: 'iOS and Android confirmed' },
  { id: 41, req: 'API integration capabilities?', answer: 'Comply', conf: 'High', reason: 'REST API documented' },
  { id: 50, req: 'Regulatory compliance with PDPA?', answer: 'Comply', conf: 'High', reason: 'Legal team confirmed' },
];

const CONF_CLASS: Record<string, string> = { High: 'conf-high', Medium: 'conf-medium', Low: 'conf-low' };
const ANSWER_CLASS: Record<string, string> = {
  'Comply': 'comply-yes',
  'Comply with Configuration': 'comply-config',
  'WIP – RAMS to confirm': 'comply-wip',
  'Not Comply': 'comply-no',
};

type Msg = { role: 'user' | 'bot' | 'typing'; text?: string };

function CompliancePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<'review' | 'all' | 'sources'>('review');
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [chat]);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setRows(SAMPLE_RFP_ROWS);
      setChat((c) => [
        ...c,
        {
          role: 'bot',
          text: `✅ I've filled ${file.name} — 48 rows complete.\n\nRows to review:\n• Row 18 — No close match; drafted standard answer\n• Row 23 — Data backup location unclear\n• Row 47 — Financial statements — please fill placeholder`,
        },
      ]);
    }, 1800);
  }

  async function ask(preset?: string) {
    const msg = (preset || input).trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    setChat((c) => [...c, { role: 'user', text: msg }, { role: 'typing' }]);
    const system = `You are a Compliance Copilot for Ramssol Group. You help pre-sales teams fill RFP and compliance forms using the company's knowledge base. Categories: Security, Data Management, Technical Architecture, Support SLAs, Certifications, Disaster Recovery, Mobile, API Integration. Be concise and practical.`;
    const reply = await callClaude([{ role: 'user', content: msg }], system);
    setChat((c) => [...c.filter((m) => m.role !== 'typing'), { role: 'bot', text: reply }]);
    setBusy(false);
  }

  function reviewRow(id: number) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    ask(`Review row ${id}: "${row.req}" — current answer: ${row.answer}. Is this correct? Suggest improvements.`);
  }

  function downloadCompliance() {
    const csv = [
      'Row,Requirement,Answer,Confidence,Reason',
      ...rows.map((r) => `${r.id},"${r.req}","${r.answer}",${r.conf},"${r.reason}"`),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'compliance_completed.csv';
    a.click();
  }

  const highConf = rows.filter((r) => r.conf === 'High');
  const needsReview = rows.filter((r) => r.conf !== 'High');
  const total = rows.length;
  const visibleRows = tab === 'review' ? needsReview : rows;

  const stats = [
    { label: 'Total Rows', value: total, sub: '' },
    { label: 'Completed', value: 48, sub: '97%' },
    { label: 'High Confidence', value: highConf.length, sub: total ? `${((highConf.length / total) * 100).toFixed(0)}%` : '' },
    { label: 'Needs Review', value: needsReview.length, sub: 'Check these first' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="page-title">Compliance Assistant (RFP)</div>
        <div className="comp-header-actions">
          <span className="comp-file-label">{fileName || 'No file loaded'}</span>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            Upload RFP
          </button>
          <input
            type="file"
            ref={fileRef}
            accept=".xlsx,.xls,.csv,.pdf"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
        </div>
      </div>

      <div className="compliance-wrapper">
        <div>
          <div
            className={`upload-zone${fileName ? ' has-file' : ''}`}
            onClick={() => fileRef.current?.click()}
          >
            {!fileName ? (
              <>
                <div className="upload-icon">📋</div>
                <div className="upload-title">Drop your RFP / compliance form here</div>
                <div className="upload-sub">
                  Supports .xlsx, .xls, .csv, .pdf · The AI will fill it using our knowledge base
                </div>
              </>
            ) : processing ? (
              <>
                <div className="upload-icon">⏳</div>
                <div className="upload-title">{fileName}</div>
                <div className="upload-sub">Processing with AI...</div>
              </>
            ) : (
              <>
                <div className="upload-icon">✅</div>
                <div className="upload-title">{fileName}</div>
                <div className="upload-sub">48 of 50 rows completed · Click to upload another</div>
              </>
            )}
          </div>

          {rows.length > 0 && (
            <div>
              <div className="compliance-stats">
                {stats.map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value">{s.value}</div>
                    {s.sub && <div className="stat-sub">{s.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="compliance-table">
                <div className="comp-table-header">
                  <div className="comp-table-tabs">
                    <button
                      className={`comp-tab${tab === 'review' ? ' active' : ''}`}
                      onClick={() => setTab('review')}
                    >
                      Rows to Review ({needsReview.length})
                    </button>
                    <button className={`comp-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
                      All Rows ({total})
                    </button>
                    <button
                      className={`comp-tab${tab === 'sources' ? ' active' : ''}`}
                      onClick={() => setTab('sources')}
                    >
                      Source Matches
                    </button>
                  </div>
                  <button className="btn-primary" onClick={downloadCompliance}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download Completed File
                  </button>
                </div>

                <table className="rfp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Requirement</th>
                      <th>AI Answer</th>
                      <th>Confidence</th>
                      <th>Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-id">{r.id}</td>
                        <td className="cell-req">{r.req}</td>
                        <td>
                          <span className={`comply-badge ${ANSWER_CLASS[r.answer] || 'comply-yes'}`}>
                            {r.answer}
                          </span>
                        </td>
                        <td className={CONF_CLASS[r.conf]}>{r.conf}</td>
                        <td className="cell-reason">{r.reason}</td>
                        <td>
                          <button className="review-btn" onClick={() => reviewRow(r.id)}>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="ai-panel comp-ai-panel">
            <div className="ai-copilot-header">
              <div className="ai-copilot-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l3 3" />
                </svg>
                Compliance Copilot <span className="ai-badge">AI</span>
              </div>
            </div>

            <div className="ai-messages" ref={feedRef}>
              <div className="ai-msg-system">
                Hi, I&apos;m your Compliance Copilot. Upload an RFP file and I&apos;ll fill it
                automatically from our knowledge base — or ask me anything about past responses.
              </div>
              <div
                className="ai-quick-btn"
                onClick={() => ask('What categories of requirements do we handle best?')}
              >
                What categories do we handle best?
              </div>
              <div className="ai-quick-btn" onClick={() => ask('Explain the confidence scoring system')}>
                Explain the confidence scoring system
              </div>

              {chat.map((m, i) =>
                m.role === 'typing' ? (
                  <div className="ai-msg-bot" key={i}>
                    <div className="ai-typing">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  </div>
                ) : (
                  <div
                    className={m.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'}
                    key={i}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {m.text}
                  </div>
                )
              )}
            </div>

            <div className="ai-input-area">
              <textarea
                className="ai-input"
                rows={2}
                value={input}
                placeholder="Ask about a requirement, row, or policy..."
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

export default function Page() {
  return (
    <RequireLevel min={1}>
      <CompliancePage />
    </RequireLevel>
  );
}
