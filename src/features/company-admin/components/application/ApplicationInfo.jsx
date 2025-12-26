import React from 'react';
import { StatusHeader } from './sections/StatusHeader';
import { PersonalInfoSection } from './sections/PersonalInfoSection';
import { QualificationsSection } from './sections/QualificationsSection';
import { SupplementalSection } from './sections/SupplementalSection';

export function ApplicationInfo({ 
  appData, 
  fileUrls, 
  isEditing, 
  isUploading, 
  handleDataChange,
  companyId, 
  applicationId, 
  currentStatus, 
  handleStatusUpdate,
  handleDriverTypeUpdate, 
  isCompanyAdmin, 
  isSuperAdmin, 
  canEdit, 
  canEditAllFields = true, 
  onPhoneClick 
}) {

  if (!appData) return null;

  return (
    <div className="space-y-6">

      {/* 1. Top Bar: Status & Contact Actions */}
      <StatusHeader 
        appData={appData}
        currentStatus={currentStatus}
        handleStatusUpdate={handleStatusUpdate}
        canEdit={canEdit}
        isEditing={isEditing}
        onPhoneClick={onPhoneClick}
      />

      {/* 2. Personal Information (Name, Phone, Address) */}
      <PersonalInfoSection 
        appData={appData}
        isEditing={isEditing}
        handleDataChange={handleDataChange}
        canEditAllFields={canEditAllFields}
        onPhoneClick={onPhoneClick}
      />

      {/* 3. Qualifications (Experience, CDL, Source) */}
      <QualificationsSection 
        appData={appData}
        isEditing={isEditing}
        handleDataChange={handleDataChange}
        canEditAllFields={canEditAllFields}
      />

      {/* 4. Bottom Section (Questions, History, Signature) */}
      <SupplementalSection 
        appData={appData}
      />

    </div>
  );
}