import React from 'react';
import { Section, InfoGrid, InfoItem } from '../ApplicationUI';
import { getFieldValue } from '@shared/utils/helpers';
import { AlertCircle, User } from 'lucide-react';

/**
 * PersonalInfoSection - Displays personal information fields
 * 
 * Field definitions are documented in: src/config/applicationSchema.js
 * Sections: PERSONAL_INFO_SECTION, ADDRESS_SECTION, PREVIOUS_ADDRESSES_SECTION
 * 
 * @see src/config/applicationSchema.js for the source of truth
 */
export function PersonalInfoSection({
    appData,
    isEditing,
    handleDataChange,
    canEditAllFields,
    onPhoneClick
}) {

    // Helper for SSN masking
    const renderSSN = (ssn) => {
        if (!ssn) return <span className="text-gray-400 italic">Not provided</span>;
        // If editing, show full value
        if (isEditing) return (
            <input
                type="text"
                value={ssn}
                onChange={(e) => handleDataChange('ssn', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
            />
        );
        // Mask for view only
        return <span>***-**-{ssn.slice(-4)}</span>;
    };

    return (
        <Section title="Personal Information">
            <InfoGrid>

                {/* Row 1: Name */}
                <InfoItem label="First Name" value={appData.firstName} isEditing={isEditing} onChange={v => handleDataChange('firstName', v)} />
                <InfoItem label="Middle" value={appData.middleName} isEditing={isEditing} onChange={v => handleDataChange('middleName', v)} />
                <InfoItem label="Last Name" value={appData.lastName} isEditing={isEditing} onChange={v => handleDataChange('lastName', v)} />

                {/* NEW: Suffix */}
                <div className="col-span-1">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Suffix</label>
                    {isEditing ? (
                        <input
                            type="text"
                            value={appData.suffix || ''}
                            onChange={(e) => handleDataChange('suffix', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded"
                            placeholder="Jr."
                        />
                    ) : (
                        <p className="text-lg font-medium text-gray-900">{appData.suffix || '-'}</p>
                    )}
                </div>

                {/* Row 2: Contact & Identity */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                    {isEditing ? (
                        <input type="tel" value={appData.phone || ''} onChange={(e) => handleDataChange('phone', e.target.value)} className="w-full p-2 border border-gray-300 rounded" />
                    ) : (
                        <button onClick={() => onPhoneClick(appData.phone)} className="text-lg font-medium text-blue-600 hover:underline flex items-center gap-2">
                            {appData.phone || 'N/A'}
                        </button>
                    )}
                </div>

                <InfoItem label="Email" value={appData.email} isEditing={isEditing} onChange={v => handleDataChange('email', v)} />

                <InfoItem label="Date of Birth" value={appData.dob} isEditing={isEditing} type="date" onChange={v => handleDataChange('dob', v)} />

                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">SSN</label>
                    {renderSSN(appData.ssn)}
                </div>

                {/* SMS Consent */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">SMS Consent</label>
                    <span className={`text-sm font-bold px-2 py-1 rounded ${appData['sms-consent'] === 'yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {appData['sms-consent'] === 'yes' ? 'YES' : 'NO'}
                    </span>
                </div>

                {/* Referral Source */}
                <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">How Did You Hear About Us?</label>
                    {isEditing ? (
                        <input
                            type="text"
                            value={appData.referralSource || ''}
                            onChange={(e) => handleDataChange('referralSource', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded"
                        />
                    ) : (
                        <p className="text-sm text-gray-900">{appData.referralSource || '-'}</p>
                    )}
                </div>

                {/* NEW: Other Names (Aliases) */}
                {appData['known-by-other-name'] === 'yes' && (
                    <div className="col-span-full bg-yellow-50 p-3 rounded-lg border border-yellow-200 mt-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-yellow-800 uppercase mb-1">
                            <User size={14} /> Known By Other Name(s)
                        </label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={appData.otherName || ''}
                                onChange={(e) => handleDataChange('otherName', e.target.value)}
                                className="w-full p-2 border border-yellow-300 rounded"
                            />
                        ) : (
                            <p className="text-sm font-medium text-gray-900">{appData.otherName}</p>
                        )}
                    </div>
                )}

                {/* Row 3: Current Address */}
                <div className="col-span-full pt-4 border-t border-gray-100">
                    <h4 className="text-sm font-bold text-gray-700 mb-3">Current Address</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InfoItem label="Street" value={appData.street} isEditing={isEditing} onChange={v => handleDataChange('street', v)} />
                        <div className="grid grid-cols-3 gap-4">
                            <InfoItem label="City" value={appData.city} isEditing={isEditing} onChange={v => handleDataChange('city', v)} />
                            <InfoItem label="State" value={appData.state} isEditing={isEditing} onChange={v => handleDataChange('state', v)} />
                            <InfoItem label="Zip" value={appData.zip} isEditing={isEditing} onChange={v => handleDataChange('zip', v)} />
                        </div>
                    </div>
                    <div className="mt-2">
                        <span className="text-xs text-gray-500">Lived here 3+ years? </span>
                        <span className={`text-xs font-bold ${appData['residence-3-years'] === 'yes' ? 'text-green-600' : 'text-orange-600'}`}>
                            {appData['residence-3-years'] === 'yes' ? 'YES' : 'NO'}
                        </span>
                    </div>
                </div>

                {/* Row 4: Previous Addresses (Array - Conditional) */}
                {appData['residence-3-years'] === 'no' && (
                    <div className="col-span-full pt-4 border-t border-gray-100 bg-gray-50 p-4 rounded-lg">
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <AlertCircle size={14} /> Previous Addresses (Required for History)
                        </h4>

                        {/* Handle previousAddresses as array */}
                        {Array.isArray(appData.previousAddresses) && appData.previousAddresses.length > 0 ? (
                            <div className="space-y-4">
                                {appData.previousAddresses.map((addr, index) => (
                                    <div key={index} className="bg-white p-3 rounded border border-gray-200">
                                        <p className="text-xs font-bold text-gray-500 mb-2">Address {index + 1}</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                            <div><span className="text-gray-500">Street:</span> {addr.street || '-'}</div>
                                            <div><span className="text-gray-500">City:</span> {addr.city || '-'}</div>
                                            <div><span className="text-gray-500">State:</span> {addr.state || '-'}</div>
                                            <div><span className="text-gray-500">Zip:</span> {addr.zip || '-'}</div>
                                            {addr.startDate && <div><span className="text-gray-500">From:</span> {addr.startDate}</div>}
                                            {addr.endDate && <div><span className="text-gray-500">To:</span> {addr.endDate}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* Fallback for legacy flat field data */
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <InfoItem label="Prev Street" value={appData.prevStreet} isEditing={isEditing} onChange={v => handleDataChange('prevStreet', v)} />
                                <div className="grid grid-cols-3 gap-4">
                                    <InfoItem label="Prev City" value={appData.prevCity} isEditing={isEditing} onChange={v => handleDataChange('prevCity', v)} />
                                    <InfoItem label="Prev State" value={appData.prevState} isEditing={isEditing} onChange={v => handleDataChange('prevState', v)} />
                                    <InfoItem label="Prev Zip" value={appData.prevZip} isEditing={isEditing} onChange={v => handleDataChange('prevZip', v)} />
                                </div>
                            </div>
                        )}
                    </div>
                )}

            </InfoGrid>
        </Section>
    );
}