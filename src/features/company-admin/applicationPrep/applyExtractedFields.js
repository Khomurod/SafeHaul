import {
    employerFromCarrier,
    findListedCarrier,
    licenseFillPlan,
    licensePatch,
    violationAlreadyListed,
    violationFromSuggestion,
} from '@features/driver-app/components/application/reportSuggestions';
import { parseAddressPartsFromCdl } from '@shared/utils/parseCdlAddress';
import { toUsStateName } from '@shared/utils/usStates';

/**
 * Putting what the documents said into the application the carrier is preparing.
 *
 * ## Fill what is empty, keep what is there
 *
 * A recruiter who typed a licence number before pressing Read meant that licence
 * number. Every field here fills only when the form is blank, using the same
 * `licenseFillPlan` the driver's own PSP/MVR import uses — one rule about what
 * overwriting means, on both sides of the application.
 *
 * ## The same mappers the driver's import uses
 *
 * `employerFromCarrier`, `violationFromSuggestion` and the two "already listed"
 * checks are imported rather than rewritten. A PSP carrier becomes the same
 * employer row whether the driver imported it or the carrier did, which is what
 * lets the row be locked on one side and rendered on the other without a
 * translation step between them.
 *
 * ## A PSP carrier is a sighting, and stays one
 *
 * The row it produces holds a name and a USDOT number and nothing else. The dates
 * are not in the report — an inspection date is not a hire date — so they are left
 * empty for whoever can actually answer them.
 */

/** Every field a document can fill, and where it comes from. */
const DRIVER_FIELDS = Object.freeze(['firstName', 'lastName', 'dob']);
const ADDRESS_FIELDS = Object.freeze(['street', 'city', 'state', 'zip']);

function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

/**
 * A date the form's date controls can show, or nothing — the rule the fill plan
 * already applies to the licence expiration. A value they cannot show is held by
 * the form and seen by nobody: the carrier's box and the driver's picker were both
 * blank over "03/11/1988" (2026-10-01).
 */
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fullDate = (value) => (FULL_DATE.test(String(value ?? '').trim()) ? String(value).trim() : '');

/**
 * @param {object} formData what the carrier has so far
 * @param {object} extracted the reader's normalised answer
 * @param {object} [options] `{ now }` for deterministic row ids in tests
 * @returns {{formData: object, lockedCarriers: Array, added: object, kept: Array}}
 */
export function applyExtractedFields(formData, extracted, options = {}) {
    const now = options.now || Date.now();
    const current = formData || {};
    const next = { ...current };
    const kept = [];
    const added = { employers: 0, violations: 0, fields: 0 };

    // --- the driver themselves -------------------------------------------------
    const driver = extracted?.driver || {};
    const driverValues = {
        firstName: driver.firstName,
        lastName: driver.lastName,
        dob: fullDate(driver.dateOfBirth),
    };
    for (const field of DRIVER_FIELDS) {
        if (isBlank(driverValues[field])) continue;
        if (isBlank(current[field])) {
            next[field] = driverValues[field];
            added.fields += 1;
        } else if (String(current[field]).trim() !== String(driverValues[field]).trim()) {
            kept.push(field);
        }
    }

    // The licence prints one address line; the application holds four fields.
    if (!isBlank(driver.fullAddress)) {
        const parsed = parseAddressPartsFromCdl(driver.fullAddress);
        // The parser returns the postal code the licence prints; the driver's state
        // picker holds names and rendered a code as "Alabama". See usStates.js.
        const parts = { ...parsed, state: toUsStateName(parsed.state) };
        for (const field of ADDRESS_FIELDS) {
            if (isBlank(parts[field])) continue;
            if (isBlank(current[field])) {
                next[field] = parts[field];
                added.fields += 1;
            } else if (String(current[field]).trim() !== String(parts[field]).trim()) {
                kept.push(field);
            }
        }
    }

    // --- the licence -----------------------------------------------------------
    const plan = licenseFillPlan(current, extracted?.license || {});
    const patch = licensePatch(plan);
    Object.assign(next, patch);
    added.fields += Object.keys(patch).length;
    kept.push(...plan.filter((row) => row.action === 'keep').map((row) => row.id));

    // `medCardExpiration` is not part of the licence plan — it comes from a
    // different card — so it fills on the same terms, separately.
    const medCard = fullDate(extracted?.license?.medCardExpiration);
    if (!isBlank(medCard)) {
        if (isBlank(current.medCardExpiration)) {
            next.medCardExpiration = medCard;
            added.fields += 1;
        } else if (String(current.medCardExpiration).trim() !== String(medCard).trim()) {
            kept.push('medCardExpiration');
        }
    }

    // --- carriers the report named --------------------------------------------
    const employers = Array.isArray(current.employers) ? [...current.employers] : [];
    const lockedCarriers = [];
    (extracted?.carriers || []).forEach((carrier, index) => {
        const listed = findListedCarrier(employers, carrier);
        if (listed) {
            // Already on the application, by name or USDOT number. Locking it is
            // still right — the report names it either way — but adding it again
            // would be a duplicate row nobody asked for.
            //
            // And it is the ROW that is locked, as it stands. Locking the report's
            // own spelling made a lock no driver could satisfy (found 2026-10-01): a
            // row "Acme Trucking LLC" matched by USDOT to the report's "ACME
            // TRUCKING" passed every carrier save, then failed submission as
            // `locked-employer-changed` — on a name the wizard shows the driver as a
            // record they cannot edit. Matched by name with no number on the row, the
            // report's number gave the lock a signature no row had, and the save
            // silently dropped it.
            lockedCarriers.push({ companyName: listed.companyName || '', dotNumber: listed.dotNumber || '' });
            return;
        }
        employers.push(employerFromCarrier(carrier, now + index));
        lockedCarriers.push(carrier);
        added.employers += 1;
    });
    next.employers = employers;

    // --- violations: the motor vehicle record's convictions -------------------
    const violations = Array.isArray(current.violations) ? [...current.violations] : [];
    (extracted?.violations || []).forEach((violation, index) => {
        if (violationAlreadyListed(violations, violation)) return;
        violations.push(violationFromSuggestion(violation, now + 1000 + index));
        added.violations += 1;
    });
    next.violations = violations;
    if (violations.length > 0) next['has-violations'] = 'yes';

    return { formData: next, lockedCarriers, added, kept: [...new Set(kept)] };
}

export default applyExtractedFields;
