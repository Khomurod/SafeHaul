import React, { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

import { functions } from '@lib/firebase';
import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { describeError } from './useApplicationPrepDraft';
import { applyExtractedFields } from './applyExtractedFields';
import { extractDocuments } from './extraction/documentExtractionPipeline';
import { attachedDocuments } from './attachedDocuments';

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

export function ApplicationAiPrepPanel({ companyId, files, formData, onApply, onLockCarriers }) {
    const [state, setState] = useState('idle');
    const [error, setError] = useState(null);
    const [methods, setMethods] = useState({});
    const [summary, setSummary] = useState(null);

    const attached = attachedDocuments(files);

    const read = useCallback(async () => {
        setState('reading');
        setError(null);
        setSummary(null);
        try {
            const extraction = await extractDocuments(attached);
            if (Object.keys(extraction.documents).length === 0) {
                setError('None of the attached files could be opened. You can still type the details in.');
                setState('error');
                return;
            }

            const call = httpsCallable(functions, 'extractCompanyApplicationDocuments', { timeout: 120000 });
            let { data } = await call({ companyId, documents: extraction.documents });

            // Documents the model itself could not read go again, as pictures.
            const unreadable = Object.entries(data.methods || {})
                .filter(([, method]) => method === 'unreadable')
                .map(([kind]) => kind);
            if (unreadable.length > 0) {
                const pages = await extractDocuments(
                    attached.filter((entry) => unreadable.includes(entry.kind)),
                    { forcePages: true },
                );
                const asPages = Object.fromEntries(Object.entries(pages.documents)
                    .filter(([kind]) => unreadable.includes(kind))
                    .map(([kind, value]) => [kind, value.pages ? value : { pages: [] }]));
                if (Object.values(asPages).some((entry) => entry.pages.length > 0)) {
                    const second = await call({ companyId, documents: asPages });
                    data = {
                        ...second.data,
                        extracted: { ...data.extracted, ...second.data.extracted },
                        methods: { ...data.methods, ...second.data.methods },
                    };
                }
            }

            const applied = applyExtractedFields(formData, data.extracted);
            onApply(applied.formData);
            if (applied.lockedCarriers.length > 0) onLockCarriers(applied.lockedCarriers);

            setMethods({ ...extraction.methods, ...data.methods });
            setSummary(applied);
            setState('done');
        } catch (readError) {
            setError(describeError(readError));
            setState('error');
        }
    }, [attached, companyId, formData, onApply, onLockCarriers]);

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
                    disabled={attached.length === 0 || state === 'reading'}
                    data-testid="read-documents"
                >
                    {state === 'reading'
                        ? <><Loader2 className="animate-spin" size={14} aria-hidden="true" /> Reading…</>
                        : <><Sparkles size={14} aria-hidden="true" /> Read {attached.length || 'the'} document{attached.length === 1 ? '' : 's'}</>}
                </Button>

                {state === 'reading' && (
                    <p role="status" className="text-ds-xs text-ds-content-muted">
                        Reading happens in this browser first, so a scanned page can take a moment.
                    </p>
                )}

                {error && (
                    <FieldMessage tone="error" role="alert">
                        <AlertCircle size={14} className="mr-ds-1 inline" aria-hidden="true" />{error}
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
