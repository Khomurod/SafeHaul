// functions/shared/pdf/applicationSections.js
//
// The sections of the application PDF above the agreements: company header,
// title block, submission band, provenance, the answer sections (fixed and
// repeating), coverage, and custom questions. Extracted verbatim from
// `applicationDocument.js`, whose header states the rules these sections
// enforce — everything printed comes from the snapshot, nothing is invented,
// unpresented questions and internal identifiers never appear.

const {
    CONTENT_WIDTH,
    INK,
    MARGIN,
    TYPE,
} = require('./documentBuilder');
const { resolveRepeatingRows } = require('../submissionSnapshot');
const { decodeRepeatingRows } = require('../submissionSnapshotStorage');
const {
    NOT_PROVIDED,
    NONE_RECORDED,
    WORDING_UNAVAILABLE,
    clean,
    formatInstant,
    formatMonth,
    singularize,
    pluralMonths,
    scalarValue,
} = require('./applicationText');

/** Company identity block, top-left of page one. */
function drawCompanyHeader(doc, company) {
    const name = clean(company?.companyName) || 'Company name not recorded';

    doc.line(name, { size: TYPE.COMPANY, font: doc.font.bold, width: CONTENT_WIDTH * 0.62 });

    const dba = clean(company?.dba);
    if (dba) doc.line(`d/b/a ${dba}`, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const address = company?.address || {};
    const street = clean(address.street);
    const locality = [clean(address.city), clean(address.state)].filter(Boolean).join(', ');
    const cityLine = [locality, clean(address.zip)].filter(Boolean).join(' ');
    if (street) doc.line(street, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });
    if (cityLine) doc.line(cityLine, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const contact = company?.contact || {};
    const contactLine = [clean(contact.phone), clean(contact.email)].filter(Boolean).join('  ·  ');
    if (contactLine) doc.line(contactLine, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const registration = [
        clean(company?.dotNumber) ? `USDOT ${clean(company.dotNumber)}` : null,
        clean(company?.mcNumber) ? `MC ${clean(company.mcNumber)}` : null,
    ].filter(Boolean).join('  ·  ');
    if (registration) doc.line(registration, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });
}

/**
 * The title block, right-aligned against the company block.
 *
 * Drawn at a fixed y rather than through the cursor, because it sits beside the
 * company details rather than after them.
 */
function drawTitleBlock(doc, topY) {
    const savedY = doc.y;
    doc.y = topY;
    const width = CONTENT_WIDTH * 0.36;
    const x = MARGIN.LEFT + CONTENT_WIDTH - width;

    doc.line('DRIVER APPLICATION', { x, width, align: 'right', size: TYPE.TITLE, font: doc.font.bold });
    doc.line('FOR EMPLOYMENT', { x, width, align: 'right', size: TYPE.TITLE, font: doc.font.bold });
    doc.moveDown(3);
    doc.line('49 CFR Part 391, Subpart C', {
        x, width, align: 'right', size: TYPE.SMALL, color: INK.MUTED,
    });
    doc.y = savedY;
}

/** Submission metadata band under the header. */
function drawSubmissionBand(doc, snapshot, { sequence, isOriginal }) {
    const submitted = formatInstant(snapshot.submittedAt);
    const entries = [
        ['Submitted', submitted || 'Not recorded'],
        ['Record', isOriginal ? 'Original submission' : `Resubmission #${sequence}`],
    ];
    if (clean(snapshot.agreementVersion)) {
        entries.push(['Agreement set', clean(snapshot.agreementVersion)]);
    }

    doc.moveDown(6);
    doc.page.drawRectangle({
        x: MARGIN.LEFT, y: doc.y - 22, width: CONTENT_WIDTH, height: 26, color: INK.BAND,
    });
    doc.moveDown(2);

    const cellWidth = CONTENT_WIDTH / entries.length;
    const savedY = doc.y;
    entries.forEach(([label, value], index) => {
        doc.y = savedY;
        const x = MARGIN.LEFT + 10 + index * cellWidth;
        doc.line(label.toUpperCase(), {
            x, width: cellWidth - 12, size: 6.5, font: doc.font.bold, color: INK.MUTED, leading: 1.4,
        });
        doc.line(value, { x, width: cellWidth - 12, size: TYPE.SMALL, leading: 1.2 });
    });
    doc.y = savedY - 24;
}

/** Provenance caveats, stated plainly rather than implied. */
function drawProvenance(doc, snapshot) {
    const provenance = snapshot.provenance || {};
    if (provenance.source !== 'reconstructed') return;

    doc.moveDown(6);
    doc.page.drawRectangle({
        x: MARGIN.LEFT, y: doc.y - 4, width: 2.5, height: 4, color: INK.WARNING,
    });
    doc.line('RECONSTRUCTED RECORD', {
        x: MARGIN.LEFT + 9, size: TYPE.LABEL, font: doc.font.bold, color: INK.WARNING,
    });
    doc.paragraph(
        'This application was submitted before submissions were preserved. The record below was '
        + 'rebuilt from the evidence that survives. Where something could not be recovered it is '
        + 'stated as such and has not been reconstructed from present-day settings.',
        { x: MARGIN.LEFT + 9, width: CONTENT_WIDTH - 9, size: TYPE.SMALL, color: INK.MUTED, font: doc.font.italic },
    );
    for (const note of provenance.notes || []) {
        doc.paragraph(`• ${note}`, {
            x: MARGIN.LEFT + 9, width: CONTENT_WIDTH - 9, size: TYPE.SMALL, color: INK.MUTED, font: doc.font.italic,
        });
    }
    doc.moveDown(4);
}

/** One answer section: scalars in a grid, repeating groups as record blocks. */
function drawSection(doc, section, { includeFullSsn, columnsById }) {
    const answers = (section.answers || []).filter((answer) => answer.presented !== false);
    if (answers.length === 0) return;

    const scalars = answers.filter((answer) => !answer.repeating);
    const groups = answers.filter((answer) => answer.repeating);

    // A section whose every scalar is blank and whose every group is empty still
    // gets its heading: "we asked, nothing came back" is information.
    //
    // A section that opens with a repeating group reserves room for its first
    // record, not the two rows a scalar grid needs — otherwise "EDUCATION &
    // MILITARY" lands alone at the foot of a page with its schools overleaf.
    // Decoded like every other row read: `measureRecordBlock` needs an array of
    // cells, and a stored row map would measure as a single opaque object and
    // reserve the wrong height.
    const firstRows = groups[0] && Array.isArray(groups[0].rows)
        ? decodeRepeatingRows(groups[0].rows)
        : null;
    doc.sectionHeading(section.title, {
        keepWith: scalars.length > 0
            ? 62
            : (firstRows && firstRows.length
                ? Math.min(doc.measureRecordBlock(firstRows[0]) + 34, 420)
                : 40),
    });

    if (scalars.length > 0) {
        doc.fieldGrid(scalars.map((answer) => {
            const value = scalarValue(answer, { includeFullSsn });
            return {
                label: answer.label,
                value: value || NOT_PROVIDED,
                muted: !value,
            };
        }));
    }

    for (const group of groups) {
        const { rows, usedCurrentColumns } = resolveRepeatingRows(group, columnsById);
        // Keep the group label with its first record, measured rather than
        // guessed: a fifteen-field employer block is three times the height of a
        // four-field violation, and a fixed reserve orphans one or wastes a
        // third of a page on the other. Capped so a record taller than a page
        // cannot force an endless break.
        doc.subheading(group.label, {
            keepWith: rows.length ? Math.min(doc.measureRecordBlock(rows[0]) + 10, 420) : 24,
        });
        if (rows.length === 0) {
            doc.note(NONE_RECORDED);
            continue;
        }
        if (usedCurrentColumns) {
            doc.note(
                'This record predates stored field names, so these entries are laid out under '
                + 'the application\'s current ones. The applicant\'s answers are unchanged.',
            );
        }
        const singular = singularize(group.label);
        rows.forEach((cells, index) => {
            doc.recordBlock(`${singular} ${index + 1} of ${rows.length}`, cells);
        });
    }
}

/**
 * Three-year employment coverage, stated as a fact about the record rather than
 * a judgement about the applicant.
 */
function drawCoverage(doc, snapshot) {
    const coverage = snapshot.employmentCoverage;
    if (!coverage) return;

    doc.sectionHeading('Employment History Coverage');

    if (coverage.isComplete) {
        doc.paragraph(
            `The employment, unemployment, schooling and military records above account for the `
            + `full ${coverage.requiredMonths} months of history required by 49 CFR 391.21(b)(10).`,
        );
    } else {
        doc.paragraph(
            `The records above account for ${coverage.coveredMonths} of the ${coverage.requiredMonths} `
            + `months of history required by 49 CFR 391.21(b)(10). `
            + `${pluralMonths(coverage.missingMonths)} unaccounted for.`,
        );
        const gaps = Array.isArray(coverage.gaps) ? coverage.gaps : [];
        if (gaps.length > 0) {
            doc.moveDown(4);
            doc.subheading('Unaccounted periods');
            for (const gap of gaps) {
                const from = formatMonth(gap.fromMonth);
                const to = formatMonth(gap.toMonth);
                if (!from && !to) continue;
                const span = from === to ? from : `${from || 'unknown'} to ${to || 'unknown'}`;
                const length = Number.isFinite(gap.months)
                    ? ` (${gap.months} month${gap.months === 1 ? '' : 's'})`
                    : '';
                doc.paragraph(`• ${span}${length}`, { size: TYPE.BODY });
            }
        }
        doc.moveDown(4);
        doc.note(
            'The applicant was shown this shortfall before submitting and chose to continue. '
            + 'The gap is recorded here rather than filled in.',
        );
    }
}

/**
 * Company-authored questions, printed with their HUMAN wording.
 *
 * The old generator iterated the answer map and used each key as the label,
 * which put question UUIDs in front of recruiters under this exact heading.
 */
function drawCustomQuestions(doc, snapshot) {
    const answers = Array.isArray(snapshot.customAnswers) ? snapshot.customAnswers : [];
    if (answers.length === 0) return;

    doc.sectionHeading('Supplemental Questions');

    for (const answer of answers) {
        const value = clean(answer.displayValue);
        doc.ensure(34);
        doc.moveDown(2);

        if (answer.labelMissing) {
            doc.line(WORDING_UNAVAILABLE, {
                size: TYPE.SUBHEADING, font: doc.font.italic, color: INK.MUTED,
            });
        } else {
            doc.paragraph(answer.label, { size: TYPE.SUBHEADING, font: doc.font.bold });
        }

        if (answer.unknownQuestion) {
            doc.note(
                'This answer no longer matches a question on the company\'s application. '
                + 'It is kept because the applicant gave it.',
            );
        }

        if (value) {
            doc.paragraph(value);
        } else {
            doc.paragraph(NOT_PROVIDED, { font: doc.font.italic, color: INK.MUTED });
        }
        doc.moveDown(4);
    }
}


module.exports = {
    drawCompanyHeader,
    drawTitleBlock,
    drawSubmissionBand,
    drawProvenance,
    drawSection,
    drawCoverage,
    drawCustomQuestions,
};
