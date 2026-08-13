'use client';
/* ═══════════════════════════════════════════════════════════
   docExport.ts — turning the generated HTML into a downloadable file.

   Same approach as prospects.html: the document is rendered into an
   off-screen div at its natural width, then captured. The PDF/Word
   libraries are imported dynamically so they stay out of the initial
   bundle and never run during SSR.
═══════════════════════════════════════════════════════════ */

function offscreen(id: string, width: number, html: string) {
  let div = document.getElementById(id);
  if (!div) {
    div = document.createElement('div');
    div.id = id;
    div.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;background:white`;
    document.body.appendChild(div);
  }
  div.innerHTML = html;
  return div;
}

/**
 * Proposal deck → landscape PDF, one 1280×720 slide per page.
 *
 * Built directly with html2canvas + jsPDF (NOT html2pdf.js). html2pdf.js
 * resizes the source element to match its page size before rendering,
 * which squashed the fixed slide layout, and its page-break modes
 * miscounted pages and inserted blanks. One canvas per slide, one page
 * per canvas, is exact and predictable.
 */
export async function downloadProposalPDF(html: string, filename: string) {
  const el = offscreen('__proposal-render', 1280, html);
  const slides = Array.from(el.querySelectorAll<HTMLElement>('.rp-slide'));
  if (!slides.length) return;

  const PAGE_W = 1280;
  const PAGE_H = 720;

  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const html2canvas = html2canvasMod.default;

  const pdf = new jsPDF({
    unit: 'px',
    format: [PAGE_W, PAGE_H],
    orientation: 'landscape',
    compress: true,
  });

  for (let i = 0; i < slides.length; i++) {
    const canvas = await html2canvas(slides[i], {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: PAGE_W,
      height: PAGE_H,
      windowWidth: PAGE_W,
      windowHeight: PAGE_H,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'landscape');
    pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
  }

  pdf.save(`${filename}.pdf`);
}

/** Intelligence report → A4 portrait PDF. */
export async function downloadReportPDF(html: string, filename: string) {
  const el = offscreen('__report-render', 800, html);
  const target = el.querySelector('#ramssol-report');
  if (!target) return;

  const mod = await import('html2pdf.js');
  const html2pdf = (mod.default ?? mod) as unknown as () => {
    set: (o: unknown) => { from: (e: Element) => { save: () => Promise<void> } };
  };

  await html2pdf()
    .set({
      margin: [8, 8, 8, 8],
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.97 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    })
    .from(target)
    .save();
}

/** Intelligence report → editable .doc (Word / Google Docs / LibreOffice). */
export function downloadReportWord(html: string, filename: string) {
  const el = offscreen('__report-render', 800, html);
  const wordHtml =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"' +
    ' xmlns:w="urn:schemas-microsoft-com:office:word"' +
    ' xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta charset="utf-8">' +
    '<style>' +
    'body{font-family:Calibri,Arial,sans-serif;margin:40px;color:#111827;}' +
    'table{border-collapse:collapse;width:100%;}' +
    'td,th{padding:8px 12px;}' +
    '</style></head>' +
    '<body>' + el.innerHTML + '</body></html>';

  const blob = new Blob([wordHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Chat intent detection (unchanged from prospects.html) ── */
const DOC_WORDS = ['generate', 'create', 'make', 'produce', 'export', 'download', 'write', 'build', 'draft'];
const FILE_WORDS = ['pdf', 'word', 'doc', 'document', 'report', 'file', 'paper', 'brief', 'summary', 'profile'];
const PROPOSAL_WORDS = ['proposal', 'pitch deck', 'slide deck', 'deck', 'slides', 'presentation'];

export function detectDocIntent(msg: string) {
  const lower = msg.toLowerCase();
  return DOC_WORDS.some((w) => lower.includes(w)) && FILE_WORDS.some((w) => lower.includes(w));
}

/** Checked before the generic report intent — it is more specific. */
export function detectProposalIntent(msg: string) {
  const lower = msg.toLowerCase();
  return DOC_WORDS.some((w) => lower.includes(w)) && PROPOSAL_WORDS.some((w) => lower.includes(w));
}

/** Models sometimes wrap JSON in a markdown fence — strip it before parsing. */
export function parseJsonReply<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as T;
  } catch {
    return fallback;
  }
}
