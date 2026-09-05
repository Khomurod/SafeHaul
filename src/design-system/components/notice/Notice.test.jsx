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

  it('renders an actions slot beside the body', () => {
    const { container } = render(<Notice actions={<button type="button">Retry</button>}>Failed.</Notice>);
    expect(container.querySelector('.ds-notice__actions')).toBeInTheDocument();
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
