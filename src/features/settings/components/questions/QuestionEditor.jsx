import React from 'react';
import { 
    Trash2, MoreVertical, Plus, X, HelpCircle 
} from 'lucide-react';
import { QUESTION_TYPES, hasOptions } from './QuestionConfig';

export function QuestionEditor({ question, index, onChange, onDelete }) {
    
    const handleChange = (field, value) => {
        onChange(index, { ...question, [field]: value });
    };

    const handleOptionChange = (optIndex, value) => {
        const newOptions = [...(question.options || [])];
        newOptions[optIndex] = value;
        handleChange('options', newOptions);
    };

    const addOption = () => {
        const newOptions = [...(question.options || []), `Option ${(question.options?.length || 0) + 1}`];
        handleChange('options', newOptions);
    };

    const removeOption = (optIndex) => {
        const newOptions = question.options.filter((_, i) => i !== optIndex);
        handleChange('options', newOptions);
    };

    const handleTypeChange = (e) => {
        const newType = e.target.value;
        const updates = { type: newType };
        
        if (hasOptions(newType) && (!question.options || question.options.length === 0)) {
            updates.options = ['Option 1'];
        }
        
        onChange(index, { ...question, ...updates });
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm relative group transition-all hover:shadow-md border-l-4 border-l-blue-500">
            
            <div className="flex justify-between items-start mb-4">
                <div className="p-1 text-gray-400 cursor-move">
                    <MoreVertical size={20} />
                </div>
                <div className="flex-1 px-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    
                    <div className="md:col-span-2">
                        <input
                            type="text"
                            placeholder="Question Title"
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-lg font-medium text-gray-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            value={question.label}
                            onChange={(e) => handleChange('label', e.target.value)}
                        />
                    </div>

                    <div>
                        <div className="relative">
                            <select
                                className="w-full p-3 pl-10 border border-gray-200 rounded-lg bg-white appearance-none cursor-pointer hover:border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
                                value={question.type}
                                onChange={handleTypeChange}
                            >
                                {QUESTION_TYPES.map(type => (
                                    <option key={type.id} value={type.id}>
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                            <div className="absolute left-3 top-3.5 text-gray-500 pointer-events-none">
                                {(() => {
                                    const TypeIcon = QUESTION_TYPES.find(t => t.id === question.type)?.icon;
                                    return TypeIcon ? <TypeIcon size={18} /> : null;
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
                
                <button 
                    onClick={() => onDelete(index)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                    title="Delete Question"
                >
                    <Trash2 size={20} />
                </button>
            </div>

            <div className="pl-10 pr-12 space-y-4">
                
                <div className="flex items-center gap-2">
                    <HelpCircle size={14} className="text-gray-400" />
                    <input 
                        type="text" 
                        placeholder="Description (optional)" 
                        className="flex-1 text-sm text-gray-600 border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none bg-transparent transition-colors py-1"
                        value={question.helpText || ''}
                        onChange={(e) => handleChange('helpText', e.target.value)}
                    />
                </div>

                {hasOptions(question.type) && (
                    <div className="space-y-2 mt-4 ml-1 pl-4 border-l-2 border-gray-100">
                        {question.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-3 group/opt">
                                <div className="w-4 h-4 border-2 border-gray-300 rounded-full shrink-0"></div>
                                <input
                                    type="text"
                                    className="flex-1 p-2 text-sm border border-transparent hover:border-gray-200 focus:border-blue-300 rounded outline-none transition-all"
                                    value={opt}
                                    onChange={(e) => handleOptionChange(i, e.target.value)}
                                    placeholder={`Option ${i + 1}`}
                                />
                                <button 
                                    onClick={() => removeOption(i)}
                                    className="opacity-0 group-hover/opt:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                        
                        <button 
                            onClick={addOption}
                            className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:text-blue-800 mt-2 px-2 py-1 rounded hover:bg-blue-50 transition-colors w-fit"
                        >
                            <Plus size={16} /> Add Option
                        </button>
                    </div>
                )}

                {question.type === 'fileUpload' && (
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center bg-gray-50 text-gray-400 text-sm mt-4">
                        <p>Applicants will see a file upload button here.</p>
                    </div>
                )}

                <div className="pt-4 mt-4 border-t border-gray-100 flex justify-end items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-sm font-medium text-gray-600">Required</span>
                        <div className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={question.required || false}
                                onChange={(e) => handleChange('required', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </div>
                    </label>
                </div>

            </div>
        </div>
    );
}
