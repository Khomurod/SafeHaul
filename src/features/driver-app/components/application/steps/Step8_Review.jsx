import React from 'react';
import { formatIsoDateUs, formatMonthYearUs } from '@shared/utils/dateFormHelpers';
import {
    User, MapPin, Truck, Briefcase, FileCheck,
    AlertCircle, IdCard, ShieldCheck, Beaker, Edit2,
    CheckCircle2
} from 'lucide-react';
import { Badge, Button, Card, FieldDisplay } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';

/**
 * Review & confirm step. Presentation migrated to the approved `Card` /
 * `Button` / `Badge` / `FieldDisplay` primitives (2026-07-27).
 *
 * Unchanged: the SSN masking (`***-**-` + last four), the yes/no → wording
 * mapping for every disclosure, the `residence-3-years === 'no'` previous-address
 * branch with its legacy `prevStreet` fallback, the date display helpers, the
 * uploaded-document key list, the `emptyText` strings, the per-section Edit
 * target indices (0,0,1,2,3,4,5,6 — deliberately 0-based wizard steps, not the
 * displayed step numbers), and the "Confirm & Proceed" label the guest specs
 * click.
 *
 * DEFECTS FIXED (2026-07-27):
 * - Each Edit control's accessible name was the bare word "Edit", so a screen
 *   reader heard eight identical controls. Each now names its section.
 * - Section titles were `<h4>` with an `<h3>` page heading elsewhere; they are
 *   now `<h2>` under the wizard's `<h1>`. The nested "Almost Done!" callout was
 *   also an `<h3>` outranking them.
 * - Felony history signalled "YES" with red text alone; it now carries a
 *   `danger` `Badge` so the emphasis survives greyscale and colour blindness.
 */

const ReviewSection = ({ title, icon: Icon, onEdit, children }) => (
    <Card padding="none" className="mb-ds-6 overflow-hidden">
        <div className="flex items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-3">
            <h2 className="flex items-center gap-ds-2 text-ds-body font-bold text-ds-content">
                {Icon && <Icon size={18} className="shrink-0 text-ds-action-primary" aria-hidden="true" />}
                {title}
            </h2>
            <Button variant="ghost" size="md" onClick={onEdit} aria-label={`Edit ${title}`}>
                <Edit2 size={14} aria-hidden="true" /> Edit
            </Button>
        </div>
        <div className="grid grid-cols-1 gap-x-ds-8 gap-y-ds-4 p-ds-5 md:grid-cols-2">
            {children}
        </div>
    </Card>
);

function displayAnyDate(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatIsoDateUs(s);
    if (/^\d{4}-\d{2}$/.test(s)) return formatMonthYearUs(s);
    return s;
}

const ReviewItem = ({ label, value, badge = null, fullWidth = false }) => {
    if (value === null || value === undefined || value === "") return null;

    return (
        <FieldDisplay
            label={label}
            className={`min-w-0 ${fullWidth ? 'col-span-1 md:col-span-2' : ''}`}
        >
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>
            {badge && <span className="ml-ds-2 inline-block align-middle">{badge}</span>}
        </FieldDisplay>
    );
};

const ReviewGroupLabel = ({ children }) => (
    <h3 className="mb-ds-2 block text-ds-xs font-bold uppercase tracking-wider text-ds-content-muted">{children}</h3>
);

const ReviewList = ({ items, renderItem, emptyText = "None recorded" }) => {
    if (!items || items.length === 0) {
        return <p className="col-span-2 text-ds-sm italic text-ds-content-muted">{emptyText}</p>;
    }
    return (
        <ul className="col-span-2 space-y-ds-2">
            {items.map((item, index) => (
                <li key={index} className="rounded-ds-sm border border-ds-border-subtle p-ds-3 text-ds-sm text-ds-content-secondary">
                    {renderItem(item, index)}
                </li>
            ))}
        </ul>
    );
};

const Step8_Review = ({ formData, onNavigate }) => {

    // Corrected Mapping for Navigation (0-based index)
    // 0: Contact (Personal + Address)
    // 1: Qualifications
    // 2: License
    // 3: Violations
    // 4: Accidents
    // 5: Employment
    // 6: General / HOS
    const navigateToStep = (stepIndex) => {
        onNavigate(stepIndex);
    };

    // Helper to nicely format file names
    const getFileName = (key) => {
        const fileData = formData[key];
        if (fileData && fileData.name) return `📄 ${fileData.name} (Uploaded)`;
        return null;
    };

    const hasFelony = formData['has-felony'] === 'yes';

    return (
        <div id="page-8" className="form-step space-y-ds-8">
            <div>
                <h2 className="text-ds-heading-md font-bold text-ds-content">Review &amp; Confirm</h2>
                <p className="mt-ds-1 text-ds-content-muted">Please ensure all details are accurate before signing.</p>
            </div>

            <Card padding="md" className="flex items-start gap-ds-3 border-ds-status-success-border bg-ds-status-success-bg">
                <CheckCircle2 className="mt-ds-1 shrink-0 text-ds-status-success-fg" size={24} aria-hidden="true" />
                <div className="min-w-0">
                    <p className="font-bold text-ds-status-success-fg">Almost Done!</p>
                    <p className="mt-ds-1 text-ds-sm text-ds-status-success-fg">
                        Review your application below. If you need to make changes, tap the <strong>Edit</strong> button on any section.
                    </p>
                </div>
            </Card>

            <ReviewSection title="Personal Information" icon={User} onEdit={() => navigateToStep(0)}>
                <ReviewItem label="Full Name" value={`${formData.firstName} ${formData.middleName || ''} ${formData.lastName} ${formData.suffix || ''}`} />
                <ReviewItem label="Date of Birth" value={displayAnyDate(formData.dob)} />
                <ReviewItem label="SSN" value={formData.ssn ? `***-**-${String(formData.ssn).slice(-4)}` : 'Not Provided'} />
                <ReviewItem label="Phone" value={formData.phone} />
                <ReviewItem label="Email" value={formData.email} />
                <ReviewItem label="Referral Source" value={formData.referralSource} />
                {formData['known-by-other-name'] === 'yes' && (
                    <ReviewItem label="Other Names" value={formData.otherName} fullWidth />
                )}
            </ReviewSection>

            <ReviewSection title="Address History" icon={MapPin} onEdit={() => navigateToStep(0)}>
                <ReviewItem label="Current Address" value={`${formData.street || ''}, ${formData.city || ''}, ${formData.state || ''} ${formData.zip || ''}`} fullWidth />
                <ReviewItem label="3+ Years at Current?" value={formData['residence-3-years'] === 'yes' ? 'Yes' : 'No'} />

                {formData['residence-3-years'] === 'no' && (
                    <div className="col-span-2 mt-ds-2 border-t border-ds-border-subtle pt-ds-2">
                        <ReviewGroupLabel>Previous Address(es)</ReviewGroupLabel>
                        {Array.isArray(formData.previousAddresses) && formData.previousAddresses.length > 0 ? (
                            formData.previousAddresses.map((addr, i) => {
                                const period =
                                    addr.startDate || addr.endDate
                                        ? ` (${displayAnyDate(addr.startDate) || addr.startDate || '?'} – ${displayAnyDate(addr.endDate) || addr.endDate || '?'})`
                                        : '';
                                return (
                                    <ReviewItem
                                        key={i}
                                        label={`Previous Address ${i + 1}`}
                                        value={`${addr.street || ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}${period}`}
                                        fullWidth
                                    />
                                );
                            })
                        ) : (
                            <ReviewItem
                                label="Previous Address"
                                value={`${formData.prevStreet || ''}, ${formData.prevCity || ''}, ${formData.prevState || ''} ${formData.prevZip || ''}`}
                                fullWidth
                            />
                        )}
                    </div>
                )}
            </ReviewSection>

            <ReviewSection title="Qualifications" icon={ShieldCheck} onEdit={() => navigateToStep(1)}>
                <ReviewItem label="Legal to Work in U.S." value={formData['legal-work'] === 'yes' ? 'Yes' : 'No'} />
                <ReviewItem label="English Fluency" value={formData['english-fluency'] === 'yes' ? 'Fluent' : 'Not Fluent'} />
                <ReviewItem label="Commercial Experience" value={formData['experience-years']} />
                <ReviewItem label="Drug Test History" value={formData['drug-test-positive'] === 'yes' ? 'Positive/Refusal Record' : 'No Issues'} />
                <ReviewItem label="Return to Duty" value={formData['dot-return-to-duty']} />
            </ReviewSection>

            <ReviewSection title="License & Credentials" icon={IdCard} onEdit={() => navigateToStep(2)}>
                <ReviewItem label="License Number" value={formData.cdlNumber} />
                <ReviewItem label="State & Class" value={`${formData.cdlState} (Class ${formData.cdlClass})`} />
                <ReviewItem label="Expiration Date" value={displayAnyDate(formData.cdlExpiration)} />
                <ReviewItem label="Endorsements" value={formData.endorsements || 'None'} fullWidth />

                <div className="col-span-2 mt-ds-2 grid grid-cols-1 gap-ds-4 border-t border-ds-border-subtle pt-ds-2 md:grid-cols-2">
                    <ReviewItem label="TWIC Card" value={formData['has-twic'] === 'yes' ? `Yes (Exp: ${displayAnyDate(formData.twicExpiration) || formData.twicExpiration || '—'})` : 'No'} />
                </div>

                <div className="col-span-2 mt-ds-2 border-t border-ds-border-subtle pt-ds-2">
                    <ReviewGroupLabel>Uploaded Documents</ReviewGroupLabel>
                    <div className="flex flex-wrap gap-ds-2">
                        {[
                            getFileName('cdl-front'),
                            getFileName('cdl-back'),
                            getFileName('medical-card-upload'),
                            getFileName('twic-card-upload'),
                            getFileName('ssc-upload'),
                            getFileName('mvr-upload'),
                            getFileName('mvr-consent-upload'),
                            getFileName('drug-test-consent-upload')
                        ].map((file, i) => file && (
                            <Badge key={i} tone="info">{file}</Badge>
                        ))}
                    </div>
                </div>
            </ReviewSection>

            <ReviewSection title="Driving History" icon={AlertCircle} onEdit={() => navigateToStep(3)}>
                <div className="col-span-2 mb-ds-4 grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                    <ReviewItem label="License Revoked?" value={formData['revoked-licenses'] === 'yes' ? 'YES' : 'No'} />
                    <ReviewItem label="Suspended Convictions?" value={formData['driving-convictions'] === 'yes' ? 'YES' : 'No'} />
                    <ReviewItem label="Drug/Alcohol Issues?" value={formData['drug-alcohol-convictions'] === 'yes' ? 'YES' : 'No'} />
                </div>

                <div className="col-span-2">
                    <ReviewGroupLabel>Moving Violations (3 Years)</ReviewGroupLabel>
                    <ReviewList
                        items={formData.violations}
                        renderItem={(v) => (
                            <span className="flex flex-wrap justify-between gap-ds-2">
                                <span className="font-bold">{v.charge}</span>
                                <span className="text-ds-content-muted">{displayAnyDate(v.date) || v.date} ({v.location})</span>
                            </span>
                        )}
                    />
                </div>
            </ReviewSection>

            <ReviewSection title="Accident History" icon={Truck} onEdit={() => navigateToStep(4)}>
                <div className="col-span-2">
                    <ReviewList
                        items={formData.accidents}
                        renderItem={(a) => (
                            <>
                                <span className="flex flex-wrap justify-between gap-ds-2 font-bold">
                                    <span>{a.city}, {a.state}</span>
                                    <span>{displayAnyDate(a.date) || a.date}</span>
                                </span>
                                <span className="mt-ds-1 block text-ds-content-secondary">{a.details}</span>
                                <span className="mt-ds-1 block text-ds-xs text-ds-content-muted">
                                    Preventable: {a.preventable} | Commercial: {a.commercial}
                                </span>
                            </>
                        )}
                        emptyText="No accidents listed in the past 3 years."
                    />
                </div>
            </ReviewSection>

            <ReviewSection title="Work History" icon={Briefcase} onEdit={() => navigateToStep(5)}>
                <div className="col-span-2 space-y-ds-4">
                    <div>
                        <ReviewGroupLabel>Employers</ReviewGroupLabel>
                        <ReviewList
                            items={formData.employers}
                            renderItem={(e) => (
                                <>
                                    <span className="flex flex-wrap justify-between gap-ds-2 font-bold text-ds-content">
                                        <span>{e.companyName || e.name || 'Unknown'}</span>
                                        <span className="rounded-ds-sm bg-ds-status-neutral-bg px-ds-2 text-ds-xs text-ds-status-neutral-fg">
                                            {displayAnyDate(e.startDate) || e.startDate || '??'} – {displayAnyDate(e.endDate) || e.endDate || 'Present'}
                                        </span>
                                    </span>
                                    <span className="block text-ds-content-secondary">{e.position}</span>
                                    {(e.address || e.city || e.state) && (
                                        <span className="mt-ds-1 block text-ds-sm text-ds-content-secondary">
                                            {[e.address, [e.city, e.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                    <span className="mt-ds-1 block space-y-0.5 text-ds-xs text-ds-content-muted">
                                        {e.dotNumber && <span className="block">USDOT: {e.dotNumber}</span>}
                                        {e.phone && <span className="block">Company phone: {e.phone}</span>}
                                        {e.companyEmail && <span className="block">Company email: {e.companyEmail}</span>}
                                        {e.supervisorName && <span className="block">Supervisor: {e.supervisorName}</span>}
                                        {e.supervisorPhone && <span className="block">Supervisor phone: {e.supervisorPhone}</span>}
                                        {e.supervisorEmail && <span className="block">Supervisor email: {e.supervisorEmail}</span>}
                                    </span>
                                </>
                            )}
                        />
                    </div>

                    {formData.unemployment && formData.unemployment.length > 0 && (
                        <div className="border-t border-ds-border-subtle pt-ds-2">
                            <ReviewGroupLabel>Unemployment Gaps</ReviewGroupLabel>
                            <ReviewList
                                items={formData.unemployment}
                                renderItem={(u) => (
                                    <span>{displayAnyDate(u.startDate) || u.startDate} - {displayAnyDate(u.endDate) || u.endDate}: {u.details}</span>
                                )}
                            />
                        </div>
                    )}
                </div>
            </ReviewSection>

            <ReviewSection title="Operations & Compliance" icon={Beaker} onEdit={() => navigateToStep(6)}>
                {formData.businessName && (
                    <div className="col-span-2 mb-ds-2 rounded-ds-sm border border-ds-border-subtle p-ds-3">
                        <ReviewItem label="Owner Operator Info" value={`${formData.businessName} (EIN: ${formData.ein})`} fullWidth />
                    </div>
                )}

                <ReviewItem label="Straight Truck Exp" value={`${formData.expStraightTruckExp} yrs`} />
                <ReviewItem label="Semi-Trailer Exp" value={`${formData.expSemiTrailerExp} yrs`} />

                <ReviewItem label="Emergency Contact" value={`${formData.ec1Name} (${formData.ec1Relationship}) - ${formData.ec1Phone}`} fullWidth />

                {/* HOS Section Removed - No longer collected in driver application */}

                <div className="col-span-2 mt-ds-2 border-t border-ds-border-subtle pt-ds-2">
                    <ReviewItem
                        label="Felony History"
                        value={hasFelony ? `YES - ${formData.felonyExplanation}` : 'No Felony Convictions'}
                        badge={hasFelony ? <Badge tone="danger">Disclosed</Badge> : null}
                        fullWidth
                    />
                </div>
            </ReviewSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={() => onNavigate('next')}
                continueLabel="Confirm & Proceed"
                continueIcon={<FileCheck size={18} aria-hidden="true" />}
                continueTone="success"
            />
        </div>
    );
};

export default Step8_Review;
