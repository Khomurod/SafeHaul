import React from 'react';
import {
  AlertTriangle, ArrowRight, Check, Download, Filter, Icon, ICON_SIZES,
  Plus, Search, Trash2, Upload,
} from '@design-system/icons';
import { Badge, Button, IconButton } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

/**
 * The icon contract: a glyph is a token, its size is a step on a scale, and
 * whether a screen reader says anything about it is a decision the call site
 * has to take on purpose.
 */
const meta = {
  title: 'Foundations/Icons',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          '**Status: Approved.** Built 2026-09-05.',
          '',
          '### One import, one scale',
          '',
          '```jsx',
          "import { Icon, Trash2 } from '@/design-system/icons';",
          '',
          '<Icon icon={Trash2} size="sm" />',
          '```',
          '',
          '| Step | Size | Use |',
          '|---|---|---|',
          '| `xs` | 12px | Inside a badge, a chip, a dense corner affordance |',
          '| `sm` | 14px | Beside 13px text; the `sm` control step |',
          '| `md` | **16px** | The default. Beside body text and in `md` controls |',
          '| `lg` | 18px | The `lg` control step; a section heading |',
          '| `xl` | 20px | A page heading, a prominent single action |',
          '| `2xl` | 24px | A medallion, an empty state, a disclosure chevron |',
          '| `3xl` | 32px | The display step: a glyph ABOVE a sentence, lining up with nothing |',
          '',
          '### A glyph is not a component',
          '',
          'The registry hands out **tokens**, not renderable components, so',
          '`<Trash2 size={13} />` throws by name at the call site. That is deliberate:',
          'if the registry re-exported the components, moving 209 files onto this import',
          'path would have changed nothing at all — every one of them could keep passing',
          'whichever pixel number it already passed. A static rule cannot close that,',
          'because the commonest shape hides the name entirely:',
          '`const Glyph = ICONS[status]; <Glyph size={16} />`.',
          '',
          '### Containers size their own glyph',
          '',
          '`Button`, `IconButton`, `Tabs` and `Badge` each set the size of any glyph',
          'inside them, and they still do — the size rules here use `:where()`, which',
          'has zero specificity, so they state a default and lose every argument.',
          'An icon inside a `sm` button is 14px because the button says so, not because',
          'the call site guessed right.',
          '',
          '### Announced, or not — never neither',
          '',
          'Decoration beside a word is `aria-hidden` and costs the reader nothing.',
          'A glyph that *is* the control takes `label`, and becomes `role="img"` with',
          'that name. A blank `label` throws rather than announcing an image and then',
          'saying nothing about it.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const SPECIMENS = [
  { size: 'xs', px: 12, use: 'badge, chip, dense corner' },
  { size: 'sm', px: 14, use: '13px text, sm controls' },
  { size: 'md', px: 16, use: 'the default' },
  { size: 'lg', px: 18, use: 'lg controls, section heading' },
  { size: 'xl', px: 20, use: 'page heading' },
  { size: '2xl', px: 24, use: 'medallion, empty state' },
  { size: '3xl', px: 32, use: 'the display step — a glyph above a sentence' },
];

/** The scale, at rest, in order. */
export const Sizes = {
  render: () => (
    <Stack gap="lg">
      {SPECIMENS.map(({ size, px, use }) => (
        <Inline key={size} gap="md">
          <span className="w-10 shrink-0 text-ds-xs font-bold uppercase text-ds-content-muted">
            {size}
          </span>
          <Icon icon={Search} size={size} />
          <Icon icon={Filter} size={size} />
          <Icon icon={ArrowRight} size={size} />
          <Icon icon={AlertTriangle} size={size} />
          <span className="text-ds-sm text-ds-content-secondary">
            {px}px — {use}
          </span>
        </Inline>
      ))}
    </Stack>
  ),
};

/**
 * The same six steps with nothing else in the frame, which is what the
 * `check:visual-contract` probe measures.
 */
export const Scale = {
  render: () => (
    <Inline gap="lg">
      {ICON_SIZES.map((size) => (
        <Icon key={size} icon={Check} size={size} data-step={size} />
      ))}
    </Inline>
  ),
};

/** A glyph that carries meaning on its own says what it means. */
export const Labelled = {
  render: () => (
    <Stack gap="md">
      <Inline gap="sm">
        <Icon icon={Check} label="Verified" size="lg" />
        <span className="text-ds-sm text-ds-content-secondary">
          announced as “Verified”
        </span>
      </Inline>
      <Inline gap="sm">
        <Icon icon={Check} size="lg" />
        <span className="text-ds-sm text-ds-content-secondary">
          decoration beside these words — announced by nothing
        </span>
      </Inline>
    </Stack>
  ),
};

/**
 * The container wins. Every glyph below is written `size="md"`; each renders at
 * the size its container decided, which is the rule that keeps two buttons in a
 * row from carrying different-sized icons.
 */
export const InsideControls = {
  render: () => (
    <Stack gap="lg">
      <Inline gap="md">
        <Button size="sm">
          <Icon icon={Plus} size="md" />
          Add line
        </Button>
        <Button size="md">
          <Icon icon={Upload} size="md" />
          Upload
        </Button>
        <Button size="lg">
          <Icon icon={Download} size="md" />
          Download
        </Button>
      </Inline>
      <Inline gap="md">
        <IconButton label="Delete" variant="ghost" size="sm">
          <Icon icon={Trash2} size="md" />
        </IconButton>
        <IconButton label="Search" variant="secondary">
          <Icon icon={Search} size="md" />
        </IconButton>
        <Badge tone="success">
          <Icon icon={Check} size="xs" />
          Complete
        </Badge>
      </Inline>
    </Stack>
  ),
};
