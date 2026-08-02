import React from 'react';
import { AlertTriangle, Check, Clock, Info, Star, X } from 'lucide-react';
import { Badge } from '@design-system/components';

/**
 * `Badge` is the approved inline status treatment: a short, toned label that
 * annotates the thing next to it.
 */
const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'Active', tone: 'neutral' },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['neutral', 'info', 'success', 'warning', 'danger', 'accent'],
    },
    icon: { control: false, description: 'Optional decorative icon component.' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Tones, contrast pairings and the icon slot are settled and',
          'the token pairings are pinned by `src/design-system/tests/tokens.test.js`.',
          '',
          '### Intended use',
          '',
          'A short read-only status or category label attached to a record: a state, a',
          'count qualifier, a plan tier. One or two words.',
          '',
          '### Supported variants',
          '',
          '`neutral` (default), `info`, `success`, `warning`, `danger`, `accent`. An',
          'unsupported tone throws rather than silently rendering the neutral treatment.',
          '',
          'The design system owns *what each tone looks like*. Features own *which domain',
          'state maps to which tone* — the design system deliberately does not know that a',
          'record can be "expired".',
          '',
          '### Accessibility expectations',
          '',
          '- **Tone is never the only signal.** The text inside the badge must state the',
          '  status. A bare coloured dot is not a badge.',
          '- A badge is not interactive. It has no role, no focus and no click handler; if',
          '  it needs to be clickable it is a `Button` or a filter control, not a badge.',
          '- The optional icon is rendered `aria-hidden`, so it never doubles the announced',
          '  text.',
          '- Every tone pairing meets WCAG AA against its own tinted background.',
          '',
          '### Common mistakes',
          '',
          '- Putting a sentence in a badge. Long text makes rows jump and defeats scanning —',
          '  use a `FieldMessage` or body copy instead.',
          '- Using `danger` for anything merely *important*. Reserve it for a genuinely bad',
          '  state, or it stops being noticeable.',
          '- Using more than one or two badges per row; the colour stops carrying meaning.',
          '- Adding an `onClick` via a wrapper to make a badge act as a filter chip. There is',
          '  no approved chip primitive yet — record the gap in the roadmap instead.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: a neutral badge. */
export const Default = {};

/** Every approved tone. Features map domain states onto these. */
export const Tones = {
  render: () => (
    <div className="sb-row">
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="info">Info</Badge>
      <Badge tone="success">Success</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="danger">Danger</Badge>
      <Badge tone="accent">Accent</Badge>
    </div>
  ),
};

/** The icon is decorative reinforcement; the word still carries the meaning. */
export const WithIcons = {
  render: () => (
    <div className="sb-row">
      <Badge tone="success" icon={Check}>Complete</Badge>
      <Badge tone="warning" icon={Clock}>Pending</Badge>
      <Badge tone="danger" icon={X}>Rejected</Badge>
      <Badge tone="info" icon={Info}>In review</Badge>
      <Badge tone="accent" icon={Star}>Priority</Badge>
      <Badge tone="warning" icon={AlertTriangle}>Action needed</Badge>
    </div>
  ),
};

/**
 * A badge does not truncate — long text wraps and the badge grows. That is a
 * deliberate reason to keep badge text to one or two words: this is what
 * happens when it is not.
 */
export const LongText = {
  render: () => (
    <div className="sb-measure sb-column">
      <div className="sb-specimen">
        <span className="sb-specimen__label">Correct — short label</span>
        <div className="sb-row"><Badge tone="warning">Expiring</Badge></div>
      </div>
      <div className="sb-specimen">
        <span className="sb-specimen__label">Anti-pattern — a sentence in a badge</span>
        <div className="sb-row">
          <Badge tone="warning">
            Awaiting secondary review before the record can be released
          </Badge>
        </div>
      </div>
    </div>
  ),
};

/**
 * Narrow viewport. Badges wrap onto their own lines rather than forcing the row
 * to scroll horizontally.
 */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-row">
      <Badge tone="success" icon={Check}>Complete</Badge>
      <Badge tone="warning" icon={Clock}>Pending</Badge>
      <Badge tone="info">In review</Badge>
      <Badge tone="neutral">Archived</Badge>
      <Badge tone="danger" icon={X}>Rejected</Badge>
    </div>
  ),
};
