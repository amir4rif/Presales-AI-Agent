'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RequireLevel from '@/components/RequireLevel';
import { callClaude } from '@/lib/ai';
import { getComplianceRows, type ComplianceRow } from '@/lib/data';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

const CONF_CLASS: Record<string, string> = {
  High: 'conf-high',
  Medium: 'conf-medium',
  Low: 'conf-low',
};

const ANSWER_CLASS: Record<string, string> = {
  Comply: 'comply-yes',
  'Comply with Configuration': 'comply-config',
  'WIP – RAMS to confirm': 'comply-wip',
  'Not Comply': 'comply-no',
};

type Msg = { role: 'user' | 'bot' | 'typing'; text?: string };

function csvCell(value: string | number) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function CompliancePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [allRows, setAllRows] = useState<ComplianceRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [tab, setTab] = useState<'review' | 'all' | 'sources'>('review');
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setAllRows(getComplianceRows()), []);
  useEffect(reload, [reload]);
  useRemoteDataRefresh(reload);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [chat]);

  const rows = useMemo(() => {
    if (!fileName) return allRows;
    const target = fileName.trim().toLocaleLowerCase();
    return allRows.filter((row) => row.documentName.trim().toLocaleLowerCase() === target);
  }, [allRows, fileName]);

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const matches = allRows.filter(
      (row) => row.documentName.trim().toLocaleLowerCase() === file.name.trim().toLocaleLowerCase()
    );
    setChat((current) => [
      ...current,
      {
        role: 'bot',
        text: matches.length
          ? `Loaded ${matches.length} database row${matches.length === 1 ? '' : 's'} for ${file.name}.`
          : `No persisted compliance results exist for ${file.name}. Nothing was generated or filled automatically.`,
      },
    ]);
  }

  async function ask(preset?: string) {
    const message = (preset || input).trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setChat((current) => [...current, { role: 'user', text: message }, { role: 'typing' }]);
    const system = `You are a Compliance Copilot for Ramssol Group. Answer only from the persisted compliance rows supplied below. If the rows do not contain the answer, say that the database has no supporting answer. Do not invent certifications, capabilities, sources, or prior responses.

Persisted rows:
${JSON.stringify(rows)}`;
    const reply = await callClaude([{ role: 'user', content: message }], system);
    setChat((current) => [
      ...current.filter((item) => item.role !== 'typing'),
      { role: 'bot', text: reply },
    ]);
    setBusy(false);
  }

  function reviewRow(id: number) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    void ask(
      `Review database row ${row.rowNumber}: "${row.requirement}" — current answer: ${row.answer || '(empty)'}. `
      + 'Assess only against the persisted source and reason fields.'
    );
  }

  function downloadCompliance() {
    const csv = [
      ['Row', 'Requirement', 'Answer', 'Confidence', 'Reason', 'Source'].map(csvCell).join(','),
      ...rows.map((row) => [
        row.rowNumber,
        row.requirement,
        row.answer,
        row.confidence,
        row.reason,
        row.sourceReference,
      ].map(csvCell).join(',')),
    ].join('\n');
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    anchor.href = url;
    anchor.download = fileName ? `${fileName.replace(/\.[^.]+$/, '')}_compliance.csv` : 'compliance_rows.csv';
    anchor.click();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  const highConfidence = rows.filter((row) => row.confidence === 'High');
  const needsReview = rows.filter((row) => row.confidence !== 'High');
  const completed = rows.filter((row) => row.answer.trim()).length;
  const completion = rows.length ? Math.round((completed / rows.length) * 100) : 0;
  const sourceMatches = rows.filter((row) => row.sourceReference.trim());
  const visibleRows = tab === 'review' ? needsReview : tab === 'sources' ? sourceMatches : rows;
  const stats = [
    { label: 'Total Rows', value: rows.length, sub: '' },
    { label: 'Completed', value: completed, sub: rows.length ? `${completion}%` : '' },
    {
      label: 'High Confidence',
      value: highConfidence.length,
      sub: rows.length ? `${Math.round((highConfidence.length / rows.length) * 100)}%` : '',
    },
    { label: 'Needs Review', value: needsReview.length, sub: needsReview.length ? 'Check these first' : '' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="page-title">Compliance Assistant (RFP)</div>
        <div className="comp-header-actions">
          <span className="comp-file-label">{fileName || 'All database records'}</span>
          {fileName && (
            <button className="btn-secondary" onClick={() => setFileName('')}>Show all</button>
          )}
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            Select RFP
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
          <div className={`upload-zone${fileName ? ' has-file' : ''}`} onClick={() => fileRef.current?.click()}>
            <div className="upload-icon">📋</div>
            <div className="upload-title">{fileName || 'Select an RFP to find its saved results'}</div>
            <div className="upload-sub">
              Results are loaded only from the compliance database. Selecting a file never creates placeholder answers.
            </div>
          </div>

          {rows.length ? (
            <div>
              <div className="compliance-stats">
                {stats.map((stat) => (
                  <div className="stat-card" key={stat.label}>
                    <div className="stat-label">{stat.label}</div>
                    <div className="stat-value">{stat.value}</div>
                    {stat.sub && <div className="stat-sub">{stat.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="compliance-table">
                <div className="comp-table-header">
                  <div className="comp-table-tabs">
                    <button className={`comp-tab${tab === 'review' ? ' active' : ''}`} onClick={() => setTab('review')}>
                      Rows to Review ({needsReview.length})
                    </button>
                    <button className={`comp-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
                      All Rows ({rows.length})
                    </button>
                    <button className={`comp-tab${tab === 'sources' ? ' active' : ''}`} onClick={() => setTab('sources')}>
                      Source Matches ({sourceMatches.length})
                    </button>
                  </div>
                  <button className="btn-primary" onClick={downloadCompliance}>Download Database Rows</button>
                </div>

                <table className="rfp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Requirement</th>
                      <th>Answer</th>
                      <th>Confidence</th>
                      <th>{tab === 'sources' ? 'Source' : 'Reason'}</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-id">{row.rowNumber}</td>
                        <td className="cell-req">{row.requirement}</td>
                        <td>
                          {row.answer
                            ? <span className={`comply-badge ${ANSWER_CLASS[row.answer] || 'comply-config'}`}>{row.answer}</span>
                            : <span className="empty-hint">No answer</span>}
                        </td>
                        <td className={CONF_CLASS[row.confidence] || ''}>{row.confidence || 'Not scored'}</td>
                        <td className="cell-reason">
                          {tab === 'sources' ? row.sourceReference : row.reason}
                        </td>
                        <td><button className="review-btn" onClick={() => reviewRow(row.id)}>Review</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card empty-state" style={{ padding: 28, marginTop: 16 }}>
              {fileName
                ? `No compliance rows are stored in the database for ${fileName}.`
                : 'No compliance rows are stored in the database.'}
            </div>
          )}
        </div>

        <div>
          <div className="ai-panel comp-ai-panel">
            <div className="ai-copilot-header">
              <div className="ai-copilot-title">Compliance Copilot <span className="ai-badge">AI</span></div>
            </div>
            <div className="ai-messages" ref={feedRef}>
              <div className="ai-msg-system">
                I answer from the compliance rows currently loaded from the database. If the database has no supporting answer, I will say so.
              </div>
              {chat.map((message, index) => message.role === 'typing' ? (
                <div className="ai-msg-bot" key={index}>
                  <div className="ai-typing">
                    <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                  </div>
                </div>
              ) : (
                <div className={message.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'} key={index} style={{ whiteSpace: 'pre-wrap' }}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="ai-input-area">
              <textarea
                className="ai-input"
                rows={2}
                value={input}
                placeholder="Ask about the loaded database rows..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
              />
              <button className="ai-send-btn" disabled={busy || !rows.length} onClick={() => void ask()}>
                <svg viewBox="0 0 24 24"><path d="M22 2L11 13" /><path d="M22 2L15 22 11 13 2 9l20-7z" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return <RequireLevel min={1}><CompliancePage /></RequireLevel>;
}
