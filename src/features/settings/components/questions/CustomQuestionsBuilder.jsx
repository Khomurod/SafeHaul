import React, { useState, useRef } from 'react';
import { Plus, Eye, EyeOff, GripVertical, Save, Loader2, Shield, AlertCircle } from 'lucide-react';
import { QuestionEditor } from './QuestionEditor';
import { INITIAL_QUESTION_STATE } from './QuestionConfig';

export function CustomQuestionsBuilder({ questions = [], onChange, onSave, loading }) {
    const [previewMode, setPreviewMode] = useState(false);
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
            alert('Cannot delete DOT-required field. This question is mandated by FMCSA regulations.');
            return;
        }
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

    const renderPreviewInput = (q) => {
        const commonClasses = "w-full p-3 border border-gray-300 rounded-lg bg-white opacity-75 cursor-not-allowed";

        switch (q.type) {
            case 'paragraph':
                return <textarea className={commonClasses} rows="3" disabled placeholder="Long answer text..." />;
            case 'multipleChoice':
                return (
                    <div className="space-y-2">
                        {q.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full border border-gray-400"></div>
                                <span className="text-gray-600 text-sm">{opt}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'checkboxes':
                return (
                    <div className="space-y-2">
                        {q.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded border border-gray-400"></div>
                                <span className="text-gray-600 text-sm">{opt}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'dropdown':
                return (
                    <select className={commonClasses} disabled>
                        <option>Select an option...</option>
                        {q.options?.map((opt, i) => <option key={i}>{opt}</option>)}
                    </select>
                );
            case 'fileUpload':
                return (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
                        <p className="text-gray-500 text-sm">Upload file button will appear here</p>
                    </div>
                );
            case 'date':
                return <input type="date" className={commonClasses} disabled />;
            case 'time':
                return <input type="time" className={commonClasses} disabled />;
            case 'linearScale':
                return (
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-xs text-gray-500">{q.min || 1} ({q.minLabel || 'Min'})</span>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map(n => (
                                <div key={n} className="w-4 h-4 rounded-full border border-gray-400"></div>
                            ))}
                        </div>
                        <span className="text-xs text-gray-500">{q.max || 5} ({q.maxLabel || 'Max'})</span>
                    </div>
                );
            default:
                return <input type="text" className={commonClasses} disabled placeholder="Short answer text" />;
        }
    };

    return (
        <div className="space-y-6">

            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm sticky top-0 z-20">
                <div>
                    <h3 className="text-lg font-bold text-gray-900">Custom Questions</h3>
                    <p className="text-sm text-gray-500">{questions.length} questions added</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setPreviewMode(!previewMode)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${previewMode
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        {previewMode ? <EyeOff size={18} /> : <Eye size={18} />}
                        {previewMode ? 'Edit Mode' : 'Preview'}
                    </button>
                    <button
                        onClick={onSave}
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all"
                    >
                        {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        Save Changes
                    </button>
                </div>
            </div>

            <div className="space-y-4 min-h-[200px]">
                {questions.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                        <p className="text-gray-400 font-medium">No questions yet.</p>
                        <button
                            onClick={addQuestion}
                            className="mt-4 text-blue-600 hover:text-blue-800 font-bold text-sm"
                        >
                            + Add your first question
                        </button>
                    </div>
                )}

                {questions.map((question, index) => (
                    <div
                        key={question.id || index}
                        draggable={!previewMode}
                        onDragStart={(e) => { dragItem.current = index; e.currentTarget.style.opacity = '0.5'; }}
                        onDragEnter={(e) => { dragOverItem.current = index; }}
                        onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; handleSort(); }}
                        onDragOver={(e) => e.preventDefault()}
                        className={`transition-all duration-200 ${previewMode ? '' : 'cursor-move'}`}
                    >
                        {previewMode ? (
                            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                                <div className="mb-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <label className="block text-sm font-bold text-gray-800">
                                            {question.label || 'Untitled Question'}
                                            {question.required && <span className="text-red-500 ml-1">*</span>}
                                        </label>
                                        {question.dotRequired && (
                                            <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                                                <Shield size={10} /> DOT
                                            </span>
                                        )}
                                        {!question.canCompanyHide && (
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                                Locked
                                            </span>
                                        )}
                                    </div>
                                    {question.fmcsaReference && (
                                        <p className="text-xs text-amber-600 font-medium">{question.fmcsaReference}</p>
                                    )}
                                    {question.helpText && <p className="text-xs text-gray-500">{question.helpText}</p>}
                                </div>
                                {renderPreviewInput(question)}
                            </div>
                        ) : (
                            <QuestionEditor
                                question={question}
                                index={index}
                                onChange={updateQuestion}
                                onDelete={deleteQuestion}
                            />
                        )}
                    </div>
                ))}
            </div>

            {!previewMode && (
                <div className="flex justify-center pt-4">
                    <button
                        onClick={addQuestion}
                        className="group flex flex-col items-center gap-2 text-gray-400 hover:text-blue-600 transition-colors"
                    >
                        <div className="w-12 h-12 bg-white border-2 border-dashed border-gray-300 rounded-full flex items-center justify-center group-hover:border-blue-500 group-hover:bg-blue-50 transition-all shadow-sm">
                            <Plus size={24} />
                        </div>
                        <span className="text-sm font-medium">Add Question</span>
                    </button>
                </div>
            )}
        </div>
    );
}
