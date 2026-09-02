import React, { useId } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Card, Checkbox, ChoiceGroup, FieldMessage, FormField, Input, Radio, Switch } from '@/design-system/components';
import {
    APPLICATION_RULES_CATALOG,
    isRuleConfigured,
    resolveApplicationRules,
} from '@/config/applicationRules';
import { EXPERIENCE_OPTIONS } from '@/config/form-options';

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

function RuleRow({ rule, rules, configured, readOnly, onChange }) {
    const rawId = useId().replace(/:/g, '');
    const baseId = `rule-${rule.id}-${rawId}`;
    const value = rules[rule.id];
    const set = (next) => onChange({ ...rules, [rule.id]: next });

    let control;
    switch (rule.type) {
        case 'boolean':
            control = (
                <Switch
                    checked={Boolean(value)}
                    tone="success"
                    label={rule.label}
                    disabled={readOnly}
                    onChange={(checked) => set(checked)}
                />
            );
            break;
        case 'enforcement':
        case 'choice': {
            const options = rule.type === 'enforcement' ? APPLICATION_RULES_CATALOG.enforcementOptions : rule.options;
            control = (
                <ChoiceGroup legend={rule.label} description={rule.help}>
                    {options.map((option) => (
                        <Radio
                            key={option.value}
                            id={`${baseId}-${option.value}`}
                            name={baseId}
                            value={option.value}
                            label={option.label}
                            checked={value === option.value}
                            disabled={readOnly}
                            onChange={() => set(option.value)}
                        />
                    ))}
                </ChoiceGroup>
            );
            break;
        }
        case 'number':
            control = (
                <FormField id={baseId} label={rule.label} description={rule.help}>
                    <Input
                        type="number"
                        inputMode="numeric"
                        min={rule.min}
                        max={rule.max}
                        value={value}
                        disabled={readOnly}
                        onChange={(e) => set(e.target.value === '' ? rule.default : Number(e.target.value))}
                        className="max-w-[8rem]"
                    />
                </FormField>
            );
            break;
        case 'hiddenOptions': {
            const hidden = Array.isArray(value) ? value : [];
            control = (
                <ChoiceGroup legend={rule.label} description={rule.help}>
                    {optionsFor(rule).map((option) => (
                        <Checkbox
                            key={option.id}
                            id={`${baseId}-${option.id}`}
                            name={`${baseId}-${option.id}`}
                            label={option.label}
                            checked={!hidden.includes(option.id)}
                            disabled={readOnly}
                            onChange={(e) => set(e.target.checked
                                ? hidden.filter((entry) => entry !== option.id)
                                : [...hidden, option.id])}
                        />
                    ))}
                </ChoiceGroup>
            );
            break;
        }
        case 'labels': {
            const labels = value && typeof value === 'object' ? value : {};
            control = (
                <fieldset className="space-y-ds-3">
                    <legend className="text-ds-sm font-semibold text-ds-content">{rule.label}</legend>
                    {rule.help && <FieldMessage tone="help">{rule.help}</FieldMessage>}
                    <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2">
                        {optionsFor(rule).map((option) => (
                            <FormField key={option.id} id={`${baseId}-${option.id}`} label={option.label}>
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
                </fieldset>
            );
            break;
        }
        default:
            control = null;
    }

    const isSwitch = rule.type === 'boolean';
    return (
        <li className="px-ds-4 py-ds-4" data-rule-id={rule.id} data-configured={configured || undefined}>
            {isSwitch ? (
                <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-start sm:justify-between sm:gap-ds-6">
                    <div className="min-w-0 space-y-ds-1">
                        <p className="text-ds-sm font-semibold text-ds-content">{rule.label}</p>
                        {rule.help && <p className="text-ds-xs text-ds-content-muted">{rule.help}</p>}
                        {configured && <p className="text-ds-xs font-medium text-ds-status-info-fg">Changed from the platform default</p>}
                    </div>
                    <div className="shrink-0">{control}</div>
                </div>
            ) : (
                <div className="space-y-ds-2">
                    {control}
                    {configured && <p className="text-ds-xs font-medium text-ds-status-info-fg">Changed from the platform default</p>}
                </div>
            )}
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
        <Card padding="none" className="overflow-hidden" aria-labelledby={titleId}>
            <div className="flex items-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <SlidersHorizontal size={18} className="text-ds-content-muted" aria-hidden="true" />
                <h4 id={titleId} className="text-ds-body font-bold text-ds-content">Application Rules</h4>
            </div>
            <p className="border-b border-ds-border-subtle px-ds-4 py-ds-3 text-ds-sm text-ds-content-muted">
                Nothing here changes which questions are asked — that is Standard Questions. These rules decide what happens
                when an answer needs more attention. Every rule starts on the platform default, which is how the application
                behaved before rules existed; only what you change applies to your applicants, and it is checked again when
                they submit.
            </p>
            {APPLICATION_RULES_CATALOG.groups.map((group) => {
                const groupRules = APPLICATION_RULES_CATALOG.rules.filter((rule) => rule.group === group.id);
                if (groupRules.length === 0) return null;
                return (
                    <section key={group.id} aria-label={group.title} className="border-b border-ds-border-subtle last:border-b-0">
                        <h5 className="bg-ds-surface-subtle px-ds-4 py-ds-2 text-ds-xs font-bold uppercase text-ds-content-muted">{group.title}</h5>
                        <ul className="divide-y divide-ds-border-subtle">
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
                        </ul>
                    </section>
                );
            })}
        </Card>
    );
}

export default ApplicationRulesPanel;
