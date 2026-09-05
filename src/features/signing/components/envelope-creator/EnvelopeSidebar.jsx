import React, { useId, useRef, useState } from 'react';
import { X, Mail, MessageSquare, Copy, Send, Sparkles, FileText } from 'lucide-react';
import {
    Button, Disclosure, FileInput, IconButton, SegmentedControl,
} from '@/design-system/components';
import { FormField, Input } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { FIELD_CATEGORIES } from './fieldDefinitions';

/**
 * Left tools rail of the envelope creator.
 *
 * Organised into three collapsible sections — Setup, Add Fields and Fields — so
 * the rail reads as a workflow rather than one long column: who the document is
 * for and what it is built from, what you can place, and what you have placed.
 *
 * Sections rather than tabs: the design system has no approved Tabs primitive
 * (recorded in the roadmap next to the toned-Button gap), and a disclosure needs
 * no new visual primitive — it is a button with `aria-expanded`/`aria-controls`
 * over a region. It also lets more than one section stay open at once, which a
 * tab strip cannot.
 *
 * Presentation only. Every prop, callback argument and conditional below is the
 * pre-migration contract: EnvelopeCreator still owns the recipient state, the
 * upload validation, field creation/removal and the selection.
 *
 * Two compositions stay feature-owned because the design system has no approved
 * primitive for them yet (both tracked in the roadmap): the delivery-method
 * toggle group (no segmented-control primitive) and the file input (no
 * file-input primitive — this follows the same visually-hidden-input + approved
 * Button pattern already used by the branding upload).
 */

/**
 * Delivery options in their original order. The `key` values are the exact
 * `deliveryMethod` values EnvelopeCreator sends to the backend, so they are
 * frozen; only the presentation around them changed.
 */
const DELIVERY_OPTIONS = [
    { key: 'email', icon: Mail, label: 'Email' },
    { key: 'sms', icon: MessageSquare, label: 'SMS' },
    { key: 'both', icon: Send, label: 'Both' },
    { key: 'copy', icon: Copy, label: 'Link' },
];

function Kbd({ children }) {
    return (
        <kbd className="rounded-ds-sm border border-ds-border bg-ds-surface-subtle px-ds-1 font-mono text-ds-xs text-ds-content">
            {children}
        </kbd>
    );
}

/**
 * One rail section.
 *
 * The design system's `Disclosure` since 2026-08-25. It was a raw `<button>`
 * inside an `<h3>`, recorded as a temporary exception because "the approved
 * Button's padding and inline layout cannot express" an edge-to-edge trigger with
 * a rotating affordance inside a heading — all true, and the reason `Disclosure`
 * was built on 2026-08-21 naming this component as its consumer. The exception
 * outlived its own fix by four days.
 *
 * `Disclosure` unmounts a closed panel where this kept it with `hidden`. That is
 * the primitive's deliberate choice and it is safe here: the recipient fields are
 * lifted state, so a collapsed section loses no typed value — and a stale focus
 * target inside a `hidden` panel is reachable by find-in-page and by
 * screen-reader browse mode, which is what the primitive avoids.
 */
function RailSection({ id, title, count, countLabel, open, onToggle, children }) {
    return (
        <Disclosure
            id={id}
            title={title}
            open={open}
            onToggle={onToggle}
            className="border-b border-ds-border"
            meta={count > 0 ? (
                <>
                    <span aria-hidden="true">{count}</span>
                    <span className="ds-visually-hidden">{countLabel}</span>
                </>
            ) : undefined}
        >
            {children}
        </Disclosure>
    );
}

export function EnvelopeSidebar({
    creatorMode,
    isEditingTemplate,
    recipientName,
    setRecipientName,
    recipientEmail,
    setRecipientEmail,
    recipientPhone,
    setRecipientPhone,
    deliveryMethod,
    setDeliveryMethod,
    file,
    handleFileChange,
    addField,
    fields,
    selectedFieldId,
    setSelectedFieldId,
    removeField,
    getIcon,
    onOpenAiAssistant,
    aiAssistantBusy = false,
    fieldTools = null,
    // Which sections start open, and how the rail presents itself. The compact
    // editor mounts this inside a bottom sheet for one section at a time, so it
    // opens that section only and drops the fixed-width bordered rail chrome.
    initialOpenSections = null,
    className = 'z-ds-raised flex w-64 shrink-0 flex-col overflow-y-auto border-r border-ds-border bg-ds-surface shadow-ds-lg',
    label = 'Envelope setup',
}) {
    const rawId = useId().replace(/:/g, '');
    const aiHelpId = `envelope-ai-help-${rawId}`;
    const recipientHeadingId = `envelope-recipient-heading-${rawId}`;
    const deliveryLabelId = `envelope-delivery-label-${rawId}`;
    const placedHeadingId = `envelope-placed-heading-${rawId}`;
    const fileInputRef = useRef(null);

    // All three start open: the rail is a workflow, and collapsing by default
    // would hide the upload control that everything else depends on.
    /*
     * What a drop refused, kept HERE rather than in the picker.
     *
     * The picker below renders only while `!file`, so a mixed drop — a PDF this
     * accepts plus something it does not — hands `handleFileChange` the PDF, the
     * branch flips, and `FileInput`'s own rejection alert is unmounted in the
     * commit that created it. Found in review on 2026-08-26. `onReject` fires
     * after `onChange`, so this lands last and survives the swap.
     */
    const [dropRejection, setDropRejection] = useState(null);

    const [openSections, setOpenSections] = useState(
        () => initialOpenSections || { setup: true, add: true, placed: true },
    );
    const toggleSection = (key) =>
        setOpenSections((previous) => ({ ...previous, [key]: !previous[key] }));

    const showRecipient = creatorMode === 'request' && !isEditingTemplate;

    return (
        <aside aria-label={label} className={className}>
            <RailSection
                id={`rail-setup-${rawId}`}
                title="Setup"
                open={openSections.setup}
                onToggle={() => toggleSection('setup')}
            >
                {/* Document. The upload lives with the rest of the setup because
                    it is the first decision, not part of the field palette. */}
                {!file ? (
                    /*
                      `FileInput variant="dropzone"`. It was a hidden input plus a
                      `Button` that clicked it; the primitive is a real focusable
                      input behind a real `<label>`, and `FileInput`'s `onDrop`
                      makes the panel a real drop target for a PDF. The frozen copy
                      is unchanged: "Upload a PDF first" is the description and
                      "Choose File" the control's own words.
                    */
                    <FileInput
                        ref={fileInputRef}
                        id="pdf-upload"
                        label="Choose a PDF file"
                        labelHidden
                        variant="dropzone"
                        buttonLabel="Choose File"
                        description="Upload a PDF first"
                        accept="application/pdf"
                        onChange={(event) => {
                            // Retires a rejection from an earlier drop; one that
                            // arrived with THIS drop is re-set immediately after.
                            setDropRejection(null);
                            handleFileChange(event);
                        }}
                        onReject={({ message }) => setDropRejection(message)}
                    />
                ) : (
                    <div className="flex items-center gap-ds-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-2">
                        <FileText size={16} aria-hidden="true" className="shrink-0 text-ds-content-secondary" />
                        <span className="truncate text-ds-xs font-medium text-ds-content" title={file.name}>
                            {file.name}
                        </span>
                    </div>
                )}

                {/*
                  Outlives the picker, which is the point — see `dropRejection`.
                  Shown only once `file` exists — which is exactly when the
                  picker above is gone, so this and `FileInput`'s own message are
                  complements and never both on screen.
                */}
                {dropRejection && file && (
                    <p className="mt-ds-2 text-ds-xs text-ds-status-danger-fg [overflow-wrap:anywhere]" role="alert">
                        {dropRejection}
                    </p>
                )}

                {/* Recipient Info (only in request mode) */}
                {showRecipient && (
                    <div className="mt-ds-4">
                        <h4
                            id={recipientHeadingId}
                            className="mb-ds-2 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary"
                        >
                            Recipient
                        </h4>
                        <Stack gap="sm">
                            <FormField label="Name" required>
                                <Input
                                    type="text"
                                    value={recipientName}
                                    onChange={e => setRecipientName(e.target.value)}
                                />
                            </FormField>
                            <FormField label="Email">
                                <Input
                                    type="email"
                                    value={recipientEmail}
                                    onChange={e => setRecipientEmail(e.target.value)}
                                />
                            </FormField>
                            <FormField label="Phone">
                                <Input
                                    type="tel"
                                    value={recipientPhone}
                                    onChange={e => setRecipientPhone(e.target.value)}
                                />
                            </FormField>
                        </Stack>

                        {/* Delivery Method */}
                        <h4
                            id={deliveryLabelId}
                            className="mb-ds-1 mt-ds-4 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary"
                        >
                            Delivery
                        </h4>
                        {/* Two-state toggle group built from the approved Button, matching the
                            creator shell's mode toggle: variant carries the visual state and
                            aria-pressed plus the check icon carry it non-visually. */}
                        <SegmentedControl
                            ariaLabelledBy={deliveryLabelId}
                            columns={2}
                            value={deliveryMethod}
                            onChange={setDeliveryMethod}
                            options={DELIVERY_OPTIONS.map(opt => ({
                                value: opt.key,
                                label: opt.label,
                                icon: opt.icon,
                            }))}
                        />
                    </div>
                )}
            </RailSection>

            <RailSection
                id={`rail-add-${rawId}`}
                title="Add Fields"
                open={openSections.add}
                onToggle={() => toggleSection('add')}
            >
                {/* AI Field Assistant entry point. Always rendered so the capability
                    is discoverable, but disabled until a PDF is loaded — there is
                    nothing to scan before then, and the helper text says so. */}
                {onOpenAiAssistant && (
                    <div className="mb-ds-3 rounded-ds-lg border border-ds-status-accent-border bg-ds-status-accent-bg p-ds-3">
                        <Button
                            variant="primary"
                            size="sm"
                            fullWidth
                            disabled={!file || aiAssistantBusy}
                            aria-describedby={aiHelpId}
                            onClick={onOpenAiAssistant}
                        >
                            <Sparkles size={14} aria-hidden="true" />
                            Auto-place fields
                        </Button>
                        <p id={aiHelpId} className="mt-ds-2 text-ds-xs leading-snug text-ds-content-secondary">
                            {file
                                ? 'AI will scan your PDF and suggest signature, initials, dates, checkboxes and text fields. Review all suggestions before applying them.'
                                : 'Upload a PDF to use the AI Field Assistant. AI will scan your PDF and suggest signature, initials, dates, checkboxes and text fields. Review all suggestions before applying them.'}
                        </p>
                    </div>
                )}

                {file ? (
                    /* DOCUMENTED TEMPORARY EXCEPTION — palette buttons are not the
                       approved `Button`.

                       The approved Button exposes only primary / secondary / ghost /
                       danger; it has no semantic status tone. The tone here is
                       load-bearing rather than decorative: `ResizableDraggableField`
                       colour-codes each placed overlay by field type, so these
                       buttons are the legend for what appears on the PDF. Rendering
                       them as `variant="secondary"` would flatten all eight to one
                       colour and break that pairing.

                       They already use semantic `--ds-*` status tokens (no raw
                       palette), a 44 px activation height, a focus-visible ring and
                       unique `Add <label> field` names. The missing capability — a
                       toned Button variant — is recorded in the roadmap next to the
                       Tabs and Checkbox gaps, and this exception retires when that
                       variant exists. */
                    <div className="flex flex-col gap-ds-4">
                        {FIELD_CATEGORIES.map((category) => (
                            <div key={category.title}>
                                <h4 className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                                    {category.title}
                                </h4>
                                <div className="flex flex-col gap-ds-1">
                                    {category.items.map((item) => {
                                        const IconComp = item.icon;
                                        return (
                                            <Button
                                                key={item.templateId}
                                                variant="secondary"
                                                tone={item.tone}
                                                fullWidth
                                                justify="start"
                                                onClick={() => addField(item.templateId)}
                                                aria-label={`Add ${item.label} field`}
                                            >
                                                <IconComp size={15} aria-hidden="true" />
                                                <span className="text-ds-xs font-semibold">{item.label}</span>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-ds-xs leading-snug text-ds-content-secondary">
                        Upload a PDF in Setup to start placing fields.
                    </p>
                )}

                {file && (
                    <p className="mt-ds-3 text-ds-xs leading-snug text-ds-content-secondary">
                        Duplicate a placed field: select it on the PDF, then{' '}
                        <Kbd>Ctrl+C</Kbd>
                        {' / '}
                        <Kbd>⌘C</Kbd>
                        , then{' '}
                        <Kbd>Ctrl+V</Kbd>
                        {' / '}
                        <Kbd>⌘V</Kbd>
                        . Same size; repeats step to the right (wraps below).
                        {' '}
                        Over the PDF,{' '}
                        <Kbd>Ctrl</Kbd>
                        {' / '}
                        <Kbd>⌘</Kbd>
                        {' + '}scroll zooms the document only (not the whole page).
                    </p>
                )}
            </RailSection>

            <RailSection
                id={`rail-placed-${rawId}`}
                title="Fields"
                count={fields.length}
                countLabel={`${fields.length} placed`}
                open={openSections.placed}
                onToggle={() => toggleSection('placed')}
            >
                {fieldTools}

                {fields.length === 0 ? (
                    <p className="text-ds-xs leading-snug text-ds-content-secondary">
                        No fields placed yet.
                    </p>
                ) : (
                    <div className={fieldTools ? 'mt-ds-3' : undefined}>
                        <h4
                            id={placedHeadingId}
                            className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary"
                        >
                            Placed ({fields.length})
                        </h4>
                        {/* Each row is a real button plus a sibling remove button, so the
                            list no longer nests an interactive control inside a clickable
                            div and both actions are keyboard reachable. */}
                        <ul aria-labelledby={placedHeadingId} className="flex max-h-48 flex-col gap-ds-1 overflow-y-auto pr-1">
                            {fields.map((f) => {
                                const isSelected = selectedFieldId === f.id;
                                return (
                                    <li
                                        key={f.id}
                                        className={`flex items-center justify-between gap-ds-1 rounded-ds-lg border transition-colors ${
                                            isSelected
                                                ? 'border-ds-action-primary bg-ds-status-info-bg'
                                                : 'border-ds-border bg-ds-surface-subtle'
                                        }`}
                                    >
                                        {/* Approved Button as the row control, following the
                                            precedent set for the send dialog's quick-select
                                            rows: ghost + fullWidth + justify="start" carries
                                            two-part row content because the primitive uses
                                            min-height rather than a fixed height. */}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            fullWidth
                                            justify="start"
                                            aria-pressed={isSelected}
                                            className="min-w-0 flex-1"
                                            onClick={() => setSelectedFieldId(f.id)}
                                        >
                                            <span className="shrink-0 text-ds-content-secondary" aria-hidden="true">
                                                {getIcon(f.type)}
                                            </span>
                                            <span className="truncate font-bold text-ds-content">{f.label}</span>
                                            <span className="shrink-0 rounded-ds-sm bg-ds-status-neutral-bg px-ds-1 text-ds-xs text-ds-content-secondary">
                                                P{f.page}
                                            </span>
                                        </Button>
                                        <IconButton
                                            label={`Remove ${f.label} on page ${f.page}`}
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0"
                                            onClick={(e) => { e.stopPropagation(); removeField(f.id); }}
                                        >
                                            <X size={12} aria-hidden="true" />
                                        </IconButton>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </RailSection>
        </aside>
    );
}

export default EnvelopeSidebar;
