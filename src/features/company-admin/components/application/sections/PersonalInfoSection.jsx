import React from 'react';
import { Phone, AlertCircle } from 'lucide-react';
import { Section, InfoGrid, InfoItem } from '../ApplicationUI';
import { formatPhoneNumber, getFieldValue } from '@shared/utils/helpers';

export function PersonalInfoSection({ 
  appData, 
  isEditing, 
  handleDataChange, 
  canEditAllFields, 
  onPhoneClick 
}) {

  if (canEditAllFields) {
    return (
        <Section title="Personal Information">
          <InfoGrid>
            <InfoItem label="First Name" value={appData.firstName} isEditing={isEditing} onChange={v => handleDataChange('firstName', v)} />
            <InfoItem label="Middle Name" value={appData.middleName} isEditing={isEditing} onChange={v => handleDataChange('middleName', v)} />
            <InfoItem label="Last Name" value={appData.lastName} isEditing={isEditing} onChange={v => handleDataChange('lastName', v)} />

            <div className="col-span-1">
               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
               {isEditing ? (
                   <input 
                      className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                      value={appData.phone || ''} 
                      onChange={(e) => handleDataChange('phone', e.target.value)} 
                   />
               ) : (
                   onPhoneClick && appData.phone ? (
                      <button onClick={onPhoneClick} className="text-lg font-medium text-blue-600 hover:underline flex items-center gap-2 transition-colors">
                          <Phone size={16} className="fill-blue-100"/> {formatPhoneNumber(getFieldValue(appData.phone))}
                       </button>
                   ) : (
                      <p className="text-lg font-medium text-gray-900">{formatPhoneNumber(getFieldValue(appData.phone))}</p>
                   )
               )}
            </div>

            <InfoItem label="Email" value={appData.email} isEditing={isEditing} onChange={v => handleDataChange('email', v)} />
            <InfoItem label="DOB" value={appData.dob} isEditing={isEditing} onChange={v => handleDataChange('dob', v)} />
            <InfoItem label="SSN" value={appData.ssn} isEditing={isEditing} onChange={v => handleDataChange('ssn', v)} />
          </InfoGrid>

          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-4">
              <InfoItem label="Street" value={appData.street} isEditing={isEditing} onChange={v => handleDataChange('street', v)} />
              <InfoItem label="City" value={appData.city} isEditing={isEditing} onChange={v => handleDataChange('city', v)} />
              <InfoItem label="State" value={appData.state} isEditing={isEditing} onChange={v => handleDataChange('state', v)} />
              <InfoItem label="Zip" value={appData.zip} isEditing={isEditing} onChange={v => handleDataChange('zip', v)} />
          </div>
      </Section>
    );
  }

  // View Only Mode (for HR Users)
  return (
    <Section title="Personal Information">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={18} />
        <div className="text-sm text-blue-800">
          <p className="font-medium">View Only</p>
          <p className="text-blue-700">As an HR user, you can only edit the status of this application. Other information is view-only.</p>
        </div>
      </div>
      <InfoGrid className="mt-4 opacity-75">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">First Name</label>
          <p className="text-lg font-medium text-gray-900">{appData.firstName}</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Last Name</label>
          <p className="text-lg font-medium text-gray-900">{appData.lastName}</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
          <p className="text-lg font-medium text-gray-900">{formatPhoneNumber(getFieldValue(appData.phone))}</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
          <p className="text-lg font-medium text-gray-900">{appData.email}</p>
        </div>
      </InfoGrid>
    </Section>
  );
}