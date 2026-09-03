import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import DynamicRow from '@shared/components/form/DynamicRow';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import { Badge, Button, FormSection } from '@/design-system/components';
import { EMPTY_EMPLOYER } from '@features/driver-app/components/application/steps/components/employmentRowShapes';
import { employerSignature, isLockedEmployerRow } from '@/config/applicationLockedFields';

/**
 * Employment history, as the carrier can fill it in, plus the lock.
 *
 * The wizard's own employer row is the driver's form and stays that way. This is
 * the carrier's shorter version of it: who, when, and why they left — the fields a
 * recruiter reading a PSP report or a driver's own file can actually answer.
 *
 * Locking is per row and explicit. It says "this carrier is on the safety record I
 * used to start this application", which is a claim only the person holding that
 * report can make — so it is a button here rather than something inferred from a
 * row being filled in. What it does to the driver is narrow and stated on the
 * button: the name and USDOT number stop being editable, and everything else about
 * the row stays theirs.
 */
export function PreparedEmployersPanel({ formData, updateFormData, lockedEmployers, onLock, onUnlock }) {
    const ty = new Date().getFullYear();

    const renderRow = (index, item, handleChange) => {
        const locked = isLockedEmployerRow(item, lockedEmployers);
        const signature = employerSignature(item);
        return (
            <div className="space-y-ds-3">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    {locked
                        ? <Badge tone="info">Locked — the driver cannot change who this is</Badge>
                        : <span className="text-ds-xs text-ds-content-muted">The driver can edit every field on this row.</span>}
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!signature}
                        onClick={() => (locked ? onUnlock(signature) : onLock([item]))}
                    >
                        {locked
                            ? <><Unlock size={14} aria-hidden="true" /> Unlock</>
                            : <><Lock size={14} aria-hidden="true" /> Lock this employer</>}
                    </Button>
                </div>
                <InputField
                    label="Company name"
                    id={`prep-emp-name-${index}`}
                    name="companyName"
                    value={item.companyName}
                    onChange={handleChange}
                />
                <InputField
                    label="USDOT number"
                    id={`prep-emp-dot-${index}`}
                    name="dotNumber"
                    value={item.dotNumber}
                    onChange={handleChange}
                    placeholder="Optional"
                />
                <InputField
                    label="Position held"
                    id={`prep-emp-position-${index}`}
                    name="position"
                    value={item.position}
                    onChange={handleChange}
                />
                <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                    <DateTripletField
                        label="Start date"
                        idPrefix={`prep-emp-start-${index}`}
                        name="startDate"
                        value={item.startDate}
                        onChange={handleChange}
                        maxToday={true}
                        minYear={ty - 40}
                        helpText="Leave blank for the driver to fill in."
                    />
                    <DateTripletField
                        label="End date"
                        idPrefix={`prep-emp-end-${index}`}
                        name="endDate"
                        value={item.endDate}
                        onChange={handleChange}
                        maxToday={true}
                        minYear={ty - 40}
                        helpText="Leave blank for the driver to fill in."
                    />
                </div>
                <InputField
                    label="Reason for leaving"
                    id={`prep-emp-reason-${index}`}
                    name="reasonForLeaving"
                    value={item.reasonForLeaving}
                    onChange={handleChange}
                    placeholder="Usually the driver's to answer"
                />
            </div>
        );
    };

    return (
        <FormSection
            title="Employment history"
            description="A PSP report shows inspections and crashes, not employment dates. Lock a carrier to fix who it is; the driver supplies when they worked there and why they left."
        >
            <DynamicRow
                listKey="employers"
                formData={formData}
                updateFormData={updateFormData}
                renderRow={renderRow}
                initialItemState={{ ...EMPTY_EMPLOYER }}
                addButtonLabel="+ Add employer"
            />
        </FormSection>
    );
}

export default PreparedEmployersPanel;
