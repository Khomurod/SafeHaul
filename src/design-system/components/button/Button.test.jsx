import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Button, IconButton } from './Button';

/*
 * Comments are stripped before any selector matching. `selectorFor` captures
 * everything back to the previous `}`, so a comment sitting above a rule would
 * be counted as part of its prelude — and the comment above the tone rule
 * mentions `[data-tone]`, `[data-variant]` and `.bg-ds-status-success-fg`,
 * which inflated the tone count from 3 to 7. The specificity guard would then
 * have passed even with the tone selector weakened back to a losing form,
 * which is the exact defect it exists to catch (P2 in review on PR #116).
 */
const BUTTON_CSS = readFileSync(path.join(__dirname, 'Button.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Counts the class and attribute selectors in a rule, which is the middle
 * (`b`) component of CSS specificity. That is the only component in play here:
 * these rules use no ids and no element selectors.
 */
function classAndAttributeCount(selector) {
  return (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
}

function selectorFor(declaration) {
  const match = BUTTON_CSS.match(new RegExp(`([^{}]+)\\{[^}]*${declaration}`));
  if (!match) throw new Error(`No rule found declaring ${declaration}`);
  const selector = match[1].trim();
  // Fail loudly rather than silently counting stray text as part of the
  // prelude: a real selector here always starts at the `.ds-button` class.
  if (!selector.startsWith('.ds-button')) {
    throw new Error(`Parsed prelude for ${declaration} is not a selector: ${selector}`);
  }
  return selector;
}

describe('Button', () => {
  it('uses native button behavior and exposes loading state', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('requires an accessible label for icon-only buttons', () => {
    expect(() => render(<IconButton><span>icon</span></IconButton>))
      .toThrow(/requires a non-empty label/i);
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Continue</Button>
        <IconButton label="Open navigation"><span aria-hidden="true">+</span></IconButton>
      </div>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Button tone', () => {
  it('carries no tone attribute by default', () => {
    render(<Button variant="primary">Continue</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-tone');
  });

  it('marks a success-toned button without disturbing its variant or size', () => {
    render(<Button variant="primary" tone="success" size="lg">Finish</Button>);
    const button = screen.getByRole('button', { name: 'Finish' });
    expect(button).toHaveAttribute('data-tone', 'success');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'lg');
  });

  it('rejects an unsupported tone rather than rendering an unstyled button', () => {
    expect(() => render(<Button tone="chartreuse">Finish</Button>))
      .toThrow(/Unsupported Button tone: chartreuse/);
  });

  it('still exposes loading state when toned', () => {
    render(<Button variant="primary" tone="success" loading>Finish</Button>);
    const button = screen.getByRole('button', { name: 'Finish' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('has no accessibility violations when toned', async () => {
    const { container } = render(<Button variant="primary" tone="success">Finish</Button>);
    expect((await axe(container)).violations).toEqual([]);
  });

  /*
   * Regression guard for the P2 raised in review on PR #114. The green submit
   * treatment was previously applied with a `bg-ds-status-success-fg` utility,
   * which has one class and therefore loses to Button's own two-selector
   * variant rule: the built CSS kept the blue background and blue hover, so a
   * documented "visual exception" was in fact dead code. The tone rule must
   * outrank the variant rule for the capability to mean anything.
   */
  it('defines the success tone at higher specificity than the primary variant', () => {
    const tone = selectorFor('background: var\\(--ds-color-action-success\\)');
    const variant = selectorFor('background: var\\(--ds-color-action-primary\\)');
    expect(classAndAttributeCount(tone)).toBeGreaterThan(classAndAttributeCount(variant));
  });

  it('overrides the variant hover colour too', () => {
    const toneHover = selectorFor('background: var\\(--ds-color-action-success-hover\\)');
    const variantHover = selectorFor('background: var\\(--ds-color-action-primary-hover\\)');
    expect(toneHover).toContain(':hover');
    expect(classAndAttributeCount(toneHover)).toBeGreaterThan(classAndAttributeCount(variantHover));
  });
});
