import React, { useId, useState, useEffect } from 'react';
import { updateCompany } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase';
import { X, CreditCard, SlidersHorizontal } from 'lucide-react';
import {
  Button,
  ChoiceGroup,
  FileInput,
  FormField,
  IconButton,
  Input,
  Radio,
} from '@/design-system/components';
import { Modal } from '@design-system/patterns';
import { ApplicationRulesPanel } from '@features/settings/components/rules/ApplicationRulesPanel';

/**
 * Super Admin company editor.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * `updateCompany(companyDoc.id, companyData, originalSlug)` call and the exact
 * shape of `companyData` (including `appSlug.toLowerCase().trim()` and
 * `state.toUpperCase()`), the `uploadCompanyLogo` sequence, the 1500 ms
 * close delay after a successful save, and every frozen string are unchanged.
 * The `edit-company-modal` id is preserved for existing selectors.
 *
 * Fixed here:
 *  - **Duplicate DOM ids**: both plan radios rendered `id="planType"`. Duplicate
 *    ids are invalid, break `<label for>` association, and make the two options
 *    indistinguishable to assistive technology. They are now one properly
 *    grouped `ChoiceGroup` of `Radio`s with distinct ids.
 *  - The plan choice was communicated by border/ring colour only.
 *  - Hand-built overlay replaced by the approved accessible `Modal`.
 *  - Unnamed icon-only close control.
 *  - The save status message was plain text and never announced; it is now a
 *    live region, and the error case is `role="alert"`.
 *  - Duplicate submission: Save was disabled during the request but the dialog
 *    could still be dismissed mid-flight; Escape/backdrop are now suppressed
 *    while saving.
 *
 * The logo upload uses the approved `FileInput` (added 2026-08-21), which
 * closed the file-input gap this file used to record as an exception. The
 * picker's keyboard path and accessible name are the primitive's; the accepted
 * types and what happens to the file stay here.
 *
 * Application Rules (2026-09-02): a super admin configures a selected company's
 * driver-application behaviour from here, with the same panel the company's own
 * admins see under Settings → Company Profile → Application Rules. The rules are
 * written only when this editor touched them, so saving a name change leaves a
 * company's rules — or its absence of rules — exactly as they were.
 */
function TextField({ id, label, ...props }) {
  return (
    <FormField id={id} label={label}>
      <Input id={id} {...props} />
    </FormField>
  );
}

export function EditCompanyModal({ companyDoc, onClose, onSave }) {
  const [formData, setFormData] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [originalSlug, setOriginalSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [applicationRules, setApplicationRules] = useState(undefined);
  const [rulesTouched, setRulesTouched] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const titleId = useId();
  const logoId = useId();
  const planGroupId = useId();

  useEffect(() => {
    if (companyDoc) {
      const company = companyDoc.data();
      setFormData({
        companyName: company.companyName || '',
        appSlug: company.appSlug || '',
        phone: company.contact?.phone || '',
        email: company.contact?.email || '',
        street: company.address?.street || '',
        city: company.address?.city || '',
        state: company.address?.state || '',
        zip: company.address?.zip || '',
        mcNumber: company.legal?.mcNumber || '',
        dotNumber: company.legal?.dotNumber || '',
        companyLogoUrl: company.companyLogoUrl || '',
        planType: company.planType || 'free', // Default to Free
      });
      setOriginalSlug(company.appSlug || '');
      setApplicationRules(company.applicationRules);
      setRulesTouched(false);
    }
  }, [companyDoc]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setLogoFile(e.target.files[0]);
    } else {
      setLogoFile(null);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage('');
    setMessageType('');

    let newLogoUrl = formData.companyLogoUrl;
    try {
      if (logoFile) {
        setMessage('Uploading logo...');
        newLogoUrl = await uploadCompanyLogo(companyDoc.id, logoFile);
      }

      const companyData = {
        companyName: formData.companyName,
        appSlug: formData.appSlug.toLowerCase().trim(),
        address: {
          street: formData.street, city: formData.city,
          state: formData.state.toUpperCase(), zip: formData.zip,
        },
        contact: { phone: formData.phone, email: formData.email },
        legal: { mcNumber: formData.mcNumber, dotNumber: formData.dotNumber },
        companyLogoUrl: newLogoUrl,
        planType: formData.planType, // Save the plan type!
      };
      if (rulesTouched && applicationRules) companyData.applicationRules = applicationRules;

      setMessage('Saving company data...');
      await updateCompany(companyDoc.id, companyData, originalSlug);

      setMessage('Successfully saved!');
      setMessageType('success');
      await onSave();
      setTimeout(onClose, 1500);
    } catch (error) {
      console.error("Error updating company:", error);
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      closeOnBackdrop={!loading}
      closeOnEscape={!loading}
      size="2xl"
      scroll="body"
    >
      <div id="edit-company-modal" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle p-ds-5">
          <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Edit Company</h2>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            <X size={20} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 space-y-ds-6 overflow-y-auto p-ds-5">

          {/* --- Subscription Plan Section --- */}
          <div className="rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
            <CreditCard
              size={20}
              aria-hidden="true"
              className="mb-ds-2 inline-block text-ds-status-info-fg"
            />
            <ChoiceGroup
              id={planGroupId}
              legend="Subscription Plan"
              orientation="horizontal"
            >
              <Radio
                name="planType"
                value="free"
                label="Free Plan"
                description="Standard features"
                checked={formData.planType === 'free'}
                onChange={() => setFormData({ ...formData, planType: 'free' })}
              />
              <Radio
                name="planType"
                value="paid"
                label="Paid Plan"
                description="All premium features"
                checked={formData.planType === 'paid'}
                onChange={() => setFormData({ ...formData, planType: 'paid' })}
              />
            </ChoiceGroup>
          </div>

          <hr className="border-ds-border-subtle" />

          <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
            <TextField id="companyName" label="Company Name" required value={formData.companyName} onChange={handleChange} />
            <TextField id="appSlug" label="Unique URL Slug" required value={formData.appSlug} onChange={handleChange} />
          </div>

          <div>
            <div className="flex items-center gap-ds-4">
              {formData.companyLogoUrl && (
                <img
                  src={formData.companyLogoUrl}
                  alt="Current company logo"
                  className="h-16 w-16 rounded-ds-lg border border-ds-border-subtle bg-ds-surface-subtle object-contain p-1"
                />
              )}
              <FileInput
                id={logoId}
                label="Company Logo"
                description="PNG or JPEG."
                buttonLabel="Choose a logo"
                accept="image/png, image/jpeg"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
            <TextField id="phone" label="Contact Phone" type="tel" value={formData.phone} onChange={handleChange} />
            <TextField id="email" label="Contact Email" type="email" value={formData.email} onChange={handleChange} />
          </div>

          <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-3">
            <TextField id="city" label="City" value={formData.city} onChange={handleChange} />
            <TextField id="state" label="State" value={formData.state} onChange={handleChange} maxLength="2" />
            <TextField id="zip" label="ZIP Code" value={formData.zip} onChange={handleChange} />
          </div>

          <hr className="border-ds-border-subtle" />

          {/* The company's driver-application rules, configurable without code. */}
          <div className="space-y-ds-3">
            <Button
              variant="secondary"
              onClick={() => setRulesOpen((open) => !open)}
              aria-expanded={rulesOpen}
              aria-controls="edit-company-application-rules"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              {rulesOpen ? 'Hide application rules' : 'Application rules for this company'}
            </Button>
            {rulesOpen && (
              <div id="edit-company-application-rules">
                <ApplicationRulesPanel
                  rules={applicationRules}
                  onChange={(next) => { setApplicationRules(next); setRulesTouched(true); }}
                />
              </div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
          <p
            role={messageType === 'error' ? 'alert' : 'status'}
            className={`text-ds-sm ${messageType === 'success' ? 'text-ds-status-success-fg' : 'text-ds-status-danger-fg'}`}
          >
            {message}
          </p>
          <div className="flex gap-ds-3">
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
