import { describe, expect, it } from 'vitest';
import {
  cloneFieldWithoutId,
  computeNextPasteRect,
  isEditableKeyboardTarget,
} from './envelopeFieldClipboard';

describe('envelopeFieldClipboard', () => {
  it('cloneFieldWithoutId strips id and preserves geometry + semantics', () => {
    const src = {
      id: 'old-id',
      type: 'checkbox',
      label: 'Agree',
      page: 2,
      x: 12,
      y: 34,
      width: 5,
      height: 4,
      bindingKey: '',
      defaultValue: '',
      prefillGroupKey: '',
      fontSize: 'Auto',
    };
    const c = cloneFieldWithoutId(src);
    expect(c.id).toBeUndefined();
    expect(c.type).toBe('checkbox');
    expect(c.width).toBe(5);
    expect(c.height).toBe(4);
    expect(c.page).toBe(2);
    expect(c.label).toBe('Agree');
  });

  it('computeNextPasteRect advances horizontally', () => {
    const anchor = { x: 10, y: 20, width: 15, height: 5, page: 1 };
    const last = { ...anchor };
    const next = computeNextPasteRect(last, anchor, 15, 5, 1);
    expect(next.x).toBeCloseTo(26);
    expect(next.y).toBe(20);
    expect(next.page).toBe(1);
    expect(next.width).toBe(15);
    expect(next.height).toBe(5);
  });

  it('computeNextPasteRect wraps below anchor when row overflows', () => {
    const anchor = { x: 5, y: 10, width: 30, height: 6, page: 1 };
    const last = { x: 70, y: 10, width: 30, height: 6, page: 1 };
    const next = computeNextPasteRect(last, anchor, 30, 6, 1);
    expect(next.x).toBe(5);
    expect(next.y).toBeCloseTo(17);
  });

  it('computeNextPasteRect clamps to page bounds', () => {
    const anchor = { x: 0, y: 95, width: 50, height: 10, page: 1 };
    const last = { x: 0, y: 95, width: 50, height: 10, page: 1 };
    const next = computeNextPasteRect(last, anchor, 50, 10, 5);
    expect(next.y).toBe(90);
    expect(next.x).toBe(0);
  });

  it('isEditableKeyboardTarget detects inputs', () => {
    expect(isEditableKeyboardTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'DIV' })).toBe(false);
  });
});
