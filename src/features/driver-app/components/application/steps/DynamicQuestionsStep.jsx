/**
 * DynamicQuestionsStep
 * 
 * Renders custom questions from the merged schema.
 * Inserted as Step 8 (between General and Review) when company has custom questions.
 * 
 * Now uses DynamicQuestionRenderer for consistent field type support across all 9 types:
 * shortAnswer, paragraph, multipleChoice, checkboxes, dropdown, date, time, fileUpload, linearScale
 */

import React from 'react';
import { Shield, UploadCloud, Calendar, Clock } from 'lucide-react';

export function DynamicQuestionsStep({
    questions = [],
    formData = {},
    updateFormData,
    onNavigate,
    handleFileUpload // Optional file upload handler from parent
}) {
    if (!questions || questions.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                No additional questions for this company.
            </div>
        );
    }

    const handleChange = (key, value) => {
        updateFormData(key, value);
    };

    const handleCheckboxChange = (key, optValue) => {
        const current = formData[key] || [];
        const currentArray = Array.isArray(current) ? current : [];
        const isChecked = currentArray.includes(optValue);
        const newValues = isChecked
            ? currentArray.filter(v => v !== optValue)
            : [...currentArray, optValue];
        updateFormData(key, newValues);
    };

    const renderField = (field) => {
        const value = formData[field.key] || '';
        const baseInputClass = "w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all";

        switch (field.type) {
            case 'paragraph':
            case 'textarea':
                return (
                    <textarea
                        className={baseInputClass}
                        rows={4}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder || 'Enter your response...'}
                        required={field.required}
                    />
                );

            case 'multipleChoice':
            case 'radio':
                return (
                    <div className="space-y-2">
                        {(field.options || []).map((opt, i) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            return (
                                <label key={i} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                    <input
                                        type="radio"
                                        name={field.key}
                                        checked={value === optValue}
                                        onChange={() => handleChange(field.key, optValue)}
                                        className="w-4 h-4 text-blue-600"
                                        required={field.required}
                                    />
                                    <span className="text-gray-700">{optLabel}</span>
                                </label>
                            );
                        })}
                    </div>
                );

            case 'checkboxes':
                const checkedValues = Array.isArray(value) ? value : [];
                return (
                    <div className="space-y-2">
                        {(field.options || []).map((opt, i) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            const isChecked = checkedValues.includes(optValue);
                            return (
                                <label key={i} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => handleCheckboxChange(field.key, optValue)}
                                        className="w-4 h-4 text-blue-600 rounded"
                                    />
                                    <span className="text-gray-700">{optLabel}</span>
                                </label>
                            );
                        })}
                    </div>
                );

            case 'dropdown':
            case 'select':
                return (
                    <select
                        className={baseInputClass}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        required={field.required}
                    >
                        <option value="">Select an option...</option>
                        {(field.options || []).map((opt, i) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            return <option key={i} value={optValue}>{optLabel}</option>;
                        })}
                    </select>
                );

            case 'date':
                return (
                    <div className="relative">
                        <Calendar size={18} className="absolute left-3 top-3.5 text-gray-400 pointer-events-none" />
                        <input
                            type="date"
                            className={`${baseInputClass} pl-10`}
                            value={value}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            required={field.required}
                        />
                    </div>
                );

            case 'time':
                return (
                    <div className="relative">
                        <Clock size={18} className="absolute left-3 top-3.5 text-gray-400 pointer-events-none" />
                        <input
                            type="time"
                            className={`${baseInputClass} pl-10`}
                            value={value}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            required={field.required}
                        />
                    </div>
                );

            case 'number':
                return (
                    <input
                        type="number"
                        className={baseInputClass}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                    />
                );

            case 'fileUpload':
                return (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50 text-center hover:bg-gray-100 hover:border-blue-400 transition-all cursor-pointer">
                        <input
                            type="file"
                            id={`file-${field.key}`}
                            className="hidden"
                            required={field.required && !value}
                            accept={field.accept || "image/*,application/pdf"}
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file && handleFileUpload) {
                                    handleFileUpload(field.key, file);
                                }
                                handleChange(field.key, file?.name || '');
                            }}
                        />
                        <label htmlFor={`file-${field.key}`} className="cursor-pointer flex flex-col items-center">
                            <UploadCloud size={28} className="text-blue-500 mb-2" />
                            <span className="text-sm text-blue-600 font-medium">Click to upload file</span>
                            <span className="text-xs text-gray-400 mt-1">PDF, PNG, JPG accepted</span>
                            {value && (
                                <span className="text-xs text-green-600 mt-2 font-medium">
                                    ✓ Selected: {typeof value === 'string' ? value : value.name}
                                </span>
                            )}
                        </label>
                    </div>
                );

            case 'linearScale':
                const min = field.min || 1;
                const max = field.max || 5;
                const scaleValues = Array.from({ length: max - min + 1 }, (_, i) => min + i);
                return (
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
                            <span className="text-xs text-gray-500 font-medium min-w-[60px] text-right">
                                {field.minLabel || 'Poor'}
                            </span>
                            <div className="flex gap-3 flex-1 justify-center">
                                {scaleValues.map(val => (
                                    <label key={val} className="flex flex-col items-center gap-1.5 cursor-pointer group">
                                        <input
                                            type="radio"
                                            name={field.key}
                                            value={val}
                                            checked={Number(value) === val}
                                            onChange={(e) => handleChange(field.key, Number(e.target.value))}
                                            required={field.required}
                                            className="w-5 h-5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                        <span className={`text-xs font-medium ${Number(value) === val ? 'text-blue-600' : 'text-gray-500'}`}>
                                            {val}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            <span className="text-xs text-gray-500 font-medium min-w-[60px]">
                                {field.maxLabel || 'Excellent'}
                            </span>
                        </div>
                    </div>
                );

            default: // shortAnswer, text
                return (
                    <input
                        type="text"
                        className={baseInputClass}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder || 'Enter your response...'}
                        required={field.required}
                    />
                );
        }
    };

    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">Additional Questions</h2>
                <p className="text-sm text-gray-500">Please answer the following questions from the employer.</p>
            </div>

            {questions.map((field, index) => (
                <div key={field.key || index} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <label className="block mb-3">
                        <span className="flex items-center gap-2 text-sm font-bold text-gray-700">
                            {field.label}
                            {field.required && <span className="text-red-500">*</span>}
                            {field.dotRequired && (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                                    <Shield size={10} /> DOT
                                </span>
                            )}
                        </span>
                        {field.helpText && (
                            <span className="block text-xs text-gray-500 mt-1">{field.helpText}</span>
                        )}
                    </label>
                    {renderField(field)}
                </div>
            ))}

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={() => onNavigate('prev')}
                    className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={() => onNavigate('next')}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md transition-all"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}

export default DynamicQuestionsStep;
