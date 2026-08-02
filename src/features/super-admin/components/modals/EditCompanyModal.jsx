import React, { useId, useState, useEffect } from 'react';
import { updateCompany } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase';
import { X, CreditCard } from 'lucide-react';
import {
  Button,
  ChoiceGroup,
  FormField,
  IconButton,
  Input,
  Label,
  Radio,
} from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

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
 *  - Hand-built overlay replaced by the shared accessible `Modal`.
 *  - Unnamed icon-only close control.
 *  - The save status message was plain text and never announced; it is now a
 *    live region, and the error case is `role="alert"`.
 *  - Duplicate submission: Save was disabled during the request but the dialog
 *    could still be dismissed mid-flight; Escape/backdrop are now suppressed
 *    while saving.
 *
 * Documented feature-owned exception: the logo file input stays a raw
 * `<input type="file">` — the design system still has no approved file-input
 * contract (the same exception already recorded for the public application and
 * PEV result upload).
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
      className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
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
            <Label htmlFor={logoId}>Company Logo</Label>
            <div className="mt-ds-1 flex items-center gap-ds-4">
              {formData.companyLogoUrl && (
                <img
                  src={formData.companyLogoUrl}
                  alt="Current company logo"
                  className="h-16 w-16 rounded-ds-lg border border-ds-border-subtle bg-ds-surface-subtle object-contain p-1"
                />
              )}
              {/* Feature-owned exception: no approved file-input contract yet. */}
              <input
                type="file"
                id={logoId}
                className="w-full rounded-ds-lg border border-ds-border p-ds-3 text-ds-sm text-ds-content"
                onChange={handleFileChange}
                accept="image/png, image/jpeg"
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
