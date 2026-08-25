import React from 'react';
import { fn } from 'storybook/test';
import { ArrowRight, Check, Filter, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button,
  FormField,
  IconButton,
  Input,
  Select,
  Textarea,
} from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

/**
 * The control scale is the answer to "how tall is this, and how much space is
 * inside it" — for every interactive control the design system owns.
 */
const meta = {
  title: 'Foundations/Control scale',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          '**Status: Approved.** Resolved 2026-08-21; it was the longest-standing open',
          'decision in the roadmap.',
          '',
          '### One scale, three steps',
          '',
          '| Step | Height | Type | Icon | Use |',
          '|---|---|---|---|---|',
          '| `sm` | 36px | 13px | 14px | Dense chrome: table row actions, toolbar affordances, pagination |',
          '| `md` | 44px | 14px | 16px | **The default.** Everything else |',
          '| `lg` | 52px | 15px | 18px | The primary action of a public, mobile-first, single-task screen |',
          '',
          '`Button`, `IconButton`, `Input`, `Select` and `Textarea` all read the same three',
          'tokens, and all default to `md`. That is the whole point: an input and the button',
          'beside it line up **without the call site deciding anything**.',
          '',
          '### What this replaced',
          '',
          '`.ds-form-control` hardcoded `min-height: 44px` while `Button`\'s `md` was 40px, so',
          'every input sitting next to a button was 4px taller than it. Screens compensated',
          'by reaching for `size="lg"` on the button — which meant "make it 44px", not "make',
          'it prominent" — and 25 internal call sites had done exactly that. They no longer',
          'need to, and `lg` got its meaning back.',
          '',
          '### `lg` is not the way to match a form control',
          '',
          'The default already does that. Use `lg` when the control *is* the screen: the',
          'driver application wizard\'s Continue, Login\'s Sign In, the employer verification',
          'portal\'s Submit, the signing sheet\'s Adopt. When one action in a row takes `lg`,',
          'its siblings take it too, or the row will not line up.',
          '',
          '### Icon size is not a call-site decision',
          '',
          'Call sites passed `size={16}`, `size={18}`, `size={20}`, `size={24}` and',
          '`className="h-5 w-5"` to the same kind of button, so adjacent buttons had',
          'different-sized glyphs and visibly different internal spacing. `Button.css` sizes',
          'any contained `svg` from the step\'s icon token, which outranks the width/height',
          '*attributes* an icon library renders. The **Icon normalisation** story below proves',
          'it: every button there is passed a deliberately wrong icon size.',
          '',
          '### Accessibility',
          '',
          '44px is WCAG 2.2 SC 2.5.5 Target Size (Enhanced, AAA) — and it is the *default*,',
          'not something a screen opts into. `sm` (36px) still clears SC 2.5.8 (Minimum,',
          '24px) and is reserved for dense chrome where a larger target would crowd the row.',
          '',
          '### Common mistakes',
          '',
          '- Reaching for `lg` to match an input. The default already matches.',
          '- Mixing steps inside one row, which is what makes a toolbar look accidental.',
          '- Passing `size={20}` to an icon and expecting it to render at 20px.',
          '- Passing `size={30}` to an `Input` expecting the native character-width',
          '  attribute — it throws, because control width is a layout decision.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const STEPS = [
  { size: 'sm', label: 'sm — 36px' },
  { size: 'md', label: 'md — 44px (default)' },
  { size: 'lg', label: 'lg — 52px' },
];

/**
 * The headline pairing. An input and its adjacent button at each step: same
 * height, same corner radius, aligned baselines. The middle row is what a
 * caller gets by writing neither `size` — which is the case that used to be
 * misaligned.
 */
export const InputAndButton = {
  render: () => (
    <Stack gap="lg">
      {STEPS.map(({ size, label }) => (
        <div className="sb-specimen" key={size}>
          <span className="sb-specimen__label">{label}</span>
          <Inline gap="sm" wrap={false}>
            <Input
              size={size}
              aria-label={`Search records (${size})`}
              placeholder="Search records"
              onChange={fn()}
            />
            <Button size={size} variant="primary">
              <Search aria-hidden="true" />
              Search
            </Button>
            <IconButton size={size} label={`Filter results (${size})`}>
              <Filter aria-hidden="true" />
            </IconButton>
          </Inline>
        </div>
      ))}
    </Stack>
  ),
};

/**
 * An input, a select and a textarea take the same steps, so a whole form stays
 * in step.
 *
 * The input sits next to the select on purpose. They must be the same height,
 * the same type size **and the same colour**, and for most of 2026 the last of
 * those was not true: `.ds-form-control:read-only` matched every `<select>` in
 * the product — `:read-only` means "not `:read-write`", and only inputs,
 * textareas and contenteditable are ever `:read-write` — so every dropdown wore
 * the greyed treatment meant for a field you cannot type into. It is pinned by
 * a resolved-colour probe in `check:visual-contract` now, because it is the
 * kind of difference that reads as a rendering quirk rather than a bug.
 */
export const EveryControl = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="lg">
        {STEPS.map(({ size, label }) => (
          <div className="sb-specimen" key={size}>
            <span className="sb-specimen__label">{label}</span>
            <Stack gap="sm">
              <Inline gap="sm" wrap={false}>
                <Input size={size} aria-label={`Reference (${size})`} placeholder="REC-000000" onChange={fn()} />
                <Select size={size} aria-label={`Status (${size})`} onChange={fn()}>
                  <option>Any status</option>
                  <option>Complete</option>
                </Select>
                <Button size={size}>Apply</Button>
              </Inline>
              {/*
                A textarea opts out of the height token — it is sized by rows —
                but keeps the step's padding and type, so it still reads as the
                same family as the controls above it.
              */}
              <Textarea size={size} aria-label={`Notes (${size})`} rows={2} onChange={fn()} />
            </Stack>
          </div>
        ))}
      </Stack>
    </div>
  ),
};

/**
 * Every button here is passed a deliberately wrong icon size — 24, 12, 20, 32 —
 * and every glyph still renders at its step's token. If this story ever shows
 * mismatched icons, the CSS that outranks the rendered attribute has regressed.
 */
export const IconNormalisation = {
  render: () => (
    <Stack gap="md">
      <p className="sb-note">
        The numbers below are what the call site asked for. None of them is what renders.
      </p>
      <Inline gap="sm">
        <Button variant="primary"><Plus size={24} aria-hidden="true" />size 24</Button>
        <Button variant="secondary"><Check size={12} aria-hidden="true" />size 12</Button>
        <Button variant="danger"><Trash2 size={20} aria-hidden="true" />size 20</Button>
        <Button variant="ghost"><ArrowRight size={32} aria-hidden="true" />size 32</Button>
      </Inline>
      <Inline gap="sm">
        <Button size="sm"><Plus size={24} aria-hidden="true" />sm</Button>
        <Button size="md"><Plus size={24} aria-hidden="true" />md</Button>
        <Button size="lg"><Plus size={24} aria-hidden="true" />lg</Button>
      </Inline>
    </Stack>
  ),
};

/**
 * A labelled field beside its action — the shape most forms actually use. The
 * button aligns with the control, not with the label above it.
 */
export const LabelledFieldWithAction = {
  render: () => (
    <div className="sb-measure">
      <Inline gap="sm" wrap={false}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FormField label="Reference number" description="Digits only.">
            <Input placeholder="REC-000000" onChange={fn()} />
          </FormField>
        </div>
        <Button variant="primary" style={{ marginTop: 'var(--ds-space-6)' }}>
          Look up
        </Button>
      </Inline>
    </div>
  ),
};

/** Mobile width. The row wraps rather than shrinking a control below its step. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <Inline gap="sm">
        <Input aria-label="Search records" placeholder="Search records" onChange={fn()} />
        <Button variant="primary" fullWidth>
          <Search aria-hidden="true" />
          Search
        </Button>
      </Inline>
      <Button size="lg" variant="primary" fullWidth>
        Continue
        <ArrowRight aria-hidden="true" />
      </Button>
    </Stack>
  ),
};
