import { describe, expect, it } from 'vitest';
import { getMagicFillPatchForStep, SANDBOX_SIGNATURE_DATA_URL } from './dummyDataGenerator';

describe('getMagicFillPatchForStep', () => {
  it('fills consent agreements as agree-* string values', () => {
    const patch = getMagicFillPatchForStep(8, { hasCustomQuestions: false });
    expect(patch['agree-electronic']).toBe('agreed');
    expect(patch['final-certification']).toBe('agreed');
    expect(typeof patch.signature).toBe('string');
    expect(patch.signature.length).toBeGreaterThan(100);
  });

  it('uses Class A for CDL step', () => {
    const patch = getMagicFillPatchForStep(2, { hasCustomQuestions: false });
    expect(patch['cdl-class']).toBe('Class A');
  });

  it('includes long signature constant export', () => {
    expect(SANDBOX_SIGNATURE_DATA_URL.startsWith('data:image/png')).toBe(true);
  });
});
