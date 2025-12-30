import React from 'react';
import { CreditCard, AlertCircle, CheckSquare, Square, IdCard, Calendar, Upload } from 'lucide-react';

const US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", 
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", 
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", 
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", 
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const ENDORSEMENTS_LIST = [
    { code: "H", label: "Hazmat (H)" },
    { code: "N", label: "Tanker (N)" },
    { code: "T", label: "Doubles/Triples (T)" },
    { code: "P", label: "Passenger (P)" },
    { code: "S", label: "School Bus (S)" },
    { code: "X", label: "Hazmat + Tanker (X)" }
];

export function StepLicense({ data, onChange }) {

    const handleChange = (e) => {
        const { name, value } = e.target;
        onChange({ [name]: value });
    };

    const toggleEndorsement = (code) => {
        let current = data.endorsements || [];
        if (typeof current === 'string') current = current.split(',').filter(e => e);
        if (!Array.isArray(current)) current = [];

        if (current.includes(code)) {
            onChange({ endorsements: current.filter(e => e !== code) });
        } else {
            onChange({ endorsements: [...current, code] });
        }
    };

    const endorsements = Array.isArray(data.endorsements) ? data.endorsements : 
                         (typeof data.endorsements === 'string' ? data.endorsements.split(',').filter(e => e) : []);

    return (
        <div className="space-y-8 animate-in slide-in-from-right duration-500">
            
            {/* License Details Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-6">
                    <CreditCard size={20} className="text-blue-600" /> Commercial Driver's License (CDL)
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* License Number */}
                    <div className="col-span-1 md:col-span-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">License Number <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            name="cdlNumber"
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono tracking-wide"
                            placeholder="Enter CDL Number"
                            value={data.cdlNumber || ''}
                            onChange={handleChange}
                        />
                    </div>

                    {/* State */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Issuing State <span className="text-red-500">*</span></label>
                        <select
                            name="cdlState"
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={data.cdlState || ''}
                            onChange={handleChange}
                        >
                            <option value="">Select State</option>
                            {US_STATES.map(st => (
                                <option key={st} value={st}>{st}</option>
                            ))}
                        </select>
                    </div>

                    {/* Class */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">License Class <span className="text-red-500">*</span></label>
                        <select
                            name="cdlClass"
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={data.cdlClass || ''}
                            onChange={handleChange}
                        >
                            <option value="">Select Class</option>
                            <option value="Class A">Class A</option>
                            <option value="Class B">Class B</option>
                            <option value="Class C">Class C</option>
                            <option value="Class D">Class D</option>
                            <option value="Non-CDL">Non-CDL</option>
                        </select>
                    </div>

                    {/* Expiration */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">License Expiration <span className="text-red-500">*</span></label>
                        <input
                            type="date"
                            name="cdlExpiration"
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={data.cdlExpiration || ''}
                            onChange={handleChange}
                        />
                    </div>

                    {/* Medical Card Expiration */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Medical Card Expiration</label>
                        <input
                            type="date"
                            name="medCardExpiration"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={data.medCardExpiration || ''}
                            onChange={handleChange}
                        />
                    </div>
                </div>
            </div>

            {/* Endorsements Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-4">Endorsements</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ENDORSEMENTS_LIST.map((endo) => {
                        const isSelected = endorsements.includes(endo.code);
                        return (
                            <div 
                                key={endo.code}
                                onClick={() => toggleEndorsement(endo.code)}
                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                    isSelected 
                                    ? 'bg-blue-50 border-blue-300 shadow-sm' 
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {isSelected 
                                    ? <CheckSquare className="text-blue-600" size={20} />
                                    : <Square className="text-gray-400" size={20} />
                                }
                                <span className={`text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-600'}`}>
                                    {endo.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* TWIC Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <IdCard size={20} className="text-indigo-600" /> TWIC Card (Transportation Worker Identification Credential)
                </h3>

                <div className="space-y-4">
                    <div>
                        <p className="text-sm text-gray-800 font-medium mb-2">Do you have a TWIC card?</p>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2">
                                <input type="radio" name="has-twic" value="yes" checked={data['has-twic'] === 'yes'} onChange={handleChange} /> Yes
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="radio" name="has-twic" value="no" checked={data['has-twic'] === 'no'} onChange={handleChange} /> No
                            </label>
                        </div>
                    </div>

                    {data['has-twic'] === 'yes' && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">TWIC Expiration Date</label>
                            <input
                                type="date"
                                name="twicExpiration"
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={data.twicExpiration || ''}
                                onChange={handleChange}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* File Upload Note */}
            <div className="flex gap-3 p-4 bg-blue-50 text-blue-800 rounded-lg border border-blue-200 text-sm">
                <Upload size={20} className="shrink-0" />
                <div>
                    <p className="font-medium">Document Uploads</p>
                    <p className="text-xs mt-1">You may be asked to upload copies of your CDL, medical card, and TWIC card during the onboarding process after your application is reviewed.</p>
                </div>
            </div>

            {/* Warning / Info */}
            <div className="flex gap-3 p-4 bg-yellow-50 text-yellow-800 rounded-lg border border-yellow-200 text-sm">
                <AlertCircle size={20} className="shrink-0" />
                <p>
                    Ensure your license information matches the physical card exactly. 
                    Incorrect information may delay your application.
                </p>
            </div>

        </div>
    );
}
