import React from 'react';
import { Icon, Lock, Unlock } from '@design-system/icons';
import DynamicRow from '@shared/components/form/DynamicRow';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import { StateSelectField } from '@features/driver-app/components/application/steps/components/StateSelectField';
import { NORTH_AMERICAN_REGION_GROUPS } from '@shared/utils/northAmericanRegions';
import { Badge, Button, FieldDisplay, FormSection } from '@/design-system/components';
import { EMPTY_EMPLOYER } from '@features/driver-app/components/application/steps/components/employmentRowShapes';
import { employerSignature, isLockedEmployerRow } from '@/config/applicationLockedFields';

/**
 * Employment history, as the carrier can fill it in, plus the lock.
 *
 * The wizard's own employer row is the driver's form and stays that way. This is
 * the carrier's shorter version of it: who, where to reach them, when, and why
 * they left — the fields a recruiter reading a PSP report or a driver's own file
 * can actually answer. A PSP carrier's address and phone come from FMCSA by its
 * USDOT number (`fillEmployersFromFmcsa`) and show here to be checked.
 *
 * Locking is per row and explicit. It says "this carrier is on the safety record I
 * used to start this application", which is a claim only the person holding that
 * report can make — so it is a button here rather than something inferred from a
 * row being filled in. What it does to the driver is narrow and stated on the
 * button: the name and USDOT number stop being editable, and everything else about
 * the row stays theirs.
 *
 * ## A locked row's identity is read-only HERE too
 *
 * The lock stores a snapshot of the row's identity, so the carrier may not go on
 * editing the fields that snapshot is taken from: the two would drift, and the
 * driver would be blocked at submission on a field they are not allowed to touch
 * — a corrected NAME on a row locked by USDOT number trips
 * `locked-employer-changed` while the wizard renders that identity as a record
 * rather than a field.
 *
 * So the identity is a read-only display while the lock exists, and correcting it
 * means Unlock → correct → Lock, which mints a lock that matches. That is the same
 * rule the design system already states for a field its viewer may not change, and
 * the same shape the driver's wizard uses — the wording differs because the
 * audience does. `reconcileLockedEmployers` covers the edit that leaves nothing to
 * render: a deleted row.
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
                            ? <><Icon icon={Unlock} size="sm" /> Unlock to correct</>
                            : <><Icon icon={Lock} size="sm" /> Lock this employer</>}
                    </Button>
                </div>
                {locked ? (
                    <div
                        className="space-y-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3"
                        data-testid={`prep-emp-locked-${index}`}
                    >
                        <FieldDisplay label="Company name" emphasis="strong">
                            {item.companyName || `USDOT ${item.dotNumber}`}
                        </FieldDisplay>
                        {item.dotNumber && <FieldDisplay label="USDOT number">{item.dotNumber}</FieldDisplay>}
                        <p className="text-ds-xs text-ds-content-muted">
                            The driver signs an application that says this is who they drove for, so it is fixed
                            while the lock is on. Unlock to correct it — that removes the lock, and you can put it
                            back afterwards.
                        </p>
                    </div>
                ) : (
                    <>
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
                    </>
                )}
                <InputField
                    label="Street address"
                    id={`prep-emp-street-${index}`}
                    name="address"
                    value={item.address}
                    onChange={handleChange}
                />
                <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
                    <InputField
                        label="City"
                        id={`prep-emp-city-${index}`}
                        name="city"
                        value={item.city}
                        onChange={handleChange}
                    />
                    <StateSelectField
                        id={`prep-emp-state-${index}`}
                        name="state"
                        groups={NORTH_AMERICAN_REGION_GROUPS}
                        label="State / Province"
                        placeholder="Select state or province"
                        required={false}
                        value={item.state}
                        onChange={(e) => handleChange(e.target.name, e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
                    <InputField
                        label="Company phone"
                        id={`prep-emp-phone-${index}`}
                        name="phone"
                        type="tel"
                        value={item.phone}
                        onChange={handleChange}
                    />
                    <InputField
                        label="Company email"
                        id={`prep-emp-email-${index}`}
                        name="companyEmail"
                        type="email"
                        value={item.companyEmail}
                        onChange={handleChange}
                    />
                </div>
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
