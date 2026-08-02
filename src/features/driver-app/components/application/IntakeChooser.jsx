import React, { useId } from 'react';
import { Wand2, PencilLine } from 'lucide-react';
import { Button, Card } from '@/design-system/components';

/**
 * Presentational intake chooser for the public driver application (D1).
 *
 * Pure/stateless — all behaviour stays in the container via props, so this is
 * behaviour-identical and guarded by the existing PublicApplyHandler intake test
 * and `e2e/guest-application-intake.spec.cjs` (which clicks the exact "Fill Out
 * Manually" text and asserts "Upload CDL for Auto-Fill").
 *
 * Presentation is migrated to the approved `Card` / `Button` primitives and
 * `--ds-*` tokens. The two intake options are `Button`s rather than bare
 * `<button>`s wrapping their own headings — the previous markup nested an
 * `<h3>` inside a control, which made the option's accessible name a run-on of
 * heading plus body copy and put a heading inside interactive content.
 *
 * The hidden CDL input is `aria-hidden` and out of the tab order: the visible
 * auto-fill Button is its only trigger, so exposing it would add a second,
 * unlabelled tab stop for the same action.
 */
export function IntakeChooser({ companyName, onChooseAutoFill, onChooseManual, cdlInputRef, onCdlFileChange }) {
  const headingId = `intake-chooser-${useId().replace(/:/g, '')}`;

  return (
    <main
      aria-labelledby={headingId}
      className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4"
    >
      <Card padding="lg" className="w-full max-w-2xl">
        <div className="mb-ds-8 text-center">
          <h1 id={headingId} className="mb-ds-2 text-ds-heading-lg font-bold text-ds-content">{companyName}</h1>
          <p className="text-ds-content-secondary">
            How would you like to start your driver application?
          </p>
        </div>

        <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
          <Button
            variant="secondary"
            fullWidth
            justify="start"
            className="h-auto"
            onClick={onChooseAutoFill}
          >
            <span className="flex flex-col items-start gap-ds-2 py-ds-4 text-left">
              <span className="flex items-center gap-ds-3">
                <Wand2 className="shrink-0 text-ds-action-primary" size={20} aria-hidden="true" />
                <span className="text-ds-body-lg font-semibold text-ds-content">Upload CDL for Auto-Fill (Fastest)</span>
              </span>
              <span className="text-ds-sm font-normal text-ds-content-secondary">
                Upload one CDL photo and we pre-fill your name, date of birth, address, CDL number, and expiration date.
              </span>
            </span>
          </Button>

          <Button
            variant="secondary"
            fullWidth
            justify="start"
            className="h-auto"
            onClick={onChooseManual}
          >
            <span className="flex flex-col items-start gap-ds-2 py-ds-4 text-left">
              <span className="flex items-center gap-ds-3">
                <PencilLine className="shrink-0 text-ds-content-secondary" size={20} aria-hidden="true" />
                <span className="text-ds-body-lg font-semibold text-ds-content">Fill Out Manually</span>
              </span>
              <span className="text-ds-sm font-normal text-ds-content-secondary">
                Start at Step 1 and enter everything by hand, just like the current flow.
              </span>
            </span>
          </Button>
        </div>

        <p className="mt-ds-6 text-center text-ds-xs text-ds-content-muted">
          You can review and edit everything before submitting.
        </p>

        <input
          ref={cdlInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          aria-hidden="true"
          tabIndex={-1}
          className="ds-visually-hidden"
          onChange={onCdlFileChange}
        />
      </Card>
    </main>
  );
}

export default IntakeChooser;
