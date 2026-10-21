/**
 * Runs inside the page: lists text that spills out of its box or off the screen, and text cut off with "…".
 * Icons (Material Symbols ligatures) are skipped: their glyph box is not text the user reads.
 */
export function auditLayout(): string[] {
  const issues: string[] = [];
  const label = (el: Element) => ((el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60));
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) issues.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('dialog:not([open])')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('.material-symbols-outlined')) continue;
    const h = el as HTMLElement;
    const scrollsX = /(auto|scroll)/.test(cs.overflowX), scrollsY = /(auto|scroll)/.test(cs.overflowY);
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').trim());
    const control = el.matches('button,a,[role=tab]');
    if (cs.textOverflow === 'ellipsis' && h.scrollWidth > h.clientWidth + 1) { issues.push(`cut off with "…": ${label(el)}`); continue; }
    if (!scrollsX && cs.overflowX !== 'hidden' && h.clientWidth && h.scrollWidth > h.clientWidth + 1 && (hasText || control)) issues.push(`spills sideways: ${label(el)} (${h.scrollWidth}>${h.clientWidth})`);
    if (!scrollsY && cs.overflowY !== 'hidden' && h.clientHeight && h.scrollHeight > h.clientHeight + 1 && (hasText || control)) issues.push(`spills down: ${label(el)} (${h.scrollHeight}>${h.clientHeight})`);
    if (hasText && r.right / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) > W + 1 && !el.closest('.overflow-x-auto')) issues.push(`off screen: ${label(el)}`);
  }
  return Array.from(new Set(issues));
}
