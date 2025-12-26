import React from 'react';
import { Briefcase, Plus, Trash2, Calendar, MapPin, Building2, GraduationCap, Shield, Clock } from 'lucide-react';

const EMPTY_EMPLOYER = {
    name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    position: 'Driver',
    startDate: '',
    endDate: '',
    reason: '',
    fmcsr: 'yes'
};

const EMPTY_GAP = { startDate: '', endDate: '', reason: '' };
const EMPTY_SCHOOL = { name: '', city: '', state: '', graduationDate: '' };
const EMPTY_MILITARY = { branch: '', startDate: '', endDate: '', rank: '' };

export function StepEmployment({ data, onChange }) {
    
    const employers = Array.isArray(data.employers) ? data.employers : [];
    const unemployment = Array.isArray(data.unemployment) ? data.unemployment : [];
    const schools = Array.isArray(data.schools) ? data.schools : [];
    const military = Array.isArray(data.military) ? data.military : [];

    const handleAddEmployer = () => onChange({ employers: [...employers, { ...EMPTY_EMPLOYER }] });
    const handleRemoveEmployer = (i) => onChange({ employers: employers.filter((_, idx) => idx !== i) });
    const handleUpdateEmployer = (i, field, val) => {
        const updated = [...employers];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ employers: updated });
    };

    const handleAddGap = () => onChange({ unemployment: [...unemployment, { ...EMPTY_GAP }] });
    const handleRemoveGap = (i) => onChange({ unemployment: unemployment.filter((_, idx) => idx !== i) });
    const handleUpdateGap = (i, field, val) => {
        const updated = [...unemployment];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ unemployment: updated });
    };

    const handleAddSchool = () => onChange({ schools: [...schools, { ...EMPTY_SCHOOL }] });
    const handleRemoveSchool = (i) => onChange({ schools: schools.filter((_, idx) => idx !== i) });
    const handleUpdateSchool = (i, field, val) => {
        const updated = [...schools];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ schools: updated });
    };

    const handleAddMilitary = () => onChange({ military: [...military, { ...EMPTY_MILITARY }] });
    const handleRemoveMilitary = (i) => onChange({ military: military.filter((_, idx) => idx !== i) });
    const handleUpdateMilitary = (i, field, val) => {
        const updated = [...military];
        updated[i] = { ...updated[i], [field]: val };
        onChange({ military: updated });
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-500">
            
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-sm text-blue-800">
                <p><strong>DOT Requirement:</strong> Please list employment history for the past 3 years. If you were a driver, please list up to 10 years. Include any gaps in employment.</p>
            </div>

            {/* Employers Section */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <Briefcase size={20} className="text-blue-600" /> Previous Employers
                </h3>

                <div className="space-y-6">
                    {employers.map((emp, index) => (
                        <div key={index} className="bg-gray-50 border border-gray-200 rounded-xl p-5 relative">
                            
                            <div className="flex justify-between items-center mb-4 border-b border-gray-200 pb-2">
                                <h4 className="font-bold text-gray-700 flex items-center gap-2">
                                    <Building2 size={18} className="text-gray-400" /> Employer #{index + 1}
                                </h4>
                                <button onClick={() => handleRemoveEmployer(index)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><Trash2 size={18} /></button>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Company Name</label>
                                        <input type="text" className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="ABC Trucking Inc." value={emp.name} onChange={(e) => handleUpdateEmployer(index, 'name', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                                        <input type="tel" className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="(555) 123-4567" value={emp.phone} onChange={(e) => handleUpdateEmployer(index, 'phone', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Position</label>
                                        <input type="text" className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Driver" value={emp.position} onChange={(e) => handleUpdateEmployer(index, 'position', e.target.value)} />
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                                        <input type="text" className="w-full p-2.5 border border-gray-300 rounded-lg" value={emp.city} onChange={(e) => handleUpdateEmployer(index, 'city', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                                        <input type="text" className="w-full p-2.5 border border-gray-300 rounded-lg" maxLength={2} placeholder="IL" value={emp.state} onChange={(e) => handleUpdateEmployer(index, 'state', e.target.value)} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Start Date</label>
                                        <input type="date" className="w-full p-2.5 border border-gray-300 rounded-lg" value={emp.startDate} onChange={(e) => handleUpdateEmployer(index, 'startDate', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">End Date</label>
                                        <input type="date" className="w-full p-2.5 border border-gray-300 rounded-lg" value={emp.endDate} onChange={(e) => handleUpdateEmployer(index, 'endDate', e.target.value)} />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Reason for Leaving</label>
                                    <input type="text" className="w-full p-2.5 border border-gray-300 rounded-lg" placeholder="Better opportunity..." value={emp.reason} onChange={(e) => handleUpdateEmployer(index, 'reason', e.target.value)} />
                                </div>

                                <label className="flex items-start gap-3 p-3 bg-white rounded-lg cursor-pointer border">
                                    <input type="checkbox" className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300" checked={emp.fmcsr === 'yes'} onChange={(e) => handleUpdateEmployer(index, 'fmcsr', e.target.checked ? 'yes' : 'no')} />
                                    <span className="text-xs text-gray-600">Subject to Federal Motor Carrier Safety Regulations (FMCSRs) while employed here?</span>
                                </label>
                            </div>
                        </div>
                    ))}
                </div>

                <button onClick={handleAddEmployer} className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold flex items-center justify-center gap-2 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all">
                    <Plus size={20} /> Add Previous Employer
                </button>
            </div>

            {/* Employment Gaps */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <Clock size={20} className="text-orange-600" /> Employment Gaps
                </h3>
                <p className="text-xs text-gray-500 mb-4">List any periods of unemployment lasting 30 days or more.</p>

                <div className="space-y-4">
                    {unemployment.map((gap, i) => (
                        <div key={i} className="bg-gray-50 p-4 rounded-lg border relative">
                            <button onClick={() => handleRemoveGap(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">From</label>
                                    <input type="date" className="w-full p-2 border rounded text-sm" value={gap.startDate} onChange={(e) => handleUpdateGap(i, 'startDate', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">To</label>
                                    <input type="date" className="w-full p-2 border rounded text-sm" value={gap.endDate} onChange={(e) => handleUpdateGap(i, 'endDate', e.target.value)} />
                                </div>
                            </div>
                            <input type="text" placeholder="Reason (e.g., personal leave, job searching)" className="w-full p-2 border rounded text-sm" value={gap.reason} onChange={(e) => handleUpdateGap(i, 'reason', e.target.value)} />
                        </div>
                    ))}
                </div>

                <button onClick={handleAddGap} className="mt-4 text-sm text-blue-600 flex items-center gap-1 font-medium">
                    <Plus size={16}/> Add Employment Gap
                </button>
            </div>

            {/* Driving Schools */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <GraduationCap size={20} className="text-green-600" /> Driving Schools / Training
                </h3>
                <p className="text-xs text-gray-500 mb-4">List any CDL training schools or certifications.</p>

                <div className="space-y-4">
                    {schools.map((school, i) => (
                        <div key={i} className="bg-gray-50 p-4 rounded-lg border relative">
                            <button onClick={() => handleRemoveSchool(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
                                <input type="text" placeholder="School Name" className="p-2 border rounded text-sm col-span-2" value={school.name} onChange={(e) => handleUpdateSchool(i, 'name', e.target.value)} />
                                <input type="text" placeholder="City" className="p-2 border rounded text-sm" value={school.city} onChange={(e) => handleUpdateSchool(i, 'city', e.target.value)} />
                                <input type="text" placeholder="State" maxLength={2} className="p-2 border rounded text-sm" value={school.state} onChange={(e) => handleUpdateSchool(i, 'state', e.target.value)} />
                            </div>
                            <input type="date" className="w-full p-2 border rounded text-sm" value={school.graduationDate} onChange={(e) => handleUpdateSchool(i, 'graduationDate', e.target.value)} />
                        </div>
                    ))}
                </div>

                <button onClick={handleAddSchool} className="mt-4 text-sm text-blue-600 flex items-center gap-1 font-medium">
                    <Plus size={16}/> Add Driving School
                </button>
            </div>

            {/* Military Service */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <Shield size={20} className="text-red-600" /> Military Service
                </h3>
                <p className="text-xs text-gray-500 mb-4">List any military service history (optional).</p>

                <div className="space-y-4">
                    {military.map((mil, i) => (
                        <div key={i} className="bg-gray-50 p-4 rounded-lg border relative">
                            <button onClick={() => handleRemoveMilitary(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <select className="p-2 border rounded text-sm" value={mil.branch} onChange={(e) => handleUpdateMilitary(i, 'branch', e.target.value)}>
                                    <option value="">Select Branch</option>
                                    <option value="Army">Army</option>
                                    <option value="Navy">Navy</option>
                                    <option value="Air Force">Air Force</option>
                                    <option value="Marines">Marines</option>
                                    <option value="Coast Guard">Coast Guard</option>
                                    <option value="National Guard">National Guard</option>
                                </select>
                                <input type="text" placeholder="Rank at Discharge" className="p-2 border rounded text-sm" value={mil.rank} onChange={(e) => handleUpdateMilitary(i, 'rank', e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="date" className="p-2 border rounded text-sm" value={mil.startDate} onChange={(e) => handleUpdateMilitary(i, 'startDate', e.target.value)} />
                                <input type="date" className="p-2 border rounded text-sm" value={mil.endDate} onChange={(e) => handleUpdateMilitary(i, 'endDate', e.target.value)} />
                            </div>
                        </div>
                    ))}
                </div>

                <button onClick={handleAddMilitary} className="mt-4 text-sm text-blue-600 flex items-center gap-1 font-medium">
                    <Plus size={16}/> Add Military Service
                </button>
            </div>

            {employers.length === 0 && unemployment.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-4">
                    Please add at least one employer or explain any employment gaps.
                </div>
            )}
        </div>
    );
}
