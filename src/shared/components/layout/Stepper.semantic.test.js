import { describe, it, expect } from 'vitest';
import { buildSemanticStepOrder, resolveWizardStepIndex } from './Stepper';

describe('wizard semantic step mapping', () => {
  it('inserts custom_questions when company has custom questions', () => {
    const order = buildSemanticStepOrder(true);
    expect(order).toContain('custom_questions');
    expect(order.indexOf('custom_questions')).toBeGreaterThan(order.indexOf('general'));
    expect(order.indexOf('review')).toBeGreaterThan(order.indexOf('custom_questions'));
  });

  it('resolves semantic step id after schema adds dynamic step', () => {
    const idx = resolveWizardStepIndex('license', true);
    expect(idx).toBe(2);
  });

  it('falls back to first step for unknown semantic id', () => {
    expect(resolveWizardStepIndex('unknown_step', false)).toBe(0);
  });
});
