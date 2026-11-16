import React, { useId, useState, useRef } from 'react';
import { Icon, Plus, Eye, EyeOff, Shield } from '@design-system/icons';
import {
    Badge, Button, Card, FieldMessage, Input, Select, Textarea,
} from '@/design-system/components';
import { EmptyState } from '@design-system/patterns';
import { QuestionEditor } from './QuestionEditor';
import { CUSTOM_QUESTIONS_DESCRIPTION, INITIAL_QUESTION_STATE } from './QuestionConfig';

/**
 * Application questions → Custom Questions: the section, its heading included,
 * since the heading row holds the count and the Preview switch the builder
 * owns. One card: the empty state, or the questions one after another.
 */
export function CustomQuestionsBuilder({ questions = [], onChange }) {
    const headingId = `custom-questions-heading-${useId().replace(/:/g, '')}`;
    const [previewMode, setPreviewMode] = useState(false);
    /**
     * Replaces a blocking `alert()` with an inline, non-blocking message,
     * keeping the exact frozen wording. Cleared on the next delete attempt so
     * a stale message can't be mistaken for a fresh one.
     */
    const [blockedDeleteMessage, setBlockedDeleteMessage] = useState('');
    const dragItem = useRef(null);
    const dragOverItem = useRef(null);

    const addQuestion = () => {
        const newQuestion = {
            ...INITIAL_QUESTION_STATE,
            id: crypto.randomUUID()
        };
        onChange([...questions, newQuestion]);
    };

    const updateQuestion = (index, updatedData) => {
        const newQuestions = [...questions];
        newQuestions[index] = updatedData;
        onChange(newQuestions);
    };

    const deleteQuestion = (index) => {
        const question = questions[index];
        // Prevent deletion of DOT-required fields
        if (question?.dotRequired) {
            setBlockedDeleteMessage('Cannot delete DOT-required field. This question is mandated by FMCSA regulations.');
            return;
        }
        setBlockedDeleteMessage('');
        const newQuestions = questions.filter((_, i) => i !== index);
        onChange(newQuestions);
    };

    const handleSort = () => {
        let _questions = [...questions];
        const draggedItemContent = _questions.splice(dragItem.current, 1)[0];
        _questions.splice(dragOverItem.current, 0, draggedItemContent);
        dragItem.current = null;
        dragOverItem.current = null;
        onChange(_questions);
    };

    // Keyboard-accessible reordering. Mutates the same array-order format that
    // drag-and-drop produces, so the saved `customQuestions` shape is identical.
    const moveQuestion = (from, to) => {
        if (to < 0 || to >= questions.length) return;
        const _questions = [...questions];
        const [moved] = _questions.splice(from, 1);
        _questions.splice(to, 0, moved);
        onChange(_questions);
    };

    const renderPreviewInput = (q) => {
        /*
         * Preview controls are non-interactive visual mockups; the real,
         * labelled inputs live in the public application. They are hidden from
         * assistive tech (the question label above conveys the meaning).
         *
         * They render through the design system's own controls rather than a
         * hand-written class list, which is the point of a preview: what the
         * recruiter is shown here is the control the applicant will actually
         * meet, dimmed by the same `:disabled` treatment every other disabled
         * control in the app uses.
         */
        switch (q.type) {
            case 'paragraph':
                return <Textarea rows="3" disabled aria-hidden="true" tabIndex={-1} placeholder="Long answer text..." />;
            case 'multipleChoice':
                return (
                    <div className="space-y-ds-2">
                        {q.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-ds-2">
                                <span className="h-4 w-4 rounded-ds-full border border-ds-border" aria-hidden="true"></span>
                                <span className="text-ds-sm text-ds-content-secondary">{opt}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'checkboxes':
                return (
                    <div className="space-y-ds-2">
                        {q.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-ds-2">
                                <span className="h-4 w-4 rounded-ds-sm border border-ds-border" aria-hidden="true"></span>
                                <span className="text-ds-sm text-ds-content-secondary">{opt}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'dropdown':
                return (
                    <Select disabled aria-hidden="true" tabIndex={-1}>
                        <option>Select an option...</option>
                        {q.options?.map((opt, i) => <option key={i}>{opt}</option>)}
                    </Select>
                );
            case 'fileUpload':
                return (
                    <div className="rounded-ds-lg border-2 border-dashed border-ds-border p-ds-6 text-center bg-ds-surface-subtle">
                        <p className="text-ds-sm text-ds-content-muted">Upload file button will appear here</p>
                    </div>
                );
            case 'date':
                return <Input type="date" disabled aria-hidden="true" tabIndex={-1} />;
            case 'time':
                return <Input type="time" disabled aria-hidden="true" tabIndex={-1} />;
            case 'linearScale':
                return (
                    <div className="flex items-center justify-between rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-2">
                        <span className="text-ds-xs text-ds-content-muted">{q.min || 1} ({q.minLabel || 'Min'})</span>
                        <div className="flex gap-ds-2">
                            {[1, 2, 3, 4, 5].map(n => (
                                <span key={n} className="h-4 w-4 rounded-ds-full border border-ds-border" aria-hidden="true"></span>
                            ))}
                        </div>
                        <span className="text-ds-xs text-ds-content-muted">{q.max || 5} ({q.maxLabel || 'Max'})</span>
                    </div>
                );
            default:
                return <Input type="text" disabled aria-hidden="true" tabIndex={-1} placeholder="Short answer text" />;
        }
    };

    return (
        <section aria-labelledby={headingId} className="grid min-w-0 gap-ds-3">
            {/* The heading row: the title and its count, Preview at the end of
                the row (on a phone too); the description under both. The
                count sits beside the heading, not in it, so the heading keeps
                its name; it is a polite status, read with its words. */}
            <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-ds-4 gap-y-ds-1">
                <div className="flex min-w-0 flex-wrap items-center gap-ds-2">
                    <h2 id={headingId} className="text-ds-heading-sm font-semibold text-ds-content">
                        Custom Questions
                    </h2>
                    <span
                        role="status"
                        className="inline-flex min-h-ds-5 items-center rounded-ds-full border border-ds-border bg-ds-surface px-ds-2 text-ds-xs font-semibold tabular-nums text-ds-content-secondary"
                    >
                        {questions.length}
                        <span className="ds-visually-hidden"> questions added</span>
                    </span>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPreviewMode(!previewMode)}
                    aria-pressed={previewMode}
                >
                    {previewMode ? <Icon icon={EyeOff} /> : <Icon icon={Eye} />}
                    {previewMode ? 'Edit Mode' : 'Preview'}
                </Button>
                <p className="col-span-2 max-w-[80ch] text-ds-body text-ds-content-muted [text-wrap:pretty]">
                    {CUSTOM_QUESTIONS_DESCRIPTION}
                </p>
            </header>

            {blockedDeleteMessage && (
                <FieldMessage tone="error">{blockedDeleteMessage}</FieldMessage>
            )}

            <div className="space-y-ds-4">
                {questions.length === 0 && (
                    <EmptyState
                        headingLevel={3}
                        title="No questions yet."
                        actions={(
                            <Button variant="primary" size="sm" onClick={addQuestion}>
                                <Icon icon={Plus} /> Add your first question
                            </Button>
                        )}
                    />
                )}

                {questions.map((question, index) => (
                    <div
                        key={question.id || index}
                        draggable={!previewMode}
                        onDragStart={(e) => { dragItem.current = index; e.currentTarget.style.opacity = '0.5'; }}
                        onDragEnter={() => { dragOverItem.current = index; }}
                        onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; handleSort(); }}
                        onDragOver={(e) => e.preventDefault()}
                        className="transition-all duration-200"
                    >
                        {previewMode ? (
                            <Card>
                                <div className="mb-ds-3">
                                    <div className="mb-ds-1 flex flex-wrap items-center gap-ds-2">
                                        <span className="text-ds-sm font-bold text-ds-content">
                                            {question.label || 'Untitled Question'}
                                            {question.required && <span className="ml-1 text-ds-status-danger-fg" aria-hidden="true">*</span>}
                                        </span>
                                        {question.dotRequired && (
                                            <Badge tone="warning" icon={Shield}>DOT</Badge>
                                        )}
                                        {!question.canCompanyHide && (
                                            <Badge tone="neutral">Locked</Badge>
                                        )}
                                    </div>
                                    {question.fmcsaReference && (
                                        <p className="text-ds-xs font-medium text-ds-status-warning-fg">{question.fmcsaReference}</p>
                                    )}
                                    {question.helpText && <p className="text-ds-xs text-ds-content-muted">{question.helpText}</p>}
                                </div>
                                {renderPreviewInput(question)}
                            </Card>
                        ) : (
                            <QuestionEditor
                                question={question}
                                index={index}
                                onChange={updateQuestion}
                                onDelete={deleteQuestion}
                                onMoveUp={(i) => moveQuestion(i, i - 1)}
                                onMoveDown={(i) => moveQuestion(i, i + 1)}
                                canMoveUp={index > 0}
                                canMoveDown={index < questions.length - 1}
                            />
                        )}
                    </div>
                ))}
            </div>

            {!previewMode && questions.length > 0 && (
                <div className="flex justify-center pt-ds-4">
                    <Button variant="ghost" size="md" onClick={addQuestion}>
                        <Icon icon={Plus} size="xl" /> Add Question
                    </Button>
                </div>
            )}
        </section>
    );
}
