import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DateTripletField from '@shared/components/form/DateTripletField';
import MonthYearField from '@shared/components/form/MonthYearField';
import { MILITARY_BRANCH_OPTIONS } from '@/config/form-options';
import { FormField, Textarea } from '@/design-system/components';

/**
 * Row renderers for the employment step's schooling, gap and military lists.
 *
 * Moved out of `Step6_Employment.jsx` verbatim on 2026-09-02 so the step could
 * take on the company's coverage rules without passing the source-size limit.
 * Every element id (`school-name-<n>`, `unemp-start-<n>`, `mil-branch-<n>`, …),
 * every saved key and every required flag is exactly what the step rendered.
 * The per-row radio groups scope their ids and grouping name by index while
 * `name` (the saved key) stays bare.
 */
export function makeEmploymentRowRenderers({ ty, yesNoOptions }) {
    const renderSchoolRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <InputField label="School Name" id={'school-name-' + index} name="name" value={item.name} onChange={handleChange} required={true} />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <DateTripletField
                    label="Start Date"
                    idPrefix={'school-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
                <DateTripletField
                    label="End Date"
                    idPrefix={'school-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
            </div>
            <InputField label="Location (City, State)" id={'school-location-' + index} name="location" value={item.location} onChange={handleChange} />
        </div>
    );

    const renderUnemploymentRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <MonthYearField
                    label="Gap Start (month / year)"
                    idPrefix={'unemp-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Easier than typing — stored securely like other dates."
                />
                <MonthYearField
                    label="Gap End (month / year)"
                    idPrefix={'unemp-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                />
            </div>
            <FormField id={'unemp-details-' + index} label="Details related to unemployment period">
                <Textarea
                    name="details"
                    rows="3"
                    value={item.details || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
        </div>
    );

    const renderMilitaryRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <RadioGroup
                label="Branch of Service"
                name="branch"
                idPrefix={'mil-branch-' + index}
                groupName={'mil-branch-' + index}
                options={MILITARY_BRANCH_OPTIONS}
                value={item.branch}
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={false}
            />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <MonthYearField
                    label="Service Start (month / year)"
                    idPrefix={'mil-start-' + index}
                    name="start"
                    value={item.start}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 50}
                />
                <MonthYearField
                    label="Service End (month / year)"
                    idPrefix={'mil-end-' + index}
                    name="end"
                    value={item.end}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 50}
                />
            </div>
            <InputField label="Rank of Discharge" id={'mil-rank-' + index} name="rank" value={item.rank} onChange={handleChange} required={true} />
            <RadioGroup
                label="Did you operate heavy equipment/machinery?"
                name="heavyEq"
                idPrefix={'mil-heavy-eq-' + index}
                groupName={'mil-heavy-eq-' + index}
                options={yesNoOptions}
                value={item.heavyEq}
                onChange={(name, value) => handleChange(name, value)}
            />
            <RadioGroup
                label="Did you receive an honorable discharge?"
                name="honorable"
                idPrefix={'mil-honorable-' + index}
                groupName={'mil-honorable-' + index}
                options={yesNoOptions}
                value={item.honorable}
                onChange={(name, value) => handleChange(name, value)}
            />
            <FormField id={'mil-explain-' + index} label="Please explain">
                <Textarea
                    name="explanation"
                    rows="3"
                    value={item.explanation || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
        </div>
    );

    return { renderSchoolRow, renderUnemploymentRow, renderMilitaryRow };
}

export default makeEmploymentRowRenderers;
