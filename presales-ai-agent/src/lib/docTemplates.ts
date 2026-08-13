/* ═══════════════════════════════════════════════════════════
   docTemplates.ts — the printable Sales Intelligence Report and the
   8-slide Proposal deck.

   Lifted out of prospects.html unchanged: these are pure
   (data, prospect) => HTML-string builders, so the generated documents
   look exactly as they did before the migration. Only the type
   annotations are new.
═══════════════════════════════════════════════════════════ */
import type { Prospect } from './data';

export type Solution = { product?: string; reason?: string };

export type ReportData = {
  executiveSummary?: string;
  companyBackground?: string;
  financials?: { revenue?: string; itSpend?: string; hrSpend?: string };
  estimatedRevenue?: string;
  estimatedITSpend?: string;
  estimatedHRSpend?: string;
  employeeSize?: string;
  decisionMaker?: string;
  buyingPotential?: string;
  buyingPotentialReason?: string;
  keyPainPoints?: string[];
  recommendedSolutions?: Solution[];
  nextSteps?: string[];
};

export type ProposalData = ReportData & {
  proposalTitle?: string;
  proposalSubtitle?: string;
  engagementType?: string;
  pricing?: { items?: { item?: string; description?: string; cost?: string }[]; total?: string };
  timeline?: { phase?: string; duration?: string; description?: string }[];
  whyRamssol?: { title?: string; detail?: string }[];
};

// ── BUILD REPORT HTML TEMPLATE ───────────────────────────
export function buildReportHTML(data: ReportData, prospect: Prospect): string {
  const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  const pot   = (data.buyingPotential || 'Medium').trim();
  const potColor  = pot==='High' ? '#0A6650' : pot==='Low' ? '#A32D2D' : '#BA7517';
  const potBg     = pot==='High' ? '#E7F9F2' : pot==='Low' ? '#FEF2F2' : '#FEF9EC';
  const pains     = (data.keyPainPoints || []).map((p: string) =>`<li style="margin-bottom:6px">${p}</li>`).join('');
  const solutions = (data.recommendedSolutions || []).map((s: Solution, i: number) =>`
    <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #F0EFF0">
      <div style="width:24px;height:24px;border-radius:50%;background:#1B2A4A;color:white;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div><div style="font-size:13px;font-weight:600;color:#1B2A4A">${s.product||s}</div><div style="font-size:12px;color:#6B7280;margin-top:2px">${s.reason||''}</div></div>
    </div>`).join('');
  const nextSteps = (data.nextSteps || []).map((s: string, i: number) =>`
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
      <div style="background:#00B4A0;color:white;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;flex-shrink:0;margin-top:1px">Step ${i+1}</div>
      <div style="font-size:12px;color:#374151">${s}</div>
    </div>`).join('');

  return `
<div id="ramssol-report" style="font-family:'Calibri',Arial,sans-serif;max-width:780px;margin:0 auto;color:#111827;background:white;padding:0">

  <!-- HEADER -->
  <div style="background:#1B2A4A;padding:36px 40px;border-radius:10px 10px 0 0;margin-bottom:0">
    <div style="font-size:9px;font-weight:700;color:#00D4B4;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">RAMSSOL GROUP · SALES INTELLIGENCE REPORT</div>
    <div style="font-size:30px;font-weight:700;color:white;line-height:1.2">${prospect.name}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:6px">${prospect.type} &nbsp;·&nbsp; ${prospect.country} &nbsp;·&nbsp; Generated ${date}</div>
  </div>

  <!-- TEAL ACCENT BAR -->
  <div style="height:4px;background:linear-gradient(90deg,#00B4A0,#00D4B4);margin-bottom:28px"></div>

  <!-- EXECUTIVE SUMMARY -->
  <div style="padding:0 40px 24px">
    <div style="font-size:10px;font-weight:700;color:#00B4A0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Executive Summary</div>
    <div style="font-size:13px;color:#374151;line-height:1.7;background:#F8F9FA;border-radius:8px;padding:16px 20px;border-left:4px solid #00B4A0">${data.executiveSummary || data.companyBackground || '—'}</div>
  </div>

  <!-- FINANCIAL METRICS -->
  <div style="padding:0 40px 24px">
    <div style="font-size:10px;font-weight:700;color:#00B4A0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Financial Intelligence</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        ['Est. Annual Revenue',    data.financials?.revenue    || data.estimatedRevenue    || '—'],
        ['Est. IT Spending',       data.financials?.itSpend    || data.estimatedITSpend    || '—'],
        ['Est. HR Spending',       data.financials?.hrSpend    || data.estimatedHRSpend    || '—'],
        ['Employee Size',          data.employeeSize           || prospect.employees       || '—'],
      ].map(([label, val]: string[]) =>`
        <div style="background:#F4F6F8;border-radius:8px;padding:14px 16px;border-top:3px solid #1B2A4A">
          <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
          <div style="font-size:14px;font-weight:700;color:#1B2A4A;font-family:'Courier New',monospace">${val}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- DECISION MAKER + BUYING POTENTIAL -->
  <div style="padding:0 40px 24px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div style="background:#F4F6F8;border-radius:8px;padding:16px 20px;border-top:3px solid #1B2A4A">
      <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Decision Maker</div>
      <div style="font-size:14px;font-weight:600;color:#1B2A4A">${data.decisionMaker || '—'}</div>
    </div>
    <div style="background:${potBg};border-radius:8px;padding:16px 20px;border-top:3px solid ${potColor}">
      <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Buying Potential</div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:16px;font-weight:700;color:${potColor}">${pot}</span>
        <span style="font-size:11px;color:#6B7280;line-height:1.4">${data.buyingPotentialReason || ''}</span>
      </div>
    </div>
  </div>

  <!-- PAIN POINTS -->
  <div style="padding:0 40px 24px">
    <div style="font-size:10px;font-weight:700;color:#00B4A0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">Key Pain Points &amp; Needs</div>
    <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.8">${pains || '<li>No pain points identified</li>'}</ul>
  </div>

  <!-- RECOMMENDED SOLUTIONS -->
  <div style="padding:0 40px 24px">
    <div style="font-size:10px;font-weight:700;color:#00B4A0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">Recommended Ramssol Solutions</div>
    ${solutions || '<div style="font-size:13px;color:#6B7280">No solutions specified</div>'}
  </div>

  <!-- NEXT STEPS -->
  <div style="padding:0 40px 28px">
    <div style="font-size:10px;font-weight:700;color:#00B4A0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Recommended Next Steps</div>
    ${nextSteps || '<div style="font-size:13px;color:#6B7280">No next steps specified</div>'}
  </div>

  <!-- FOOTER -->
  <div style="background:#F4F6F8;padding:18px 40px;border-radius:0 0 10px 10px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #E5E9EF">
    <div style="font-size:12px;font-weight:700;color:#1B2A4A">Ramssol Group &nbsp;·&nbsp; Pre-Sales Intelligence</div>
    <div style="font-size:11px;color:#9CA3AF">Confidential · For Internal Use Only · ${date}</div>
  </div>

</div>`;
}

// ── BUILD PROPOSAL SLIDE DECK HTML TEMPLATE ──────────────
// Renders a set of 16:9 "slides" (1280x720px each). Each slide is
// captured as its own canvas and placed on its own PDF page in JS
// (see downloadProposalPDF) — no CSS page-break is used.
export function buildProposalHTML(data: ProposalData, prospect: Prospect): string {
  const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  const navy = '#1B2A4A', teal = '#00B4A0', tealLight='#00D4B4';

  const S = (inner: string, opts: { bg?: string; pageBreak?: boolean } = {}) => `
    <div class="rp-slide" style="width:1280px;height:720px;box-sizing:border-box;position:relative;overflow:hidden;background:${opts.bg||'#ffffff'};font-family:'Calibri',Arial,sans-serif;color:#111827">
      ${inner}
    </div>`;

  const slideHeader = (kicker: string, title: string) => `
    <div style="padding:56px 72px 0">
      <div style="font-size:12px;font-weight:700;color:${teal};letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">${kicker}</div>
      <div style="font-size:32px;font-weight:700;color:${navy};line-height:1.2">${title}</div>
      <div style="width:64px;height:4px;background:linear-gradient(90deg,${teal},${tealLight});border-radius:2px;margin-top:16px"></div>
    </div>`;

  const pageFooter = (n: number) => `
    <div style="position:absolute;left:72px;right:72px;bottom:28px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9CA3AF;border-top:1px solid #EDEFF2;padding-top:12px">
      <span>Ramssol Group &nbsp;·&nbsp; Confidential Proposal</span>
      <span>${prospect.name} &nbsp;·&nbsp; ${n}</span>
    </div>`;

  // ── Slide 1: Cover ──
  const slideCover = S(`
    <div style="position:absolute;inset:0;background:linear-gradient(135deg,${navy} 0%,#0E1830 100%)"></div>
    <div style="position:absolute;top:-80px;right:-80px;width:340px;height:340px;border-radius:50%;background:rgba(0,180,160,0.14)"></div>
    <div style="position:absolute;bottom:-120px;left:-60px;width:280px;height:280px;border-radius:50%;background:rgba(0,180,160,0.10)"></div>
    <div style="position:relative;padding:72px;height:100%;display:flex;flex-direction:column;justify-content:space-between">
      <div style="font-size:13px;font-weight:700;color:${tealLight};letter-spacing:3px;text-transform:uppercase">RAMSSOL GROUP</div>
      <div>
        <div style="font-size:12px;font-weight:700;color:${tealLight};letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">Business Proposal</div>
        <div style="font-size:48px;font-weight:700;color:white;line-height:1.15;max-width:900px">${data.proposalTitle || `Partnership Proposal for ${prospect.name}`}</div>
        <div style="font-size:16px;color:rgba(255,255,255,0.65);margin-top:18px;max-width:760px;line-height:1.6">${data.proposalSubtitle || `Prepared for ${prospect.name} — ${prospect.type}`}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div style="font-size:13px;color:rgba(255,255,255,0.55)">Prepared for <strong style="color:white">${prospect.name}</strong> &nbsp;·&nbsp; ${prospect.country}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.55)">${date}</div>
      </div>
    </div>`, {pageBreak:true});

  // ── Slide 2: Executive Summary ──
  const slideSummary = S(`
    ${slideHeader('Executive Summary', 'Why We’re Here')}
    <div style="padding:32px 72px 0">
      <div style="font-size:17px;line-height:1.9;color:#374151;background:#F8F9FA;border-left:4px solid ${teal};border-radius:8px;padding:24px 28px;max-width:1080px">${data.executiveSummary || `${prospect.name} is a ${prospect.type} organisation positioned to benefit from Ramssol's HR & enterprise technology solutions.`}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px">
        ${[
          ['Industry', prospect.type || '—'],
          ['Employee Size', data.employeeSize || prospect.employees || '—'],
          ['Engagement Type', data.engagementType || 'Software + Advisory'],
        ].map(([l, v]: string[]) =>`
        <div style="background:#F4F6F8;border-radius:8px;padding:18px 20px;border-top:3px solid ${navy}">
          <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${l}</div>
          <div style="font-size:16px;font-weight:700;color:${navy}">${v}</div>
        </div>`).join('')}
      </div>
    </div>
    ${pageFooter(2)}`, {pageBreak:true});

  // ── Slide 3: Challenges ──
  const pains = (data.keyPainPoints || prospect.painPoints || []).map((p: string, i: number) =>`
    <div style="display:flex;gap:16px;align-items:flex-start;background:#F8F9FA;border-radius:10px;padding:16px 20px">
      <div style="width:28px;height:28px;border-radius:50%;background:#FEF2F2;color:#A32D2D;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="font-size:14px;color:#374151;line-height:1.6;padding-top:3px">${p}</div>
    </div>`).join('');
  const slideChallenges = S(`
    ${slideHeader('The Challenge', 'What ' + prospect.name + ' Is Facing')}
    <div style="padding:32px 72px 0;display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1140px">${pains || '<div style="font-size:14px;color:#6B7280">No challenges identified</div>'}</div>
    ${pageFooter(3)}`, {pageBreak:true});

  // ── Slide 4: Proposed Solution ──
  const solutions = (data.recommendedSolutions || []).map((s: Solution, i: number) =>`
    <div style="display:flex;gap:18px;padding:18px 0;border-bottom:1px solid #EDEFF2">
      <div style="width:34px;height:34px;border-radius:50%;background:${navy};color:white;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div>
        <div style="font-size:16px;font-weight:700;color:${navy}">${s.product||s}</div>
        <div style="font-size:13px;color:#6B7280;margin-top:4px;line-height:1.6;max-width:920px">${s.reason||''}</div>
      </div>
    </div>`).join('');
  const slideSolution = S(`
    ${slideHeader('Our Recommendation', 'Proposed Solution')}
    <div style="padding:24px 72px 0">${solutions || '<div style="font-size:14px;color:#6B7280">No solutions specified</div>'}</div>
    ${pageFooter(4)}`, {pageBreak:true});

  // ── Slide 5: Investment / Pricing ──
  const items = data.pricing?.items || [];
  const rows = items.map(it=>`
    <tr>
      <td style="padding:14px 20px;font-size:13px;color:#374151;border-bottom:1px solid #EDEFF2">${it.item||'—'}</td>
      <td style="padding:14px 20px;font-size:13px;color:#6B7280;border-bottom:1px solid #EDEFF2">${it.description||''}</td>
      <td style="padding:14px 20px;font-size:13px;color:${navy};font-weight:700;font-family:'Courier New',monospace;text-align:right;border-bottom:1px solid #EDEFF2;white-space:nowrap">${it.cost||'—'}</td>
    </tr>`).join('');
  const slidePricing = S(`
    ${slideHeader('Investment', 'Pricing & Commercial Terms')}
    <div style="padding:28px 72px 0">
      <table style="width:100%;border-collapse:collapse;max-width:1140px">
        <thead><tr>
          <th style="text-align:left;padding:12px 20px;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid ${navy}">Item</th>
          <th style="text-align:left;padding:12px 20px;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid ${navy}">Description</th>
          <th style="text-align:right;padding:12px 20px;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid ${navy}">Cost</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="3" style="padding:20px;font-size:13px;color:#6B7280;text-align:center">Pricing to be confirmed after scoping</td></tr>`}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:18px;max-width:1140px">
        <div style="background:${navy};border-radius:8px;padding:16px 28px;text-align:right">
          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:.5px">Total Estimated Investment</div>
          <div style="font-size:22px;font-weight:700;color:white;font-family:'Courier New',monospace;margin-top:4px">${data.pricing?.total || '—'}</div>
        </div>
      </div>
    </div>
    ${pageFooter(5)}`, {pageBreak:true});

  // ── Slide 6: Timeline ──
  const phases = (data.timeline || []).map((t,i,arr)=>`
    <div style="flex:1;position:relative;padding-top:26px">
      <div style="position:absolute;top:0;left:0;right:${i===arr.length-1?'50%':'0'};height:3px;background:${teal}"></div>
      <div style="width:16px;height:16px;border-radius:50%;background:${teal};border:3px solid white;box-shadow:0 0 0 2px ${teal};position:absolute;top:-7px;left:0"></div>
      <div style="font-size:11px;font-weight:700;color:${teal};text-transform:uppercase;letter-spacing:.5px;margin-top:14px">${t.phase || 'Phase ' + (i+1)}</div>
      <div style="font-size:13px;font-weight:700;color:${navy};margin-top:4px">${t.duration||''}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:6px;line-height:1.6;max-width:220px">${t.description||''}</div>
    </div>`).join('');
  const slideTimeline = S(`
    ${slideHeader('Roadmap', 'Implementation Timeline')}
    <div style="padding:56px 72px 0;display:flex;gap:24px">${phases || '<div style="font-size:14px;color:#6B7280">Timeline to be confirmed after kickoff</div>'}</div>
    ${pageFooter(6)}`, {pageBreak:true});

  // ── Slide 7: Why Ramssol ──
  const why = (data.whyRamssol || []).map(w=>`
    <div style="background:#F8F9FA;border-radius:10px;padding:20px 22px;border-top:3px solid ${teal}">
      <div style="font-size:14px;font-weight:700;color:${navy};margin-bottom:6px">${w.title||w}</div>
      <div style="font-size:12px;color:#6B7280;line-height:1.6">${w.detail||''}</div>
    </div>`).join('');
  const slideWhy = S(`
    ${slideHeader('Our Value', 'Why Ramssol')}
    <div style="padding:32px 72px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1140px">${why || '<div style="font-size:14px;color:#6B7280">—</div>'}</div>
    ${pageFooter(7)}`, {pageBreak:true});

  // ── Slide 8: Next Steps / Close ──
  const steps = (data.nextSteps || []).map((s: string, i: number) =>`
    <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px">
      <div style="background:${teal};color:white;font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;flex-shrink:0">Step ${i+1}</div>
      <div style="font-size:14px;color:#374151;line-height:1.6;padding-top:1px">${s}</div>
    </div>`).join('');
  const slideNext = S(`
    <div style="position:absolute;inset:0;background:linear-gradient(135deg,${navy} 0%,#0E1830 100%)"></div>
    <div style="position:relative;padding:64px 72px;height:100%;display:flex;flex-direction:column;justify-content:space-between">
      <div>
        <div style="font-size:12px;font-weight:700;color:${tealLight};letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Let's Move Forward</div>
        <div style="font-size:30px;font-weight:700;color:white;margin-bottom:28px">Next Steps</div>
        <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:24px 28px;max-width:820px">${steps || '<div style="font-size:14px;color:rgba(255,255,255,0.7)">Schedule a follow-up discussion</div>'}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:14px;font-weight:700;color:white">Ramssol Group</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px">Pre-Sales &amp; Solutions Team</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.45)">Confidential · Prepared for ${prospect.name} · ${date}</div>
      </div>
    </div>`, {pageBreak:false});

  return `<div id="ramssol-proposal">${slideCover}${slideSummary}${slideChallenges}${slideSolution}${slidePricing}${slideTimeline}${slideWhy}${slideNext}</div>`;
}

