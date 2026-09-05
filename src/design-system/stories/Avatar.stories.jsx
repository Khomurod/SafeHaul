import React from 'react';
import { Avatar, Card, Badge } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-09-05, replacing eight hand-built discs.',
          '',
          '### The scale is fixed, and it is not ours',
          '',
          'Every published system checked exposes a fixed set of steps and lets the',
          'consumer pick one — GitHub Primer (16/20/24/32/40/48/64), Shopify Polaris',
          '(20/24/28/32/40), Atlassian (16/24/32/48/96) and Red Hat, which says outright',
          'that the size is the consumer\'s choice. The five steps here are all Primer',
          'steps, and they are exactly the sizes this product already used.',
          '',
          'Two sizes in the tree were **not** on it. 36px is absent from Primer for a',
          'structural reason — the scale runs base-4 to 32 and base-8 from there — so the',
          'two 36px discs moved to 40. 24px is absent because the one 24px disc is a',
          'numbered step marker in a progress bar, not an avatar.',
          '',
          '### `size` also takes a responsive pair',
          '',
          'Primer types its own prop `number | { narrow?, regular?, wide? }`. A responsive',
          'avatar is first-class in the reference system for this kind of application,',
          'because a profile header wants a larger disc where there is room. `{ base, sm }`',
          'is the same idea in this repository\'s breakpoint vocabulary. Passing the same',
          'step twice throws — that is a plain string spelled the long way.',
          '',
          '### Circle or square is a rule, not a preference',
          '',
          'Primer: *"Circle Avatars represent individual people. Square Avatars represent',
          'non-human entities, such as bots, AI agents, teams, or organizations."*',
          '',
          '### Always hidden',
          '',
          'An avatar restates a name that is already beside it, so announcing "M" before',
          '"Maria Garcia" is noise. There is no prop to un-hide one — and five of the',
          'eight discs this replaced were **not** hidden, so a screen-reader user heard',
          'the initial read out as content.',
          '',
          '### A disc holding a glyph is not this',
          '',
          'Twenty-five round discs were measured in the product and only eight were',
          'avatars. The rest are `StatusMedallion`s, unread-count badges, step markers, a',
          'radio dot and a selection indicator — which is why `hand-rolled-avatar` reads',
          'what a disc *holds* rather than its shape.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const STEPS = [['xs', 20], ['sm', 32], ['md', 40], ['lg', 48], ['xl', 64]];

/** The five steps, each labelled with the pixel value it is. */
export const Sizes = {
  render: () => (
    <Card>
      <Inline gap="md" wrap>
        {STEPS.map(([step, px]) => (
          <Stack key={step} gap="sm" className="items-center">
            <Avatar size={step}>MG</Avatar>
            <span className="text-ds-xs text-ds-content-secondary">{step} · {px}px</span>
          </Stack>
        ))}
      </Inline>
    </Card>
  ),
};

/** Every tone. `primary` fills; `inverse` is for the console-dark panel. */
export const Tones = {
  render: () => (
    <Stack gap="sm">
      <Card>
        <Inline gap="sm" wrap>
          {['neutral', 'info', 'success', 'warning', 'danger', 'accent', 'primary'].map((tone) => (
            <Avatar key={tone} tone={tone}>MG</Avatar>
          ))}
        </Inline>
      </Card>
      <div className="rounded-ds-lg bg-ds-surface-inverse p-ds-4">
        <Inline gap="sm">
          <Avatar tone="inverse">MG</Avatar>
          <Avatar tone="inverse" bordered>RS</Avatar>
        </Inline>
      </div>
    </Stack>
  ),
};

/** A person is a circle; a team, an organisation or a bot is not. */
export const PersonOrOrganisation = {
  render: () => (
    <Card>
      <Stack gap="sm">
        <Inline gap="sm">
          <Avatar size="lg" tone="info">MG</Avatar>
          <span className="self-center text-ds-sm">A person — circle</span>
        </Inline>
        <Inline gap="sm">
          <Avatar size="lg" shape="square" tone="neutral">NS</Avatar>
          <span className="self-center text-ds-sm">An organisation — square</span>
        </Inline>
      </Stack>
    </Card>
  ),
};

/**
 * The responsive pair, and the only consumer that needs one: a record header
 * that is 48px on a phone and 64px from 640px up. Resize the frame to see it.
 */
export const ResponsiveHeader = {
  render: () => (
    <Card>
      <Inline gap="md">
        <Avatar size={{ base: 'lg', sm: 'xl' }} tone="info" bordered>MG</Avatar>
        <Stack gap="sm">
          <span className="text-ds-body-lg font-bold text-ds-content">Maria Garcia</span>
          <Inline gap="sm">
            <Badge tone="info">In review</Badge>
          </Inline>
        </Stack>
      </Inline>
    </Card>
  ),
};

/** How it sits in a dense row, which is where most of them live. */
export const InALine = {
  render: () => (
    <Card>
      <Stack gap="sm">
        {[['MG', 'Maria Garcia', 'accent'], ['RS', 'Rosa Silva', 'neutral'], ['TK', 'Tomas Kim', 'info']].map(
          ([initials, name, tone]) => (
            <Inline key={name} gap="sm">
              <Avatar size="sm" tone={tone}>{initials}</Avatar>
              <span className="self-center text-ds-sm text-ds-content">{name}</span>
            </Inline>
          ),
        )}
      </Stack>
    </Card>
  ),
};
