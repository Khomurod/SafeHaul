import React, { useState } from 'react';
import { Badge, Button, FieldMessage, FileInput, FormSection } from '@/design-system/components';
import { useReportImport } from '@features/driver-app/hooks/useReportImport';
import {
    REPORT_KINDS,
    carrierAlreadyListed,
    describeSighting,
    employerFromCarrier,
    licenseFillPlan,
    licensePatch,
    violationAlreadyListed,
    violationFromSuggestion,
} from '../../reportSuggestions';

/**
 * Optional import of an applicant's own PSP report (employment step) or motor
 * vehicle record (licence step). Shown only when the company has switched the
 * source on; see `integrationEnabled`.
 *
 * Everything the report yields is a SUGGESTION with its own Add button. The
 * panel never writes a field that already holds an answer, never adds a row that
 * is already there, and never turns a PSP sighting into employment dates — the
 * three promises `reportSuggestions.js` keeps and its tests pin.
 */
export function ReportImportPanel({ kind, company, formData, updateFormData }) {
    const copy = REPORT_KINDS[kind];
    const companyId = company?.id;
    const { status, suggestions, skippedPages, error, importFile, reset } = useReportImport({ companyId, kind });
    const [licenseApplied, setLicenseApplied] = useState(false);

    const onFileChange = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        setLicenseApplied(false);
        if (file) importFile(file);
    };

    const nextId = (offset = 0) => Date.now() + offset;

    const addCarrier = (carrier, offset = 0) => {
        updateFormData('employers', (current) => {
            const list = Array.isArray(current) ? current : [];
            return carrierAlreadyListed(list, carrier) ? list : [...list, employerFromCarrier(carrier, nextId(offset))];
        });
    };

    const addViolation = (violation, offset = 0) => {
        updateFormData('violations', (current) => {
            const list = Array.isArray(current) ? current : [];
            return violationAlreadyListed(list, violation) ? list : [...list, violationFromSuggestion(violation, nextId(offset))];
        });
        updateFormData('has-violations', 'yes');
    };

    const carriers = Array.isArray(suggestions?.carriers) ? suggestions.carriers : [];
    const violations = Array.isArray(suggestions?.violations) ? suggestions.violations : [];
    const newCarriers = carriers.filter((carrier) => !carrierAlreadyListed(formData?.employers, carrier));
    const newViolations = violations.filter((violation) => !violationAlreadyListed(formData?.violations, violation));
    const plan = suggestions?.license ? licenseFillPlan(formData, suggestions.license) : [];
    const patch = licensePatch(plan);
    const fillable = Object.keys(patch);

    const applyLicense = () => {
        Object.entries(patch).forEach(([field, value]) => updateFormData(field, value));
        setLicenseApplied(true);
    };

    const nothingFound = status === 'ready'
        && carriers.length === 0 && violations.length === 0
        && plan.every((row) => row.action === 'none');

    return (
        <FormSection title={copy.title} description={copy.intro} data-testid={`report-import-${kind}`}>
            <FileInput
                label={copy.uploadLabel}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                loading={status === 'reading'}
                loadingStatus={`Reading your ${copy.documentName}…`}
                onChange={onFileChange}
                buttonLabel="Choose file"
            />
            {status === 'error' && (
                <FieldMessage tone="error" role="alert" data-testid="report-import-error">{error}</FieldMessage>
            )}
            {status === 'ready' && (
                <div className="space-y-ds-4" data-testid="report-import-results">
                    {skippedPages > 0 && (
                        <p className="text-ds-xs text-ds-content-muted">Only the first pages of the file were read; {skippedPages} more were skipped.</p>
                    )}
                    {nothingFound && (
                        <p className="text-ds-sm text-ds-content-secondary" data-testid="report-import-empty">
                            We could not read anything usable from that file. You can try clearer pages, or continue and enter the details yourself.
                        </p>
                    )}

                    {plan.length > 0 && (
                        <div className="space-y-ds-2">
                            <h3 className="text-ds-body-lg font-semibold text-ds-content">License details on your record</h3>
                            <ul className="space-y-ds-1 text-ds-sm" data-testid="license-fill-plan">
                                {plan.map((row) => (
                                    <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-ds-2" data-testid={`license-plan-${row.id}`}>
                                        <span className="text-ds-content">{row.label}: <strong>{row.found || 'not on record'}</strong></span>
                                        {row.action === 'keep' && <Badge tone="neutral">Kept your entry: {row.current}</Badge>}
                                        {row.action === 'fill' && <Badge tone={licenseApplied ? 'success' : 'info'}>{licenseApplied ? 'Filled' : 'Will fill'}</Badge>}
                                    </li>
                                ))}
                            </ul>
                            <Button variant="secondary" size="sm" onClick={applyLicense} disabled={fillable.length === 0 || licenseApplied} data-testid="apply-license-details">
                                {licenseApplied ? 'Details filled' : fillable.length === 0 ? 'Nothing to fill' : `Fill ${fillable.length} empty field${fillable.length === 1 ? '' : 's'}`}
                            </Button>
                        </div>
                    )}

                    {carriers.length > 0 && (
                        <div className="space-y-ds-2">
                            <h3 className="text-ds-body-lg font-semibold text-ds-content">Carriers on your report</h3>
                            <p className="text-ds-xs text-ds-content-muted">
                                A PSP report shows inspections and crashes, not employment dates. Adding a carrier starts an employer entry with its name and USDOT number; you enter the dates and the rest.
                            </p>
                            <ul className="space-y-ds-2" data-testid="carrier-suggestions">
                                {carriers.map((carrier, index) => {
                                    const listed = carrierAlreadyListed(formData?.employers, carrier);
                                    const label = carrier.name || `USDOT ${carrier.dotNumber}`;
                                    return (
                                        <li key={`${carrier.dotNumber}-${carrier.name}-${index}`} className="flex flex-wrap items-center justify-between gap-ds-2 rounded-ds-md border border-ds-border-subtle p-ds-3">
                                            <div className="min-w-0 text-ds-sm">
                                                <div className="font-medium text-ds-content">{label}{carrier.dotNumber && carrier.name ? ` · USDOT ${carrier.dotNumber}` : ''}</div>
                                                <div className="text-ds-xs text-ds-content-muted">{describeSighting(carrier)}</div>
                                            </div>
                                            {listed
                                                ? <Badge tone="neutral">Already in your history</Badge>
                                                : <Button variant="secondary" size="sm" onClick={() => addCarrier(carrier, index)} aria-label={`Add ${label} as an employer`}>Add as employer</Button>}
                                        </li>
                                    );
                                })}
                            </ul>
                            {newCarriers.length > 1 && (
                                <Button variant="ghost" size="sm" onClick={() => newCarriers.forEach((carrier, index) => addCarrier(carrier, index))}>
                                    Add all {newCarriers.length} carriers
                                </Button>
                            )}
                        </div>
                    )}

                    {violations.length > 0 && (
                        <div className="space-y-ds-2">
                            <h3 className="text-ds-body-lg font-semibold text-ds-content">Violations on your {copy.documentName}</h3>
                            <p className="text-ds-xs text-ds-content-muted">Added violations appear under Moving Violations, where you can edit or remove them.</p>
                            <ul className="space-y-ds-2" data-testid="violation-suggestions">
                                {violations.map((violation, index) => {
                                    const listed = violationAlreadyListed(formData?.violations, violation);
                                    return (
                                        <li key={`${violation.date}-${violation.charge}-${index}`} className="flex flex-wrap items-center justify-between gap-ds-2 rounded-ds-md border border-ds-border-subtle p-ds-3">
                                            <div className="min-w-0 text-ds-sm">
                                                <div className="font-medium text-ds-content">{violation.charge}</div>
                                                <div className="text-ds-xs text-ds-content-muted">{[violation.date || 'date not shown', violation.location].filter(Boolean).join(' · ')}</div>
                                            </div>
                                            {listed
                                                ? <Badge tone="neutral">Already listed</Badge>
                                                : <Button variant="secondary" size="sm" onClick={() => addViolation(violation, index)} aria-label={`Add violation: ${violation.charge}`}>Add</Button>}
                                        </li>
                                    );
                                })}
                            </ul>
                            {newViolations.length > 1 && (
                                <Button variant="ghost" size="sm" onClick={() => newViolations.forEach((violation, index) => addViolation(violation, index))}>
                                    Add all {newViolations.length} violations
                                </Button>
                            )}
                        </div>
                    )}

                    <Button variant="ghost" size="sm" onClick={() => { reset(); setLicenseApplied(false); }}>Clear suggestions</Button>
                </div>
            )}
        </FormSection>
    );
}

export default ReportImportPanel;
