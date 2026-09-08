import React, { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, AlertCircle, Loader2, Sparkles } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { describeError } from './useApplicationPrepDraft';
import { extractDocuments } from './extraction/documentExtractionPipeline';
import { attachedDocuments } from './attachedDocuments';
import { mergeExtractionResults } from './mergeExtractionResults';

/**
 * "Read what I attached, and fill in what you can."
 *
 * The optional half of the feature. Everything it does, a recruiter can do by
 * typing, and everything it fills in, they can change — it saves the typing, it
 * does not make the decisions.
 *
 * ## What it does with what it finds
 *
 * Fills fields that are empty and leaves alone every one that is not, saying which
 * it left. Adds carriers the PSP report named as employer rows holding a name and
 * a USDOT number — never dates, which the report does not contain — and locks
 * them, because being on that report is exactly the claim a lock makes. Adds
 * violations from either report.
 *
 * ## The second pass
 *
 * The reader reports, per document, when the text it was given was too poor to
 * read. Those documents are sent again as page images, to the models that read
 * pictures — the case this catches is a photograph whose OCR produced fluent
 * nonsense, which no amount of client-side checking would have caught.
 *
 * **A failure in that second pass used to discard the first.** Both calls sat in
 * one `try`, so one failed vision retry on a medical card threw away a licence and
 * a PSP report that had read perfectly — the exact failure `mergeExtractionResults`
 * was written to prevent, one layer up. The second pass is its own `try` now, and
 * losing it falls back to the first pass rather than to nothing. It still WINS
 * where it succeeds, which is why the fallback is "apply the first pass" and not
 * "apply the first pass eagerly, then top it up": a value the first pass reported
 * for a document the model admitted it could not read is precisely the value not
 * to trust.
 *
 * ## A result belongs to one application and one set of documents
 *
 * There was nothing tying a response to what it was asked about — no applicant
 * key, no document set, no request id. `onApply` belongs to the *page*, which
 * outlives this panel, so a read started for one driver and resolved after the
 * recruiter opened another wrote the first driver's answers, and the first
 * driver's PSP carrier LOCKS, under the second driver's key. That manufactures
 * exactly the unsatisfiable lock state `reconcileLockedEmployers` exists to
 * prevent, on a driver who never had those employers. Both facts are captured
 * before the call and checked after it.
 */

const METHOD_LABELS = Object.freeze({
    text: { tone: 'success', label: 'Read from the document text' },
    ocr: { tone: 'success', label: 'Read by recognising the page' },
    vision: { tone: 'info', label: 'Read from the page image — worth checking' },
    unreadable: { tone: 'warning', label: 'Too unclear to read' },
    pages: { tone: 'info', label: 'Sent as an image' },
    failed: { tone: 'danger', label: 'Could not be read' },
});

const DOCUMENT_LABELS = Object.freeze({
    cdl: "Driver's licence",
    medical: 'Medical card',
    psp: 'PSP report',
    mvr: 'Motor vehicle record',
});

/**
 * Which documents a read was asked about.
 *
 * Compared for inequality only, so a document replaced or removed while the read
 * was open makes the answer stale rather than merely different. Name and size
 * because a recruiter who re-attaches a corrected scan keeps the file name.
 */
function documentSetOf(readable) {
    return readable
        .map((entry) => `${entry.field}:${entry.file?.name || ''}:${entry.file?.size || 0}`)
        .sort()
        .join('|');
}

export function ApplicationAiPrepPanel({
    companyId, files, blobs, applicantKey, onApplyExtraction, busy, onBusyChange,
}) {
    const [state, setState] = useState('idle');
    const [error, setError] = useState(null);
    const [methods, setMethods] = useState({});
    const [summary, setSummary] = useState(null);

    /**
     * Still on screen.
     *
     * The read outlives this panel: moving from the upload step to the editor
     * unmounts one instance and mounts another, and `onApplyExtraction` belongs to
     * the page, so the result lands either way. What must not happen is this
     * instance setting state after it has gone.
     */
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    // What the application holds, and which of those this tab can actually read.
    // See `attachedDocuments`: an upload leaves metadata behind, not bytes.
    const attached = attachedDocuments(files, blobs);
    const readable = attached.filter((entry) => entry.file);
    const elsewhere = attached.filter((entry) => !entry.file);
    const documentSet = documentSetOf(readable);
    /**
     * What is on screen NOW, for the check at the end of the read.
     *
     * A ref and not the closure's own values: `read` is a `useCallback`, so the
     * in-flight one holds the applicant and the document set as they were when the
     * button was pressed — comparing those against themselves always agrees, which
     * is a guard that cannot fire. This is the same reason the answers are read
     * through `latestFormData` in the hook.
     */
    const onScreen = useRef({ applicantKey, documentSet });
    onScreen.current = { applicantKey, documentSet };

    const read = useCallback(async () => {
        // Which application and which documents this answer will belong to.
        const askedFor = { applicantKey, documentSet };
        setState('reading');
        setError(null);
        setSummary(null);
        onBusyChange?.(true);
        try {
            const extraction = await extractDocuments(readable);
            if (Object.keys(extraction.documents).length === 0) {
                if (!mounted.current) return;
                setError('None of the attached files could be opened. You can still type the details in.');
                setState('error');
                return;
            }

            const call = httpsCallable(functions, 'extractCompanyApplicationDocuments', { timeout: 120000 });
            const { data: first } = await call({ companyId, documents: extraction.documents });

            let extracted = first.extracted;
            let readMethods = { ...extraction.methods, ...first.methods };

            // Documents the model itself could not read go again, as pictures.
            const unreadable = Object.entries(first.methods || {})
                .filter(([, method]) => method === 'unreadable')
                .map(([kind]) => kind);
            if (unreadable.length > 0) {
                try {
                    const pages = await extractDocuments(
                        readable.filter((entry) => unreadable.includes(entry.kind)),
                        { forcePages: true },
                    );
                    const asPages = Object.fromEntries(Object.entries(pages.documents)
                        .filter(([kind]) => unreadable.includes(kind))
                        .map(([kind, value]) => [kind, value.pages ? value : { pages: [] }]));
                    if (Object.values(asPages).some((entry) => entry.pages.length > 0)) {
                        const second = await call({ companyId, documents: asPages });
                        // Nested, not spread: the second pass answers for the
                        // unreadable documents only, so its empty sections would
                        // otherwise erase everything the first pass read. See
                        // `mergeExtractionResults`.
                        extracted = mergeExtractionResults(extracted, second.data.extracted);
                        readMethods = { ...readMethods, ...second.data.methods };
                    }
                } catch (secondError) {
                    // Its own `try` so the first pass survives it. A licence and a
                    // PSP report that read perfectly are not worth losing to one
                    // failed retry on a medical card; the documents it could not
                    // read stay flagged as such in the summary either way.
                    console.warn('[ApplicationAiPrepPanel] second pass failed:', secondError?.code || secondError?.message);
                }
            }

            // The answer has to belong to what was asked. `onApplyExtraction`
            // reaches the page, which outlives this panel, so without this a read
            // started for one driver and resolved after the recruiter opened
            // another writes the first driver's answers — and their PSP carrier
            // locks — under the second driver's key.
            if (!mounted.current) return;
            const now = onScreen.current;
            if (askedFor.applicantKey !== now.applicantKey || askedFor.documentSet !== now.documentSet) {
                setState('idle');
                return;
            }

            const applied = onApplyExtraction(extracted);
            setMethods(readMethods);
            setSummary(applied);
            setState('done');
        } catch (readError) {
            if (!mounted.current) return;
            setError(describeError(readError));
            setState('error');
        } finally {
            onBusyChange?.(false);
        }
    }, [companyId, applicantKey, documentSet, onApplyExtraction, onBusyChange, readable]);

    return (
        <Card padding="md">
            <div className="space-y-ds-3">
                <div>
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Read the documents</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Optional. Whatever you attached above is read and used to fill in the blanks. Anything you have
                        already typed is kept, and you can change everything afterwards.
                    </p>
                </div>

                <Button
                    variant="primary"
                    onClick={read}
                    disabled={readable.length === 0 || state === 'reading' || busy}
                    data-testid="read-documents"
                >
                    {state === 'reading'
                        ? <><Icon icon={Loader2} size="sm" className="animate-spin" /> Reading…</>
                        : <><Icon icon={Sparkles} size="sm" /> Read {readable.length || 'the'} document{readable.length === 1 ? '' : 's'}</>}
                </Button>

                {elsewhere.length > 0 && (
                    <FieldMessage tone="help" data-testid="reattach-to-read">
                        Attached in an earlier session, so not in this browser to read:
                        {' '}{[...new Set(elsewhere.map((entry) => DOCUMENT_LABELS[entry.kind] || entry.kind))].join(', ')}.
                        {' '}They stay on the application either way — attach one again above to have it read.
                    </FieldMessage>
                )}

                {state === 'reading' && (
                    <p role="status" className="text-ds-xs text-ds-content-muted">
                        Reading happens in this browser first, so a scanned page can take a moment.
                    </p>
                )}

                {error && (
                    <FieldMessage tone="error" role="alert">
                        <Icon icon={AlertCircle} size="sm" className="mr-ds-1 inline" />{error}
                    </FieldMessage>
                )}

                {state === 'done' && (
                    <div className="space-y-ds-2" data-testid="read-summary">
                        <ul className="space-y-ds-1">
                            {Object.entries(methods).map(([kind, method]) => (
                                <li key={kind} className="flex flex-wrap items-center justify-between gap-ds-2 text-ds-sm">
                                    <span className="text-ds-content">{DOCUMENT_LABELS[kind] || kind}</span>
                                    <Badge tone={(METHOD_LABELS[method] || METHOD_LABELS.failed).tone}>
                                        {(METHOD_LABELS[method] || METHOD_LABELS.failed).label}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                        <p className="text-ds-sm text-ds-content-secondary">
                            Filled {summary.added.fields} field{summary.added.fields === 1 ? '' : 's'},
                            added {summary.added.employers} employer{summary.added.employers === 1 ? '' : 's'} and
                            {' '}{summary.added.violations} violation{summary.added.violations === 1 ? '' : 's'}.
                            {summary.added.employers > 0 && ' Carriers from the PSP report are locked — the driver adds the dates and why they left.'}
                        </p>
                        {summary.kept.length > 0 && (
                            <p className="text-ds-xs text-ds-content-muted">
                                Kept what you had already typed in: {summary.kept.join(', ')}.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
}

export default ApplicationAiPrepPanel;
