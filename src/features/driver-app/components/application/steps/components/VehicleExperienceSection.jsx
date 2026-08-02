import React from 'react';
import { FormField, FormSection, Select } from '@/design-system/components';

/**
 * Six paired miles/experience dropdowns. Presentation migrated to the approved
 * `FormSection` / `FormField` / `Select` primitives (2026-07-27).
 *
 * Unchanged: every field key, every element id, and the defaults each select
 * falls back to when the applicant has not answered (`'0'` for miles,
 * `'<6 months'` for experience) — these defaults are what gets saved, so they
 * must keep being the rendered value.
 */
const VEHICLE_TYPES = [
    { label: 'Straight Truck', milesId: 'exp-straight-truck-miles', milesName: 'expStraightTruckMiles', expId: 'exp-straight-truck-exp', expName: 'expStraightTruckExp', milesLabel: 'Miles Driven in Straight Truck', expLabel: 'Experience in Straight Truck' },
    { label: 'Tractor + Semi Trailer', milesId: 'exp-semi-trailer-miles', milesName: 'expSemiTrailerMiles', expId: 'exp-semi-trailer-exp', expName: 'expSemiTrailerExp', milesLabel: 'Miles Driven in Tractor + Semi Trailer', expLabel: 'Experience in Tractor + Semi Trailer' },
    { label: 'Tractor + Two Trailers', milesId: 'exp-two-trailers-miles', milesName: 'expTwoTrailersMiles', expId: 'exp-two-trailers-exp', expName: 'expTwoTrailersExp', milesLabel: 'Miles Driven in Tractor + Two Trailers', expLabel: 'Experience in Tractor + Two Trailers' },
];

const VehicleExperienceSection = ({ formData, updateFormData, milesOptions, expOptions }) => {
    const handleChange = (e) => updateFormData(e.target.name, e.target.value);

    return (
        <FormSection title="Experience by Vehicle Type">
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                {VEHICLE_TYPES.map((type) => (
                    <React.Fragment key={type.label}>
                        <FormField id={type.milesId} label={type.milesLabel}>
                            <Select
                                name={type.milesName}
                                value={formData[type.milesName] || '0'}
                                onChange={handleChange}
                            >
                                {milesOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </FormField>
                        <FormField id={type.expId} label={type.expLabel}>
                            <Select
                                name={type.expName}
                                value={formData[type.expName] || '<6 months'}
                                onChange={handleChange}
                            >
                                {expOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </FormField>
                    </React.Fragment>
                ))}
            </div>
        </FormSection>
    );
};

export default VehicleExperienceSection;
