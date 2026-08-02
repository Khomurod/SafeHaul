import React, { useState, useRef } from 'react';
import { Plus, Eye, EyeOff, Save, Shield } from 'lucide-react';
import { Button, Card, Badge, FieldMessage } from '@/design-system/components';
import { QuestionEditor } from './QuestionEditor';
import { INITIAL_QUESTION_STATE } from './QuestionConfig';

export function CustomQuestionsBuilder({ questions = [], onChange, onSave, loading }) {
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
        const commonClasses = "w-full rounded-ds-md border border-ds-border bg-ds-surface p-ds-3 text-ds-content opacity-75";

        // Preview controls are non-interactive visual mockups; the real,
        // labelled inputs live in the public application. They are hidden from
        // assistive tech (the question label above conveys the meaning).
        switch (q.type) {
            case 'paragraph':
                return <textarea className={commonClasses} rows="3" disabled aria-hidden="true" tabIndex={-1} placeholder="Long answer text..." />;
            case 'multipleChoice':
                return (
                    <div className="space-y-ds-2">
                        {q.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-ds-2">
                                <span className="h-4 w-4 rounded-full border border-ds-border" aria-hidden="true"></span>
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
                                <span className="h-4 w-4 rounded border border-ds-border" aria-hidden="true"></span>
                                <span className="text-ds-sm text-ds-content-secondary">{opt}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'dropdown':
                return (
                    <select className={commonClasses} disabled aria-hidden="true" tabIndex={-1}>
                        <option>Select an option...</option>
                        {q.options?.map((opt, i) => <option key={i}>{opt}</option>)}
                    </select>
                );
            case 'fileUpload':
                return (
                    <div className="rounded-ds-lg border-2 border-dashed border-ds-border p-ds-6 text-center bg-ds-surface-subtle">
                        <p className="text-ds-sm text-ds-content-muted">Upload file button will appear here</p>
                    </div>
                );
            case 'date':
                return <input type="date" className={commonClasses} disabled aria-hidden="true" tabIndex={-1} />;
            case 'time':
                return <input type="time" className={commonClasses} disabled aria-hidden="true" tabIndex={-1} />;
            case 'linearScale':
                return (
                    <div className="flex items-center justify-between rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-2">
                        <span className="text-ds-xs text-ds-content-muted">{q.min || 1} ({q.minLabel || 'Min'})</span>
                        <div className="flex gap-ds-2">
                            {[1, 2, 3, 4, 5].map(n => (
                                <span key={n} className="h-4 w-4 rounded-full border border-ds-border" aria-hidden="true"></span>
                            ))}
                        </div>
                        <span className="text-ds-xs text-ds-content-muted">{q.max || 5} ({q.maxLabel || 'Max'})</span>
                    </div>
                );
            default:
                return <input type="text" className={commonClasses} disabled aria-hidden="true" tabIndex={-1} placeholder="Short answer text" />;
        }
    };

    return (
        <div className="space-y-ds-6">

            <Card className="sticky top-0 z-20 flex flex-col items-start justify-between gap-ds-4 sm:flex-row sm:items-center">
                <div>
                    <h4 className="text-ds-body font-bold text-ds-content">Custom Questions</h4>
                    <p className="text-ds-sm text-ds-content-muted" role="status">{questions.length} questions added</p>
                </div>
                <div className="flex gap-ds-3">
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setPreviewMode(!previewMode)}
                        aria-pressed={previewMode}
                    >
                        {previewMode ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        {previewMode ? 'Edit Mode' : 'Preview'}
                    </Button>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={onSave}
                        loading={loading}
                    >
                        {!loading && <Save size={18} aria-hidden="true" />}
                        Save Changes
                    </Button>
                </div>
            </Card>

            {blockedDeleteMessage && (
                <FieldMessage tone="error">{blockedDeleteMessage}</FieldMessage>
            )}

            <div className="min-h-[200px] space-y-ds-4">
                {questions.length === 0 && (
                    <div className="rounded-ds-xl border-2 border-dashed border-ds-border-subtle py-ds-12 text-center">
                        <p className="font-medium text-ds-content-muted">No questions yet.</p>
                        <div className="mt-ds-4 flex justify-center">
                            <Button variant="ghost" size="sm" onClick={addQuestion}>
                                <Plus size={16} aria-hidden="true" /> Add your first question
                            </Button>
                        </div>
                    </div>
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
                        <Plus size={20} aria-hidden="true" /> Add Question
                    </Button>
                </div>
            )}
        </div>
    );
}
