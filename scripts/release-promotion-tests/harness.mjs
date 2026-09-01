/**
 * Shared assertion harness for the promotion-gate tests, extracted verbatim
 * from `test-release-promotion.mjs`. The failure counter lives here so every
 * scenario module feeds the same total; the entry reads it via
 * `failureCount()` for the exit status.
 */
import {
    resolveTestingRelease,
    IneligibleReleaseError,
} from '../resolve-testing-release.mjs';

let failures = 0;

export function failureCount() {
    return failures;
}

export function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

export async function refuses(label, options) {
    try {
        await resolveTestingRelease(options);
        failures += 1;
        console.error(`  FAIL ${label} — expected a refusal, but it resolved`);
    } catch (error) {
        assert(
            label,
            error instanceof IneligibleReleaseError,
            `threw ${error.constructor.name}: ${error.message}`,
        );
    }
}
