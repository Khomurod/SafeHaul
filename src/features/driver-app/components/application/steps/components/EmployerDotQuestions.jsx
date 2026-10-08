import React from 'react';
import RadioGroup from '@shared/components/form/RadioGroup';
import { YES_NO_OPTIONS } from '@/config/form-options';
import { endedBeforeLastThreeYears } from '@shared/utils/employmentApplicationHelpers';

/**
 * The two questions 49 CFR 391.21(b)(10)(iv) asks about each employer of the
 * three years before the application: was the applicant subject to the FMCSRs
 * there, and was the job a safety-sensitive function subject to DOT drug and
 * alcohol testing (49 CFR Part 40).
 *
 * Neither is pre-selected: the applicant answers both. They are left out only
 * when the row's own end date places the job before those three years, so a
 * row whose dates are not filled in yet is still asked.
 *
 * The saved keys are the verification portal's names for the same facts
 * (`subjectToFmcsrs`, `subjectToDotTesting`), so the applicant's answer and the
 * previous employer's read side by side. Ids are scoped by row like the step's
 * other per-row radio groups. `errorFor(key)` says why a question still needs
 * an answer, once the applicant has pressed Continue.
 */
export function EmployerDotQuestions({ index, item, required, onChange, errorFor = () => undefined }) {
    if (endedBeforeLastThreeYears(item)) return null;
    return (
        <>
            <RadioGroup
                label="Were you subject to the FMCSRs (Federal Motor Carrier Safety Regulations) while employed here?"
                name="subjectToFmcsrs"
                idPrefix={'emp-fmcsrs-' + index}
                groupName={'emp-fmcsrs-' + index}
                options={YES_NO_OPTIONS}
                value={item.subjectToFmcsrs}
                onChange={onChange}
                required={required}
                error={errorFor('subjectToFmcsrs')}
            />
            <RadioGroup
                label="Was this job a safety-sensitive function in any DOT-regulated mode, subject to drug and alcohol testing under 49 CFR Part 40?"
                name="subjectToDotTesting"
                idPrefix={'emp-dot-tested-' + index}
                groupName={'emp-dot-tested-' + index}
                options={YES_NO_OPTIONS}
                value={item.subjectToDotTesting}
                onChange={onChange}
                required={required}
                error={errorFor('subjectToDotTesting')}
            />
        </>
    );
}

export default EmployerDotQuestions;
