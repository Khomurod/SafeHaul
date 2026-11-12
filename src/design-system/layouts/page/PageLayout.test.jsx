import React, { createRef } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageContainer, PageEyebrow, PageHeader, ResponsiveGrid, Stack } from './PageLayout';
import { PageEyebrow as PublicPageEyebrow } from '..';

describe('page layouts', () => {
  it('provides a single page heading and responsive composition contract', async () => {
    const { container } = render(
      <PageContainer>
        <Stack>
          <PageHeader title="Overview" description="Current activity" />
          <ResponsiveGrid><div>One</div><div>Two</div></ResponsiveGrid>
        </Stack>
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('spaces whole sections 32px apart with gap="xl"', () => {
    const { container } = render(<Stack gap="xl"><div>One</div><div>Two</div></Stack>);
    expect(container.firstChild).toHaveAttribute('data-gap', 'xl');
    const css = readFileSync(path.join(__dirname, 'PageLayout.css'), 'utf8');
    expect(css).toMatch(/\.ds-stack\[data-gap='xl'\],\s*\.ds-inline\[data-gap='xl'\]\s*\{\s*gap:\s*var\(--ds-space-8\);/);
  });

  describe('PageHeader count', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sits beside the heading, outside it, and is read with its word', () => {
      render(<PageHeader title="Applications" count={8} countLabel="applications" />);

      expect(screen.getByRole('heading', { level: 1, name: 'Applications' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/^8 applications$/);
    });

    it('groups a large number the way the rest of the app writes it', () => {
      render(<PageHeader title="Leads" count={12345} countLabel="leads" />);

      expect(screen.getByRole('status')).toHaveTextContent(/^12,345 leads$/);
    });

    it('shows zero, an empty list being a real answer', () => {
      render(<PageHeader title="Leads" count={0} countLabel="leads" />);

      expect(screen.getByRole('status')).toHaveTextContent(/^0 leads$/);
    });

    it('keeps an empty status region while the number is unknown, so the first one is announced', () => {
      const { rerender } = render(<PageHeader title="Leads" countLabel="leads" />);
      const region = screen.getByRole('status');
      expect(region).toBeEmptyDOMElement();

      rerender(<PageHeader title="Leads" count={8} countLabel="leads" />);

      // The same element: a region inserted with its content is often not read.
      expect(screen.getByRole('status')).toBe(region);
      expect(region).toHaveTextContent(/^8 leads$/);
    });

    it('draws a plain heading when the page shows no count at all', () => {
      render(<PageHeader title="Settings" />);

      expect(screen.queryByRole('status')).toBeNull();
    });

    it.each([[-1], [2.5], ['8'], [Number.NaN]])('refuses %p as a count', (count) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" count={count} countLabel="leads" />))
        .toThrow('PageHeader count must be a whole number of records');
    });

    it('refuses a count with no word to read after it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" count={3} />))
        .toThrow('PageHeader count needs a countLabel');
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <PageHeader title="Applications" count={8} countLabel="applications" actions={<button type="button">Export</button>} />,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  });

  describe('PageHeader level', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('is a second-level heading under a masthead that holds the page\'s h1, drawn the same', () => {
      render(<PageHeader level={2} title="Blog Posts" count={3} countLabel="articles" />);

      const heading = screen.getByRole('heading', { level: 2, name: 'Blog Posts' });
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(heading).toHaveClass('ds-page-header__heading');
      expect(screen.getByRole('heading', { level: 2 })).toBe(heading);
      expect(screen.getByRole('status')).toHaveTextContent(/^3 articles$/);
    });

    it('hands its heading to a page that moves focus to it', () => {
      const ref = createRef();
      render(<PageHeader level={2} title="Blog Posts" headingRef={ref} />);

      expect(ref.current).toBe(screen.getByRole('heading', { level: 2, name: 'Blog Posts' }));
      ref.current.focus();
      expect(ref.current).toHaveFocus();
    });

    it('is not focusable without a headingRef', () => {
      render(<PageHeader title="Settings" />);

      expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('tabindex');
    });

    it.each([[3], [0], ['2']])('refuses %p as a level', (level) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" level={level} />))
        .toThrow('PageHeader level must be 1 or 2');
    });
  });
});

/** `a` comes before `b` in the document. */
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('PageHeader eyebrow and back link', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('draws the eyebrow above the heading, outside it', () => {
    render(<PageHeader eyebrow="Records and owners" title="Records" />);
    const heading = screen.getByRole('heading', { level: 1 });
    const eyebrow = screen.getByText('Records and owners');

    expect(heading).toHaveAccessibleName('Records');
    expect(precedes(eyebrow, heading)).toBe(true);
    expect(eyebrow.closest('.ds-page-eyebrow')).not.toBeNull();
  });

  it('draws the back link as a link, first, with a rule between it and the eyebrow', () => {
    const { container } = render(
      <PageHeader back={{ label: 'Records', href: '/records' }} eyebrow="Workspace" title="New record" />,
    );
    const link = screen.getByRole('link', { name: 'Records' });

    expect(link).toHaveAttribute('href', '/records');
    expect(link).toHaveClass('ds-link', 'ds-page-eyebrow__back');
    expect(precedes(link, screen.getByRole('heading', { level: 1 }))).toBe(true);
    const rule = container.querySelector('.ds-page-eyebrow__separator');
    expect(rule).toHaveAttribute('aria-hidden', 'true');
    expect(precedes(link, rule) && precedes(rule, screen.getByText('Workspace'))).toBe(true);
  });

  it('draws no rule with only one of the two, and no row with neither', () => {
    const { container, rerender } = render(<PageHeader back={{ label: 'Records', href: '/records' }} title="New record" />);
    expect(container.querySelector('.ds-page-eyebrow__separator')).toBeNull();

    rerender(<PageHeader eyebrow="Workspace" title="New record" />);
    expect(container.querySelector('.ds-page-eyebrow__separator')).toBeNull();

    rerender(<PageHeader title="New record" eyebrow={null} back={false} />);
    expect(container.querySelector('.ds-page-eyebrow')).toBeNull();
  });

  it('hands the click to a page that routes in script', () => {
    const onClick = vi.fn((event) => event.preventDefault());
    render(<PageHeader back={{ label: 'Records', href: '/records', onClick }} title="New record" />);

    fireEvent.click(screen.getByRole('link', { name: 'Records' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([[''], ['   '], [7], [{ text: 'Workspace' }]])('refuses %p as an eyebrow', (eyebrow) => {
    expect(() => render(<PageHeader eyebrow={eyebrow} title="Records" />))
      .toThrow('PageHeader eyebrow must be a non-empty string');
  });

  it.each([
    [{ href: '/records' }, 'back needs a label'],
    [{ label: ' ', href: '/records' }, 'back needs a label'],
    [{ label: 'Records' }, 'back needs an href'],
    [{ label: 'Records', onClick: () => {} }, 'back needs an href'],
    ['/records', 'back needs a label'],
    [{ label: 'Records', href: '/records', onClick: 'go' }, 'back onClick must be a function'],
  ])('refuses %p as a back link', (back, message) => {
    expect(() => render(<PageHeader back={back} title="Records" />)).toThrow(`PageHeader ${message}`);
  });

  it('leaves out what it cannot draw in a production build, and draws the rest', () => {
    vi.stubEnv('PROD', true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PageHeader
        eyebrow={12}
        back={{ label: 'Records' }}
        title="Records"
        description="Everything held."
        actions={<button type="button">Export</button>}
        mobileActions="floating"
      />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('12')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).not.toHaveAttribute('data-mobile-actions');
    expect(consoleError).toHaveBeenCalledTimes(3);
  });

  it('has no accessibility violations with every part present', async () => {
    const { container } = render(
      <PageHeader
        back={{ label: 'Records', href: '/records' }}
        eyebrow="Workspace"
        title="New record"
        count={3}
        countLabel="records"
        description="Fill in what you know."
        actions={<button type="button">Save</button>}
        mobileActions="sticky"
      />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('PageEyebrow, drawn once by a frame', () => {
  it('is exported beside PageHeader', () => {
    expect(PublicPageEyebrow).toBe(PageEyebrow);
  });

  it('draws the same row on its own', () => {
    render(<PageEyebrow eyebrow="Settings" back={{ label: 'Settings home', href: '/settings' }} />);
    expect(screen.getByRole('link', { name: 'Settings home' })).toHaveAttribute('href', '/settings');
    expect(screen.getByText('Settings')).toHaveClass('ds-page-eyebrow__text');
  });

  it('draws nothing with nothing to say', () => {
    const { container } = render(<PageEyebrow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names itself in what it refuses', () => {
    expect(() => render(<PageEyebrow back={{ label: 'Settings' }} />)).toThrow('PageEyebrow back needs an href');
  });
});

describe('PageHeader order and phone actions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /*
   * The actions sit on the title's row on a wide screen and after the
   * description on a phone, but the DOM never moves: title, description,
   * actions — so reading order and Tab order are the same at every width.
   */
  it('keeps the DOM order title, description, actions', () => {
    render(
      <PageHeader
        eyebrow="Workspace"
        title="Records"
        description="Everything held."
        actions={<button type="button">New record</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    const description = screen.getByText('Everything held.');
    const action = screen.getByRole('button', { name: 'New record' });

    expect(precedes(heading, description)).toBe(true);
    expect(precedes(description, action)).toBe(true);
    expect(description).toHaveClass('ds-page-header__description');
  });

  it('marks a sticky phone bar only when there are actions to pin', () => {
    const { rerender } = render(
      <PageHeader title="New record" mobileActions="sticky" actions={<button type="button">Save</button>} />,
    );
    expect(screen.getByRole('banner')).toHaveAttribute('data-mobile-actions', 'sticky');

    rerender(<PageHeader title="New record" mobileActions="sticky" />);
    expect(screen.getByRole('banner')).not.toHaveAttribute('data-mobile-actions');

    rerender(<PageHeader title="New record" actions={<button type="button">Save</button>} />);
    expect(screen.getByRole('banner')).not.toHaveAttribute('data-mobile-actions');
  });

  it.each([['bar'], [true], ['Sticky']])('refuses %p as mobileActions', (mobileActions) => {
    expect(() => render(<PageHeader title="Records" mobileActions={mobileActions} />))
      .toThrow("PageHeader mobileActions must be 'row' or 'sticky'");
  });

  it('marks a second-level header so its title keeps the smaller step', () => {
    const { rerender } = render(<PageHeader level={2} title="Records" />);
    expect(screen.getByRole('heading', { level: 2 }).closest('header')).toHaveAttribute('data-level', '2');

    rerender(<PageHeader title="Records" />);
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toHaveAttribute('data-level');
  });
});

/*
 * jsdom has no layout engine, so these assert the declarations; the catalog
 * baselines and the visual contract measure the result.
 */
describe('PageLayout CSS', () => {
  const css = readFileSync(path.join(__dirname, 'PageLayout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selector, from = css) => {
    const start = from.indexOf(`${selector} {`);
    expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
    return from.slice(start, from.indexOf('}', start));
  };
  const phone = css.slice(css.indexOf('@media (max-width: 767px)'));

  it('makes the standard canvas 1200px of content with the gutters added', () => {
    expect(block(".ds-page-container[data-width='standard']"))
      .toMatch(/max-width:\s*calc\(var\(--ds-page-content-width\) \+ 2 \* var\(--ds-page-gutter\)\)/);
    expect(block('.ds-page-container')).toMatch(/padding:\s*var\(--ds-space-8\) var\(--ds-page-gutter\) var\(--ds-space-12\)/);
    expect(block('.ds-page-container', phone))
      .toMatch(/padding:\s*var\(--ds-space-5\) var\(--ds-page-gutter-mobile\) var\(--ds-space-10\)/);
  });

  it('sets the title at the display step, 24px on a phone and under a masthead', () => {
    expect(block('.ds-page-header')).toContain('--ds-page-header-title-size: var(--ds-font-size-heading-2xl)');
    expect(block(".ds-page-header[data-level='2']")).toContain('var(--ds-font-size-heading-xl)');
    expect(block('.ds-page-header', phone)).toContain('--ds-page-header-title-size: var(--ds-font-size-heading-xl)');
    const heading = block('.ds-page-header__heading');
    expect(heading).toContain('font-size: var(--ds-page-header-title-size)');
    expect(heading).toContain('text-wrap: balance');
  });

  it('wraps the actions to a line of their own, at the right, before a label breaks or the title is squeezed', () => {
    // A 20rem title floor beside the actions broke 'Save Changes' onto two
    // lines inside its button and pushed the header past a 432px tablet column;
    // a lower floor squeezed a long title into four lines. Wrapping lines do
    // neither: the actions keep their labels whole and move under the title.
    const header = block('.ds-page-header');
    expect(header).toContain('display: flex');
    expect(header).toContain('flex-wrap: wrap');
    expect(block('.ds-page-header__title')).toContain('flex: 1 1 auto');
    const actions = block('.ds-page-header__actions');
    expect(actions).toContain('flex: none');
    expect(actions).toContain('margin-inline-start: auto');
    expect(actions).toContain('max-width: 100%');
    expect(actions).toContain('flex-wrap: wrap');
    expect(block('.ds-page-header__actions > *')).toContain('white-space: nowrap');
    // Reading and Tab order stay the DOM's: title, description, actions.
    expect(block('.ds-page-header__title')).toContain('order: 1');
    expect(actions).toContain('order: 2');
    expect(block('.ds-page-header__description')).toContain('order: 3');
  });

  it('keeps the description on a line of its own, to a readable measure', () => {
    const description = block('.ds-page-header__description');
    expect(description).toContain('flex-basis: 100%');
    // A max-width would let a wrapping line set it beside the title.
    expect(description).not.toContain('max-width');
    expect(description).toContain('padding-inline-end: max(0px, 100% - 68ch)');
    expect(description).toContain('text-wrap: pretty');
  });

  it('lays a phone header out in DOM order, one column', () => {
    const header = block('.ds-page-header', phone);
    expect(header).toContain('display: grid');
    expect(header).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(block('.ds-page-header > *', phone)).toContain('order: 0');
  });

  it('pins the sticky bar on the page-content layer, clear of the safe area, and pads the page for it', () => {
    const bar = block(".ds-page-header[data-mobile-actions='sticky'] .ds-page-header__actions", phone);
    expect(bar).toContain('position: fixed');
    expect(bar).toContain('z-index: var(--ds-z-raised)');
    expect(bar).toContain('env(safe-area-inset-bottom, 0px)');
    expect(phone).toMatch(
      /\.ds-page-container:has\(\.ds-page-header\[data-mobile-actions='sticky'\]\)\s*\{\s*padding-bottom:\s*calc\(var\(--ds-page-sticky-bar-height\) \+ var\(--ds-space-10\)\)/,
    );
    // Focus Not Obscured (WCAG 2.2 SC 2.4.11): the scroll container — the
    // document, or the frame's `<main>` however deep the page sits in it — keeps
    // a field that Tab scrolls into view clear of the bar, by the same height
    // the page pads with, not a copy of it.
    const scroller = phone.slice(phone.indexOf(":root:has(.ds-page-header[data-mobile-actions='sticky'])"));
    expect(scroller).toMatch(
      /^:root:has\(\.ds-page-header\[data-mobile-actions='sticky'\]\),\s*main:has\(\.ds-page-header\[data-mobile-actions='sticky'\]\)\s*\{/,
    );
    const scrollerRule = scroller.slice(0, scroller.indexOf('}'));
    expect(scrollerRule).toMatch(/--ds-page-sticky-bar-height:\s*calc\([^;]*var\(--ds-control-height-md\)[^;]*env\(safe-area-inset-bottom, 0px\)/);
    expect(scrollerRule).toContain('scroll-padding-bottom: var(--ds-page-sticky-bar-height)');
    // Only on a phone: above 767px the actions stay on the title row.
    expect(css.slice(0, css.indexOf('@media'))).not.toContain('position: fixed');
  });

  it('gives each phone action an equal share of the row', () => {
    expect(block('.ds-page-header__actions > *', phone)).toContain('flex: 1 1 0');
  });

  it('gives the back link a 44px target on a phone', () => {
    expect(block('.ds-page-eyebrow__back.ds-link', phone)).toContain('min-height: var(--ds-control-height-md)');
  });
});
