import {
    carrierAlreadyListed,
    employerFromCarrier,
    licenseFillPlan,
    licensePatch,
    violationAlreadyListed,
    violationFromSuggestion,
} from '@features/driver-app/components/application/reportSuggestions';
import { parseAddressPartsFromCdl } from '@shared/utils/parseCdlAddress';

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
        dob: driver.dateOfBirth,
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
        const parts = parseAddressPartsFromCdl(driver.fullAddress);
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
    const medCard = extracted?.license?.medCardExpiration;
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
        if (carrierAlreadyListed(employers, carrier)) {
            // Already on the application, by name or USDOT number. Locking it is
            // still right — the report names it either way — but adding it again
            // would be a duplicate row nobody asked for.
            lockedCarriers.push(carrier);
            return;
        }
        employers.push(employerFromCarrier(carrier, now + index));
        lockedCarriers.push(carrier);
        added.employers += 1;
    });
    next.employers = employers;

    // --- violations, from either report ---------------------------------------
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
