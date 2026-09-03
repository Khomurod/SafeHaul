import React from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { Button, Card } from '@/design-system/components';

/**
 * The first fork of a new application: let the reader fill it in from the driver's
 * paperwork, or type it by hand.
 *
 * Content only — the page owns what each choice does. The two are not exclusive
 * for the driver's benefit: the manual path can still attach documents, and the
 * AI path lands in the same editable form. This screen only decides where the
 * recruiter starts.
 */
export function ApplicationModeChooser({ onChooseAi, onChooseManual }) {
    return (
        <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
            <Card padding="md">
                <div className="space-y-ds-3">
                    <Sparkles size={20} aria-hidden="true" className="text-ds-content" />
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Let AI read the documents</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Upload the driver&apos;s licence, medical card, PSP report and motor vehicle record.
                        The reader fills in what it can; you review and edit everything before sending.
                    </p>
                    <Button variant="primary" onClick={onChooseAi} data-testid="mode-ai">
                        <Sparkles size={14} aria-hidden="true" /> Upload documents
                    </Button>
                </div>
            </Card>
            <Card padding="md">
                <div className="space-y-ds-3">
                    <FileText size={20} aria-hidden="true" className="text-ds-content" />
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Fill in manually</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Type what you know. You can still attach the driver&apos;s documents — they travel
                        into the application either way, just without the reader.
                    </p>
                    <Button variant="secondary" onClick={onChooseManual} data-testid="mode-manual">
                        <FileText size={14} aria-hidden="true" /> Start typing
                    </Button>
                </div>
            </Card>
        </div>
    );
}

export default ApplicationModeChooser;
