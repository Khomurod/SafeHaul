import React, { useState } from 'react';
import {
    X, ChevronRight, ChevronLeft, Check,
    Briefcase, DollarSign, MapPin, Truck
} from 'lucide-react';
import {
    PAY_TYPES, EXPERIENCE_LEVELS, FREIGHT_TYPES, BENEFITS_LIST
} from './HiringConfig';

const US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const steps = [
    { id: 1, label: 'Position Details', icon: <Briefcase size={18} /> },
    { id: 2, label: 'The Offer', icon: <DollarSign size={18} /> },
    { id: 3, label: 'Requirements', icon: <MapPin size={18} /> }
];

export function JobWizard({ isOpen, onClose, onSave, initialData }) {
    const [currentStep, setCurrentStep] = useState(1);
    const [formData, setFormData] = useState(initialData || {
        title: '',
        description: '',
        positionType: 'companyDriver', // companyDriver, ownerOperator, leaseOperator
        teamMode: 'solo', // solo, team
        routeType: 'regional', // otr, regional, local
        freightTypes: [],
        payModel: 'cpm',
        payMin: '',
        payMax: '',
        estimatedWeeklyPay: '',
        minExperience: 'moreThan1Year',
        hiringStates: [],
        benefits: {},
        status: 'active'
    });

    if (!isOpen) return null;

    const updateField = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const toggleArrayItem = (field, value) => {
        setFormData(prev => {
            const current = prev[field] || [];
            const updated = current.includes(value)
                ? current.filter(item => item !== value)
                : [...current, value];
            return { ...prev, [field]: updated };
        });
    };

    const toggleBenefit = (id) => {
        setFormData(prev => ({
            ...prev,
            benefits: { ...prev.benefits, [id]: !prev.benefits[id] }
        }));
    };

    const handleNext = () => {
        if (currentStep < 3) setCurrentStep(prev => prev + 1);
        else onSave(formData);
    };

    const handleBack = () => {
        if (currentStep > 1) setCurrentStep(prev => prev - 1);
    };

    // --- Steps Rendering ---

    const renderStep1 = () => (
        <div className="space-y-6">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Job Title</label>
                <input
                    type="text"
                    placeholder="e.g. CDL-A Regional Dry Van"
                    className="w-full p-3 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={formData.title}
                    onChange={(e) => updateField('title', e.target.value)}
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Position Type</label>
                    <select
                        className="w-full p-3 border border-gray-200 rounded-lg bg-white"
                        value={formData.positionType}
                        onChange={(e) => updateField('positionType', e.target.value)}
                    >
                        <option value="companyDriver">Company Driver</option>
                        <option value="ownerOperator">Owner Operator</option>
                        <option value="leaseOperator">Lease Purchase</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Team Mode</label>
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        {['solo', 'team'].map(mode => (
                            <button
                                key={mode}
                                onClick={() => updateField('teamMode', mode)}
                                className={`flex-1 py-2 text-sm font-bold capitalize rounded-md transition-all ${formData.teamMode === mode ? 'bg-white shadow-sm text-blue-900' : 'text-gray-500'
                                    }`}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Route Type</label>
                <div className="flex gap-2">
                    {['otr', 'regional', 'local'].map(route => (
                        <button
                            key={route}
                            onClick={() => updateField('routeType', route)}
                            className={`px-4 py-2 rounded-full border text-sm font-bold capitalize transition-all ${formData.routeType === route
                                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            {route.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Freight Types</label>
                <div className="flex flex-wrap gap-2">
                    {FREIGHT_TYPES.map(ft => (
                        <button
                            key={ft}
                            onClick={() => toggleArrayItem('freightTypes', ft)}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${formData.freightTypes?.includes(ft)
                                    ? 'bg-slate-800 text-white shadow-lg shadow-slate-200'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                        >
                            {ft}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Pay Model</label>
                    <select
                        className="w-full p-3 border border-gray-200 rounded-lg bg-white"
                        value={formData.payModel}
                        onChange={(e) => updateField('payModel', e.target.value)}
                    >
                        {PAY_TYPES.filter(pt => {
                            const isContractor = formData.positionType === 'ownerOperator' || formData.positionType === 'leaseOperator';
                            if (isContractor) return pt.value === 'percentage' || pt.value === 'flatRate';
                            return true;
                        }).map(pt => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Min Pay</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                        <input
                            type="number" step="0.01"
                            className="w-full pl-7 p-3 border border-gray-200 rounded-lg font-mono font-bold"
                            value={formData.payMin}
                            onChange={(e) => updateField('payMin', e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Max Pay</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                        <input
                            type="number" step="0.01"
                            className="w-full pl-7 p-3 border border-gray-200 rounded-lg font-mono font-bold"
                            value={formData.payMax}
                            onChange={(e) => updateField('payMax', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Estimated Weekly Pay (Avg)</label>
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">$</span>
                    <input
                        type="number"
                        placeholder="1500"
                        className="w-full pl-7 p-3 border border-emerald-200 bg-emerald-50/30 rounded-lg font-mono font-bold text-emerald-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                        value={formData.estimatedWeeklyPay}
                        onChange={(e) => updateField('estimatedWeeklyPay', e.target.value)}
                    />
                </div>
                <p className="text-xs text-gray-400 mt-1">Used for 'Min Pay' filtering on the job board.</p>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Benefits included</label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                    {BENEFITS_LIST.map(ben => (
                        <div
                            key={ben.id}
                            onClick={() => toggleBenefit(ben.id)}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${formData.benefits?.[ben.id]
                                    ? 'bg-emerald-50 border-emerald-200'
                                    : 'bg-white border-gray-100'
                                }`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${formData.benefits?.[ben.id] ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                                }`}>
                                {formData.benefits?.[ben.id] && <Check size={12} className="text-white" />}
                            </div>
                            <span className="text-xs font-medium text-gray-700">{ben.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderStep3 = () => (
        <div className="space-y-6">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Minimum Experience</label>
                <select
                    className="w-full p-3 border border-gray-200 rounded-lg bg-white"
                    value={formData.minExperience}
                    onChange={(e) => updateField('minExperience', e.target.value)}
                >
                    {EXPERIENCE_LEVELS.map(lvl => (
                        <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Hiring Zone (States)</label>
                <div className="p-2 border border-gray-200 rounded-xl bg-gray-50 max-h-[300px] overflow-y-auto grid grid-cols-6 gap-2">
                    {US_STATES.map(state => {
                        const isSelected = formData.hiringStates?.includes(state);
                        return (
                            <button
                                key={state}
                                onClick={() => toggleArrayItem('hiringStates', state)}
                                className={`text-xs font-bold py-2 rounded transition-all ${isSelected
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-white text-gray-400 hover:bg-gray-100 border border-gray-100'
                                    }`}
                            >
                                {state}
                            </button>
                        );
                    })}
                </div>
                <p className="text-xs text-gray-400 mt-2 text-center">
                    Leave empty for Nationwide (if applicable) or select specific states.
                </p>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                    <h3 className="text-lg font-bold text-gray-900">
                        {initialData ? 'Edit Job Post' : 'Create New Job Post'}
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Progress */}
                <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 shrink-0">
                    <div className="flex items-center justify-between relative">
                        {/* Line */}
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-200 -z-10 rounded-full" />
                        <div
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-blue-500 -z-10 rounded-full transition-all duration-300"
                            style={{ width: `${((currentStep - 1) / 2) * 100}%` }}
                        />

                        {steps.map((step) => {
                            const isActive = currentStep >= step.id;
                            const isCurrent = currentStep === step.id;
                            return (
                                <div key={step.id} className="flex flex-col items-center gap-2 bg-white px-2">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                                        } ${isCurrent ? 'ring-4 ring-blue-100' : ''}`}>
                                        {step.id}
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-blue-900' : 'text-gray-400'
                                        }`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 flex-1 overflow-y-auto">
                    {currentStep === 1 && renderStep1()}
                    {currentStep === 2 && renderStep2()}
                    {currentStep === 3 && renderStep3()}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-between shrink-0">
                    <button
                        onClick={handleBack}
                        disabled={currentStep === 1}
                        className={`px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors ${currentStep === 1 ? 'invisible' : ''}`}
                    >
                        Back
                    </button>
                    <button
                        onClick={handleNext}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-all flex items-center gap-2"
                    >
                        {currentStep === 3 ? (initialData ? 'Update Job' : 'Post Job') : 'Continue'}
                        {currentStep < 3 && <ChevronRight size={16} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
