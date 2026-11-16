import React, { useId } from 'react';
import { Icon, Info } from '@design-system/icons';
import { Card, Checkbox, FormField, FormSection, Input, Radio, Switch } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import {
    APPLICATION_RULES_CATALOG,
    isRuleConfigured,
    resolveApplicationRules,
} from '@/config/applicationRules';
import { EXPERIENCE_OPTIONS } from '@/config/form-options';
import { domIdSegment } from '@/shared/utils/domId';
import { SettingRows, SwitchSettingRow } from './SettingRows';
import { SETTING_HELP, SETTING_ROW_INSET, SETTING_TITLE } from './settingRowStyles';

/**
 * Application Rules — what happens when an answer, a missing answer or a date
 * needs more than "is it filled in".
 *
 * Rendered from the shared catalog (`functions/shared/applicationRulesCatalog.json`),
 * so adding a rule there adds a row here with no code in this file: a boolean
 * becomes a switch, an enforcement level or a choice becomes a radio group, a
 * number becomes a number field, a hidden-options list becomes tick boxes and a
 * labels map becomes text fields. Every control speaks the catalog's own
 * plain-language label and help text — company staff, not engineers, read this.
 *
 * `onChange` receives the WHOLE resolved rules object, so what the company saves
 * is exactly what the wizard and the server will read. A rule the company has
 * changed from the platform default is marked, so "what did we customise?" has a
 * visible answer.
 */
const OPTION_SETS = {
    experienceYears: () => EXPERIENCE_OPTIONS.map((option) => ({ id: option.value, label: option.label })),
    vehicleCategories: () => APPLICATION_RULES_CATALOG.optionSets.vehicleCategories,
};

function optionsFor(rule) {
    const build = OPTION_SETS[rule.optionSet];
    return build ? build() : [];
}

/** A rule the company changed from the platform default says so, under its help. */
function ChangedMarker() {
    return <p className="text-ds-xs font-medium text-ds-status-info-fg">Changed from the platform default</p>;
}

/*
 * A rule with choices or a number: its title and help on the left, the
 * controls in a 400px column on the right, while the row is wider than 640px;
 * narrower, the controls go under the help. The list of rows is the size
 * container (`SettingRows`).
 *
 * A group of choices is a real `<fieldset>`, named by its `<legend>`: the
 * legend floats, which takes it out of the fieldset's border and makes it a
 * grid item like the help, so it can head the left column. `ChoiceGroup` puts
 * its legend above its options and cannot do this yet (design-system request
 * in the C2 notes); the controls are the design system's own.
 */
const SPLIT_ROW = 'grid min-w-0 grid-cols-1 gap-y-ds-1 [@container_(min-width:641px)]:grid-cols-[minmax(0,1fr)_25rem] [@container_(min-width:641px)]:grid-rows-[auto_1fr] [@container_(min-width:641px)]:gap-x-ds-8';
const SPLIT_TEXT = 'col-start-1 min-w-0 space-y-ds-1';
const SPLIT_CONTROLS = 'mt-ds-3 min-w-0 [@container_(min-width:641px)]:col-start-2 [@container_(min-width:641px)]:row-span-2 [@container_(min-width:641px)]:row-start-1 [@container_(min-width:641px)]:mt-0';

/**
 * How a rule's choices are laid out in its column: a choice every 40px on a
 * phone, where each is tapped (36px from 768px up).
 */
function optionsLayout(rule, count) {
    if (rule.type !== 'hiddenOptions') return { className: 'grid gap-ds-4 md:gap-ds-3' };
    // The experience choices read down each column: Student to 1 Year, then 2 to 5+ Years.
    if (rule.optionSet === 'experienceYears') {
        return {
            className: 'grid grid-flow-col grid-cols-[repeat(2,minmax(0,max-content))] gap-x-ds-6 gap-y-ds-4 md:grid-cols-2 md:gap-x-ds-4 md:gap-y-ds-3',
            style: { gridTemplateRows: `repeat(${Math.ceil(count / 2)}, auto)` },
        };
    }
    return { className: 'grid gap-x-ds-4 gap-y-ds-4 md:grid-cols-[repeat(auto-fill,minmax(9.375rem,1fr))] md:gap-y-ds-3' };
}

function RuleRow({ rule, rules, configured, readOnly, onChange }) {
    const rawId = useId().replace(/:/g, '');
    const baseId = `rule-${rule.id}-${rawId}`;
    const helpId = `${baseId}-help`;
    // Option values such as "0-6 months" are not valid inside an id (no ASCII
    // whitespace, per the HTML spec), and axe builds a selector from the id when
    // it names an element. `domIdSegment` makes the id safe; `name`/`value` keep
    // the real option value, which is what is saved.
    const value = rules[rule.id];
    const set = (next) => onChange({ ...rules, [rule.id]: next });
    const help = rule.help && <p id={helpId} className={SETTING_HELP}>{rule.help}</p>;
    const marker = configured && <ChangedMarker />;

    if (rule.type === 'boolean') {
        return (
            <SwitchSettingRow
                data-rule-id={rule.id}
                data-configured={configured || undefined}
                title={rule.label}
                help={rule.help}
                note={marker}
                control={(
                    <Switch
                        checked={Boolean(value)}
                        tone="success"
                        label={rule.label}
                        disabled={readOnly}
                        onChange={(checked) => set(checked)}
                    />
                )}
            />
        );
    }

    let content;
    switch (rule.type) {
        case 'enforcement':
        case 'choice':
        case 'hiddenOptions': {
            const hidden = Array.isArray(value) ? value : [];
            const options = rule.type === 'enforcement'
                ? APPLICATION_RULES_CATALOG.enforcementOptions
                : rule.type === 'choice' ? rule.options : optionsFor(rule);
            const layout = optionsLayout(rule, options.length);
            content = (
                <fieldset className={SPLIT_ROW} aria-describedby={rule.help ? helpId : undefined}>
                    <legend className={`float-left col-start-1 p-0 ${SETTING_TITLE}`}>{rule.label}</legend>
                    {(help || marker) && <div className={SPLIT_TEXT}>{help}{marker}</div>}
                    <div className={SPLIT_CONTROLS}>
                        <div className={layout.className} style={layout.style}>
                            {rule.type === 'hiddenOptions'
                                ? options.map((option) => (
                                    <Checkbox
                                        key={option.id}
                                        id={`${baseId}-${domIdSegment(option.id)}`}
                                        name={`${baseId}-${option.id}`}
                                        label={option.label}
                                        checked={!hidden.includes(option.id)}
                                        disabled={readOnly}
                                        onChange={(e) => set(e.target.checked
                                            ? hidden.filter((entry) => entry !== option.id)
                                            : [...hidden, option.id])}
                                    />
                                ))
                                : options.map((option) => (
                                    <Radio
                                        key={option.value}
                                        id={`${baseId}-${domIdSegment(option.value)}`}
                                        name={baseId}
                                        value={option.value}
                                        label={option.label}
                                        checked={value === option.value}
                                        disabled={readOnly}
                                        onChange={() => set(option.value)}
                                    />
                                ))}
                        </div>
                    </div>
                </fieldset>
            );
            break;
        }
        case 'number':
            content = (
                <div className={SPLIT_ROW}>
                    <div className={SPLIT_TEXT}>
                        {/* Styled as the legends of the rows around it, not the form
                            label's 13px: in this list every rule title is one size. */}
                        <label htmlFor={baseId} className={`block ${SETTING_TITLE}`}>{rule.label}</label>
                        {help}
                        {marker}
                    </div>
                    <div className={SPLIT_CONTROLS}>
                        <Input
                            id={baseId}
                            type="number"
                            inputMode="numeric"
                            min={rule.min}
                            max={rule.max}
                            value={value}
                            disabled={readOnly}
                            aria-describedby={rule.help ? helpId : undefined}
                            onChange={(e) => set(e.target.value === '' ? rule.default : Number(e.target.value))}
                        />
                    </div>
                </div>
            );
            break;
        case 'labels': {
            const labels = value && typeof value === 'object' ? value : {};
            // The whole row: four fields a line once the row's text is 760px
            // wide (808px of card), two from 400px (448px of card), one under.
            content = (
                <fieldset className="grid min-w-0 gap-y-ds-1" aria-describedby={rule.help ? helpId : undefined}>
                    <legend className={`float-left p-0 ${SETTING_TITLE}`}>{rule.label}</legend>
                    {help}
                    <div className="mt-ds-3 grid grid-cols-1 gap-ds-3 [@container_(min-width:448px)]:grid-cols-2 [@container_(min-width:808px)]:grid-cols-4">
                        {optionsFor(rule).map((option) => (
                            <FormField key={option.id} id={`${baseId}-${domIdSegment(option.id)}`} label={option.label}>
                                <Input
                                    value={labels[option.id] || ''}
                                    placeholder={option.label}
                                    maxLength={80}
                                    disabled={readOnly}
                                    onChange={(e) => {
                                        const next = { ...labels };
                                        if (e.target.value.trim()) next[option.id] = e.target.value;
                                        else delete next[option.id];
                                        set(next);
                                    }}
                                />
                            </FormField>
                        ))}
                    </div>
                    {marker}
                </fieldset>
            );
            break;
        }
        default:
            content = null;
    }

    return (
        <li className={SETTING_ROW_INSET} data-rule-id={rule.id} data-configured={configured || undefined}>
            {content}
        </li>
    );
}

/**
 * @param {object}   props
 * @param {object}   [props.rules]    The company's stored `applicationRules` (raw).
 * @param {Function} props.onChange   Receives the full resolved rules object.
 * @param {boolean}  [props.readOnly] Company users who may look but not change.
 */
export function ApplicationRulesPanel({ rules: rawRules, onChange, readOnly = false }) {
    const rules = resolveApplicationRules(rawRules);
    const rawId = useId().replace(/:/g, '');
    const titleId = `application-rules-title-${rawId}`;

    return (
        <Stack gap="xl">
            {/* What the rules are, before the first of them. The glyph has a
                column of its own, so from 768px the paragraph starts under the
                title's first letter; on a phone it takes the card's width. */}
            <Card as="section" aria-labelledby={titleId}>
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-ds-2">
                    <Icon icon={Info} size="lg" className="text-ds-brand-primary" />
                    <h2 id={titleId} className="text-ds-heading-sm font-semibold text-ds-content">
                        Application Rules
                    </h2>
                    <p className="col-span-2 text-ds-body text-ds-content-secondary [text-wrap:pretty] md:col-span-1 md:col-start-2">
                        Nothing here changes which questions are asked — that is Standard Questions. These rules decide what happens
                        when an answer needs more attention. Every rule starts on the platform default: details and explanations
                        behind a Yes, and previous addresses for 3 years, are required; the rest is as the application behaved before
                        rules existed. A rule you change replaces the default for your applicants; the rest keep it. Rules are checked again at submit.
                    </p>
                </div>
            </Card>
            {APPLICATION_RULES_CATALOG.groups.map((group) => {
                const groupRules = APPLICATION_RULES_CATALOG.rules.filter((rule) => rule.group === group.id);
                if (groupRules.length === 0) return null;
                return (
                    <FormSection key={group.id} layout="stacked" padding="none" title={group.title}>
                        <SettingRows>
                            {groupRules.map((rule) => (
                                <RuleRow
                                    key={rule.id}
                                    rule={rule}
                                    rules={rules}
                                    configured={isRuleConfigured(rawRules, rule.id)}
                                    readOnly={readOnly}
                                    onChange={onChange}
                                />
                            ))}
                        </SettingRows>
                    </FormSection>
                );
            })}
        </Stack>
    );
}

export default ApplicationRulesPanel;
