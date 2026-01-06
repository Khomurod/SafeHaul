import React from 'react';
import { Truck, Briefcase } from 'lucide-react';
import { formatExperience } from '@shared/utils/helpers';

export function DriverDetails({ driver }) {
    const qual = driver.qualifications || {};
    const dp = driver.driverProfile || {};
    const lic = driver.licenses || [];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2 border-b pb-2">
                    <Truck className="text-blue-600" size={20}/> Qualifications
                </h3>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">Experience</span>
                        <span className="font-semibold text-gray-900">
                            {formatExperience(qual.experienceYears)}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Legal to Work?</span>
                        <span className="font-semibold text-gray-900">{qual.legalWork || 'Yes'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Source</span>
                        <span className="font-semibold text-gray-900">
                            {dp.isBulkUpload ? 'SafeHaul Network Leads' : 'App Signup'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2 border-b pb-2">
                    <Briefcase className="text-blue-600" size={20}/> License / CDL
                </h3>
                {lic.length > 0 ? lic.map((l, i) => (
                    <div key={i} className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Class</span>
                            <span className="font-semibold text-gray-900">{l.class || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">State</span>
                            <span className="font-semibold text-gray-900">{l.state || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Endorsements</span>
                            <span className="font-semibold text-gray-900">
                                {l.endorsements?.length > 0 ? l.endorsements.join(', ') : 'None'}
                            </span>
                        </div>
                    </div>
                )) : (
                    <p className="text-sm text-gray-400 italic">No license info on file.</p>
                )}
            </div>
        </div>
    );
}
