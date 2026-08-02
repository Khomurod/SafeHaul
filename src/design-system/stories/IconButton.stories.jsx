import React from 'react';
import { fn } from 'storybook/test';
import { Download, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@design-system/components';

/**
 * `IconButton` is a `Button` whose visible content is an icon and whose
 * accessible name comes from a required `label` prop.
 */
const meta = {
  title: 'Components/IconButton',
  component: IconButton,
  args: {
    label: 'Close',
    children: <X size={18} aria-hidden="true" />,
    onClick: fn(),
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Accessible name. Required — a blank or missing label throws.',
    },
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved**, on the same footing as `Button` — the primitive is proven',
          'and the remaining roadmap work is migrating the raw icon buttons that still',
          'exist in unmigrated screens.',
          '',
          '### Intended use',
          '',
          'A compact action where the icon is genuinely unambiguous *and* space is genuinely',
          'constrained: dialog close, a table row action, a toolbar. Anywhere else, use a',
          '`Button` with words.',
          '',
          '### Accessibility expectations',
          '',
          '- `label` is mandatory and is enforced at render time: `IconButton` **throws** on',
          '  a missing or blank label. This is the single defect the component exists to',
          '  prevent — an unlabelled icon button is announced as just "button".',
          '- Write the label as the action, not the picture: `Delete record`, never',
          '  `Trash icon`.',
          '- The icon inside must be `aria-hidden`, otherwise assistive technology reads the',
          '  icon *and* the label.',
          '- The control keeps the full `Button` hit area at every size, so it stays',
          '  touch-reachable on mobile.',
          '- An icon alone is not a tooltip. If the meaning is not obvious without hovering,',
          '  the action needs a text label.',
          '',
          '### Common mistakes',
          '',
          '- Using an `IconButton` for a primary action to "save space" — the user then has',
          '  to guess what the main action of the screen is.',
          '- Three or more icon-only actions in a row with no text anywhere. Beyond two,',
          '  prefer an overflow menu with labelled items.',
          '- Reusing one icon for two different meanings on the same screen.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features choose the icon and write the label — both are domain vocabulary. They',
          'must not restyle the control or drop the label.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: a secondary icon button with an accessible name. */
export const Default = {};

/** The same four variants as `Button`, so an icon action can carry the same weight. */
export const Variants = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} variant="primary" label="Download file"><Download size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} variant="secondary" label="Edit record"><Pencil size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} variant="ghost" label="More actions"><MoreHorizontal size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} variant="danger" label="Delete record"><Trash2 size={18} aria-hidden="true" /></IconButton>
    </div>
  ),
};

/** `sm` is the size used inside compact table rows. */
export const Sizes = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} size="sm" label="Edit record (small)"><Pencil size={14} aria-hidden="true" /></IconButton>
      <IconButton {...args} size="md" label="Edit record (medium)"><Pencil size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} size="lg" label="Edit record (large)"><Pencil size={20} aria-hidden="true" /></IconButton>
    </div>
  ),
};

/** In-flight and unavailable states behave exactly as they do on `Button`. */
export const LoadingAndDisabled = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} variant="secondary" loading label="Downloading file"><Download size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} variant="secondary" disabled label="Edit record (unavailable)"><Pencil size={18} aria-hidden="true" /></IconButton>
      <IconButton {...args} variant="danger" disabled label="Delete record (unavailable)"><Trash2 size={18} aria-hidden="true" /></IconButton>
    </div>
  ),
};

/**
 * The rule of thumb, shown as a comparison. The left group is at the edge of
 * what an icon can carry on its own; the right group is what to do instead once
 * the meaning stops being obvious.
 */
export const IconOnlyVersusLabelled = {
  render: (args) => (
    <div className="sb-grid">
      <div className="sb-specimen">
        <span className="sb-specimen__label">Fine — universal icons, tight space</span>
        <div className="sb-row">
          <IconButton {...args} variant="ghost" label="Close"><X size={18} aria-hidden="true" /></IconButton>
          <IconButton {...args} variant="ghost" label="Delete record"><Trash2 size={18} aria-hidden="true" /></IconButton>
        </div>
      </div>
      <div className="sb-specimen">
        <span className="sb-specimen__label">Better — meaning needs words</span>
        <div className="sb-row">
          <Button {...args} variant="secondary" size="sm">
            <Download size={16} aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>
    </div>
  ),
};

/**
 * Keyboard focus at the smallest size, which is where a clipped or
 * low-contrast focus ring is most likely to slip through review.
 */
export const KeyboardFocus = {
  render: (args) => (
    <div className="sb-column">
      <p className="sb-note">
        Press <kbd>Tab</kbd> through the row and confirm the focus ring is fully visible and
        not clipped by the neighbouring control.
      </p>
      <div className="sb-row">
        <IconButton {...args} size="sm" variant="ghost" label="Edit record"><Pencil size={14} aria-hidden="true" /></IconButton>
        <IconButton {...args} size="sm" variant="ghost" label="Download file"><Download size={14} aria-hidden="true" /></IconButton>
        <IconButton {...args} size="sm" variant="ghost" label="More actions"><MoreHorizontal size={14} aria-hidden="true" /></IconButton>
      </div>
    </div>
  ),
};
