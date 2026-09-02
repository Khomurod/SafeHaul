import React from 'react';
import InputField from '@shared/components/form/InputField';
import MonthYearField from '@shared/components/form/MonthYearField';
import DynamicRow from '@shared/components/form/DynamicRow';
import { FieldMessage } from '@/design-system/components';
import { StateSelectField } from './StateSelectField';

/**
 * Previous Address History (past 3 years).
 *
 * Gated by the SAME `addressHistory` setting as the three-year question above
 * it (the caller renders neither when the gate is hidden). Row fields stay
 * required regardless of the gate's requiredness: that is per-row completeness,
 * not per-section. A driver who chose to add a previous address is asked to
 * finish it; a driver at a company where the section is optional simply adds no
 * rows.
 *
 * `requiredHint` is the company's `requirePreviousAddressUnderThreeYears` rule
 * talking: when the applicant has lived at their current address for less than
 * 3 years, at least one complete previous address is needed, and the hint says
 * so the moment they answer No — the rule engine refuses Continue and submission
 * with the same sentence.
 */
export function PreviousAddressesSection({ formData, updateFormData, states, ty, requiredHint = false }) {
    return (
        <div className="space-y-ds-3">
            {requiredHint && (
                <FieldMessage tone="help" data-testid="previous-address-hint">
                    You have lived at your current address for less than 3 years, so this carrier needs at least one
                    previous address below.
                </FieldMessage>
            )}
            <DynamicRow
                listKey="previousAddresses"
                title="Previous Addresses (Past 3 Years)"
                formData={formData}
                updateFormData={updateFormData}
                initialItemState={{ street: '', city: '', state: '', zip: '', startDate: '', endDate: '' }}
                addButtonLabel="Add Previous Address"
                renderRow={(index, item, handleRowChange) => (
                    <div className="space-y-ds-4">
                        <InputField
                            label="Address"
                            id={`prev-street-${index}`}
                            name="street"
                            value={item.street}
                            onChange={(n, v) => handleRowChange('street', v)}
                            placeholder="123 Old St"
                            required={true}
                        />
                        <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-3">
                            <InputField
                                label="City"
                                id={`prev-city-${index}`}
                                name="city"
                                value={item.city}
                                onChange={(n, v) => handleRowChange('city', v)}
                                placeholder="City"
                                required={true}
                            />
                            <StateSelectField
                                id={`prev-state-${index}`}
                                name="state"
                                states={states}
                                value={item.state}
                                onChange={(e) => handleRowChange('state', e.target.value)}
                            />
                            <InputField
                                label="ZIP Code"
                                id={`prev-zip-${index}`}
                                name="zip"
                                value={item.zip}
                                onChange={(n, v) => handleRowChange('zip', v)}
                                placeholder="Zip"
                                required={true}
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                            <MonthYearField
                                label="From (month / year)"
                                idPrefix={`prev-start-${index}`}
                                name="startDate"
                                value={item.startDate}
                                onChange={(n, v) => handleRowChange('startDate', v)}
                                required={true}
                                maxToday={true}
                                minYear={ty - 80}
                                helpText="Same easy dropdowns as employment gaps — no calendar picker."
                            />
                            <MonthYearField
                                label="To (month / year)"
                                idPrefix={`prev-end-${index}`}
                                name="endDate"
                                value={item.endDate}
                                onChange={(n, v) => handleRowChange('endDate', v)}
                                required={true}
                                maxToday={true}
                                minYear={ty - 80}
                            />
                        </div>
                    </div>
                )}
            />
        </div>
    );
}

export default PreviousAddressesSection;
