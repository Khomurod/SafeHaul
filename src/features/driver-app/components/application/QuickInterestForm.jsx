import React, { useId, useState } from 'react';
import { Button, Card, Checkbox, FormField, Input, Notice } from '@/design-system/components';
import {
  findQuickInterestGaps, quickInterestErrorMessage, referralConsentText, sendQuickInterest,
} from './referralIntake';

const FIELDS = Object.freeze([
  { name: 'firstName', label: 'First name', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Last name', autoComplete: 'family-name' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', inputMode: 'tel', placeholder: '(555) 555-5555' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', inputMode: 'email', placeholder: 'you@example.com' },
]);

const EMPTY = Object.freeze({ firstName: '', lastName: '', phone: '', email: '', contactConsent: false });

/**
 * The quick interest form of a referral link: four answers and consent to be
 * contacted. The server checks every answer again and creates the lead.
 */
export function QuickInterestForm({ companyId, companyName, referralCode, onSent, onBack }) {
  const headingId = `quick-interest-${useId().replace(/:/g, '')}`;
  const [answers, setAnswers] = useState(EMPTY);
  const [gaps, setGaps] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setField = (name, value) => {
    setAnswers((previous) => ({ ...previous, [name]: value }));
    setGaps((previous) => (previous[name] ? { ...previous, [name]: undefined } : previous));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const found = findQuickInterestGaps(answers);
    setGaps(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      await sendQuickInterest({ companyId, referralCode, answers });
      onSent();
    } catch (sendError) {
      setError(quickInterestErrorMessage(sendError));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-ds-canvas p-ds-4">
      <Card as="main" aria-labelledby={headingId} padding="lg" className="my-ds-6 w-full max-w-md">
        <h1 id={headingId} className="mb-ds-2 text-ds-heading-md font-bold text-ds-content">Quick interest</h1>
        <p className="mb-ds-6 text-ds-content-secondary">
          Leave your details and a recruiter from {companyName} will contact you.
        </p>
        <form className="space-y-ds-4" onSubmit={handleSubmit} noValidate>
          {error && <Notice announce="assertive" tone="danger">{error}</Notice>}
          {FIELDS.map((field) => (
            <FormField
              key={field.name}
              id={`quick-interest-${field.name}`}
              label={field.label}
              error={gaps[field.name] || undefined}
              required
            >
              <Input
                type={field.type || 'text'}
                name={field.name}
                value={answers[field.name]}
                autoComplete={field.autoComplete}
                inputMode={field.inputMode}
                placeholder={field.placeholder}
                maxLength={field.name.endsWith('Name') ? 80 : undefined}
                onChange={(event) => setField(field.name, event.target.value)}
              />
            </FormField>
          ))}
          <Checkbox
            id="quick-interest-consent"
            name="contactConsent"
            label={referralConsentText(companyName)}
            checked={answers.contactConsent}
            onChange={(event) => setField('contactConsent', event.target.checked)}
            error={gaps.contactConsent || undefined}
            required
          />
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>Send</Button>
          <Button type="button" variant="ghost" fullWidth onClick={onBack} disabled={busy}>Back</Button>
        </form>
      </Card>
    </div>
  );
}

export default QuickInterestForm;
