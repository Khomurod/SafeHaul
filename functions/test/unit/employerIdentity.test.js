/**
 * A verification can never end up on the wrong employer.
 *
 * ## The failure these cases are written from
 *
 * A Previous Employment Verification is addressed positionally:
 * `verification_requests/{token}` records `employerIndex`, and the employer's own
 * response and the reminder cycle both write their result into `employers[idx]`.
 * That is sound only while nobody changes the array — and making employers
 * editable makes changing it a supported workflow.
 *
 *     [0] ABC Trucking   — verification Completed
 *     [1] XYZ Transport  — Not Started
 *
 * Delete ABC and XYZ becomes index 0, so a request issued for ABC files ABC's
 * completed verification, respondent, signature and result PDF against **XYZ**.
 * Nothing errors. The carrier's DQ file is then wrong in the one way that
 * matters: it claims a company nobody contacted confirmed this driver.
 *
 * The first describe below is that exact scenario, named as the task named it.
 */

const {
    MAX_EMPLOYERS, resolveEmployerTarget, withEmployerIds,
} = require('../../shared/employerIdentity');
const {
    describeEmployerEdit, reconcileEmployerEdit, removesVerifiedEmployer,
} = require('../../shared/employerEdits');

const COMPLETED = Object.freeze({
    status: 'Completed',
    respondentName: 'Pat Dispatcher',
    resultUrl: 'application_originals/co/app/abc.pdf',
    history: [{ action: 'Completed via Portal', timestamp: '2026-09-01T00:00:00Z' }],
});

/** The two-employer application from the report, with ids already stamped. */
function twoEmployers() {
    return [
        { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking', verification: { ...COMPLETED } },
        { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' },
    ];
}

describe('ABC is removed and XYZ must not inherit its verification', () => {
    it('does not move the completed verification onto the row that took its index', () => {
        const current = twoEmployers();
        // What the editor sends: XYZ alone, carrying whatever the browser had.
        const proposed = [{ employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' }];

        const { employers, removed } = reconcileEmployerEdit(proposed, current);

        expect(employers).toHaveLength(1);
        expect(employers[0].companyName).toBe('XYZ Transport');
        expect(employers[0].verification).toBeUndefined();
        // And the removal is reported, so it can be written into the audit log
        // rather than happening silently.
        expect(removed).toHaveLength(1);
        expect(removed[0].companyName).toBe('ABC Trucking');
    });

    it('does not move it when the browser sends it, either', () => {
        // The realistic shape of the bug: an editor that copies rows carries the
        // verification block with them, and index 0's block lands on index 0.
        const current = twoEmployers();
        const proposed = [{
            employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport', verification: { ...COMPLETED },
        }];

        const { employers } = reconcileEmployerEdit(proposed, current);

        expect(employers[0].verification).toBeUndefined();
    });

    it('refuses a write-back for a request whose employer is gone', () => {
        const after = [{ employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' }];

        // ABC's outstanding request, which recorded index 0.
        expect(resolveEmployerTarget(after, {
            employerId: 'aaaaaaaaaaaa', employerIndex: 0, employerName: 'ABC Trucking',
        })).toBeNull();
    });

    it('refuses a LEGACY write-back whose index now names a different employer', () => {
        // A request from before ids existed: index only. The name it was sent to is
        // what makes the index checkable, and it no longer matches.
        const after = [{ employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' }];

        expect(resolveEmployerTarget(after, {
            employerIndex: 0, employerName: 'ABC Trucking',
        })).toBeNull();
    });

    it('still honours a legacy request while its employer really is where it was', () => {
        // Refusing this one would break every verification outstanding at the moment
        // ids arrived, which is the other way to get this wrong.
        const unchanged = twoEmployers();

        expect(resolveEmployerTarget(unchanged, {
            employerIndex: 0, employerName: 'ABC Trucking',
        })).toEqual({ index: 0, matchedBy: 'index' });
    });
});

describe('reordering', () => {
    it('follows the employer, not the position', () => {
        const reordered = [twoEmployers()[1], twoEmployers()[0]];

        expect(resolveEmployerTarget(reordered, {
            employerId: 'aaaaaaaaaaaa', employerIndex: 0, employerName: 'ABC Trucking',
        })).toEqual({ index: 1, matchedBy: 'id' });
    });

    it('keeps each row own verification through a reorder', () => {
        const current = twoEmployers();
        const proposed = [
            { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' },
            { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking' },
        ];

        const { employers, removed } = reconcileEmployerEdit(proposed, current);

        expect(employers[0].verification).toBeUndefined();
        expect(employers[1].verification).toMatchObject({ status: 'Completed' });
        expect(removed).toHaveLength(0);
    });
});

describe('editing an employer that has verification activity', () => {
    it('keeps the verification when the details change', () => {
        const current = twoEmployers();
        const proposed = [
            {
                employerId: 'aaaaaaaaaaaa',
                companyName: 'ABC Trucking LLC',
                dotNumber: '998877',
                reasonForLeaving: 'Better route',
            },
            { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' },
        ];

        const { employers } = reconcileEmployerEdit(proposed, current);

        expect(employers[0].companyName).toBe('ABC Trucking LLC');
        expect(employers[0].reasonForLeaving).toBe('Better route');
        // A renamed employer is the same employer: the identity is the id, never
        // the name, precisely so that correcting a typo does not orphan the history.
        expect(employers[0].verification).toMatchObject(COMPLETED);
    });

    it('says out loud when a removal takes verification activity with it', () => {
        const { removed } = reconcileEmployerEdit(
            [{ employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' }],
            twoEmployers(),
        );

        expect(removesVerifiedEmployer(removed)).toBe(true);
        expect(describeEmployerEdit(removed)).toContain('ABC Trucking (verification: Completed)');
        // And the sentence says what did NOT happen, because the PEV record itself
        // lives on `verification_requests` and is never deleted here.
        expect(describeEmployerEdit(removed)).toContain('are kept on file and are not deleted');
    });

    it('has nothing to say when nothing was removed', () => {
        const { removed } = reconcileEmployerEdit(twoEmployers(), twoEmployers());
        expect(describeEmployerEdit(removed)).toBeNull();
        expect(removesVerifiedEmployer(removed)).toBe(false);
    });
});

describe('adding an employer', () => {
    it('mints an identity for it and gives it no verification', () => {
        const current = twoEmployers();
        const proposed = [
            ...twoEmployers(),
            // No id, and a verification block the client had no business sending.
            { companyName: 'New Freight Co', verification: { ...COMPLETED } },
        ];

        const { employers } = reconcileEmployerEdit(proposed, current);

        expect(employers).toHaveLength(3);
        expect(employers[2].employerId).toMatch(/^[0-9a-f]{12}$/);
        expect(employers[2].verification).toBeUndefined();
        expect(employers[0].verification).toMatchObject({ status: 'Completed' });
    });

    it('re-mints a duplicated id, so two rows can never claim one verification', () => {
        // A copy-and-paste in the editor is how this arrives, and it would make
        // "which employer is this" ambiguous again.
        const current = twoEmployers();
        const proposed = [
            { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking' },
            { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking (copy)' },
        ];

        const { employers } = reconcileEmployerEdit(proposed, current);

        expect(employers[0].employerId).toBe('aaaaaaaaaaaa');
        expect(employers[1].employerId).not.toBe('aaaaaaaaaaaa');
        expect(employers[0].verification).toMatchObject({ status: 'Completed' });
        expect(employers[1].verification).toBeUndefined();
    });
});

describe('legacy employer data', () => {
    it('stamps ids on rows that never had them, without touching anything else', () => {
        const legacy = [
            // `name` rather than `companyName`: the pre-rename shape the dossier
            // renderer still falls back to.
            { name: 'Old Hauling', reason: 'Laid off' },
            { companyName: 'Newer Freight' },
        ];

        const { employers, changed } = withEmployerIds(legacy);

        expect(changed).toBe(true);
        expect(employers[0]).toMatchObject({ name: 'Old Hauling', reason: 'Laid off' });
        expect(employers[0].employerId).toMatch(/^[0-9a-f]{12}$/);
        expect(employers[1].employerId).not.toBe(employers[0].employerId);
    });

    it('reports no change when every row already has one', () => {
        const { changed } = withEmployerIds(twoEmployers());
        expect(changed).toBe(false);
    });

    it('matches a legacy request against a legacy `name` field', () => {
        const { employers } = withEmployerIds([{ name: 'Old Hauling' }]);
        expect(resolveEmployerTarget(employers, {
            employerIndex: 0, employerName: 'old  hauling',
        })).toEqual({ index: 0, matchedBy: 'index' });
    });

    it('refuses a legacy request that recorded no name at all', () => {
        // Nothing to check means nothing to trust, and these are the same requests
        // that predate ids — so refusing is the safe half of an already narrow case.
        expect(resolveEmployerTarget([{ companyName: 'Anyone' }], { employerIndex: 0 })).toBeNull();
    });

    it('refuses an index that is off the end of the array', () => {
        expect(resolveEmployerTarget([], { employerIndex: 0, employerName: 'ABC' })).toBeNull();
        expect(resolveEmployerTarget(twoEmployers(), { employerIndex: 5, employerName: 'ABC Trucking' }))
            .toBeNull();
    });
});

describe('bounds', () => {
    it('caps how many employers one application may hold', () => {
        const many = Array.from({ length: MAX_EMPLOYERS + 10 }, (_, i) => ({ companyName: `Co ${i}` }));
        expect(withEmployerIds(many).employers).toHaveLength(MAX_EMPLOYERS);
    });

    it('treats a non-array as no employers rather than throwing', () => {
        expect(withEmployerIds(null).employers).toEqual([]);
        expect(reconcileEmployerEdit(undefined, undefined).employers).toEqual([]);
    });
});
