// src/config/applicationGates.test.js
//
// Two things are asserted here:
//
//   1. The resolver's own behaviour (canonical key, legacy alias, legacy boolean,
//      required/hidden exclusivity, defaults).
//   2. PARITY with the server. The browser copy in `applicationGates.js` and the
//      Cloud Functions copy in `functions/shared/applicationDefinition.js` are
//      separate files because the two bundles deploy separately. If they drift,
//      a driver can be shown a question the snapshot records as never asked — so
//      the drift itself is the defect this test exists to catch.
//
//   3. That every gate the settings UI offers actually reaches a public apply
//      page through `publicProfileDto`'s allowlist. A setting that cannot cross
//      that boundary silently does nothing, which is the bug this stage fixed.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import {
    GATE_ALIASES,
    GATE_DEFAULT_HIDDEN,
    GATE_DEFAULT_REQUIRED,
    resolveApplicationGate,
} from './applicationGates';
import { STANDARD_FIELDS } from '@features/settings/components/questions/StandardQuestionsConfig';

const require = createRequire(import.meta.url);
const serverDefinition = require('../../functions/shared/applicationDefinition.js');
const { PUBLIC_APPLICATION_CONFIG_KEYS } = require('../../functions/shared/publicProfileDto.js');

describe('resolveApplicationGate', () => {
    it('uses the shared default when a company has configured nothing', () => {
        expect(resolveApplicationGate({}, 'ssn')).toEqual({
            hidden: false, required: true, configured: false,
        });
        expect(resolveApplicationGate(undefined, 'referralSource')).toEqual({
            hidden: false, required: false, configured: false,
        });
    });

    it('keeps emergency contacts hidden until a company opts in', () => {
        expect(resolveApplicationGate({}, 'emergencyContacts')).toEqual({
            hidden: true, required: false, configured: false,
        });
    });

    it('honours the canonical key', () => {
        expect(resolveApplicationGate({ employmentHistory: { hidden: true } }, 'employmentHistory'))
            .toEqual({ hidden: true, required: false, configured: true });
        expect(resolveApplicationGate({ referralSource: { required: true } }, 'referralSource'))
            .toEqual({ hidden: false, required: true, configured: true });
    });

    it('falls back to a legacy alias only when the canonical key is absent', () => {
        expect(resolveApplicationGate({ employers: { hidden: true } }, 'employmentHistory').hidden)
            .toBe(true);
        // Canonical wins over the alias.
        expect(resolveApplicationGate(
            { employmentHistory: { hidden: false, required: true }, employers: { hidden: true } },
            'employmentHistory',
        )).toEqual({ hidden: false, required: true, configured: true });
    });

    it('reads the legacy showEmergencyContacts boolean', () => {
        expect(resolveApplicationGate({ showEmergencyContacts: true }, 'emergencyContacts').hidden)
            .toBe(false);
        expect(resolveApplicationGate({ showEmergencyContacts: false }, 'emergencyContacts').hidden)
            .toBe(true);
    });

    it('never reports a hidden field as required', () => {
        expect(resolveApplicationGate({ ssn: { hidden: true, required: true } }, 'ssn'))
            .toEqual({ hidden: true, required: false, configured: true });
    });

    it('ignores a gate value of an unusable type', () => {
        expect(resolveApplicationGate({ ssn: 'yes' }, 'ssn').configured).toBe(false);
    });

    it('returns a neutral result for a missing gate id', () => {
        expect(resolveApplicationGate({ ssn: { hidden: true } }, '')).toEqual({
            hidden: false, required: false, configured: false,
        });
    });
});

describe('parity with the Cloud Functions resolver', () => {
    it('shares one default-required table', () => {
        expect(GATE_DEFAULT_REQUIRED).toEqual(serverDefinition.GATE_DEFAULT_REQUIRED);
    });

    it('shares one default-hidden table', () => {
        expect(GATE_DEFAULT_HIDDEN).toEqual(serverDefinition.GATE_DEFAULT_HIDDEN);
    });

    it('shares one alias table', () => {
        expect(GATE_ALIASES).toEqual(serverDefinition.GATE_ALIASES);
    });

    it('resolves every gate identically for the same configuration', () => {
        const configs = [
            {},
            { ssn: { hidden: true } },
            { employers: { hidden: true } },
            { previousAddresses: { required: false } },
            { showEmergencyContacts: true },
            { emergencyContacts: { hidden: false, required: true } },
            { medCardUpload: { hidden: false, required: false } },
            { mvrConsent: { hidden: false, required: true } },
        ];

        for (const config of configs) {
            for (const gate of Object.keys(GATE_DEFAULT_REQUIRED)) {
                const client = resolveApplicationGate(config, gate);
                const server = serverDefinition.resolveGate(config, gate);
                expect(
                    { hidden: client.hidden, required: client.required },
                    `gate ${gate} with ${JSON.stringify(config)}`,
                ).toEqual({ hidden: server.hidden, required: server.required });
            }
        }
    });
});

describe('settings reach the public apply page', () => {
    it('offers a settings toggle for every declared gate', () => {
        const offered = STANDARD_FIELDS.map((f) => f.id).sort();
        expect(offered).toEqual(Object.keys(GATE_DEFAULT_REQUIRED).sort());
    });

    it('forwards every configurable gate through the public projection', () => {
        for (const field of STANDARD_FIELDS) {
            expect(
                PUBLIC_APPLICATION_CONFIG_KEYS,
                `gate "${field.id}" is configurable in Settings but never reaches a public apply page`,
            ).toContain(field.id);
        }
    });

    it('still forwards the legacy spellings so saved configurations keep working', () => {
        for (const aliases of Object.values(GATE_ALIASES)) {
            for (const alias of aliases) {
                expect(PUBLIC_APPLICATION_CONFIG_KEYS).toContain(alias);
            }
        }
    });
});
