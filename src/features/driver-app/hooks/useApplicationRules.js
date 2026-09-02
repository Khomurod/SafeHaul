// src/features/driver-app/hooks/useApplicationRules.js
//
// The company's Application Rules, as the apply page sees them, plus the live
// verdict for one wizard step.
//
// The rules travel on the public profile (`applicationRules`, projected by
// `publicProfileDto`), so this hook reads them from the same company object every
// step already uses for its gates. Evaluation is a pure function of the answers,
// which is what makes "changing a date immediately recalculates the validation"
// true by construction: every render re-evaluates, nothing is cached across
// answers, and the same function decides on the server.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '@/context/DataContext';
import {
    evaluateApplicationRules,
    issuesForStep,
    resolveApplicationRules,
} from '@/config/applicationRules';

/** The resolved rules for the company whose application is on screen. */
export function useApplicationRules() {
    const { currentCompanyProfile } = useData();
    const raw = currentCompanyProfile?.applicationRules;
    return useMemo(() => resolveApplicationRules(raw), [raw]);
}

/**
 * Live rule verdict for one step.
 *
 * @param {string} semanticStep e.g. `'license'`
 * @param {object} formData     the wizard's current answers
 * @returns {{rules: object, blocking: Array, warnings: Array, all: Array}}
 */
export function useStepIssues(semanticStep, formData) {
    const { currentCompanyProfile } = useData();
    const rawRules = currentCompanyProfile?.applicationRules;
    const applicationConfig = currentCompanyProfile?.applicationConfig;

    return useMemo(() => {
        const result = evaluateApplicationRules({ rules: rawRules, applicationConfig, formData });
        const all = issuesForStep(result, semanticStep);
        return {
            rules: result.rules,
            all,
            blocking: all.filter((issue) => issue.severity === 'block'),
            warnings: all.filter((issue) => issue.severity === 'warn'),
        };
    }, [rawRules, applicationConfig, formData, semanticStep]);
}

/**
 * The step's Continue gate.
 *
 * Blocking issues are computed live but SHOWN only after the applicant has tried
 * to continue — a red alert that appears the instant "Yes, I had a violation" is
 * ticked, before there was any chance to add one, is nagging rather than
 * feedback. Once shown, the alert follows the answers: fixing the last issue
 * removes it, changing an answer back brings it back.
 *
 * `refuseIfBlocked()` returns true (and moves focus to the alert) when the step
 * must not advance. Focus is deferred one render when the alert has yet to mount.
 */
export function useStepGate(semanticStep, formData) {
    const issues = useStepIssues(semanticStep, formData);
    const [attempted, setAttempted] = useState(false);
    const issuesRef = useRef(null);
    const pendingFocus = useRef(false);

    useEffect(() => {
        if (pendingFocus.current && issuesRef.current) {
            pendingFocus.current = false;
            issuesRef.current.focus();
        }
    });

    const blockedCount = issues.blocking.length;
    const refuseIfBlocked = useCallback(() => {
        if (blockedCount === 0) return false;
        setAttempted(true);
        if (issuesRef.current) {
            issuesRef.current.focus();
        } else {
            pendingFocus.current = true;
        }
        return true;
    }, [blockedCount]);

    return { ...issues, attempted, issuesRef, refuseIfBlocked };
}

export default useApplicationRules;
