import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { FormField, FormSection, Input } from '.';

const field = (
  <FormField id="name" label="Name">
    <Input />
  </FormField>
);
const save = <button type="button">Save changes</button>;

describe('FormSection — card (the default)', () => {
  it('is the card itself, named by its heading, with the header as its first row', () => {
    const { container } = render(
      <FormSection title="Profile details" description="Update your information." footer={save}>
        {field}
      </FormSection>,
    );

    const region = screen.getByRole('region', { name: 'Profile details' });
    expect(region).toBe(container.firstChild);
    expect(region).toHaveClass('ds-card', 'ds-form-section', 'ds-form-section__card');
    // The card pads nothing itself, so both dividers can run edge to edge.
    expect(region).toHaveAttribute('data-padding', 'none');
    expect(region).toHaveAttribute('data-inset', 'md');
    expect(region).not.toHaveAttribute('data-layout');
    // The inset header is the default: nothing marks it.
    expect(region).not.toHaveAttribute('data-header');

    const [header, body, footer] = region.children;
    expect(header.tagName).toBe('HEADER');
    expect(within(header).getByRole('heading', { level: 2, name: 'Profile details' })).toBeInTheDocument();
    expect(body).toHaveClass('ds-form-section__body');
    expect(within(body).getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(footer).toHaveClass('ds-form-section__footer');
    expect(within(footer).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('draws no footer, and no header, when it has neither', () => {
    const { container } = render(<FormSection aria-label="Unnamed group">{field}</FormSection>);
    expect(container.querySelector('.ds-form-section__footer')).toBeNull();
    expect(container.querySelector('.ds-form-section__header')).toBeNull();
    expect(screen.getByRole('region', { name: 'Unnamed group' })).toBeInTheDocument();
  });

  it('renders the element it is asked to', () => {
    const { container } = render(<FormSection as="div" title="Details">{field}</FormSection>);
    expect(container.firstChild.tagName).toBe('DIV');
  });

  it('marks a header="bleed" card, and keeps its rows', () => {
    render(
      <FormSection title="Lead details" description="Who to call." header="bleed" footer={save}>
        {field}
      </FormSection>,
    );
    const region = screen.getByRole('region', { name: 'Lead details' });
    expect(region).toHaveAttribute('data-header', 'bleed');
    expect([...region.children].map((child) => child.className)).toEqual([
      'ds-form-section__header',
      'ds-form-section__body',
      'ds-form-section__footer',
    ]);
  });
});

describe('FormSection — stacked', () => {
  it('puts the heading above a full-width card holding the body and the footer', () => {
    const { container } = render(
      <FormSection
        layout="stacked"
        title="Contact"
        description="How people reach you."
        actions={<button type="button">Edit</button>}
        footer={save}
      >
        {field}
      </FormSection>,
    );

    const region = screen.getByRole('region', { name: 'Contact' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('data-layout', 'stacked');
    expect(region).not.toHaveClass('ds-card');

    const [header, card] = region.children;
    expect(header.tagName).toBe('HEADER');
    expect(header).toHaveTextContent('How people reach you.');
    expect(within(header).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(card).toHaveClass('ds-card', 'ds-form-section__card');
    expect(card.tagName).toBe('DIV');
    expect([...card.children].map((child) => child.className)).toEqual([
      'ds-form-section__body',
      'ds-form-section__footer',
    ]);
    expect(container.querySelectorAll('.ds-card')).toHaveLength(1);
  });

  it('makes a flush body with padding="none", and keeps the footer its inset', () => {
    const { container } = render(
      <FormSection layout="stacked" title="Rows" padding="none" footer={save}>
        <p>A table goes here.</p>
      </FormSection>,
    );
    expect(container.firstChild).toHaveAttribute('data-inset', 'none');
    expect(container.querySelector('.ds-form-section__footer')).toBeInTheDocument();
  });
});

describe('FormSection — aside', () => {
  it('puts the heading, description and actions in a side column beside the card', () => {
    render(
      <FormSection
        layout="aside"
        title="Outgoing mail"
        description="The server your messages leave from."
        actions={<p role="status">Not connected</p>}
      >
        {field}
      </FormSection>,
    );

    const region = screen.getByRole('region', { name: 'Outgoing mail' });
    expect(region).toHaveAttribute('data-layout', 'aside');
    const columns = region.firstElementChild;
    expect(columns).toHaveClass('ds-form-section__columns');

    const [aside, card] = columns.children;
    expect(aside).toHaveClass('ds-form-section__aside');
    // The actions follow the description in the side column.
    expect(aside.lastElementChild).toHaveClass('ds-form-section__actions');
    expect(within(aside).getByRole('status')).toHaveTextContent('Not connected');
    expect(card).toHaveClass('ds-form-section__card');
    expect(within(card).getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  });
});

describe('FormSection contract', () => {
  it.each([
    ['layout', 'columns', /Unsupported FormSection layout: columns/],
    ['padding', 'xl', /Unsupported FormSection padding: xl/],
    ['header', 'full', /Unsupported FormSection header: full/],
  ])('refuses an unsupported %s', (prop, value, message) => {
    expect(() => render(<FormSection title="X" {...{ [prop]: value }}>{field}</FormSection>)).toThrow(message);
  });

  it('still requires a title or an aria-label', () => {
    expect(() => render(<FormSection>{field}</FormSection>)).toThrow(/requires a title or aria-label/);
  });

  it.each(['stacked', 'aside'])('refuses a %s section with no visible title', (layout) => {
    expect(() => render(<FormSection layout={layout} aria-label="Hidden">{field}</FormSection>))
      .toThrow(new RegExp(`A ${layout} FormSection needs a visible title`));
  });

  it.each(['stacked', 'aside'])('refuses header="bleed" on a %s section, which has no header divider', (layout) => {
    expect(() => render(<FormSection layout={layout} title="Outside" header="bleed">{field}</FormSection>))
      .toThrow(/shapes a card section/);
  });

  it('has no structural accessibility violations in any layout', async () => {
    const { container } = render(
      <>
        <FormSection title="One" description="First." footer={save}>{field}</FormSection>
        <FormSection layout="stacked" title="Two" description="Second.">
          <FormField id="two" label="Two field"><Input /></FormField>
        </FormSection>
        <FormSection layout="aside" title="Three" description="Third.">
          <FormField id="three" label="Three field"><Input /></FormField>
        </FormSection>
      </>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

/* jsdom lays nothing out, so the rules that make the layouts are what is pinned. */
describe('FormSection stylesheet', () => {
  const css = readFileSync(path.join(__dirname, 'FormSection.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('stacks an aside section by its own width, under 760px, not by the viewport', () => {
    // `width: 100%` because inline-size containment would collapse it to 0 in a shrink-to-fit parent.
    expect(css).toMatch(/\.ds-form-section\[data-layout='aside'\]\s*\{\s*width:\s*100%;\s*container:\s*ds-form-section \/ inline-size/);
    expect(css).toMatch(/@container ds-form-section \(max-width: 759px\)\s*\{\s*\.ds-form-section__columns\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/grid-template-columns:\s*232px minmax\(0, 1fr\)/);
  });

  it('runs the footer divider edge to edge and right-aligns its actions', () => {
    const footer = css.slice(css.indexOf('.ds-form-section__footer {'));
    expect(footer).toMatch(/justify-content:\s*flex-end/);
    expect(footer).toMatch(/border-top:\s*1px solid var\(--ds-color-border-subtle\)/);
    expect(footer).toMatch(/padding:\s*var\(--ds-space-4\) var\(--ds-form-section-inset\)/);
  });

  it('gives each footer action an equal share of a phone row', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.ds-form-section__footer > \*\s*\{[^}]*flex:\s*1 1 0/);
  });

  it('keeps the default card header as it was: an inset divider and a 13px description', () => {
    const root = css.slice(css.indexOf('.ds-form-section {'));
    expect(root).toMatch(/--ds-form-section-description-size:\s*var\(--ds-font-size-sm\)/);
    expect(root).toMatch(/--ds-form-section-description-measure:\s*none/);
    expect(css).toMatch(
      /\.ds-form-section__card > \.ds-form-section__header\s*\{\s*margin:\s*var\(--ds-form-section-inset\) var\(--ds-form-section-inset\) 0;\s*padding-bottom:\s*var\(--ds-space-4\);\s*border-bottom:\s*1px solid var\(--ds-color-border-subtle\)/,
    );
  });

  it('runs a header="bleed" divider edge to edge', () => {
    expect(css).toMatch(
      /\.ds-form-section\[data-header='bleed'\] > \.ds-form-section__header\s*\{\s*margin:\s*0;\s*padding:\s*var\(--ds-form-section-inset\) var\(--ds-form-section-inset\) var\(--ds-space-4\)/,
    );
  });

  it('gives the C2 shapes a 14px description, a readable measure and a pretty wrap', () => {
    const c2 = css.match(
      /\.ds-form-section:is\(\[data-header='bleed'\], \[data-layout='stacked'\], \[data-layout='aside'\]\)\s*\{([^}]*)\}/,
    );
    expect(c2?.[1]).toMatch(/--ds-form-section-description-size:\s*var\(--ds-font-size-body\)/);
    expect(c2?.[1]).toMatch(/--ds-form-section-description-measure:\s*80ch/);
    expect(c2?.[1]).toMatch(/--ds-form-section-description-wrap:\s*pretty/);
    const description = css.slice(css.indexOf('.ds-form-section__description {'));
    expect(description).toMatch(/font-size:\s*var\(--ds-form-section-description-size\)/);
    expect(description).toMatch(/max-width:\s*var\(--ds-form-section-description-measure\)/);
    expect(description).toMatch(/text-wrap:\s*var\(--ds-form-section-description-wrap\)/);
  });
});
