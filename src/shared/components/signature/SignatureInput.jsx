import React, { useId, useState } from 'react';
import { FormField, Input, SegmentedControl } from '@/design-system/components';
import { SIGNATURE_CANVAS_HEIGHT, SignaturePad } from './SignaturePad';
import { SIGNATURE_METHODS, TYPED_SIGNATURE_MAX_LENGTH, typedSignatureValue } from './typedSignature';

/**
 * SignatureInput — the employer's electronic signature, drawn OR typed.
 *
 * Until 2026-09-06 the verification portal offered only `SignaturePad`, a
 * canvas — which has no keyboard or assistive-technology path at all, and which
 * the roadmap carried as an open decision because a typed mark rendered into
 * the same PNG as a drawn one would be indistinguishable in the record.
 *
 * The standard settles both halves. The ESIGN Act (15 U.S.C. §7006(5)) and
 * UETA define an electronic signature as any "electronic sound, symbol, or
 * process … executed or adopted by a person with the intent to sign", so a
 * typed name is a valid signature — every mainstream e-signature product offers
 * "Draw" and "Type" side by side. What keeps it honest is the record: a typed
 * mark is stored as `TEXT_SIGNATURE:<name>` (the convention the driver
 * application already uses — see ./typedSignature.js for the stored form and
 * its bounds), never rasterised into an image, and the method travels with the
 * response so the PDF and the audit trail say which it was.
 *
 * `onSignatureChange` receives `{ data, method }` — `data` a PNG data URL for
 * `drawn` or a `TEXT_SIGNATURE:` string for `typed` — or `null` when nothing is
 * signed. Switching method emits `null`: what is stored must always be what the
 * respondent can see, which is the same invariant `SignaturePad` keeps on
 * resize. Draw stays the default so the pad's own tests and the E2E specs that
 * measure ink are unchanged.
 */
const TYPED_CONSENT = 'Typing your name here is your electronic signature. By typing it you adopt it as your '
    + 'signature with the intent to sign, and it is legally binding under the ESIGN Act and UETA.';

export function SignatureInput({ labelId, drawInstructions, error, onSignatureChange, initialMethod = 'drawn' }) {
    const [method, setMethod] = useState(initialMethod);
    const [typedName, setTypedName] = useState('');
    const typedInputId = `signature-typed-${useId().replace(/:/g, '')}`;

    const changeMethod = (next) => {
        if (next === method) return;
        setMethod(next);
        setTypedName('');
        onSignatureChange(null);
    };

    const handleTyped = (event) => {
        const name = event.target.value;
        setTypedName(name);
        const value = typedSignatureValue(name);
        onSignatureChange(value ? { data: value, method: 'typed' } : null);
    };

    return (
        <div className="grid gap-ds-3">
            <SegmentedControl
                ariaLabelledBy={labelId}
                columns={2}
                value={method}
                onChange={changeMethod}
                options={SIGNATURE_METHODS}
            />

            {method === 'drawn' ? (
                <SignaturePad
                    label="Electronic signature drawing area"
                    instructions={drawInstructions}
                    error={error}
                    onSignatureChange={(data) => onSignatureChange(data ? { data, method: 'drawn' } : null)}
                />
            ) : (
                <div className="grid gap-ds-3">
                    <FormField id={typedInputId} label="Type your full name to sign" required description={TYPED_CONSENT} error={error}>
                        <Input
                            type="text"
                            value={typedName}
                            onChange={handleTyped}
                            autoComplete="name"
                            maxLength={TYPED_SIGNATURE_MAX_LENGTH}
                            placeholder="e.g., John Smith"
                        />
                    </FormField>
                    {/* The same height as the drawing surface, so the form does not jump between methods. */}
                    <div
                        aria-hidden="true"
                        data-testid="typed-signature-preview"
                        className="flex items-center justify-center rounded-ds-lg border border-ds-border bg-ds-surface px-ds-6"
                        style={{ minHeight: SIGNATURE_CANVAS_HEIGHT }}
                    >
                        <span className={`truncate font-serif italic text-ds-heading-md ${typedName.trim() ? 'text-ds-content' : 'text-ds-content-muted'}`}>
                            {typedName.trim() || 'Your typed signature will appear here'}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SignatureInput;
