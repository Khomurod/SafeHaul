import React from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { ButtonLink, Button, IconButtonLink, Link } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

/**
 * Navigation primitives. A link navigates; a button acts.
 */
const meta = {
  title: 'Components/Link',
  component: Link,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21, closing the roadmap gap that kept eleven',
          'styled `<a>` elements feature-owned.',
          '',
          '### Which one',
          '',
          '| Component | Shape | Use for |',
          '| --- | --- | --- |',
          '| `Link` | Inline, underlined | A link inside a sentence or beside body text |',
          '| `ButtonLink` | The `Button` shape | A navigation presented as an action |',
          '| `IconButtonLink` | The `IconButton` shape | An icon-only navigation; `label` required |',
          '',
          '### A link navigates; a button acts',
          '',
          'That decides the announced role, whether Enter or Space activates it, and whether',
          'the browser offers "open in a new tab". Do not style a `<button>` as a link, and do',
          'not give an `<a>` an `onClick` and no `href` — assistive technology announces the',
          'lie in both directions. `Link` throws without an `href` for exactly this reason.',
          '',
          '### `external` is why these exist',
          '',
          'Before them, every external anchor in the product opened a new tab with **no',
          'announcement** — a WCAG 3.2.5 failure, and genuinely disorienting for a',
          'screen-reader or magnifier user, who simply loses the page. `external` sets',
          '`target`, sets the `rel` that closes the reverse-tabnabbing hole, and appends a',
          'visually-hidden "(opens in a new tab)". On `IconButtonLink` the hint folds into',
          '`aria-label`, because an icon-only link has no visible text to append to.',
          '',
          'Do not hand-write `target="_blank"`. Pass `external`.',
          '',
          '### Appearance',
          '',
          '`Link` is underlined at all times: colour alone fails WCAG 1.4.1 inside body text.',
          '`tone="quiet"` inherits the surrounding colour for a link inside already-coloured',
          'text and keeps the underline, which is then what distinguishes it.',
          '',
          '`ButtonLink` reuses `Button.css`, so it takes the same control height, padding,',
          'icon size and focus ring. See **Beside a button** below — that is the point of it.',
          '',
          '### No `disabled`, no `loading`',
          '',
          'An anchor can be neither. `disabled` on an `<a>` does nothing, and a "disabled"',
          'link that still navigates is worse than no link. Render the reason instead.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** Inline, in the sentence it belongs to. */
export const Inline_ = {
  name: 'Inline text link',
  render: () => (
    <div className="sb-measure">
      <p style={{ margin: 0, color: 'var(--ds-color-content)' }}>
        Credentials are issued by the provider. Read the{' '}
        <Link href="https://example.com/docs" external>provider documentation</Link>{' '}
        before connecting, or go back to <Link href="#settings">settings</Link>.
      </p>
    </div>
  ),
};

/**
 * The same two links with the announcement made visible. Nothing here is what a
 * sighted user sees — it is what a screen reader reads.
 */
export const ExternalAnnouncement = {
  render: () => (
    <Stack gap="sm">
      <p className="sb-note">
        The external link’s accessible name is “provider documentation (opens in a new tab)”.
        The internal one’s is just “settings”.
      </p>
      <Inline gap="md">
        <Link href="https://example.com/docs" external>provider documentation</Link>
        <Link href="#settings">settings</Link>
      </Inline>
    </Stack>
  ),
};

/**
 * The reason `ButtonLink` reuses `Button.css`: a navigation and an action that
 * sit beside each other are the same height, padding and icon size.
 */
export const BesideAButton = {
  render: () => (
    <Inline gap="sm">
      <ButtonLink href="/export.csv" variant="primary">
        <Download aria-hidden="true" />
        Download report
      </ButtonLink>
      <Button variant="secondary">Regenerate</Button>
      <IconButtonLink href="/report.pdf" label="Open the report">
        <FileText aria-hidden="true" />
      </IconButtonLink>
    </Inline>
  ),
};

/** Every step of the shared control scale, same as `Button`. */
export const Sizes = {
  render: () => (
    <Inline gap="sm">
      <ButtonLink href="/a" size="sm">Small</ButtonLink>
      <ButtonLink href="/a" size="md">Medium</ButtonLink>
      <ButtonLink href="/a" size="lg">Large</ButtonLink>
    </Inline>
  ),
};

/** `quiet` for a link inside text that already carries a colour. */
export const QuietTone = {
  render: () => (
    <div
      className="sb-measure"
      style={{
        background: 'var(--ds-color-status-warning-bg)',
        color: 'var(--ds-color-status-warning-fg)',
        padding: 'var(--ds-space-4)',
        borderRadius: 'var(--ds-radius-md)',
      }}
    >
      <p style={{ margin: 0 }}>
        This connection has not been verified.{' '}
        <Link href="#verify" tone="quiet">Verify it now</Link> to start receiving results.
      </p>
    </div>
  ),
};

/**
 * Keyboard focus. Tab through and confirm every shape shows a visible ring —
 * the inline link, the button-shaped link and the icon-only one.
 */
export const KeyboardFocus = {
  render: () => (
    <Stack gap="md">
      <p className="sb-note">Press <kbd>Tab</kbd> to move between the three shapes.</p>
      <Inline gap="md">
        <Link href="#one">Inline link</Link>
        <ButtonLink href="#two" variant="secondary">Button-shaped</ButtonLink>
        <IconButtonLink href="#three" label="Open in a new place">
          <ExternalLink aria-hidden="true" />
        </IconButtonLink>
      </Inline>
    </Stack>
  ),
};

/** Mobile width: a button-shaped link goes full width like a `Button` does. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <ButtonLink href="/export.csv" variant="primary" fullWidth>
        <Download aria-hidden="true" />
        Download report
      </ButtonLink>
      <p style={{ margin: 0, color: 'var(--ds-color-content)' }}>
        Trouble downloading? <Link href="https://example.com/help" external>Read the guide</Link>.
      </p>
    </Stack>
  ),
};
