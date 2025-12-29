import React from 'react';
import { Truck, AlertTriangle, ShieldCheck, CheckCircle, XCircle, Languages, Beaker, RotateCcw, Plus, Trash2 } from 'lucide-react';

const EXPERIENCE_OPTIONS = [
    { value: 'New', label: 'Student / Recent Grad' },
    { value: '0-6 months', label: '0-6 Months' },
    { value: '6-12 months', label: '6-12 Months' },
    { value: '1', label: '1 Year' },
    { value: '2', label: '2 Years' },
    { value: '3', label: '3 Years' },
    { value: '4', label: '4 Years' },
    { value: '5+', label: '5+ Years' }
];

const EQUIPMENT_TYPES = [
    "Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck", 
    "Car Hauler", "Step Deck", "Lowboy", "Intermodal", "Power Only"
];

const EMPTY_VIOLATION = { date: '', charge: '', location: '' };
const EMPTY_ACCIDENT = { date: '', city: '', state: '', description: '', injuries: 'no', fatalities: 'no' };

export function StepExperience({ data, onChange }) {

    const handleChange = (e) => {
        const { name, value } = e.target;
        onChange({ [name]: value });
    };

    const toggleEquipment = (type) => {
        let current = data.driverType || [];
        if (typeof current === 'string') current = [current];
        if (!Array.isArray(current)) current = [];

        if (current.includes(type)) {
            onChange({ driverType: current.filter(t => t !== type) });
        } else {
            onChange({ driverType: [...current, type] });
        }
    };

    const violations = Array.isArray(data.violations) ? data.violations : [];
    const accidents = Array.isArray(data.accidents) ? data.accidents : [];

    const handleAddViolation = () => onChange({ violations: [...violations, { ...EMPTY_VIOLATION }] });
    const handleRemoveViolation = (i) => onChange({ violations: violations.filter((_, idx) => idx !== i) });
    const handleUpdateViolation = (i, field, val) => {
        const updated = [...violations];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ violations: updated });
    };

    const handleAddAccident = () => onChange({ accidents: [...accidents, { ...EMPTY_ACCIDENT }] });
    const handleRemoveAccident = (i) => onChange({ accidents: accidents.filter((_, idx) => idx !== i) });
    const handleUpdateAccident = (i, field, val) => {
        const updated = [...accidents];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ accidents: updated });
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-500">
            
            {/* Experience Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-6">
                    <Truck size={20} className="text-blue-600" /> Driving Experience
                </h3>

                <div className="space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Years of Commercial Driving Experience <span className="text-red-500">*</span></label>
                        <select
                            name="experience"
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={data.experience || ''}
                            onChange={handleChange}
                        >
                            <option value="">Select Experience Level</option>
                            {EXPERIENCE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Equipment Operated</label>
                        <div className="grid grid-cols-2 gap-2">
                            {EQUIPMENT_TYPES.map(type => {
                                const isSelected = (data.driverType || []).includes(type);
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => toggleEquipment(type)}
                                        className={`px-3 py-2 text-sm font-medium rounded-lg border text-left transition-all ${
                                            isSelected 
                                            ? 'bg-blue-50 border-blue-500 text-blue-700' 
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        {type}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* General Qualifications Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-6">
                    <ShieldCheck size={20} className="text-green-600" /> General Qualifications
                </h3>

                <div className="space-y-6">
                    {/* Legal Work */}
                    <div className="flex items-start gap-3">
                        <ShieldCheck className="text-green-600 shrink-0 mt-0.5" size={20} />
                        <div className="flex-1">
                            <p className="text-sm text-gray-800 font-medium">Legally eligible to work in the U.S.? <span className="text-red-500">*</span></p>
                            <div className="flex gap-4 mt-2">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="legal-work" value="yes" checked={data['legal-work'] === 'yes'} onChange={handleChange} required /> Yes
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="legal-work" value="no" checked={data['legal-work'] === 'no'} onChange={handleChange} /> No
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* English Fluency */}
                    <div className="flex items-start gap-3 pt-4 border-t border-gray-100">
                        <Languages className="text-blue-600 shrink-0 mt-0.5" size={20} />
                        <div className="flex-1">
                            <p className="text-sm text-gray-800 font-medium">Can you read, write, speak and understand English? <span className="text-red-500">*</span></p>
                            <div className="flex gap-4 mt-2">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="english-fluency" value="yes" checked={data['english-fluency'] === 'yes'} onChange={handleChange} required /> Yes
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="english-fluency" value="no" checked={data['english-fluency'] === 'no'} onChange={handleChange} /> No
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Drug & Alcohol History Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <Beaker size={20} className="text-purple-600" /> Drug & Alcohol History
                </h3>

                <p className="text-xs text-gray-600 mb-4">
                    Have you ever tested positive, or refused to test on a pre-employment drug or alcohol test by an employer, or have you ever tested positive or refused to test on any DOT-mandated drug or alcohol test?
                </p>

                <div className="space-y-4">
                    <div>
                        <p className="text-sm text-gray-800 font-medium mb-2">Drug/alcohol positive tests or refusals? <span className="text-red-500">*</span></p>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="drug-test-positive" value="no" checked={data['drug-test-positive'] === 'no'} onChange={handleChange} className="w-4 h-4 text-green-600" required />
                                <span className="text-sm font-bold text-green-700 flex items-center gap-1"><CheckCircle size={16}/> No</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="drug-test-positive" value="yes" checked={data['drug-test-positive'] === 'yes'} onChange={handleChange} className="w-4 h-4 text-red-600" />
                                <span className="text-sm font-bold text-red-700 flex items-center gap-1"><XCircle size={16}/> Yes</span>
                            </label>
                        </div>
                    </div>

                    {data['drug-test-positive'] === 'yes' && (
                        <div className="pt-4 border-t border-gray-200">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Please explain:</label>
                            <textarea
                                name="drug-test-explanation"
                                rows={3}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={data['drug-test-explanation'] || ''}
                                onChange={handleChange}
                            />
                        </div>
                    )}

                    <div className="flex items-start gap-3 pt-4 border-t border-gray-100">
                        <RotateCcw className="text-orange-600 shrink-0 mt-0.5" size={20} />
                        <div className="flex-1">
                            <p className="text-sm text-gray-800 font-medium">Can you provide documentation confirming successful completion of DOT return-to-duty process? <span className="text-red-500">*</span></p>
                            <div className="flex gap-4 mt-2">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="dot-return-to-duty" value="yes" checked={data['dot-return-to-duty'] === 'yes'} onChange={handleChange} required /> Yes
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="dot-return-to-duty" value="no" checked={data['dot-return-to-duty'] === 'no'} onChange={handleChange} /> No
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="dot-return-to-duty" value="n/a" checked={data['dot-return-to-duty'] === 'n/a'} onChange={handleChange} /> N/A
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Safety Record Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-6">
                    <AlertTriangle size={20} className="text-orange-500" /> Driving Record (Last 3 Years)
                </h3>

                <div className="space-y-6">
                    
                    {/* Accidents */}
                    <div>
                        <p className="font-medium text-gray-800 mb-3">Have you had any accidents in the last 3 years? <span className="text-red-500">*</span></p>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="hasAccidents" value="no" checked={data.hasAccidents === 'no'} onChange={handleChange} className="w-4 h-4 text-green-600" required />
                                <span className="text-sm font-bold text-green-700 flex items-center gap-1"><CheckCircle size={16}/> No Accidents</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="hasAccidents" value="yes" checked={data.hasAccidents === 'yes'} onChange={handleChange} className="w-4 h-4 text-red-600" />
                                <span className="text-sm font-bold text-red-700 flex items-center gap-1"><XCircle size={16}/> Yes</span>
                            </label>
                        </div>

                        {data.hasAccidents === 'yes' && (
                            <div className="mt-4 space-y-3">
                                {accidents.map((acc, i) => (
                                    <div key={i} className="bg-gray-50 p-4 rounded-lg border relative">
                                        <button type="button" onClick={() => handleRemoveAccident(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                                        <div className="grid grid-cols-3 gap-3 mb-2">
                                            <input type="date" placeholder="Date" className="p-2 border rounded text-sm" value={acc.date} onChange={(e) => handleUpdateAccident(i, 'date', e.target.value)} />
                                            <input type="text" placeholder="City" className="p-2 border rounded text-sm" value={acc.city} onChange={(e) => handleUpdateAccident(i, 'city', e.target.value)} />
                                            <input type="text" placeholder="State" maxLength={2} className="p-2 border rounded text-sm" value={acc.state} onChange={(e) => handleUpdateAccident(i, 'state', e.target.value)} />
                                        </div>
                                        <textarea placeholder="Description of accident" className="w-full p-2 border rounded text-sm" rows={2} value={acc.description} onChange={(e) => handleUpdateAccident(i, 'description', e.target.value)} />
                                        <div className="flex gap-4 mt-2">
                                            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={acc.injuries === 'yes'} onChange={(e) => handleUpdateAccident(i, 'injuries', e.target.checked ? 'yes' : 'no')} /> Injuries</label>
                                            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={acc.fatalities === 'yes'} onChange={(e) => handleUpdateAccident(i, 'fatalities', e.target.checked ? 'yes' : 'no')} /> Fatalities</label>
                                        </div>
                                    </div>
                                ))}
                                <button type="button" onClick={handleAddAccident} className="text-sm text-blue-600 flex items-center gap-1 font-medium"><Plus size={16}/> Add Accident</button>
                            </div>
                        )}
                    </div>

                    {/* Violations */}
                    <div className="pt-4 border-t border-gray-100">
                        <p className="font-medium text-gray-800 mb-3">Any moving violations (tickets) in the last 3 years? <span className="text-red-500">*</span></p>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="hasViolations" value="no" checked={data.hasViolations === 'no'} onChange={handleChange} className="w-4 h-4 text-green-600" required />
                                <span className="text-sm font-bold text-green-700 flex items-center gap-1"><CheckCircle size={16}/> Clean Record</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                                <input type="radio" name="hasViolations" value="yes" checked={data.hasViolations === 'yes'} onChange={handleChange} className="w-4 h-4 text-red-600" />
                                <span className="text-sm font-bold text-red-700 flex items-center gap-1"><XCircle size={16}/> Yes</span>
                            </label>
                        </div>

                        {data.hasViolations === 'yes' && (
                            <div className="mt-4 space-y-3">
                                {violations.map((vio, i) => (
                                    <div key={i} className="bg-gray-50 p-4 rounded-lg border relative">
                                        <button type="button" onClick={() => handleRemoveViolation(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                                        <div className="grid grid-cols-3 gap-3">
                                            <input type="date" placeholder="Date" className="p-2 border rounded text-sm" value={vio.date} onChange={(e) => handleUpdateViolation(i, 'date', e.target.value)} />
                                            <input type="text" placeholder="Charge/Violation" className="p-2 border rounded text-sm col-span-2" value={vio.charge} onChange={(e) => handleUpdateViolation(i, 'charge', e.target.value)} />
                                        </div>
                                        <input type="text" placeholder="Location (City, State)" className="w-full p-2 border rounded text-sm mt-2" value={vio.location} onChange={(e) => handleUpdateViolation(i, 'location', e.target.value)} />
                                    </div>
                                ))}
                                <button type="button" onClick={handleAddViolation} className="text-sm text-blue-600 flex items-center gap-1 font-medium"><Plus size={16}/> Add Violation</button>
                            </div>
                        )}
                    </div>

                    {/* License Revoked */}
                    <div className="pt-4 border-t border-gray-100">
                        <p className="text-sm text-gray-800 font-medium mb-2">Has your license ever been suspended, revoked, or denied?</p>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2"><input type="radio" name="revoked-licenses" value="no" checked={data['revoked-licenses'] === 'no'} onChange={handleChange} /> No</label>
                            <label className="flex items-center gap-2"><input type="radio" name="revoked-licenses" value="yes" checked={data['revoked-licenses'] === 'yes'} onChange={handleChange} /> Yes</label>
                        </div>
                    </div>

                </div>
            </div>

        </div>
    );
}
