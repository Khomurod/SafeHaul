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

/**
 * The WEAKEST selector in a comma-separated group, which is the one that decides
 * whether a rule can lose. Counting the group as one string is what
 * `classAndAttributeCount` does, and a mutation proved that hides the answer: a
 * pressed rule weakened to a single `.ds-button[data-pressed]` still summed to
 * four across its two-selector group and passed a test asserting it outranked a
 * two-selector variant rule. Reproduced before this existed.
 */
function weakestInGroup(selectorGroup) {
  return Math.min(...selectorGroup.split(',').map((one) => classAndAttributeCount(one)));
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
   * The status tints, and the reason they are a SECOND meaning of `tone` rather
   * than a widening of the first. Eleven controls were drawing this trio by
   * hand — the envelope field palette and the sandbox Magic Fill — because
   * `Button` had no way to say "this action means warning".
   */
  it.each(['neutral', 'info', 'success', 'warning', 'danger', 'accent'])(
    'carries the %s status tint on a secondary button',
    (tone) => {
      render(<Button variant="secondary" tone={tone}>Act</Button>);
      const button = screen.getByRole('button', { name: 'Act' });
      expect(button).toHaveAttribute('data-tone', tone);
      expect(button).toHaveAttribute('data-variant', 'secondary');
    },
  );

  it.each(['neutral', 'info', 'warning', 'danger', 'accent'])(
    'carries the %s status tint on a ghost button too',
    (tone) => {
      render(<Button variant="ghost" tone={tone}>Act</Button>);
      expect(screen.getByRole('button', { name: 'Act' })).toHaveAttribute('data-tone', tone);
    },
  );

  /*
   * The two refusals. Both are checked in JS rather than left to CSS so the
   * failure names the call site: a pairing CSS simply has no rule for renders
   * as an untoned button, which looks deliberate and is not.
   */
  it('refuses any tone but success on a primary, and says why', () => {
    expect(() => render(<Button variant="primary" tone="warning">Act</Button>))
      .toThrow(/cannot carry tone="warning"/);
    expect(() => render(<Button variant="primary" tone="warning">Act</Button>))
      .toThrow(/strongest emphasis/);
  });

  it('refuses a tone on a danger button, which is already one', () => {
    expect(() => render(<Button variant="danger" tone="warning">Act</Button>))
      .toThrow(/already a tone/);
  });

  it('refuses a tone on a link, which has no box to tint', () => {
    expect(() => render(<Button variant="link" tone="info">Act</Button>))
      .toThrow(/no box to tint/);
  });

  /*
   * The `xs` step: 24px, the WCAG 2.2 SC 2.5.8 minimum, and icon-only. It exists
   * because the corner affordances on a placed PDF field measured 14x14.
   */
  it('gives IconButton a 24px step that a labelled Button cannot reach', () => {
    render(<IconButton label="Remove" size="xs">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('data-size', 'xs');
  });

  it('refuses xs on a labelled button, which cannot fit text at 24px', () => {
    expect(() => render(<Button size="xs">Remove</Button>))
      .toThrow(/Unsupported Button size: xs/);
  });

  it('cuts an icon button square by default and round on request', () => {
    const { rerender } = render(<IconButton label="Remove">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Remove' })).not.toHaveAttribute('data-shape');
    rerender(<IconButton label="Remove" shape="round">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('data-shape', 'round');
  });

  it('refuses a shape it has no rule for', () => {
    expect(() => render(<IconButton label="Remove" shape="pill">x</IconButton>))
      .toThrow(/Unsupported IconButton shape: pill/);
  });

  it('keeps the one pairing that predates the scale', () => {
    // `primary` + `success` is the signing submit, and it fills rather than
    // tints. Twelve live call sites depend on it looking exactly as it did.
    render(<Button variant="primary" tone="success">Finish</Button>);
    expect(screen.getByRole('button', { name: 'Finish' }))
      .toHaveAttribute('data-tone', 'success');
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

/**
 * The design system sizes the icon, not the call site.
 *
 * Before this contract, call sites passed `size={16}`, `size={18}`, `size={20}`,
 * `size={24}` and `className="h-5 w-5"` to the same kind of button, so two
 * adjacent buttons had different-sized glyphs and visibly different internal
 * spacing. The rule works by outranking the width/height *attributes* an icon
 * library renders, and by winning against the `[data-size]` rules that also set
 * the custom property — both of which are specificity facts, so both are pinned
 * here rather than left to a visual review.
 */
describe('Button icon sizing', () => {
  it('sizes the icons it is handed directly from the button icon custom property', () => {
    const selector = selectorFor('width: var\\(--ds-button-icon-size');
    expect(selector).toBe('.ds-button__content > svg');
  });

  it('leaves a deliberately composed nested tile alone', () => {
    // Five call sites pair a larger icon with heading-sized text inside a
    // wrapper (the CDL intake chooser, the upload dropzone, the send-template
    // wizard). A descendant selector would flatten those to a label glyph, so
    // the child combinator is load-bearing rather than stylistic.
    expect(BUTTON_CSS).not.toMatch(/\.ds-button svg\s*\{/);
    expect(BUTTON_CSS).toMatch(/\.ds-button__content > svg\s*\{/);
  });

  it('keeps the glyph from being squeezed by a long label', () => {
    // A shrinking icon is what made a Delete button render as "Dele" on a phone.
    expect(BUTTON_CSS).toMatch(/\.ds-button__content > svg\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it.each(['sm', 'md', 'lg'])('gives the %s size its own icon step', (size) => {
    expect(BUTTON_CSS).toMatch(
      new RegExp(`\\.ds-button\\[data-size='${size}'\\]\\s*\\{[^}]*--ds-button-icon-size`),
    );
  });

  it('lets the icon-only rule outrank the size rule that also sets the property', () => {
    // `.ds-icon-button` alone scores below `.ds-button[data-size='md']`, so the
    // labelled glyph size would win no matter the source order. The repeated
    // `.ds-button` in the selector is what fixes that, and removing it is a
    // silent regression — hence this assertion rather than a comment.
    const iconOnly = classAndAttributeCount('.ds-button.ds-icon-button');
    const sizeRule = classAndAttributeCount(".ds-button[data-size='md']");
    expect(iconOnly).toBeGreaterThanOrEqual(sizeRule);
    expect(BUTTON_CSS).toMatch(/\.ds-button\.ds-icon-button\s*\{[^}]*--ds-button-icon-size/);
  });

  it('renders an icon-only button at the icon-only glyph step', () => {
    render(<IconButton label="Close"><svg /></IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('ds-icon-button');
  });
});

/*
 * `link` is the one variant that leaves the control-height scale, so the rules
 * that keep it honest are pinned here rather than left to review.
 */
describe('Button variant="link"', () => {
  it('is a button, not an anchor — it performs an action', () => {
    render(<Button variant="link">Forgot password?</Button>);
    const action = screen.getByRole('button', { name: 'Forgot password?' });
    expect(action).toHaveAttribute('data-variant', 'link');
    expect(action.tagName).toBe('BUTTON');
  });

  it('opts out of the control height, so it does not push a form row apart', () => {
    expect(BUTTON_CSS).toMatch(/\.ds-button\[data-variant='link'\]\s*\{[^}]*min-height:\s*0/);
    expect(BUTTON_CSS).toMatch(/\.ds-button\[data-variant='link'\]\s*\{[^}]*padding:\s*0/);
  });

  it('carries the underline affordance on hover and on keyboard focus alike', () => {
    // Focus-visible matters more than hover here: with the box gone, the
    // underline is the only thing that says this text is operable.
    const rule = BUTTON_CSS.match(
      /\.ds-button\[data-variant='link'\]:hover:not\(:disabled\),\s*\.ds-button\[data-variant='link'\]:focus-visible\s*\{[^}]*\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/text-decoration:\s*underline/);
  });

  it('stays inline when a caller asks for full width', () => {
    // A full-bleed underline the width of its container reads as a rule, not a link.
    expect(BUTTON_CSS).toMatch(
      /\.ds-button\[data-variant='link'\]\[data-full-width='true'\]\s*\{[^}]*width:\s*auto/,
    );
  });

  it('extends the hit area past the text, without moving the layout box', () => {
    // ~16px of text is under the WCAG 2.5.8 minimum. The pseudo-element takes
    // the pointer region to ~26px while `position: absolute` keeps the button's
    // own box — and therefore the surrounding text — exactly where it was.
    expect(BUTTON_CSS).toMatch(/\.ds-button\[data-variant='link'\]\s*\{[^}]*position:\s*relative/);
    const hitArea = BUTTON_CSS.match(
      /\.ds-button\[data-variant='link'\]::after\s*\{[^}]*\}/,
    );
    expect(hitArea).not.toBeNull();
    expect(hitArea[0]).toMatch(/position:\s*absolute/);
    expect(hitArea[0]).toMatch(/inset-block:\s*-\d/);
    // Vertical only: a sideways expansion would overlap the next inline link.
    expect(hitArea[0]).toMatch(/inset-inline:\s*0/);
  });

  it('refuses to be an icon-only button, which would drop under the target size', () => {
    expect(() => render(<IconButton label="Close" variant="link"><svg /></IconButton>))
      .toThrow(/cannot use variant="link"/);
  });
});

describe('Button pressed', () => {
  it('says nothing about pressing unless asked', () => {
    render(<Button>Filter</Button>);
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).not.toHaveAttribute('data-pressed');
  });

  it('reports both states and marks only the pressed one for CSS', () => {
    const { rerender } = render(<Button pressed={false}>Filter</Button>);
    const off = screen.getByRole('button', { name: 'Filter' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off).not.toHaveAttribute('data-pressed');

    rerender(<Button pressed>Filter</Button>);
    const on = screen.getByRole('button', { name: 'Filter' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveAttribute('data-pressed', 'true');
  });

  /*
   * Nineteen call sites already pass `aria-pressed` straight through and draw
   * the state with a variant swap. `aria-pressed` sits AFTER the prop spread in
   * the element, so writing it as a conditional expression would overwrite
   * every one of those with `undefined` and delete the attribute. Reproduced
   * before the destructure was added; this is the guard.
   */
  it('does not eat an aria-pressed passed straight through', () => {
    render(<Button aria-pressed variant="primary">SMS</Button>);
    expect(screen.getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reaches an icon-only toggle at the compact step', () => {
    render(<IconButton label="Sort by earliest" variant="ghost" size="xs" pressed><svg /></IconButton>);
    const button = screen.getByRole('button', { name: 'Sort by earliest' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-size', 'xs');
  });

  /*
   * The whole reason the prop exists. P-2 recorded that the candidate list's
   * sort toggles could not migrate because their pressed colour was a
   * `text-ds-action-primary` utility at one class, losing to the variant rule
   * at two. The contract's own pressed rule has to outrank the variant rule or
   * it repeats the defect it was built to fix.
   */
  it('defines pressed at higher specificity than the variant it sits on', () => {
    const pressed = selectorFor('color: var\\(--ds-color-action-primary\\);\\s*box-shadow');
    const variant = selectorFor('background: var\\(--ds-color-action-primary\\)');
    expect(pressed).toContain('[data-pressed]');
    expect(weakestInGroup(pressed)).toBeGreaterThan(weakestInGroup(variant));
  });

  /*
   * Colour is the signal that disappears in forced-colours mode, so the fill is
   * never the whole story: an inset ring is drawn with it. The old hand-rolled
   * toggles marked the active sort with colour alone.
   */
  it('draws a ring as well as a fill, on every variant', () => {
    const rings = BUTTON_CSS.match(/\[data-pressed\][^{]*\{[^}]*box-shadow:\s*inset/g) || [];
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });

  /*
   * `.ds-button:focus-visible` sets `box-shadow` at two selectors, so every
   * pressed rule above outranks it and would have silently deleted the focus
   * ring — the same class of loss the pressed rule exists to prevent. The two
   * shadows are composed rather than chosen between.
   */
  it('keeps the focus ring on a pressed control', () => {
    const focused = BUTTON_CSS.match(
      /\[data-pressed\]:focus-visible[^{]*\{[^}]*box-shadow:[^;]*;/g,
    ) || [];
    expect(focused.length).toBeGreaterThanOrEqual(2);
    for (const rule of focused) {
      expect(rule).toContain('var(--ds-focus-ring)');
      expect(rule).toContain('inset');
    }
  });
});
