import React from 'react';
import { fn } from 'storybook/test';
import { Check, Icon, Download, MoreHorizontal, Pencil, Trash2, X } from '@design-system/icons';
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
    children: <Icon icon={X} size="lg" />,
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
      <IconButton {...args} variant="primary" label="Download file"><Icon icon={Download} size="lg" /></IconButton>
      <IconButton {...args} variant="secondary" label="Edit record"><Icon icon={Pencil} size="lg" /></IconButton>
      <IconButton {...args} variant="ghost" label="More actions"><Icon icon={MoreHorizontal} size="lg" /></IconButton>
      <IconButton {...args} variant="danger" label="Delete record"><Icon icon={Trash2} size="lg" /></IconButton>
    </div>
  ),
};

/** `sm` is the size used inside compact table rows. */
export const Sizes = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} size="xs" label="Edit record (extra small)"><Icon icon={Pencil} size="xs" /></IconButton>
      <IconButton {...args} size="sm" label="Edit record (small)"><Icon icon={Pencil} size="sm" /></IconButton>
      <IconButton {...args} size="md" label="Edit record (medium)"><Icon icon={Pencil} size="lg" /></IconButton>
      <IconButton {...args} size="lg" label="Edit record (large)"><Icon icon={Pencil} size="xl" /></IconButton>
    </div>
  ),
};

/**
 * `xs` is 24px — the WCAG 2.2 SC 2.5.8 (AA) target-size **minimum**, not a
 * comfortable size. It exists for affordances pinned to something small enough
 * that a 36px control would cover it, and it is **icon-only**: a labelled
 * `Button` refuses this step, because 12px text cannot sit in 24px with any
 * padding.
 *
 * `shape="round"` cuts it as a disc. That is for a control sitting ON another
 * element's corner, where a rounded square reads as a second, nested box.
 */
export const ExtraSmallAndRound = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} size="xs" label="Dismiss"><Icon icon={X} size="xs" /></IconButton>
      <IconButton {...args} size="xs" shape="round" variant="danger" label="Remove item"><Icon icon={X} size="xs" /></IconButton>
      <IconButton {...args} size="xs" shape="round" variant="primary" label="Accept suggestion"><Icon icon={Check} size="xs" /></IconButton>
      <IconButton {...args} size="xs" variant="ghost" label="Sort ascending"><Icon icon={Pencil} size="xs" /></IconButton>
    </div>
  ),
};

/** In-flight and unavailable states behave exactly as they do on `Button`. */
export const LoadingAndDisabled = {
  render: (args) => (
    <div className="sb-row">
      <IconButton {...args} variant="secondary" loading label="Downloading file"><Icon icon={Download} size="lg" /></IconButton>
      <IconButton {...args} variant="secondary" disabled label="Edit record (unavailable)"><Icon icon={Pencil} size="lg" /></IconButton>
      <IconButton {...args} variant="danger" disabled label="Delete record (unavailable)"><Icon icon={Trash2} size="lg" /></IconButton>
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
          <IconButton {...args} variant="ghost" label="Close"><Icon icon={X} size="lg" /></IconButton>
          <IconButton {...args} variant="ghost" label="Delete record"><Icon icon={Trash2} size="lg" /></IconButton>
        </div>
      </div>
      <div className="sb-specimen">
        <span className="sb-specimen__label">Better — meaning needs words</span>
        <div className="sb-row">
          <Button {...args} variant="secondary" size="sm">
            <Icon icon={Download} size="md" />
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
        <IconButton {...args} size="sm" variant="ghost" label="Edit record"><Icon icon={Pencil} size="sm" /></IconButton>
        <IconButton {...args} size="sm" variant="ghost" label="Download file"><Icon icon={Download} size="sm" /></IconButton>
        <IconButton {...args} size="sm" variant="ghost" label="More actions"><Icon icon={MoreHorizontal} size="sm" /></IconButton>
      </div>
    </div>
  ),
};
