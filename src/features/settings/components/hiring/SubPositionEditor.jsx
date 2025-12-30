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
        <div className={`border rounded-xl transition-all duration-200 ${data.enabled ? 'border-blue-300 bg-white shadow-sm' : 'border-gray-200 bg-gray-50 opacity-80'}`}>

            <div className="p-4 flex justify-between items-center border-b border-gray-100">
                <h4 className={`font-bold flex items-center gap-2 ${data.enabled ? 'text-blue-900' : 'text-gray-500'}`}>
                    <Briefcase size={18} />
                    {title}
                </h4>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={data.enabled || false}
                        onChange={(e) => handleToggleEnable(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {data.enabled && (
                <div className="p-5 space-y-6 animate-in fade-in slide-in-from-top-2">

                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                            <DollarSign size={16} className="text-green-600"/> Pay Structure
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <select 
                                    className="w-full p-2 border border-gray-300 rounded bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={data.payType}
                                    onChange={handlePayTypeChange}
                                >
                                    {availablePayTypes.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                                </select>
                            </div>
                            {renderPayInputs()}
                        </div>
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                            <Clock size={16} className="text-orange-500"/> Required Experience
                        </label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded bg-white text-sm"
                            value={data.experienceRequired}
                            onChange={(e) => onChange({ ...data, experienceRequired: e.target.value })}
                        >
                            {EXPERIENCE_LEVELS.map(ex => <option key={ex.value} value={ex.value}>{ex.label}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                            <MapPin size={16} className="text-red-500"/> Hiring Geography
                        </label>
                        <div className="flex items-center gap-4 mb-3">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input 
                                    type="radio" name={`geo_${title}`} 
                                    checked={data.hiringGeography?.nationwide === true}
                                    onChange={() => handleGeographyToggle(true)}
                                    className="text-blue-600 focus:ring-blue-500"
                                />
                                Nationwide
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input 
                                    type="radio" name={`geo_${title}`} 
                                    checked={data.hiringGeography?.nationwide === false}
                                    onChange={() => handleGeographyToggle(false)}
                                    className="text-blue-600 focus:ring-blue-500"
                                />
                                Specific States
                            </label>
                        </div>

                        {data.hiringGeography?.nationwide === false && (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 h-32 overflow-y-auto grid grid-cols-4 sm:grid-cols-6 gap-2">
                                {US_STATES.map(state => {
                                    const isSelected = data.hiringGeography.states?.includes(state);
                                    return (
                                        <button
                                            key={state}
                                            onClick={() => handleStateToggle(state)}
                                            className={`text-xs py-1 px-1 rounded border text-center transition-colors ${
                                                isSelected 
                                                ? 'bg-blue-600 text-white border-blue-600' 
                                                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                                            }`}
                                        >
                                            {state}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                            <Truck size={16} className="text-blue-500"/> Specific Freight
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {FREIGHT_TYPES.map(ft => {
                                const isSelected = data.freightTypes?.includes(ft);
                                return (
                                    <button
                                        key={ft}
                                        onClick={() => handleFreightToggle(ft)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-all ${
                                            isSelected 
                                            ? 'bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-200' 
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        {isSelected ? <CheckSquare size={12}/> : <Square size={12}/>}
                                        {ft}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}