import React from 'react';
import { fn } from 'storybook/test';
import {
  AlertTriangle,
  Check,
  FileText,
  Inbox,
  Loader,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button, Card, StatusMedallion } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `StatusMedallion` is the toned, centred icon disc that sits above a status
 * heading — the visual anchor of loading, success, error and empty screens.
 */
const meta = {
  title: 'Components/StatusMedallion',
  component: StatusMedallion,
  args: { tone: 'info', size: 'md', children: <Check /> },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['neutral', 'info', 'success', 'warning', 'danger', 'accent'],
    },
    size: { control: 'inline-radio', options: ['md', 'lg'] },
    children: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Proven by the public signing room\'s status screens and by',
          '`ConfirmDialog`.',
          '',
          '### Intended use',
          '',
          'The icon above a status heading on a full-page state or in a dialog. It is not a',
          'general-purpose avatar, an inline icon, or a badge — for a status *label* inside',
          'a row, use `Badge`.',
          '',
          '### Supported variants',
          '',
          'Tones are `neutral`, `info`, `success`, `warning`, `danger` and `accent`. Sizes are',
          '`md` (default) and `lg`; use `lg` when the medallion is the main element of a',
          'full-page state.',
          '',
          '### Accessibility expectations',
          '',
          '- The medallion is **always `aria-hidden`**, by construction. It is decoration:',
          '  the adjacent heading and body copy carry the meaning.',
          '- Because of that, it must never be the only thing that changes between two',
          '  states. A screen that differs from another only by medallion tone is identical',
          '  to a screen reader.',
          '- Its icon must not be a focus target and must not carry a tooltip.',
          '',
          '### Common mistakes',
          '',
          '- Communicating success or failure by tone alone, with generic copy like "Done".',
          '- Using it inline beside body text, where it dominates the line.',
          '- Wrapping it in a button to make it clickable.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features decide which domain state maps to which tone and which icon to pass in —',
          'the design system deliberately does not know what "voided" means. They must not',
          'change the shape, size steps or tone palette.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default medallion. */
export const Default = {};

/** Every tone at the default size. */
export const Tones = {
  render: () => (
    <div className="sb-row">
      {[
        { tone: 'neutral', Icon: Inbox },
        { tone: 'info', Icon: FileText },
        { tone: 'success', Icon: Check },
        { tone: 'warning', Icon: AlertTriangle },
        { tone: 'danger', Icon: X },
        { tone: 'accent', Icon: ShieldCheck },
      ].map(({ tone, Icon }) => (
        <div className="sb-specimen" key={tone}>
          <span className="sb-specimen__label">{tone}</span>
          <StatusMedallion tone={tone}><Icon /></StatusMedallion>
        </div>
      ))}
    </div>
  ),
};

/** `lg` is for a medallion that anchors a whole page state. */
export const Sizes = {
  render: () => (
    <div className="sb-row" data-align="start">
      <div className="sb-specimen">
        <span className="sb-specimen__label">md</span>
        <StatusMedallion tone="success" size="md"><Check /></StatusMedallion>
      </div>
      <div className="sb-specimen">
        <span className="sb-specimen__label">lg</span>
        <StatusMedallion tone="success" size="lg"><Check /></StatusMedallion>
      </div>
    </div>
  ),
};

/**
 * The real composition: medallion, heading, explanation and an action. Note
 * that every state is fully distinguishable with the colour removed.
 */
export const InStatusScreens = {
  render: () => (
    <div className="sb-grid">
      {[
        {
          tone: 'info',
          Icon: Loader,
          title: 'Preparing your document',
          body: 'This usually takes a few seconds. Do not close this window.',
          action: null,
        },
        {
          tone: 'success',
          Icon: Check,
          title: 'Everything is complete',
          body: 'A copy has been sent to the address on the record.',
          action: 'Close',
        },
        {
          tone: 'warning',
          Icon: AlertTriangle,
          title: 'This link has expired',
          body: 'Ask the sender for a new link, then try again.',
          action: 'Request a new link',
        },
        {
          tone: 'danger',
          Icon: X,
          title: 'Access denied',
          body: 'This record is not available with the link you used.',
          action: null,
        },
      ].map(({ tone, Icon, title, body, action }) => (
        <Card key={title}>
          <Stack gap="sm">
            <StatusMedallion tone={tone}><Icon /></StatusMedallion>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <p style={{ margin: 0 }}>{body}</p>
            {action && <div><Button variant="secondary" onClick={fn()}>{action}</Button></div>}
          </Stack>
        </Card>
      ))}
    </div>
  ),
};

/** Long headings wrap beneath the medallion without shifting it off-centre. */
export const LongContent = {
  render: () => (
    <div className="sb-measure">
      <Card>
        <Stack gap="sm">
          <StatusMedallion tone="warning" size="lg"><AlertTriangle /></StatusMedallion>
          <h2 style={{ margin: 0 }}>
            This record cannot be completed until every listed organisation has responded
          </h2>
          <p style={{ margin: 0 }}>
            The medallion stays a fixed size and keeps its alignment no matter how long the
            heading and body copy become.
          </p>
        </Stack>
      </Card>
    </div>
  ),
};

/** Mobile width, at the large size used for full-page states. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Card>
      <Stack gap="sm">
        <StatusMedallion tone="success" size="lg"><Check /></StatusMedallion>
        <h2 style={{ margin: 0 }}>Everything is complete</h2>
        <p style={{ margin: 0 }}>A copy has been sent to the address on the record.</p>
      </Stack>
    </Card>
  ),
};
