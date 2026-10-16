// src/config/applicationSchema.test.js
//
// The dossier's field list (`applicationSchema.js`, which the Application tab and
// the carrier's editor render) and the shared section table
// (`functions/shared/applicationSections.json`, which the review page, the
// submission record and its PDF read) are two lists. A field the dossier shows
// that the table does not hold is one a recruiter can see and edit but the record
// never keeps. So every field here is in the table, or listed below with the
// reason it is not.

import { describe, expect, it } from 'vitest';

import { APPLICATION_SCHEMA } from './applicationSchema';
import { STANDARD_SECTIONS } from './applicationDefinition';

/** Fields the dossier shows that the table deliberately does not hold. */
const OUTSIDE_THE_TABLE = Object.freeze({
    // Military service as flat answers, which the wizard no longer asks: it
    // records service as rows of `military`, which the table holds.
    'military-service': 'flat military answers',
    'military-branch': 'flat military answers',
    'military-mos': 'flat military answers',
    'military-start': 'flat military answers',
    'military-end': 'flat military answers',
    // The signature and the final certification are recorded with the
    // agreements they bind to, not as answers.
    'final-certification': 'the agreements',
    signature: 'the agreements',
    signatureDate: 'the agreements',
});

/** The table's fields by id; a repeating one carries its rows' columns. */
const tableFields = new Map(STANDARD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.id, field])));

/** A dossier row section whose rows the table stores under another name. */
const ROWS_STORED_AS = Object.freeze({ employmentHistory: 'employers' });

const schemaFields = APPLICATION_SCHEMA.sections.flatMap((section) => (section.fields || []).map((field) => field.key));
const schemaRowFields = APPLICATION_SCHEMA.sections.flatMap((section) => (section.itemFields || [])
    .map((field) => [ROWS_STORED_AS[section.id] || section.id, field.key]));

describe('the dossier shows only what the record keeps', () => {
    it.each(schemaFields)('holds %s in the shared table, or says why not', (key) => {
        expect(tableFields.has(key) || Object.hasOwn(OUTSIDE_THE_TABLE, key)).toBe(true);
    });

    it.each(schemaRowFields)('holds the %s rows\' %s among their columns', (rowsId, key) => {
        const rows = tableFields.get(rowsId);
        expect(rows?.repeating).toBe(true);
        expect(rows.columns.map((column) => column.id)).toContain(key);
    });

    it('lists as an exception only fields the table really lacks', () => {
        for (const key of Object.keys(OUTSIDE_THE_TABLE)) {
            expect(tableFields.has(key)).toBe(false);
            expect(schemaFields).toContain(key);
        }
    });
});
