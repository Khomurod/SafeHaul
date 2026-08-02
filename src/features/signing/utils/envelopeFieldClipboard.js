/**
 * Clipboard helpers for EnvelopeCreator placeholder duplicate (Ctrl/Cmd+C, Ctrl/Cmd+V).
 * Positions are PDF-overlay percentages (same coordinate system as field x/y/width/height).
 */

/** @typedef {{ x: number, y: number, width: number, height: number, page: number }} PasteRect */

export function cloneFieldWithoutId(field) {
  if (!field || typeof field !== 'object') return null;
  const clone = { ...field };
  delete clone.id;
  return clone;
}

/**
 * Next rectangle for a pasted duplicate: step right from last placed; wrap below anchor column when overflowing right edge.
 */
export function computeNextPasteRect(lastPlaced, anchor, templateWidth, templateHeight, gap = 0.75) {
  const w = Number(templateWidth) || 1;
  const h = Number(templateHeight) || 1;

  let nx = Number(lastPlaced.x) + Number(lastPlaced.width) + gap;
  let ny = Number(lastPlaced.y);
  const page = lastPlaced.page;

  if (nx + w > 100) {
    nx = Number(anchor.x);
    ny = Number(lastPlaced.y) + Number(lastPlaced.height) + gap;
  }

  nx = Math.min(Math.max(0, nx), Math.max(0, 100 - w));
  ny = Math.min(Math.max(0, ny), Math.max(0, 100 - h));

  return { x: nx, y: ny, width: w, height: h, page };
}

export function isEditableKeyboardTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}
