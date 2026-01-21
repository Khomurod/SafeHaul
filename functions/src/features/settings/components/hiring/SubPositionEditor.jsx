import React from 'react';
import {
    DollarSign, MapPin, Truck, Clock, Briefcase,
    CheckSquare, Square
} from 'lucide-react';
import {
    PAY_TYPES, EXPERIENCE_LEVELS, FREIGHT_TYPES
} from './HiringConfig';

const US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

export function SubPositionEditor({ title, data, onChange, category }) {

    const handleToggleEnable = (checked) => {
        onChange({ ...data, enabled: checked });
    };

    const handlePayTypeChange = (e) => {
        onChange({ ...data, payType: e.target.value });
    };

    const handlePayValueChange = (type, field, value) => {
        const currentPayData = data[type] || {};
        onChange({
            ...data,
            [type]: { ...currentPayData, [field]: value }
        });
    };

    const handleGeographyToggle = (isNationwide) => {
        onChange({
            ...data,
            hiringGeography: { ...data.hiringGeography, nationwide: isNationwide }
        });
    };

    const handleStateToggle = (stateCode) => {
        const currentStates = data.hiringGeography?.states || [];
        const newStates = currentStates.includes(stateCode)
            ? currentStates.filter(s => s !== stateCode)
            : [...currentStates, stateCode];

        onChange({
            ...data,
            hiringGeography: { ...data.hiringGeography, states: newStates }
        });
    };

    const handleFreightToggle = (type) => {
        const current = data.freightTypes || [];
        const updated = current.includes(type)
            ? current.filter(t => t !== type)
            : [...current, type];
        onChange({ ...data, freightTypes: updated });
    };

    // --- Logic for Pay Types ---
    // Owner/Lease: No CPM or Hourly. Only Percentage or Flat.
    const availablePayTypes = PAY_TYPES.filter(pt => {
        const isContractor = category === 'ownerOperator' || category === 'leaseOperator';
        if (isContractor) {
            return pt.value === 'percentage' || pt.value === 'flatRate';
        }
        return true; // Company driver gets all
    });

    const renderPayInputs = () => {
        const type = data.payType;

        if (type === 'cpm') {
            return (
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-gray-500 uppercase font-bold">Min CPM</label>
                        <div className="relative">
                            <span className="absolute left-2 top-2 text-gray-400 text-xs">$</span>
                            <input
                                type="number" step="0.01" placeholder="0.50"
                                className="w-full pl-5 p-2 border border-gray-300 rounded bg-white text-sm"
                                value={data.cpm?.min || ''}
                                onChange={(e) => handlePayValueChange('cpm', 'min', e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-1">
                        <label className="text-xs text-gray-500 uppercase font-bold">Max CPM</label>
                        <div className="relative">
                            <span className="absolute left-2 top-2 text-gray-400 text-xs">$</span>
                            <input
                                type="number" step="0.01" placeholder="0.75"
                                className="w-full pl-5 p-2 border border-gray-300 rounded bg-white text-sm"
                                value={data.cpm?.max || ''}
                                onChange={(e) => handlePayValueChange('cpm', 'max', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            );
        }

        if (type === 'percentage') {
            return (
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-gray-500 uppercase font-bold">Flat %</label>
                        <div className="relative">
                            <input
                                type="number" placeholder="25"
                                className="w-full pr-6 p-2 border border-gray-300 rounded bg-white text-sm"
                                value={data.percentage?.min || ''}
                                onChange={(e) => handlePayValueChange('percentage', 'min', e.target.value)}
                            />
                            <span className="absolute right-2 top-2 text-gray-400 text-xs">%</span>
                        </div>
                    </div>
                </div>
            );
        }

        if (type === 'flatRate' || type === 'hourly') {
            const fieldKey = type === 'flatRate' ? 'flatRate' : 'hourly';
            return (
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-gray-500 uppercase font-bold">Amount</label>
                        <div className="relative">
                            <span className="absolute left-2 top-2 text-gray-400 text-xs">$</span>
                            <input
                                type="number" placeholder="1500"
                                className="w-full pl-5 p-2 border border-gray-300 rounded bg-white text-sm"
                                value={data[fieldKey]?.amount || ''}
                                onChange={(e) => handlePayValueChange(fieldKey, 'amount', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            );
        }
    };

    return (
        <div className={`rounded-[2rem] border-2 transition-all duration-300 overflow-hidden ${data.enabled ? 'border-blue-100 bg-white shadow-xl shadow-blue-500/5' : 'border-slate-100 bg-slate-50/50'}`}>

            <div className={`p-5 flex justify-between items-center border-b transition-colors ${data.enabled ? 'border-blue-100 bg-blue-50/30' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-2xl shadow-sm border transition-all ${data.enabled ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                        <Briefcase size={20} />
                    </div>
                    <div>
                        <h4 className={`text-lg font-extrabold tracking-tight ${data.enabled ? 'text-slate-900' : 'text-slate-500'}`}>
                            {title}
                        </h4>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">
                            {category.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                    </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer group">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={data.enabled || false}
                        onChange={(e) => handleToggleEnable(e.target.checked)}
                    />
                    <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:rounded-full after:h-5 after:w-7 after:transition-all peer-checked:bg-emerald-500"></div>
                    <span className={`ml-3 text-xs font-black uppercase tracking-widest transition-colors ${data.enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {data.enabled ? 'Active' : 'Draft'}
                    </span>
                </label>
            </div>

            {data.enabled && (
                <div className="p-5 space-y-8 animate-in fade-in slide-in-from-top-2">

                    {/* Pay Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                                <DollarSign size={20} />
                            </div>
                            <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">Pay Structure</h5>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-2">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Payment Type</label>
                                <select
                                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                    value={data.payType}
                                    onChange={handlePayTypeChange}
                                >
                                    {availablePayTypes.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                {renderPayInputs()}
                            </div>
                        </div>
                    </div>

                    {/* Requirements Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                                <CheckSquare size={20} />
                            </div>
                            <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">Requirements & Details</h5>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-2">
                            {/* Experience */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                                    <span className="flex items-center gap-1.5"><Clock size={14} /> Required Experience</span>
                                </label>
                                <select
                                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                    value={data.experienceRequired}
                                    onChange={(e) => onChange({ ...data, experienceRequired: e.target.value })}
                                >
                                    {EXPERIENCE_LEVELS.map(ex => <option key={ex.value} value={ex.value}>{ex.label}</option>)}
                                </select>
                            </div>

                            {/* Geography */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                    <span className="flex items-center gap-2"><MapPin size={14} className="text-blue-500" /> Hiring Geography</span>
                                </label>
                                <div className="flex items-center gap-4 mb-3">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-blue-600 transition-colors">
                                        <input
                                            type="radio" name={`geo_${title}`}
                                            checked={data.hiringGeography?.nationwide === true}
                                            onChange={() => handleGeographyToggle(true)}
                                            className="text-blue-600 focus:ring-blue-500"
                                        />
                                        Nationwide
                                    </label>
                                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-blue-600 transition-colors">
                                        <input
                                            type="radio" name={`geo_${title}`}
                                            checked={data.hiringGeography?.nationwide === false}
                                            onChange={() => handleGeographyToggle(false)}
                                            className="text-blue-600 focus:ring-blue-500"
                                        />
                                        Specific States
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* State Selector (Condition) */}
                        {data.hiringGeography?.nationwide === false && (
                            <div className="pl-2">
                                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 h-40 overflow-y-auto grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 custom-scrollbar">
                                    {US_STATES.map(state => {
                                        const isSelected = data.hiringGeography.states?.includes(state);
                                        return (
                                            <button
                                                key={state}
                                                onClick={() => handleStateToggle(state)}
                                                className={`text-xs font-medium py-1.5 px-1 rounded-md border text-center transition-all ${isSelected
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                                                    }`}
                                            >
                                                {state}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Freight Types */}
                        <div className="pl-2 pt-2">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                                <span className="flex items-center gap-2"><Truck size={14} className="text-blue-500" /> Specific Freight Experience</span>
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {FREIGHT_TYPES.map(ft => {
                                    const isSelected = data.freightTypes?.includes(ft);
                                    return (
                                        <button
                                            key={ft}
                                            onClick={() => handleFreightToggle(ft)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${isSelected
                                                ? 'bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-200'
                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                                }`}
                                        >
                                            {isSelected ? <CheckSquare size={12} /> : <Square size={12} className="text-gray-400" />}
                                            {ft}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}