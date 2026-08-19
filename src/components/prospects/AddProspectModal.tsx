'use client';
/* Add New Prospect — the AI Sales Agent form (Doc §3.3).

   AI calls go through /api/generate; optional verified web context comes
   from the server-only /api/research bridge. */
import { useState } from 'react';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { callClaude } from '@/lib/ai';
import { parseJsonReply } from '@/lib/docExport';
import type { AIResearch, Prospect } from '@/lib/data';
import { researchCompany } from '@/lib/research';

const INDUSTRIES = ['Banking & Finance', 'Healthcare', 'Government', 'Education', 'Manufacturing', 'Retail & FMCG', 'NGO / Non-profit', 'Technology', 'Logistics & Supply Chain', 'Telecommunications', 'Property & Construction', 'Oil & Gas', 'Other'];
const EMP_SIZES = ['1 – 50', '51 – 200', '201 – 500', '501 – 1,000', '1,001 – 5,000', '5,001 – 10,000', '10,000+'];
const IT_BUDGETS = ['Below RM 500K', 'RM 500K – RM 1M', 'RM 1M – RM 3M', 'RM 3M – RM 10M', 'RM 10M – RM 50M', 'Above RM 50M'];
const HR_BUDGETS = ['Below RM 200K', 'RM 200K – RM 500K', 'RM 500K – RM 1M', 'RM 1M – RM 3M', 'RM 3M – RM 10M', 'Above RM 10M'];
const TIMELINES = ['Immediate (within 1 month)', 'Short-term (1 – 3 months)', 'Medium-term (3 – 6 months)', 'Long-term (6 – 12 months)', 'Future planning (12+ months)'];

const EMPTY = {
  name: '', industry: '', location: '', website: '', empSize: '',
  itBudget: '', hrBudget: '', pain: '', timeline: '',
  contactName: '', contactPos: '', authName: '', authPos: '',
  currSystem: '', currModule: '',
};
type Form = typeof EMPTY;

/** Match a free-text AI answer to one of our fixed options. */
function matchOption(options: string[], text?: string) {
  if (!text) return '';
  const target = text.trim().toLowerCase();
  return (
    options.find((o) => o.toLowerCase() === target) ||
    options.find((o) => target.includes(o.toLowerCase()) || o.toLowerCase().includes(target)) ||
    ''
  );
}

export default function AddProspectModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (p: Prospect, form: Form, research: AIResearch | null) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [autofilling, setAutofilling] = useState(false);
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState<AIResearch | null>(null);
  const [products, setProducts] = useState<string | null>(null);
  const [outline, setOutline] = useState<string | null>(null);

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  function reset() {
    setF(EMPTY);
    setResearch(null);
    setProducts(null);
    setOutline(null);
  }

  /* ── AI AUTOFILL: FILL FORM FROM NAME + WEBSITE ────────── */
  async function autofill() {
    if (!f.name) {
      alert('Please enter a Company Name first — AI needs at least that to work with.');
      return;
    }
    setAutofilling(true);

    const system = `You are an AI research assistant for Ramssol Group's pre-sales team. Given only a company name and (optionally) a website, provide your single best-effort estimate for each requested field, using typical patterns for that company's industry, size and country when you don't have certain information. Never leave a field vague like "unknown" — always commit to your best estimate. Return ONLY valid JSON, no markdown, no extra text, no commentary.`;

    const prompt = `Company Name: ${f.name}
Website: ${f.website || 'Not provided'}

Return ONLY this JSON object (no markdown, no backticks, no trailing commentary):
{
  "industry": "",
  "location": "",
  "employeeSize": "",
  "currentSystem": "",
  "currentModule": "",
  "itBudget": "",
  "hrBudget": "",
  "contactPosition": "",
  "authorityPosition": "",
  "painPoints": "",
  "timeline": ""
}

Field rules:
- industry: exactly one of ${INDUSTRIES.join(', ')}
- location: "City, Country"
- employeeSize: exactly one of ${EMP_SIZES.join(', ')}
- currentSystem: likely incumbent HR/IT system, e.g. SAP, Oracle, Workday, In-house, Excel-based
- currentModule: likely function in use, e.g. Payroll, Recruitment, ERP, Core Banking
- itBudget: exactly one of ${IT_BUDGETS.join(', ')}
- hrBudget: exactly one of ${HR_BUDGETS.join(', ')}
- contactPosition: a plausible day-to-day point-of-contact title, e.g. "Head of HR" (do NOT invent a person's name)
- authorityPosition: a plausible final decision-maker title, e.g. "CHRO" or "CIO" (do NOT invent a person's name)
- painPoints: 2-4 short lines, each a likely pain point for a company like this, separated by \\n, no numbering
- timeline: exactly one of ${TIMELINES.join(', ')}, Unknown / Not specified`;

    const raw = await callClaude([{ role: 'user', content: prompt }], system);
    setAutofilling(false);

    const data = parseJsonReply<Record<string, string> | null>(raw, null);
    if (!data) {
      toast('⚠️ AI autofill failed — try again or fill manually', true);
      return;
    }

    // Only empty fields are filled in — never overwrite what the rep typed.
    setF((prev) => ({
      ...prev,
      industry: prev.industry || matchOption(INDUSTRIES, data.industry),
      location: prev.location || data.location || '',
      empSize: prev.empSize || matchOption(EMP_SIZES, data.employeeSize),
      currSystem: prev.currSystem || data.currentSystem || '',
      currModule: prev.currModule || data.currentModule || '',
      itBudget: prev.itBudget || matchOption(IT_BUDGETS, data.itBudget),
      hrBudget: prev.hrBudget || matchOption(HR_BUDGETS, data.hrBudget),
      contactPos: prev.contactPos || data.contactPosition || '',
      authPos: prev.authPos || data.authorityPosition || '',
      timeline: prev.timeline || matchOption(TIMELINES, data.timeline),
      pain: prev.pain || data.painPoints || '',
    }));
    toast('✨ Autofilled by AI — please review before saving');
  }

  /* ── AI SALES AGENT: RESEARCH COMPANY ──────────────────── */
  async function runResearch() {
    if (!f.name) {
      alert('Please enter a Company Name before running AI research.');
      return;
    }
    setResearching(true);

    const system = `You are an expert AI Sales Intelligence Agent for Ramssol Group, a Malaysian B2B technology company specialising in enterprise software:
- RAMS PeopleTech: HCM/HR consulting (Oracle Fusion HCM, Darwinbox, Hono.ai, RAMCO Payce)
- RAMS A.I.Tech: AI, IoT, cloud solutions (iFlytek, Tencent Cloud partnerships)
- RAMS AutoTech: Robotic process automation and industrial automation
- RAMS EduTech: Education technology platforms
- RAMS MarTech: Marketing technology and CRM solutions

You help Ramssol's pre-sales team qualify prospects and win deals in Malaysia and Southeast Asia.
IMPORTANT: Return ONLY valid JSON, no markdown, no extra text.`;

    const web = await researchCompany(
      `${f.name} ${f.website || ''} company profile revenue employees technology`,
      f.location || 'Malaysia'
    );
    const verifiedContext = web.configured && web.summary
      ? `\nVerified web research (use this as the factual source of truth):\n${web.summary}\nSources: ${JSON.stringify(web.sources || [])}\n`
      : '\nNo verified web research is configured. Clearly label financial and headcount values as estimates.\n';

    const prompt = `Research this prospect for Ramssol Group and return a JSON object:

Company: ${f.name}
Industry: ${f.industry || 'Unknown'}
Location: ${f.location || 'Malaysia'}
Website: ${f.website || 'Not provided'}
Employee Size: ${f.empSize || 'Unknown'}
Known IT Budget: ${f.itBudget || 'Unknown'}
Known HR Budget: ${f.hrBudget || 'Unknown'}
Pain Points / Needs: ${f.pain || 'Not provided'}
Timeline: ${f.timeline || 'Unknown'}
${verifiedContext}

Return ONLY this JSON structure (no markdown, no backticks):
{
  "companyBackground": "2-3 sentence factual overview of the company, industry, and operations",
  "estimatedRevenue": "e.g. RM 50M – 200M/year",
  "estimatedITSpend": "e.g. RM 2M – 5M/year",
  "estimatedHRSpend": "e.g. RM 500K – 1M/year",
  "employeeSize": "best estimate as a number range",
  "decisionMaker": "most likely decision-maker title and why",
  "buyingPotential": "High or Medium or Low",
  "buyingPotentialReason": "1-2 sentences on why this potential rating was given, considering budget, need urgency, and fit with Ramssol products"
}`;

    const raw = await callClaude([{ role: 'user', content: prompt }], system);
    setResearching(false);
    // If JSON parsing fails, keep the raw text so nothing is silently lost.
    const parsed = parseJsonReply<AIResearch>(raw, { raw });
    setResearch({ ...parsed, ...(web.sources?.length ? { sources: web.sources } : {}) });
    setProducts(null);
    setOutline(null);
  }

  /* ── AI: RECOMMEND PRODUCTS ────────────────────────────── */
  async function recommendProducts() {
    setProducts('⏳ Analysing and recommending products...');
    const system = `You are a senior pre-sales consultant at Ramssol Group. Ramssol's product portfolio:

RAMS PeopleTech (HCM / HR):
• Oracle Fusion HCM — Enterprise HR, Payroll, Talent Management (large enterprise, 1,000+ employees)
• Darwinbox — Mid-market HCM cloud platform (SEA focus, 200–5,000 employees)
• Hono.ai — AI-powered HR & workforce analytics
• RAMCO Payce — Payroll automation for complex multi-country payroll

RAMS A.I.Tech (AI / Cloud):
• iFlytek AI Platform — NLP, speech recognition, AI solutions
• Tencent Cloud — Cloud infrastructure, AI services, private cloud

RAMS AutoTech:
• RPA and industrial automation solutions

RAMS EduTech:
• Learning management systems and student lifecycle platforms

RAMS MarTech:
• CRM, digital marketing automation

Recommend the most suitable products. Be specific on why each product fits this prospect.`;

    const prompt = `Prospect: ${f.name || 'the prospect'} | Industry: ${f.industry || 'Unknown'} | Employees: ${f.empSize || 'Unknown'}
IT Budget: ${f.itBudget || 'Unknown'} | HR Budget: ${f.hrBudget || 'Unknown'}
Pain Points: ${f.pain || 'Not specified'}
Timeline: ${f.timeline || 'Unknown'}
AI Research: ${research ? JSON.stringify(research) : 'No prior research available'}

Recommend the top 2-3 Ramssol products/solutions for this prospect. For each:
1. Product name
2. Why it fits (2-3 specific reasons tied to their industry/pain)
3. Estimated deal value range
4. Recommended next step

Format clearly with numbered sections.`;

    setProducts(await callClaude([{ role: 'user', content: prompt }], system));
  }

  /* ── AI: GENERATE PROPOSAL OUTLINE ─────────────────────── */
  async function generateOutline() {
    setOutline('⏳ Generating proposal outline...');
    const name = f.name || 'the prospect';
    const system = `You are a senior proposal writer for Ramssol Group, a Malaysian technology solutions company. Write professional, persuasive proposal outlines tailored to the prospect's industry and pain points. Be specific, not generic.`;

    const prompt = `Generate a full proposal outline for this prospect:

Company: ${name}
Industry: ${f.industry || 'Unknown'}
Location: ${f.location || 'Malaysia'}
Decision Maker: ${f.authName ? f.authName + (f.authPos ? `, ${f.authPos}` : '') : 'Not specified'}
IT Budget: ${f.itBudget || 'Unknown'} | HR Budget: ${f.hrBudget || 'Unknown'}
Key Pain Points: ${f.pain || 'Not specified'}
Timeline: ${f.timeline || 'Unknown'}
Research Notes: ${research ? JSON.stringify(research) : ''}

Create a structured proposal outline with these 8 sections:
1. Executive Summary
2. Understanding of ${name}'s Challenges
3. Proposed Solution (specific Ramssol products)
4. Key Benefits & ROI
5. Implementation Approach & Timeline
6. Commercial Proposal (pricing structure)
7. Case Studies & References
8. Next Steps & Call to Action

For each section, write 2-3 bullet points of specific content guidance tailored to ${name}.`;

    setOutline(await callClaude([{ role: 'user', content: prompt }], system));
  }

  function submit() {
    if (!f.name) {
      alert('Please enter a Company Name.');
      return;
    }
    const ind = f.industry || 'Other';
    const painArr = f.pain ? f.pain.split('\n').filter(Boolean) : ['To be researched with AI'];
    const tags = [ind, f.currSystem, f.currModule].filter(Boolean).slice(0, 3);

    const prospect: Prospect = {
      id: Date.now(),
      name: f.name,
      type: ind,
      country: f.location || 'Malaysia',
      website: f.website || '—',
      added: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      tags: tags.length ? tags : [ind],
      employees: f.empSize || '—',
      opportunities: 0,
      totalValue: 0,
      painPoints: painArr,
      contact: f.contactName ? `${f.contactName}${f.contactPos ? `, ${f.contactPos}` : ''}` : '—',
      authority: f.authName ? `${f.authName}${f.authPos ? `, ${f.authPos}` : ''}` : '—',
      itBudget: f.itBudget,
      hrBudget: f.hrBudget,
      timeline: f.timeline,
      currentSystem: f.currSystem || '—',
      currentModule: f.currModule || '—',
      aiResearch: research,
    };

    onAdd(prospect, f, research);
    reset();
  }

  const pot = (research?.buyingPotential || 'Medium').trim();
  const potCls = pot === 'High' ? 'b-high' : pot === 'Low' ? 'b-low' : 'b-med';

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      style={{ maxWidth: 720, maxHeight: '88vh', overflowY: 'auto' }}
      title={
        <div className="modal-header-row">
          <div>
            <div>Add New Prospect</div>
            <div className="modal-sub">
              Fill in the details, then let the AI Sales Agent research the company.
            </div>
          </div>
          <span className="modal-ai-badge">🤖 AI Sales Agent</span>
        </div>
      }
      actions={
        <>
          <button
            className="btn-secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Prospect
          </button>
        </>
      }
    >
      <div className="sec-divider">Company Information</div>
      <div className="fg">
        <label className="fl">
          Company Name <span className="req">*</span>
        </label>
        <input className="fi" value={f.name} onChange={set('name')} placeholder="e.g. Tzu Chi Foundation" />
      </div>
      <div className="g3">
        <div className="fg">
          <label className="fl">
            Industry <span className="req">*</span>
          </label>
          <select className="fs" value={f.industry} onChange={set('industry')}>
            <option value="">Select industry</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Location</label>
          <input className="fi" value={f.location} onChange={set('location')} placeholder="e.g. Kuala Lumpur, Malaysia" />
        </div>
        <div className="fg">
          <label className="fl">Employee Size</label>
          <select className="fs" value={f.empSize} onChange={set('empSize')}>
            <option value="">Select size</option>
            {EMP_SIZES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fg">
        <label className="fl">Website</label>
        <input className="fi" value={f.website} onChange={set('website')} placeholder="www.company.com" />
      </div>

      <button type="button" className="ai-autofill-btn" disabled={autofilling} onClick={autofill}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
          <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z" />
        </svg>
        {autofilling ? 'Autofilling with AI...' : "Don't know the details? Autofill with AI"}
      </button>
      <div style={{ fontSize: 10.5, color: 'var(--gray-400)', textAlign: 'center', marginTop: 5, marginBottom: 4 }}>
        Uses the Company Name (and Website, if given) to estimate the fields below. Only empty
        fields are filled in — review before saving.
      </div>

      <div className="sec-divider">Contact Details</div>
      <div className="g2">
        <div className="fg">
          <label className="fl">Contact Name</label>
          <input className="fi" value={f.contactName} onChange={set('contactName')} placeholder="Full name" />
        </div>
        <div className="fg">
          <label className="fl">Position / Title</label>
          <input className="fi" value={f.contactPos} onChange={set('contactPos')} placeholder="e.g. Head of HR, CIO" />
        </div>
      </div>

      <div className="sec-divider">Sales Intelligence</div>
      <div className="g2">
        <div className="fg">
          <label className="fl">Current System</label>
          <input className="fi" value={f.currSystem} onChange={set('currSystem')} placeholder="e.g. SAP, Oracle, In-house" />
        </div>
        <div className="fg">
          <label className="fl">Current Module / Function</label>
          <input className="fi" value={f.currModule} onChange={set('currModule')} placeholder="e.g. Payroll, Recruitment, ERP" />
        </div>
      </div>
      <div className="g2">
        <div className="fg">
          <label className="fl">IT Budget (estimated)</label>
          <select className="fs" value={f.itBudget} onChange={set('itBudget')}>
            <option value="">Unknown</option>
            {IT_BUDGETS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">HR Budget (estimated)</label>
          <select className="fs" value={f.hrBudget} onChange={set('hrBudget')}>
            <option value="">Unknown</option>
            {HR_BUDGETS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="g2">
        <div className="fg">
          <label className="fl">Authority — Decision Maker Name</label>
          <input className="fi" value={f.authName} onChange={set('authName')} placeholder="Name of final decision maker" />
        </div>
        <div className="fg">
          <label className="fl">Authority — Position</label>
          <input className="fi" value={f.authPos} onChange={set('authPos')} placeholder="e.g. CEO, CFO, CHRO, CIO" />
        </div>
      </div>

      <div className="sec-divider">Requirements</div>
      <div className="fg">
        <label className="fl">Key Focus Areas — Pain Points &amp; Needs</label>
        <textarea
          className="ft"
          rows={3}
          value={f.pain}
          onChange={set('pain')}
          placeholder="Describe the company's main challenges, unmet needs, and what they're looking to solve..."
        />
      </div>
      <div className="fg">
        <label className="fl">Timeline — When do they need a solution?</label>
        <select className="fs" value={f.timeline} onChange={set('timeline')}>
          <option value="">Unknown / Not specified</option>
          {TIMELINES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </div>

      <button className={`ai-agent-btn${researching ? ' loading' : ''}`} onClick={runResearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l3 3" />
        </svg>
        {researching
          ? `Researching ${f.name}...`
          : research
            ? '✅ Research Complete — Click to Re-run'
            : '🤖 Research Company with AI Sales Agent'}
      </button>
      <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', marginTop: 6 }}>
        AI will analyse company background, financials, decision makers and buying potential
      </div>

      {research && (
        <div className="ai-results visible">
          <div className="ai-results-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth={2} width={15} height={15}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
            <span className="ai-results-header-title">AI Sales Intelligence Report</span>
            <span style={{ marginLeft: 'auto' }}>
              {!research.raw && <span className={`buying-badge ${potCls}`}>{pot}</span>}
            </span>
          </div>
          <div className="ai-results-body">
            <div className="ai-wide-card">
              <div className="ai-card-lbl">Company Background</div>
              <div className="ai-card-val">{research.companyBackground || research.raw || '—'}</div>
            </div>

            <div className="ai-metrics-grid">
              <div className="ai-metric-box">
                <div className="ai-metric-num">{research.estimatedRevenue || '—'}</div>
                <div className="ai-metric-lbl">Est. Annual Revenue</div>
              </div>
              <div className="ai-metric-box">
                <div className="ai-metric-num">{research.estimatedITSpend || '—'}</div>
                <div className="ai-metric-lbl">Est. IT Spending</div>
              </div>
              <div className="ai-metric-box">
                <div className="ai-metric-num">{research.estimatedHRSpend || '—'}</div>
                <div className="ai-metric-lbl">Est. HR Spending</div>
              </div>
            </div>

            <div className="g2">
              <div className="ai-wide-card">
                <div className="ai-card-lbl">Employee Size (AI Estimate)</div>
                <div className="ai-card-val">{research.employeeSize || '—'}</div>
              </div>
              <div className="ai-wide-card">
                <div className="ai-card-lbl">Likely Decision Maker</div>
                <div className="ai-card-val">{research.decisionMaker || '—'}</div>
              </div>
            </div>

            <div className="ai-wide-card">
              <div className="ai-card-lbl">Buying Potential</div>
              <div className="buying-wrap">
                {!research.raw && <span className={`buying-badge ${potCls}`}>{pot}</span>}
                <span className="buying-reason">{research.buyingPotentialReason || '—'}</span>
              </div>
            </div>

            {research.sources?.length ? (
              <div className="ai-wide-card">
                <div className="ai-card-lbl">Verified Web Sources</div>
                <div className="ai-card-val" style={{ display: 'grid', gap: 5 }}>
                  {research.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="ai-actions-row">
              <button className="ai-act-btn btn-rec" onClick={recommendProducts}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                Recommend Products &amp; Solutions
              </button>
              <button className="ai-act-btn btn-prop" onClick={generateOutline}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Generate Proposal Outline
              </button>
            </div>

            {products !== null && (
              <div className="ai-output visible">
                <div className="ai-output-title">🎯 Recommended Products &amp; Solutions</div>
                <div>{products}</div>
              </div>
            )}
            {outline !== null && (
              <div className="ai-output visible">
                <div className="ai-output-title">📄 Proposal Outline</div>
                <div>{outline}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export type { Form as ProspectForm };
