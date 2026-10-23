import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, CheckCircle2, ClipboardList, Zap } from '@design-system/icons';
import { Button, Card } from '@/design-system/components';
import { QuickInterestForm } from './QuickInterestForm';

/**
 * The first screen of a driver referral link: the full application, or a quick
 * interest form a recruiter follows up on.
 *
 * Shown where the intake chooser would be, so a restored draft, an opened
 * carrier link and a confirmed identity, which all skip that chooser, skip this
 * one too. `children` is the chooser the full application starts from.
 */
export function ReferralIntake({ companyId, companyName, referralCode, children }) {
  const [view, setView] = useState('choose');
  const headingId = `referral-intake-${useId().replace(/:/g, '')}`;
  const sentHeadingRef = useRef(null);

  // The form is gone once it is sent: the thank-you takes focus, so a screen
  // reader says it rather than nothing.
  useEffect(() => {
    if (view === 'sent') sentHeadingRef.current?.focus();
  }, [view]);

  if (view === 'full') return children;
  if (view === 'quick') {
    return (
      <QuickInterestForm
        companyId={companyId}
        companyName={companyName}
        referralCode={referralCode}
        onSent={() => setView('sent')}
        onBack={() => setView('choose')}
      />
    );
  }

  return (
    <main aria-labelledby={headingId} className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
      <Card padding="lg" className="w-full max-w-2xl">
        {view === 'sent' ? (
          <div className="flex flex-col items-center gap-ds-4 text-center">
            <Icon icon={CheckCircle2} size="2xl" className="text-ds-status-success-fg" />
            <h1 id={headingId} ref={sentHeadingRef} tabIndex={-1} className="text-ds-heading-lg font-bold text-ds-content">
              Thank you
            </h1>
            <p className="text-ds-content-secondary">
              A recruiter from {companyName} will contact you soon.
            </p>
            <Button variant="secondary" onClick={() => setView('full')}>Fill out the full application</Button>
          </div>
        ) : (
          <>
            <div className="mb-ds-8 text-center">
              <h1 id={headingId} className="mb-ds-2 text-ds-heading-lg font-bold text-ds-content">{companyName}</h1>
              <p className="text-ds-content-secondary">A driver you know invited you to apply. How would you like to start?</p>
            </div>
            <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
              <ChoiceButton
                icon={Zap}
                title="Quick interest — about 1 minute"
                detail="Your name, phone and email. A recruiter calls you to talk about the job."
                onClick={() => setView('quick')}
              />
              <ChoiceButton
                icon={ClipboardList}
                title="Full application"
                detail="The complete driver application, with your license, history and documents."
                onClick={() => setView('full')}
              />
            </div>
          </>
        )}
      </Card>
    </main>
  );
}

function ChoiceButton({ icon, title, detail, onClick }) {
  return (
    <Button variant="secondary" fullWidth justify="start" className="h-auto" onClick={onClick}>
      <span className="flex min-w-0 flex-col items-start gap-ds-2 py-ds-4 text-left">
        <span className="flex min-w-0 items-center gap-ds-3">
          <Icon icon={icon} size="xl" className="shrink-0 text-ds-action-primary" />
          <span className="min-w-0 whitespace-normal text-ds-body-lg font-semibold text-ds-content">{title}</span>
        </span>
        <span className="whitespace-normal text-ds-sm font-normal text-ds-content-secondary">{detail}</span>
      </span>
    </Button>
  );
}

export default ReferralIntake;
