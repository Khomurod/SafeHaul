import React from 'react';
import { fn } from 'storybook/test';
import { Check, Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '@design-system/components';

/**
 * `Button` is the approved action primitive. Every clickable action in SafeHaul
 * should be one of these, an `IconButton`, or a real link.
 */
const meta = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: 'Save changes',
    onClick: fn(),
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'ghost', 'danger'],
      description: 'Visual weight of the action.',
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
    },
    tone: {
      control: 'inline-radio',
      options: ['default', 'success'],
      description: 'Optional colour meaning layered over a variant.',
    },
    justify: {
      control: 'inline-radio',
      options: ['center', 'start', 'end', 'space-between'],
    },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** The primitive and its Company-workspace consumer are',
          'verified. The roadmap keeps the wider *button family* item open because',
          'unmigrated raw `<button>` elements still exist elsewhere in the product —',
          'that is a migration debt, not a defect in this component.',
          '',
          '### Intended use',
          '',
          'Any action that changes application state. If the control navigates to a new',
          'URL it is a link, not a button — a button cannot be opened in a new tab and is',
          'announced as the wrong role.',
          '',
          '### Supported variants',
          '',
          '| Variant | Use for |',
          '| --- | --- |',
          '| `primary` | The one main action of a screen or dialog. |',
          '| `secondary` | The default. Everything that is not the main action. |',
          '| `ghost` | Low-emphasis actions inside dense rows and toolbars. |',
          '| `danger` | Destructive, hard-to-reverse actions. |',
          '',
          'Sizes are `sm`, `md` (default) and `lg`. `tone="success"` is an *additional*',
          'colour meaning available to actions a feature reads as affirmative; it never',
          'replaces the text label, and the catalog does not decide which actions qualify —',
          'that mapping belongs to the feature.',
          '',
          'Unsupported values throw at render time rather than falling back silently, so a',
          'typo surfaces in review instead of shipping a differently-coloured button.',
          '',
          '### Accessibility expectations',
          '',
          '- The label is the accessible name. Keep it a verb phrase (`Send invitation`),',
          '  not `OK`.',
          '- `loading` sets `aria-busy` **and** disables the button, so a slow request',
          '  cannot be double-submitted.',
          '- Focus is a visible token-driven ring; never remove it.',
          '- `type` defaults to `button`. Inside a `<form>`, the submitting button must be',
          '  given `type="submit"` explicitly.',
          '',
          '### Common mistakes',
          '',
          '- Using `variant="primary"` more than once on a screen — it stops meaning',
          '  "the main action".',
          '- Using colour alone to say what an action does (a red button labelled',
          '  "Continue").',
          '- Wrapping a `Button` in an `<a>` to make it navigate.',
          '- Re-styling with a `className` colour override instead of using a variant.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the *label*, the *icon* and *what happens on click*. They must not',
          'own the colour, radius, height or focus treatment. If a genuinely new tone is',
          'needed, record the gap in the roadmap first — the sandbox Magic Fill control is',
          'the existing documented exception of this kind.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: a secondary, medium button. */
export const Default = {};

/** All four approved variants side by side, at their default size. */
export const Variants = {
  render: (args) => (
    <div className="sb-row">
      <Button {...args} variant="primary">Primary</Button>
      <Button {...args} variant="secondary">Secondary</Button>
      <Button {...args} variant="ghost">Ghost</Button>
      <Button {...args} variant="danger">Delete</Button>
    </div>
  ),
};

/**
 * Sizes share one type scale and one focus treatment. `sm` is for dense table
 * rows and toolbars; `lg` is for a primary call to action on a public page.
 */
export const Sizes = {
  render: (args) => (
    <div className="sb-row">
      <Button {...args} variant="primary" size="sm">Small</Button>
      <Button {...args} variant="primary" size="md">Medium</Button>
      <Button {...args} variant="primary" size="lg">Large</Button>
    </div>
  ),
};

/**
 * `tone="success"` layers an affirmative colour over a variant. The label still
 * has to say what happens — the tone is reinforcement, never the message.
 */
export const SuccessTone = {
  render: (args) => (
    <div className="sb-row">
      <Button {...args} variant="primary" tone="success">Approve and continue</Button>
      <Button {...args} variant="secondary" tone="success">Mark as complete</Button>
    </div>
  ),
};

/** Icons are decorative: the text label carries the meaning. */
export const WithIcons = {
  render: (args) => (
    <div className="sb-row">
      <Button {...args} variant="primary"><Plus size={16} aria-hidden="true" />Add record</Button>
      <Button {...args} variant="secondary"><Download size={16} aria-hidden="true" />Export</Button>
      <Button {...args} variant="ghost"><Check size={16} aria-hidden="true" />Mark reviewed</Button>
      <Button {...args} variant="danger"><Trash2 size={16} aria-hidden="true" />Delete</Button>
    </div>
  ),
};

/**
 * `loading` disables the button and sets `aria-busy`, so the in-flight state is
 * announced and the action cannot be fired twice.
 */
export const Loading = {
  args: { loading: true, variant: 'primary', children: 'Saving…' },
};

/**
 * Disabled buttons are still rendered, never removed — a control that vanishes
 * gives the user nothing to reason about. Where possible, explain *why* nearby.
 */
export const Disabled = {
  render: (args) => (
    <div className="sb-row">
      <Button {...args} variant="primary" disabled>Primary</Button>
      <Button {...args} variant="secondary" disabled>Secondary</Button>
      <Button {...args} variant="ghost" disabled>Ghost</Button>
      <Button {...args} variant="danger" disabled>Delete</Button>
    </div>
  ),
};

/**
 * Long labels wrap rather than overflowing or truncating. A truncated action
 * label is unusable — the user cannot tell what the button does.
 */
export const LongLabel = {
  render: (args) => (
    <div className="sb-measure sb-column">
      <Button {...args} variant="primary">
        Send a verification request to every organisation listed on this record
      </Button>
      <Button {...args} variant="secondary" fullWidth justify="start">
        Download the complete record file, with every attachment, as a single PDF
      </Button>
    </div>
  ),
};

/**
 * `fullWidth` with `justify="start"` is the mobile form pattern: a button that
 * fills the column and aligns its label with the fields above it.
 */
export const FullWidth = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: (args) => (
    <div className="sb-column">
      <Button {...args} variant="primary" fullWidth>Continue</Button>
      <Button {...args} variant="secondary" fullWidth justify="start">Back to previous step</Button>
    </div>
  ),
};

/**
 * Keyboard focus. Tab to each button to compare the focus ring against every
 * variant, including the dark `primary` and `danger` fills where a
 * low-contrast ring is easiest to get wrong.
 */
export const KeyboardFocus = {
  parameters: {
    docs: {
      description: {
        story:
          'The ring is a single `--ds-focus-ring` token shared by every variant, so it '
          + 'cannot drift between them. Tab through to confirm it is visible on all four.',
      },
    },
  },
  render: (args) => (
    <div className="sb-column">
      <p className="sb-note">
        Press <kbd>Tab</kbd> to move through these buttons and check that the focus ring is
        clearly visible on every variant.
      </p>
      <div className="sb-row">
        <Button {...args} variant="primary">Primary</Button>
        <Button {...args} variant="secondary">Secondary</Button>
        <Button {...args} variant="ghost">Ghost</Button>
        <Button {...args} variant="danger">Delete</Button>
      </div>
    </div>
  ),
};
