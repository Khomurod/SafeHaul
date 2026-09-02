// src/config/applicationRules.js
//
// ESM mirror of `functions/shared/applicationRules.js` — the company-configurable
// Application Rules, evaluated identically in the wizard, the browser's final
// pre-flight and `submitGuestApplication`. See the server copy for the full
// rationale. The body between the markers is byte-identical to it;
// `applicationRules.parity.test.js` fails if the two drift.

import STANDARD_SECTIONS from '../../functions/shared/applicationSections.json';
import CATALOG from '../../functions/shared/applicationRulesCatalog.json';
import { resolveApplicationGate as resolveGate } from './applicationGates';
import { computeEmploymentCoverage } from '@shared/utils/employmentCoverage';
import { dateStatus, isOngoingToken, parseApplicationDate, toIsoDay } from './applicationDates';

// --- body ---------------------------------------------------------------------
// Identical to functions/shared/applicationRules.js. Edit both, or the parity test fails.

const ENFORCEMENT_LEVELS = Object.freeze(['allow', 'warn', 'block']);
const VEHICLE_CATEGORIES = Object.freeze(CATALOG.optionSets.vehicleCategories);
const EXPERIENCE_VALUES = Object.freeze(CATALOG.optionSets.experienceYears);
const RULE_BY_ID = Object.freeze(Object.fromEntries(CATALOG.rules.map((rule) => [rule.id, rule])));

/** Which wizard page collects each section of the shared field table. */
const SEMANTIC_STEP_BY_SECTION = Object.freeze({
    personal: 'contact',
    addressHistory: 'contact',
    qualifications: 'qualifications',
    license: 'license',
    documents: 'license',
    drivingRecord: 'violations',
    experience: 'general',
    employment: 'employment',
    educationMilitary: 'employment',
    businessInfo: 'general',
    emergencyAndDisclosures: 'general',
    hoursOfService: 'general',
});

/** Fields whose section is not the page they are actually collected on. */
const SEMANTIC_STEP_BY_FIELD = Object.freeze({
    accidents: 'accidents',
    referralSource: 'contact',
});

/** End-of-period columns accept "still going" instead of a date. */
const END_COLUMN_IDS = new Set(['endDate', 'end', 'to', 'dateTo']);

function optionValues(setName) {
    const set = CATALOG.optionSets[setName] || [];
    return set.map((entry) => (typeof entry === 'string' ? entry : entry.id));
}

function copyDefault(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === 'object') return { ...value };
    return value;
}

/** One rule's stored value, coerced to something the catalog permits. */
function normalizeRuleValue(rule, raw) {
    switch (rule.type) {
        case 'boolean':
            return typeof raw === 'boolean' ? raw : rule.default;
        case 'enforcement':
            return ENFORCEMENT_LEVELS.includes(raw) ? raw : rule.default;
        case 'choice':
            return rule.options.some((option) => option.value === raw) ? raw : rule.default;
        case 'number': {
            const number = Number(raw);
            if (!Number.isFinite(number)) return rule.default;
            return Math.min(rule.max, Math.max(rule.min, Math.round(number)));
        }
        case 'hiddenOptions': {
            // An array — even an empty one — is a deliberate choice; anything else
            // means "never configured".
            if (!Array.isArray(raw)) return copyDefault(rule.default);
            const allowed = optionValues(rule.optionSet);
            return raw.filter((value) => typeof value === 'string' && allowed.includes(value));
        }
        case 'labels': {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
            const allowed = optionValues(rule.optionSet);
            const labels = {};
            for (const id of allowed) {
                const label = typeof raw[id] === 'string' ? raw[id].trim() : '';
                if (label) labels[id] = label.slice(0, 80);
            }
            return labels;
        }
        default:
            return copyDefault(rule.default);
    }
}

/** The platform defaults — the application every company had before rules existed. */
function defaultApplicationRules() {
    const rules = {};
    for (const rule of CATALOG.rules) rules[rule.id] = copyDefault(rule.default);
    return rules;
}

/**
 * A company's stored rules with defaults filled in and every value validated.
 * Unknown keys are dropped and unusable values fall back to the default, so a
 * hand-edited or stale document can never produce a rule the wizard does not know.
 */
function resolveApplicationRules(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rules = {};
    for (const rule of CATALOG.rules) rules[rule.id] = normalizeRuleValue(rule, source[rule.id]);
    return rules;
}

/** True when the company changed this rule away from the platform default. */
function isRuleConfigured(raw, ruleId) {
    const rule = RULE_BY_ID[ruleId];
    if (!rule || !raw || typeof raw !== 'object') return false;
    if (raw[ruleId] === undefined) return false;
    return JSON.stringify(normalizeRuleValue(rule, raw[ruleId])) !== JSON.stringify(rule.default);
}

// --- experience options and vehicle categories ---------------------------------

function isExperienceOptionOffered(rules, value) {
    return !resolveApplicationRules(rules).experienceOptionsHidden.includes(value);
}

/** Vehicle categories the company shows, with its own wording applied. */
function visibleVehicleCategories(rules) {
    const resolved = resolveApplicationRules(rules);
    return VEHICLE_CATEGORIES
        .filter((category) => !resolved.vehicleExperienceHidden.includes(category.id))
        .map((category) => ({ ...category, label: resolved.vehicleExperienceLabels[category.id] || category.label }));
}

function vehicleCategoryForField(fieldId) {
    return VEHICLE_CATEGORIES.find((category) => category.milesField === fieldId || category.expField === fieldId) || null;
}

/**
 * The shared field table as THIS company presents it: vehicle categories carry
 * the company's wording, and a hidden category is shown only when it was
 * answered — so a record written before the category was hidden still reads,
 * while an unanswered hidden field is never claimed to have been asked.
 */
function applyRulesToSections(sections, rules) {
    const resolved = resolveApplicationRules(rules);
    return sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
            const category = vehicleCategoryForField(field.id);
            if (!category) return field;
            const suffix = String(field.label).split(' — ').slice(1).join(' — ');
            const label = resolved.vehicleExperienceLabels[category.id]
                ? `${resolved.vehicleExperienceLabels[category.id]}${suffix ? ` — ${suffix}` : ''}`
                : field.label;
            const hidden = resolved.vehicleExperienceHidden.includes(category.id);
            return { ...field, label, presentWhenAnswered: hidden || Boolean(field.presentWhenAnswered) };
        }),
    }));
}

// --- answers -------------------------------------------------------------------

function isBlank(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function yesNo(value) {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    const raw = String(value ?? '').trim().toLowerCase();
    return raw === 'yes' || raw === 'no' ? raw : null;
}

function listOf(value) {
    return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

/** A row the applicant actually typed into, as opposed to an empty "Add" click. */
function rowHasContent(row) {
    return Object.entries(row).some(([key, value]) => key !== 'id' && !isBlank(value));
}

/**
 * Legacy shapes, made explicit. The Yes/No violations and accidents questions
 * arrived after years of applications that only had the lists, so a record with
 * rows and no answer means Yes. And an explicit No is authoritative: rows left
 * behind by an applicant who changed their mind are dropped, on screen, in the
 * browser's payload and on the server alike.
 */
function normalizeApplicationAnswers(formData) {
    const data = { ...(formData && typeof formData === 'object' ? formData : {}) };
    for (const [flag, list] of [['has-violations', 'violations'], ['has-accidents', 'accidents']]) {
        const rows = listOf(data[list]).filter(rowHasContent);
        if (!yesNo(data[flag]) && rows.length > 0) data[flag] = 'yes';
        if (yesNo(data[flag]) === 'no' && Array.isArray(data[list]) && data[list].length > 0) data[list] = [];
    }
    return data;
}

function isCompletePreviousAddress(row) {
    return ['street', 'city', 'state', 'zip'].every((key) => !isBlank(row[key]))
        && Boolean(parseApplicationDate(row.startDate))
        && (Boolean(parseApplicationDate(row.endDate)) || isOngoingToken(row.endDate));
}

function isCompleteLicense(row) {
    return ['state', 'number', 'class'].every((key) => !isBlank(row[key])) && Boolean(parseApplicationDate(row.expiration));
}

function isCompleteViolation(row) {
    return Boolean(parseApplicationDate(row.date)) && !isBlank(row.charge) && !isBlank(row.location);
}

function isCount(value) {
    return /^\d{1,3}$/.test(String(value ?? '').trim());
}

function isCompleteAccident(row) {
    return Boolean(parseApplicationDate(row.date))
        && !isBlank(row.details)
        && isCount(row.fatalities)
        && isCount(row.injuries)
        && yesNo(row.hazmatSpill) !== null;
}

/** The seven calendar days before `today`, newest first — the days a statement must cover. */
function hoursOfServiceDays(today) {
    const base = new Date(toIsoDay(today) + 'T12:00:00');
    return Array.from({ length: 7 }, (_, offset) => {
        const day = new Date(base);
        day.setDate(base.getDate() - (offset + 1));
        return toIsoDay(day);
    });
}

function isCompleteHoursOfService(data, today) {
    // Keyed by day, so seven rows for the wrong week — a draft resumed later —
    // or the same day twice do not pass as a statement about the last seven.
    const byDay = new Map();
    for (const row of listOf(data.hosDailyHours)) {
        const parsed = parseApplicationDate(row.date);
        if (parsed && parsed.day !== null) byDay.set(parsed.iso, row);
    }
    const daysComplete = hoursOfServiceDays(today).every((day) => {
        const row = byDay.get(day);
        return Boolean(row) && /^\d{1,2}(\.\d{1,2})?$/.test(String(row.hours ?? '').trim()) && Number(row.hours) <= 24;
    });
    return daysComplete
        && Boolean(parseApplicationDate(data.hosLastRelievedDate))
        && /^\d{1,2}:\d{2}$/.test(String(data.hosLastRelievedTime ?? '').trim());
}

/** Coverage options every surface must share, so the number told to the driver is the number recorded. */
function employmentCoverageOptions(rules, today) {
    const resolved = resolveApplicationRules(rules);
    const options = { requiredMonths: resolved.employmentHistoryMinimumYears * 12 };
    if (today) options.referenceDate = today;
    return options;
}

// --- evaluation ----------------------------------------------------------------

function issue(code, severity, semanticStep, fieldId, message) {
    return { code, severity, semanticStep, fieldId, message };
}

/**
 * Impossible or malformed dates anywhere the shared table types a field as a
 * date. Not a company rule — a date that cannot exist is wrong for everyone —
 * but evaluated here so every surface refuses the same values.
 */
function invalidDateIssues(data) {
    const issues = [];
    for (const section of STANDARD_SECTIONS) {
        const step = SEMANTIC_STEP_BY_SECTION[section.id] || 'contact';
        // `any`: the section table is JSON, and TypeScript narrows its union of
        // field shapes too eagerly to read optional keys off it.
        for (const field of /** @type {any[]} */ (section.fields || [])) {
            const fieldStep = SEMANTIC_STEP_BY_FIELD[field.id] || step;
            if (field.type === 'date' && !isBlank(data[field.id]) && !parseApplicationDate(data[field.id])) {
                issues.push(issue('invalid-date', 'block', fieldStep, field.id, `${field.label}: enter a real date (month, day and year).`));
            }
            if (!field.repeating || !Array.isArray(field.columns)) continue;
            listOf(data[field.id]).forEach((row, index) => {
                for (const column of field.columns) {
                    if (column.type !== 'date' || isBlank(row[column.id])) continue;
                    if (END_COLUMN_IDS.has(column.id) && isOngoingToken(row[column.id])) continue;
                    if (!parseApplicationDate(row[column.id])) {
                        issues.push(issue('invalid-date', 'block', fieldStep, field.id,
                            `${field.label} #${index + 1} — ${column.label}: enter a real date.`));
                    }
                }
            });
        }
    }
    return issues;
}

function expiryIssue(level, fieldId, label, data, today) {
    if (level === 'allow' || dateStatus(data[fieldId], today) !== 'expired') return null;
    const severity = level === 'block' ? 'block' : 'warn';
    const tail = severity === 'block'
        ? 'This carrier needs a current one before you can continue.'
        : 'You can continue, but the carrier will ask you about it.';
    return issue(`expired-${fieldId}`, severity, 'license', fieldId, `Your ${label} expiration date is in the past. ${tail}`);
}

/**
 * Evaluate a company's rules against an applicant's answers.
 *
 * @param {object} opts
 * @param {object} [opts.rules]             The company's stored `applicationRules` (raw; defaults applied here).
 * @param {object} [opts.applicationConfig] The company's gate map, so a hidden question is never enforced.
 * @param {object} [opts.formData]          The answers.
 * @param {Date|string} [opts.today]        Reference day; inject for determinism.
 * @returns {{rules: object, issues: Array, blocking: Array, warnings: Array}}
 */
function evaluateApplicationRules({ rules: rawRules, applicationConfig, formData, today } = {}) {
    const rules = resolveApplicationRules(rawRules);
    const data = normalizeApplicationAnswers(formData);
    const issues = invalidDateIssues(data);

    const addressGate = resolveGate(applicationConfig, 'addressHistory');
    if (rules.requirePreviousAddressUnderThreeYears && !addressGate.hidden
        && yesNo(data['residence-3-years']) === 'no'
        && !listOf(data.previousAddresses).some(isCompletePreviousAddress)) {
        issues.push(issue('previous-address-required', 'block', 'contact', 'previousAddresses',
            'Because you have lived at your current address for less than 3 years, add at least one complete previous address (street, city, state, ZIP, and the months you lived there).'));
    }

    const experience = data['experience-years'];
    if (!isBlank(experience) && !rules.experienceOptionsHidden.every((hidden) => hidden !== experience)) {
        issues.push(issue('experience-option-not-offered', 'block', 'qualifications', 'experience-years',
            'Please choose one of the experience options offered for this application.'));
    }

    const cdlIssue = expiryIssue(rules.expiredCdl, 'cdlExpiration', 'license', data, today);
    if (cdlIssue) issues.push(cdlIssue);
    const medGate = resolveGate(applicationConfig, 'medCardUpload');
    const medIssue = medGate.hidden ? null : expiryIssue(rules.expiredMedicalCard, 'medCardExpiration', 'medical card', data, today);
    if (medIssue) issues.push(medIssue);

    if (rules.requirePreviousLicenseDetails && yesNo(data['has-other-licenses']) === 'yes'
        && !listOf(data.additionalLicenses).some(isCompleteLicense)) {
        issues.push(issue('previous-license-details-required', 'block', 'license', 'additionalLicenses',
            'Add at least one complete record (state, license number, class and expiration date) for the other state where you held a license.'));
    }

    if (rules.mvrAuthorization === 'required' && yesNo(data['consent-mvr']) !== 'yes') {
        issues.push(issue('mvr-authorization-required', 'block', 'violations', 'consent-mvr',
            'This carrier needs your authorization to obtain your motor vehicle record before the application can continue. Choose Yes to continue, or contact the carrier if you have questions.'));
    }
    // A Yes is an acceptance of versioned wording, and the wizard records the
    // evidence beside the answer. A Yes without it — the wording had not loaded
    // when it was clicked, or an older draft carried the answer alone — would be
    // frozen as "not accepted" next to an answer that says otherwise.
    const mvrEvidence = data.agreementAcceptances && data.agreementAcceptances.mvrAuthorization;
    if (yesNo(data['consent-mvr']) === 'yes' && !(mvrEvidence && mvrEvidence.accepted === true)) {
        issues.push(issue('mvr-authorization-evidence', 'block', 'violations', 'consent-mvr',
            'Your motor vehicle record authorization could not be recorded with the wording you were shown. Please answer the authorization question again.'));
    }

    if (rules.requireViolationDetails) {
        const answer = yesNo(data['has-violations']);
        if (!answer) {
            issues.push(issue('violations-answer-required', 'block', 'violations', 'has-violations',
                'Please answer whether you have had any moving violations in the past 3 years.'));
        } else if (answer === 'yes' && !listOf(data.violations).some(isCompleteViolation)) {
            issues.push(issue('violation-details-required', 'block', 'violations', 'violations',
                'You reported moving violations. Add at least one complete violation with its date, the charge and the location.'));
        }
    }

    if (rules.requireAccidentDetails) {
        const answer = yesNo(data['has-accidents']);
        const rows = listOf(data.accidents);
        if (!answer) {
            issues.push(issue('accidents-answer-required', 'block', 'accidents', 'has-accidents',
                'Please answer whether you have been in any accidents in the past 3 years.'));
        } else if (answer === 'yes' && (rows.length === 0 || !rows.every(isCompleteAccident))) {
            issues.push(issue('accident-details-required', 'block', 'accidents', 'accidents',
                'You reported an accident. Complete every accident record: the date, what happened, the number of fatalities, the number of injuries, and whether hazardous materials were spilled.'));
        }
    }

    if (rules.employmentHistoryEnforcement !== 'allow') {
        const coverage = computeEmploymentCoverage(/** @type {any} */ ({
            employers: data.employers,
            unemployment: data.unemployment,
            unemploymentPeriods: data.unemploymentPeriods,
            schools: data.schools,
            military: data.military,
        }), employmentCoverageOptions(rules, today));
        if (!coverage.isComplete) {
            const years = rules.employmentHistoryMinimumYears;
            issues.push(issue('employment-coverage', rules.employmentHistoryEnforcement === 'block' ? 'block' : 'warn', 'employment', 'employers',
                `Your history must account for the past ${years} year${years === 1 ? '' : 's'}. `
                + `Add the employers, gaps, schooling or military service that cover the missing ${coverage.missingMonths} month${coverage.missingMonths === 1 ? '' : 's'}.`));
        }
    }

    if (rules.requireFelonyExplanation && yesNo(data['has-felony']) === 'yes' && isBlank(data.felonyExplanation)) {
        issues.push(issue('felony-explanation-required', 'block', 'general', 'felonyExplanation',
            'Please explain the felony conviction you reported.'));
    }

    if (rules.hoursOfServiceStatement === 'application' && !isCompleteHoursOfService(data, today)) {
        issues.push(issue('hours-of-service-required', 'block', 'general', 'hosDailyHours',
            'Complete the Hours of Service statement: your on-duty hours for each of the past 7 days, and the date and time you were last relieved from duty.'));
    }

    return {
        rules,
        issues,
        blocking: issues.filter((entry) => entry.severity === 'block'),
        warnings: issues.filter((entry) => entry.severity === 'warn'),
    };
}

function issuesForStep(result, semanticStep) {
    return (result?.issues || []).filter((entry) => entry.semanticStep === semanticStep);
}

// --- exports -------------------------------------------------------------------

export {
    CATALOG as APPLICATION_RULES_CATALOG,
    ENFORCEMENT_LEVELS,
    EXPERIENCE_VALUES,
    SEMANTIC_STEP_BY_SECTION,
    VEHICLE_CATEGORIES,
    applyRulesToSections,
    dateStatus,
    defaultApplicationRules,
    employmentCoverageOptions,
    evaluateApplicationRules,
    invalidDateIssues,
    isExperienceOptionOffered,
    isOngoingToken,
    isRuleConfigured,
    issuesForStep,
    normalizeApplicationAnswers,
    parseApplicationDate,
    resolveApplicationRules,
    toIsoDay,
    vehicleCategoryForField,
    visibleVehicleCategories,
    yesNo,
};
