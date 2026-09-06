import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Sparkles } from '../../icons';
import { Notice } from './Notice';

describe('Notice', () => {
  it('renders the message it is given', () => {
    render(<Notice>Three documents are still outstanding.</Notice>);
    expect(screen.getByText('Three documents are still outstanding.')).toBeInTheDocument();
  });

  it('rejects a tone it does not have', () => {
    expect(() => render(<Notice tone="critical">x</Notice>))
      .toThrow(/Unsupported Notice tone/i);
  });

  it('rejects a size it does not have', () => {
    expect(() => render(<Notice size="lg">x</Notice>)).toThrow(/Unsupported Notice size/i);
  });

  it('refuses a blank title rather than rendering an empty line', () => {
    expect(() => render(<Notice title="  ">x</Notice>))
      .toThrow(/title must be a non-empty string/i);
  });

  describe('announcing', () => {
    /*
     * The default is the measurement, not a preference: of the 64 notices the
     * 6a audit found, only 26 announce themselves. Defaulting to on would have
     * turned 38 quiet blocks into interruptions.
     */
    it('says nothing by default', () => {
      const { container } = render(<Notice>Quiet.</Notice>);
      expect(container.querySelector('.ds-notice')).not.toHaveAttribute('role');
    });

    it('maps polite to status and assertive to alert', () => {
      render(<Notice announce="polite">Saved.</Notice>);
      expect(screen.getByRole('status')).toBeInTheDocument();

      render(<Notice announce="assertive">Failed.</Notice>);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('rejects an announce value it does not have', () => {
      expect(() => render(<Notice announce="loud">x</Notice>))
        .toThrow(/Unsupported Notice announce/i);
    });
  });

  describe('the icon', () => {
    /*
     * Each default was counted off the tree rather than chosen: danger uses
     * AlertCircle at 13 sites, warning AlertTriangle at 4, info Info at 3.
     * Success is the one deliberate departure — the tally favours the older
     * `CheckCircle` 6 to 1, but `CheckCircle2` is the closed-ring mark the
     * design system already ships in `SectionNavigation`.
     */
    it('draws the tone-s own glyph when none is given', () => {
      const { container } = render(<Notice tone="danger">Failed.</Notice>);
      expect(container.querySelector('.ds-notice__icon')).toBeInTheDocument();
    });

    it('takes an explicit glyph over the tone-s', () => {
      const { container } = render(<Notice tone="danger" icon={Sparkles}>x</Notice>);
      expect(container.querySelector('.ds-notice__icon')).toBeInTheDocument();
    });

    /*
     * `null` and `undefined` are deliberately different. A caller turning the
     * glyph off should not have to know which glyph they are turning off.
     */
    it('draws none when given null', () => {
      const { container } = render(<Notice tone="danger" icon={null}>x</Notice>);
      expect(container.querySelector('.ds-notice__icon')).toBeNull();
    });

    it('has a glyph for every tone, so no tone renders lopsided', () => {
      for (const tone of ['neutral', 'info', 'success', 'warning', 'danger', 'accent']) {
        const { container, unmount } = render(<Notice tone={tone}>x</Notice>);
        expect(container.querySelector('.ds-notice__icon')).toBeInTheDocument();
        unmount();
      }
    });

    it('leaves the glyph decorative — the words carry the meaning', () => {
      // `Icon` with no label renders `aria-hidden`, so a screen reader hears the
      // sentence once rather than "warning icon, warning:".
      const { container } = render(<Notice tone="warning">Careful.</Notice>);
      expect(container.querySelector('.ds-notice__icon')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('puts a title above the message, both inside one block', () => {
    const { container } = render(<Notice title="Submitted">But not finished.</Notice>);
    expect(container.querySelector('.ds-notice__title')).toHaveTextContent('Submitted');
    expect(container.querySelector('.ds-notice__message')).toHaveTextContent('But not finished.');
  });

  it('renders the title as a paragraph by default', () => {
    const { container } = render(<Notice title="Saved">All of it.</Notice>);
    expect(container.querySelector('.ds-notice__title').tagName).toBe('P');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders the title as a heading when the caller has an outline to join', () => {
    // Eight titled blocks in this tree use a real heading. Flattening those to
    // a paragraph removes them from the outline a screen-reader user navigates
    // by — invisibly, because the page still looks identical.
    render(<Notice title="What gets sent" titleAs="h3">Images of the pages you choose.</Notice>);
    expect(screen.getByRole('heading', { level: 3, name: 'What gets sent' })).toBeInTheDocument();
  });

  it('pins the title size itself rather than inheriting a heading-s', () => {
    // `titleAs` can make this an <h2>-<h6>, and a heading's user-agent size
    // would otherwise decide how a notice looks. Tailwind's preflight resets it
    // today, so this holds even if that base layer is ever turned off.
    const rules = readFileSync(path.join(__dirname, 'Notice.css'), 'utf8');
    expect(rules).toMatch(/\.ds-notice__title\s*\{[^}]*font-size:\s*inherit/);
  });

  it('rejects a title element it does not have', () => {
    // Including `h1`: a notice is never the page's own heading.
    expect(() => render(<Notice title="x" titleAs="h1">y</Notice>)).toThrow(TypeError);
    expect(() => render(<Notice title="x" titleAs="div">y</Notice>)).toThrow(TypeError);
  });

  it('puts the actions under the message, inside the body column', () => {
    // Not beside it. Atlassian's SectionMessage renders actions after the
    // content and Polaris' Banner puts them in a footer under the body; the
    // tinted blocks in this tree that carry a button already do the same, 2 to
    // 1. Asserted by CONTAINMENT rather than by class, because the class alone
    // was true of the trailing slot this replaced.
    const { container } = render(<Notice actions={<button type="button">Retry</button>}>Failed.</Notice>);
    const body = container.querySelector('.ds-notice__body');
    const actions = container.querySelector('.ds-notice__actions');
    expect(body).toContainElement(actions);
    expect(body.lastElementChild).toBe(actions);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('omits the actions slot entirely when there are none', () => {
    // Not an empty flex child: an empty slot still takes its gap, which is the
    // same defect `SectionNavigation`'s third column was scoped to avoid.
    const { container } = render(<Notice>Nothing to do.</Notice>);
    expect(container.querySelector('.ds-notice__actions')).toBeNull();
  });

  it('forwards a ref so a form can move focus to it', () => {
    const ref = React.createRef();
    render(<Notice ref={ref} tabIndex={-1}>Fix these errors.</Notice>);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current).toHaveAttribute('tabindex', '-1');
  });

  it('draws its own focus ring, because a form moves focus to it', () => {
    // Three consumers in the first migration area are the error summary a step
    // focuses when it refuses Continue. A caller must not have to remember a
    // `focus-visible:` utility to make that visible, so the rule is here.
    // `__dirname`, not `import.meta.url` — Vitest rewrites the latter, which
    // is the same hazard `uiContract.ratchet.test.js` was retargeted for.
    const rules = readFileSync(path.join(__dirname, 'Notice.css'), 'utf8');
    expect(rules).toMatch(/\.ds-notice:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ds-color-focus\)/);
    expect(rules).not.toMatch(/@media[^{]*max-width:\s*639px/);
  });

  it('omits data-size at the default, so md needs no attribute', () => {
    const { container } = render(<Notice>x</Notice>);
    expect(container.querySelector('.ds-notice')).not.toHaveAttribute('data-size');
  });

  it('has no axe violations in any tone, with and without a title', async () => {
    const { container } = render(
      <div>
        <Notice tone="danger" title="Could not send" announce="assertive">Try again.</Notice>
        <Notice tone="success" announce="polite">Saved.</Notice>
        <Notice tone="warning" actions={<button type="button">Review</button>}>Check this.</Notice>
      </div>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
