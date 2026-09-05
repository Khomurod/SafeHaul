import React, { useState } from 'react';
import { Chip, ChipGroup, Card, Button, IconButton } from '@design-system/components';
import { Icon, ArrowUp, ArrowDown, Phone, MapPin, Filter } from '@design-system/icons';
import { Inline, Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions',
          'across four files.',
          '',
          '### What a chip is',
          '',
          'The interactive twin of `Badge` — the same pill, the same 12px semibold text,',
          'the same six status tints, the same 12px leading glyph — but it can be clicked,',
          'followed, or pressed. Reach for it for filter strips, tag rows and short inline',
          'tokens that do something.',
          '',
          '### What it is not',
          '',
          '- **not `Button`.** A 24px pill with 12px text is deliberately off the button',
          '  scale, which starts at 36px and refuses anything under it except the icon-only',
          '  `xs` step.',
          '- **not `SegmentedControl`.** That is a 44px card grid and single-select by',
          '  contract — its `value` is a scalar. A filter strip of multi-select pills sitting',
          '  above a dense table is a different shape and a different arity.',
          '- **not `Link` or `ButtonLink`.** Those are underlined text and a button-shaped',
          '  anchor. A tinted inline token is neither.',
          '',
          '### Sizes',
          '',
          'Named after the shared control-height steps rather than a private scale, so one',
          'vocabulary covers the whole control family: `xs` is the same 24px as',
          '`IconButton size="xs"` (the WCAG 2.2 SC 2.5.8 minimum) and `sm` is the same 36px',
          'as `Button size="sm"`.',
          '',
          '### Accessibility',
          '',
          '- `pressed` sets `aria-pressed` **and** draws a leading check. Selection is never',
          '  colour alone — the fill is what disappears in forced-colours mode.',
          '- A set of chips belongs in a `ChipGroup`, which requires a name. "Pressed" on its',
          '  own does not say what was chosen. `ariaLabelledBy` is the better of the two when',
          '  the words are already on screen.',
          '- `href` and `pressed` together throw. A link goes somewhere; it is not a',
          '  two-state control, and `aria-pressed` on an anchor is invalid ARIA.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const TONES = ['default', 'neutral', 'info', 'success', 'warning', 'danger', 'accent'];

/** Every tone, unpressed. `default` is the quiet outline; the rest are status tints. */
export const Tones = {
  render: () => (
    <Card>
      <Inline gap="sm" wrap>
        {TONES.map((tone) => (
          <Chip key={tone} tone={tone}>{tone}</Chip>
        ))}
      </Inline>
    </Card>
  ),
};

/** The two steps, beside the controls they line up with. */
export const Sizes = {
  render: () => (
    <Card>
      <Stack gap="md">
        <Inline gap="sm" wrap>
          <Chip size="xs">xs — 24px</Chip>
          <IconButton label="Compact action" size="xs" variant="ghost">
            <Icon icon={Filter} size="xs" />
          </IconButton>
        </Inline>
        <Inline gap="sm" wrap>
          <Chip size="sm" icon={Phone}>sm — 36px</Chip>
          <Button size="sm">Same step</Button>
        </Inline>
      </Stack>
    </Card>
  ),
};

/** A multi-select filter strip: the shape two call sites hand-wrote. */
export const MultiSelectGroup = {
  render: function MultiSelectGroup() {
    const [on, setOn] = useState(['review']);
    const toggle = (id) => setOn((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
    const options = [
      { id: 'new', label: 'New' },
      { id: 'review', label: 'In review' },
      { id: 'hold', label: 'On hold' },
      { id: 'closed', label: 'Closed' },
    ];
    return (
      <Card>
        <Stack gap="sm">
          <span id="chip-story-label" className="text-ds-xs font-bold uppercase text-ds-content-secondary">
            Stage
          </span>
          <ChipGroup ariaLabelledBy="chip-story-label">
            {options.map((option) => (
              <Chip
                key={option.id}
                pressed={on.includes(option.id)}
                onClick={() => toggle(option.id)}
              >
                {option.label}
              </Chip>
            ))}
          </ChipGroup>
        </Stack>
      </Card>
    );
  },
};

/** Pressed beside unpressed, so the check and the fill can be compared at rest. */
export const PressedAndNot = {
  render: () => (
    <Card>
      <ChipGroup ariaLabel="Pressed states">
        <Chip pressed>Pressed</Chip>
        <Chip pressed={false}>Not pressed</Chip>
        <Chip pressed={false} tone="info">Toned, not pressed</Chip>
      </ChipGroup>
    </Card>
  ),
};

/** A chip that is a link. Anchors take a glyph and a tone but never a pressed state. */
export const AsLink = {
  render: () => (
    <Card>
      <Inline gap="sm" wrap>
        <Chip href="tel:+15550100" tone="success" icon={Phone}>(555) 010-0</Chip>
        <Chip href="https://example.com" external icon={MapPin}>Open map</Chip>
      </Inline>
    </Card>
  ),
};

/**
 * `pressed` on a `Button` and an `IconButton` — the other half of the toggle
 * contract. It draws the state WITHOUT changing the variant, which is what a
 * caller cannot express from outside: a text utility loses to the variant's own
 * `color` rule.
 */
export const PressedControls = {
  render: function PressedControls() {
    const [direction, setDirection] = useState('asc');
    return (
      <Card>
        <Stack gap="md">
          <Inline gap="xs">
            <IconButton
              label="Sort ascending"
              variant="ghost"
              size="xs"
              pressed={direction === 'asc'}
              onClick={() => setDirection('asc')}
            >
              <Icon icon={ArrowUp} size="xs" />
            </IconButton>
            <IconButton
              label="Sort descending"
              variant="ghost"
              size="xs"
              pressed={direction === 'desc'}
              onClick={() => setDirection('desc')}
            >
              <Icon icon={ArrowDown} size="xs" />
            </IconButton>
          </Inline>
          <Inline gap="sm" wrap>
            <Button variant="secondary" pressed>Secondary, pressed</Button>
            <Button variant="ghost" pressed>Ghost, pressed</Button>
            <Button variant="ghost" pressed={false}>Ghost, not pressed</Button>
          </Inline>
        </Stack>
      </Card>
    );
  },
};
