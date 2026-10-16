/**
 * The wizard's pages: their order with and without the company's questions,
 * their titles, and how a page's name or index resolves to the page.
 */
import { describe, it, expect } from 'vitest';
import { buildSemanticStepOrder, resolveWizardStepIndex, wizardStepsFor } from './wizardSteps';

describe('the wizard’s pages', () => {
  it('keeps the nine-step order and inserts the company’s questions before the review', () => {
    expect(buildSemanticStepOrder(false)).toEqual([
      'contact', 'qualifications', 'license', 'violations', 'accidents',
      'employment', 'general', 'review', 'consent',
    ]);
    expect(buildSemanticStepOrder(true)).toEqual([
      'contact', 'qualifications', 'license', 'violations', 'accidents',
      'employment', 'general', 'custom_questions', 'review', 'consent',
    ]);
  });

  it('gives every page the same title in both orders', () => {
    const withQuestions = wizardStepsFor(true);
    expect(withQuestions.find((page) => page.id === 'custom_questions').title).toBe('Additional Questions');
    expect(wizardStepsFor(false)).toEqual(withQuestions.filter((page) => page.id !== 'custom_questions'));
    expect(withQuestions.every((page) => typeof page.title === 'string' && page.title.length > 0)).toBe(true);
  });

  it('hands each reader its own copy, so no reader can change the order for another', () => {
    buildSemanticStepOrder(false).push('extra');
    wizardStepsFor(false).splice(0, 1);
    expect(buildSemanticStepOrder(false)).toHaveLength(9);
    expect(wizardStepsFor(true)).toHaveLength(10);
    expect(() => { wizardStepsFor(false)[0].title = 'Changed'; }).toThrow(TypeError);
  });
});

describe('a page’s index', () => {
  it('is its place in the order, the consent page last in both', () => {
    expect(resolveWizardStepIndex('consent', false)).toBe(8);
    expect(resolveWizardStepIndex('consent', true)).toBe(9);
    expect(resolveWizardStepIndex('license', true)).toBe(2);
    expect(resolveWizardStepIndex('custom_questions', true)).toBe(7);
  });

  it('keeps an index already in range and sends anything else to the first page', () => {
    expect(resolveWizardStepIndex(3, false)).toBe(3);
    expect(resolveWizardStepIndex(9, false)).toBe(0);
    expect(resolveWizardStepIndex('nope', false)).toBe(0);
    expect(resolveWizardStepIndex('custom_questions', false)).toBe(0);
  });
});
