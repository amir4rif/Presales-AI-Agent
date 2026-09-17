'use client';
/* Add New Prospect — the AI Sales Agent form (Doc §3.3).

   AI calls go through /api/generate; optional verified web context comes
   from the server-only /api/research bridge. */
import { useState } from 'react';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { callClaude, isAiError } from '@/lib/ai';
import { parseJsonReply } from '@/lib/docExport';
import type {
  AIResearch,
  ProductCatalogItem,
  Prospect,
  ProspectOptions,
} from '@/lib/data';
import { researchCompany, type ResearchResult } from '@/lib/research';

const EMPTY = {
  name: '', industry: '', location: '', website: '', empSize: '',
  itBudget: '', hrBudget: '', pain: '', timeline: '',
  contactName: '', contactPos: '', authName: '', authPos: '',
  currSystem: '', currModule: '',
};
type Form = typeof EMPTY;
type GroundedWebResearch = {
  summary: string;
  sources: NonNullable<ResearchResult['sources']>;
  searchEntryPointHtml?: string;
};

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
  options,
  productCatalog,
  onClose,
  onAdd,
}: {
  open: boolean;
  options: ProspectOptions;
  productCatalog: ProductCatalogItem[];
  onClose: () => void;
  onAdd: (
    p: Prospect,
    form: Form,
    research: AIResearch | null
  ) => Promise<boolean | string> | boolean | string;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [autofilling, setAutofilling] = useState(false);
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState<AIResearch | null>(null);
  const [groundedWeb, setGroundedWeb] = useState<GroundedWebResearch | null>(null);
  const [groundingError, setGroundingError] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [products, setProducts] = useState<string | null>(null);
  const [outline, setOutline] = useState<string | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [outlining, setOutlining] = useState(false);
  const [saving, setSaving] = useState(false);
  const catalogText = productCatalog
    .map((product) =>
      `${product.category} — ${product.name}: ${product.description}. Best fit: ${product.fit}.`
    )
    .join('\n');

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  function reset() {
    setF(EMPTY);
    setResearch(null);
    setGroundedWeb(null);
    setGroundingError(null);
    setResearchError(null);
    setProducts(null);
    setOutline(null);
    setRecommending(false);
    setOutlining(false);
  }

  /* ── AI AUTOFILL: FILL FORM FROM NAME + WEBSITE ────────── */
  async function autofill() {
    if (!f.name) {
      alert('Please enter a Company Name first — AI needs at least that to work with.');
      return;
    }
    setAutofilling(true);

    const web = await researchCompany(
      `${f.name} ${f.website || ''} company profile employees technology`,
      f.location
    ) as ResearchResult & { searchEntryPointHtml?: string };
    if (web.error || !web.configured || !web.summary || !web.sources?.length) {
      setAutofilling(false);
      toast(
        web.error || 'Verified web research is required for autofill. Fill the fields manually.',
        true
      );
      return;
    }
    setGroundedWeb({
      summary: web.summary,
      sources: web.sources,
      searchEntryPointHtml: web.searchEntryPointHtml,
    });

    const system = `You extract prospect facts from verified web research for Ramssol Group's pre-sales team. Use only the supplied research. Never infer, estimate, or invent a value. Return an empty string for every field the sources do not support. Return ONLY valid JSON, no markdown, no extra text, no commentary.`;

    const prompt = `Company Name: ${f.name}
Website: ${f.website || 'Not provided'}

Verified research:
${web.summary}
Sources: ${JSON.stringify(web.sources)}

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
- industry: one of ${options.industries.join(', ')} only when supported; otherwise empty
- location: "City, Country"
- employeeSize: one of ${options.employeeSizes.join(', ')} only when supported; otherwise empty
- currentSystem: only a system explicitly identified in the verified research; otherwise empty
- currentModule: only a function explicitly identified in the verified research; otherwise empty
- itBudget: one of ${options.itBudgetRanges.join(', ')} only when supported; otherwise empty
- hrBudget: one of ${options.hrBudgetRanges.join(', ')} only when supported; otherwise empty
- contactPosition: a documented point-of-contact title; otherwise empty
- authorityPosition: a documented decision-maker title; otherwise empty
- painPoints: only challenges explicitly supported by the verified research, separated by \\n; otherwise empty
- timeline: one of ${options.buyingTimelines.join(', ')} only when supported; otherwise empty`;

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
      industry: prev.industry || matchOption(options.industries, data.industry),
      location: prev.location || data.location || '',
      empSize: prev.empSize || matchOption(options.employeeSizes, data.employeeSize),
      currSystem: prev.currSystem || data.currentSystem || '',
      currModule: prev.currModule || data.currentModule || '',
      itBudget: prev.itBudget || matchOption(options.itBudgetRanges, data.itBudget),
      hrBudget: prev.hrBudget || matchOption(options.hrBudgetRanges, data.hrBudget),
      contactPos: prev.contactPos || data.contactPosition || '',
      authPos: prev.authPos || data.authorityPosition || '',
      timeline: prev.timeline || matchOption(options.buyingTimelines, data.timeline),
      pain: prev.pain || data.painPoints || '',
    }));
    setResearch({
      companyBackground: web.summary,
      sources: web.sources,
      raw: web.summary,
    });
    toast('✨ Autofilled by AI — please review before saving');
  }

  /* ── AI SALES AGENT: RESEARCH COMPANY ──────────────────── */
  async function runResearch() {
    if (researching) return;
    if (!f.name) {
      alert('Please enter a Company Name before running AI research.');
      return;
    }
    setResearching(true);
    setGroundedWeb(null);
    setGroundingError(null);
    setResearchError(null);

    const system = `You are an expert AI Sales Intelligence Agent for Ramssol Group, a Malaysian B2B technology company.

Current product catalog from the workspace database:
${catalogText}

Use only the verified web research and the user-entered prospect fields. Never invent or estimate factual company data. Leave unsupported factual fields empty and explain that evidence was unavailable.
IMPORTANT: Return ONLY valid JSON, no markdown, no extra text.`;

    const web = await researchCompany(
      `${f.name} ${f.website || ''} company profile revenue employees technology`,
      f.location
    ) as ResearchResult & { searchEntryPointHtml?: string };
    if (web.error || !web.configured || !web.summary || !web.sources?.length) {
      const message = web.error || 'Verified web research is not configured.';
      setResearching(false);
      setGroundingError(message);
      toast(`⚠️ Web grounding unavailable — ${message}`, true);
      return;
    }
    setGroundedWeb({
      summary: web.summary,
      sources: web.sources,
      searchEntryPointHtml: web.searchEntryPointHtml,
    });
    const verifiedContext = `\nVerified web research (use this as the factual source of truth):\n${web.summary}\nSources: ${JSON.stringify(web.sources)}\n`;

    const prompt = `Research this prospect for Ramssol Group and return a JSON object:

Company: ${f.name}
Industry: ${f.industry || 'Unknown'}
Location: ${f.location || 'Not provided'}
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
  "estimatedRevenue": "published revenue with its period, or an empty string",
  "estimatedITSpend": "published IT spend with its period, or an empty string",
  "estimatedHRSpend": "published HR spend with its period, or an empty string",
  "employeeSize": "published employee count or range, or an empty string",
  "decisionMaker": "documented decision-maker name/title, or an empty string",
  "buyingPotential": "High or Medium or Low",
  "buyingPotentialReason": "1-2 sentences on why this potential rating was given, considering budget, need urgency, and fit with Ramssol products"
}`;

    const raw = await callClaude([{ role: 'user', content: prompt }], system);
    setResearching(false);
    if (isAiError(raw)) {
      setResearchError(raw);
      toast(raw, true);
      return;
    }

    const parsed = parseJsonReply<AIResearch | null>(raw, null);
    if (!parsed || typeof parsed !== 'object') {
      const message = '⚠️ The AI returned an invalid research result. Please retry.';
      setResearchError(message);
      toast(message, true);
      return;
    }
    // Search Suggestions HTML remains transient, but durable research keeps
    // its supporting source links alongside the database record.
    setResearch({ ...parsed, sources: web.sources || [] });
    setProducts(null);
    setOutline(null);
  }

  /* ── AI: RECOMMEND PRODUCTS ────────────────────────────── */
  async function recommendProducts() {
    if (recommending) return;
    if (!productCatalog.length) {
      toast('The product catalog is empty. Ask an administrator to configure it.', true);
      return;
    }
    setRecommending(true);
    setProducts('⏳ Analysing and recommending products...');
    const system = `You are a senior pre-sales consultant at Ramssol Group. Use only the user-entered prospect fields, cited research, and database catalog supplied below. Never invent prospect facts, needs, budgets, timelines, products, prices, or expected results. If a recommendation cannot be supported by the supplied information, say so.

Use only this product catalog from the workspace database:
${catalogText}

Recommend the most suitable products. Be specific on why each product fits this prospect.`;

    const prompt = `User-entered prospect fields:
${JSON.stringify({
  name: f.name || null,
  industry: f.industry || null,
  employeeSize: f.empSize || null,
  itBudget: f.itBudget || null,
  hrBudget: f.hrBudget || null,
  painPoints: f.pain || null,
  timeline: f.timeline || null,
})}

Cited research stored for this form:
${research ? JSON.stringify(research) : 'None'}

Recommend the top 2-3 Ramssol products/solutions for this prospect. For each:
1. Product name
2. Why it fits (2-3 specific reasons tied to their industry/pain)
3. Recommended next step

Do not invent a deal value. If no entered budget supports pricing, say that commercial scoping is required.

Format clearly with numbered sections.`;

    const result = await callClaude([{ role: 'user', content: prompt }], system);
    setProducts(result);
    setRecommending(false);
    if (isAiError(result)) toast(result, true);
  }

  /* ── AI: GENERATE PROPOSAL OUTLINE ─────────────────────── */
  async function generateOutline() {
    if (outlining) return;
    if (!productCatalog.length) {
      toast('The product catalog is empty. Ask an administrator to configure it.', true);
      return;
    }
    setOutlining(true);
    setOutline('⏳ Generating proposal outline...');
    const name = f.name || 'the prospect';
    const system = `You are a senior proposal writer for Ramssol Group. Use only the user-entered prospect fields, cited research, and database product catalog supplied below. Do not infer or invent company facts, challenges, ROI, prices, implementation durations, case studies, references, or product names. Mark unsupported items as "To be confirmed". Never present an assumption as a fact.

Database product catalog:
${catalogText}`;

    const prompt = `Generate a full proposal outline for this prospect:

User-entered prospect fields:
${JSON.stringify({
  company: name,
  industry: f.industry || null,
  location: f.location || null,
  decisionMaker: f.authName
    ? { name: f.authName, position: f.authPos || null }
    : null,
  itBudget: f.itBudget || null,
  hrBudget: f.hrBudget || null,
  painPoints: f.pain || null,
  timeline: f.timeline || null,
})}

Cited research stored for this form:
${research ? JSON.stringify(research) : 'None'}

Create a structured proposal outline with these 8 sections:
1. Executive Summary
2. Understanding of ${name}'s Challenges
3. Proposed Solution (only matching products from the database catalog)
4. Key Benefits & ROI
5. Implementation Approach & Timeline
6. Commercial Proposal (pricing structure)
7. Case Studies & References
8. Next Steps & Call to Action

For each section, write 2-3 bullet points. Use "To be confirmed" anywhere the supplied data does not support a factual statement.`;

    const result = await callClaude([{ role: 'user', content: prompt }], system);
    setOutline(result);
    setOutlining(false);
    if (isAiError(result)) toast(result, true);
  }

  async function submit() {
    if (saving) return;
    const companyName = f.name.trim();
    if (!companyName) {
      alert('Please enter a Company Name.');
      return;
    }
    if (!f.industry || !options.industries.includes(f.industry)) {
      alert('Please choose an industry from the configured list.');
      return;
    }
    const ind = f.industry;
    const painArr = f.pain ? f.pain.split('\n').map((item) => item.trim()).filter(Boolean) : [];
    const tags = [ind, f.currSystem, f.currModule].filter(Boolean).slice(0, 3);

    const prospect: Prospect = {
      id: Date.now(),
      name: companyName,
      type: ind,
      country: f.location.trim(),
      website: f.website.trim(),
      added: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      tags: tags.length ? tags : [ind],
      employees: f.empSize,
      painPoints: painArr,
      contact: f.contactName ? `${f.contactName}${f.contactPos ? `, ${f.contactPos}` : ''}` : undefined,
      authority: f.authName ? `${f.authName}${f.authPos ? `, ${f.authPos}` : ''}` : undefined,
      itBudget: f.itBudget,
      hrBudget: f.hrBudget,
      timeline: f.timeline,
      currentSystem: f.currSystem || undefined,
      currentModule: f.currModule || undefined,
      aiResearch: research,
    };

    setSaving(true);
    try {
      const result = await onAdd(prospect, f, research);
      if (result === false) return;
      if (typeof result === 'string') {
        toast(result, true);
        return;
      }
      reset();
    } finally {
      setSaving(false);
    }
  }

  const pot = (research?.buyingPotential || '').trim();
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
          <button className="btn-primary" disabled={saving} onClick={submit}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {saving ? 'Saving…' : 'Add Prospect'}
          </button>
        </>
      }
    >
      <div className="sec-divider">Company Information</div>
      <div className="fg">
        <label className="fl">
          Company Name <span className="req">*</span>
        </label>
        <input className="fi" value={f.name} onChange={set('name')} placeholder="Company legal name" />
      </div>
      <div className="g3">
        <div className="fg">
          <label className="fl">
            Industry <span className="req">*</span>
          </label>
          <select className="fs" value={f.industry} onChange={set('industry')}>
            <option value="">Select industry</option>
            {options.industries.map((i) => (
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
            {options.employeeSizes.map((i) => (
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
        {autofilling ? 'Loading verified facts...' : 'Fill from verified web sources'}
      </button>
      <div style={{ fontSize: 10.5, color: 'var(--gray-400)', textAlign: 'center', marginTop: 5, marginBottom: 4 }}>
        Looks up sourced public facts using the Company Name and Website. Unsupported fields stay
        empty, and existing entries are never overwritten.
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
          <label className="fl">Known IT Budget</label>
          <select className="fs" value={f.itBudget} onChange={set('itBudget')}>
            <option value="">Unknown</option>
            {options.itBudgetRanges.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Known HR Budget</label>
          <select className="fs" value={f.hrBudget} onChange={set('hrBudget')}>
            <option value="">Unknown</option>
            {options.hrBudgetRanges.map((i) => (
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
          {options.buyingTimelines.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className={`ai-agent-btn${researching ? ' loading' : ''}`}
        disabled={researching}
        onClick={runResearch}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l3 3" />
        </svg>
        {researching
          ? `Researching ${f.name}...`
          : researchError
            ? '⚠️ Research Failed — Click to Retry'
            : research
            ? '✅ Research Complete — Click to Re-run'
            : '🤖 Research Company with AI Sales Agent'}
      </button>
      <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', marginTop: 6 }}>
        Uses verified public sources; unsupported company facts remain blank
      </div>
      {researchError && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--red-700)', textAlign: 'center', marginTop: 8 }}>
          {researchError}
        </div>
      )}
      {groundingError && (
        <div className="grounding-warning" role="status">
          <strong>Web grounding unavailable.</strong> {groundingError} No research result was
          generated; enter only facts you can verify.
        </div>
      )}

      {groundedWeb && (
        <section className="ai-results grounded-results visible" aria-label="Grounded web research">
          <div className="ai-results-header">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--brand-500)"
              strokeWidth={2}
              width={15}
              height={15}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <span className="ai-results-header-title">Grounded Web Research</span>
            <span className="grounded-provider">Google Search</span>
          </div>
          <div className="ai-results-body">
            <div className="grounded-summary">{groundedWeb.summary}</div>

            {groundedWeb.searchEntryPointHtml ? (
              <div
                className="google-search-entry-point"
                aria-label="Google Search suggestions"
                // Google supplies this compliant HTML/CSS and requires it to
                // be rendered without modification beside the grounded result.
                dangerouslySetInnerHTML={{ __html: groundedWeb.searchEntryPointHtml }}
              />
            ) : null}

            {groundedWeb.sources.length ? (
              <div className="grounded-sources">
                <div className="ai-card-lbl">Sources</div>
                <div className="grounded-source-links">
                  {groundedWeb.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {research && (
        <div className="ai-results visible">
          <div className="ai-results-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth={2} width={15} height={15}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
            <span className="ai-results-header-title">AI Sales Intelligence Report</span>
            <span style={{ marginLeft: 'auto' }}>
              {!research.raw && pot && <span className={`buying-badge ${potCls}`}>{pot}</span>}
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
                <div className="ai-metric-lbl">Published Annual Revenue</div>
              </div>
              <div className="ai-metric-box">
                <div className="ai-metric-num">{research.estimatedITSpend || '—'}</div>
                <div className="ai-metric-lbl">Published IT Spending</div>
              </div>
              <div className="ai-metric-box">
                <div className="ai-metric-num">{research.estimatedHRSpend || '—'}</div>
                <div className="ai-metric-lbl">Published HR Spending</div>
              </div>
            </div>

            <div className="g2">
              <div className="ai-wide-card">
                <div className="ai-card-lbl">Published Employee Size</div>
                <div className="ai-card-val">{research.employeeSize || '—'}</div>
              </div>
              <div className="ai-wide-card">
                <div className="ai-card-lbl">Documented Decision Maker</div>
                <div className="ai-card-val">{research.decisionMaker || '—'}</div>
              </div>
            </div>

            <div className="ai-wide-card">
              <div className="ai-card-lbl">Buying Potential</div>
              <div className="buying-wrap">
                {!research.raw && pot && <span className={`buying-badge ${potCls}`}>{pot}</span>}
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
              <button
                type="button"
                className="ai-act-btn btn-rec"
                disabled={recommending}
                onClick={recommendProducts}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {recommending ? 'Recommending...' : 'Recommend Products & Solutions'}
              </button>
              <button
                type="button"
                className="ai-act-btn btn-prop"
                disabled={outlining}
                onClick={generateOutline}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {outlining ? 'Generating...' : 'Generate Proposal Outline'}
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
