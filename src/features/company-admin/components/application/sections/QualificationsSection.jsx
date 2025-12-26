// src/components/admin/sections/QualificationsSection.jsx
import React from 'react';
import { Section, InfoGrid, InfoItem } from '../ApplicationUI.jsx';
import { CheckCircle, XCircle, AlertCircle, AlertTriangle, Database } from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';

const DRIVER_POSITIONS = ["Company Driver", "Lease Operator", "Owner Operator", "Team Driver"];
const DRIVER_TYPES = ["Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck", "Car Hauler", "Step Deck", "Lowboy", "Conestoga", "Intermodal", "Power Only", "Hotshot"];

export function QualificationsSection({ 
  appData, 
  isEditing, 
  handleDataChange, 
  canEditAllFields 
}) {

  // Helper: Status Badge
  const renderBooleanStatus = (val, labelTrue, labelFalse, isAlert = false) => {
      // Handle the string 'agreed' which is used by the checkbox in StepPage9
      const isTrue = String(val).toLowerCase() === 'yes' || val === true || val === 'agreed';

      if (val === null || val === undefined || val === '') {
          return (
            <div className="flex items-center gap-2">
                <AlertCircle className="text-gray-300" size={20}/>
                <span className="text-gray-400 italic">Not Specified</span>
            </div>
          );
      }

      if (isAlert) {
          return (
              <div className="flex items-center gap-2">
                  {isTrue ? <AlertTriangle className="text-red-600" size={20}/> : <CheckCircle className="text-green-500" size={20}/>}
                  <span className={isTrue ? "text-red-700 font-bold" : "text-green-700 font-medium"}>
                      {isTrue ? labelTrue : labelFalse}
                  </span>
              </div>
          );
      }

      return (
          <div className="flex items-center gap-2">
              {isTrue ? <CheckCircle className="text-green-500" size={20}/> : <XCircle className="text-red-500" size={20}/>}
              <span className={isTrue ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                  {isTrue ? labelTrue : labelFalse}
              </span>
          </div>
      );
  };

  const handleTypeToggle = (type) => {
      let currentTypes = appData.driverType || [];
      if (!Array.isArray(currentTypes)) currentTypes = [currentTypes];

      const newTypes = currentTypes.includes(type) 
          ? currentTypes.filter(t => t !== type)
          : [...currentTypes, type];

      handleDataChange('driverType', newTypes);
  };

  const getSourceLabel = () => {
      if (appData.isPlatformLead || appData.sourceType === 'Added by Safehaul') {
          return 'SafeHaul Network Leads';
      }
      return appData.source || 'App Signup';
  };

  if (canEditAllFields) {
    return (
        <Section title="Position & Qualifications (DOT)">
           <InfoGrid>
              <InfoItem 
                  label="Position Applied For" 
                  value={appData.positionApplyingTo} 
                  isEditing={isEditing} 
                  onChange={v => handleDataChange('positionApplyingTo', v)} 
                  options={DRIVER_POSITIONS} 
              />

              <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Driver Types</label>
                  {isEditing ? (
                      <div className="flex flex-wrap gap-2">
                          {DRIVER_TYPES.map(type => {
                              const isSelected = (appData.driverType || []).includes(type);
                              return (
                                  <button
                                      key={type}
                                      onClick={() => handleTypeToggle(type)}
                                      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                                          isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                      }`}
                                  >
                                      {type}
                                  </button>
                              );
                          })}
                      </div>
                  ) : (
                      <p className="text-lg font-medium text-gray-900">
                          {Array.isArray(appData.driverType) ? appData.driverType.join(', ') : (appData.driverType || 'Not Specified')}
                      </p>
                  )}
              </div>

              <InfoItem label="Experience" value={appData['experience-years'] || appData.experience} isEditing={isEditing} onChange={v => handleDataChange('experience-years', v)} />

              <div className="col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Legal to Work (US)</label>
                  {isEditing ? (
                      <select className="w-full p-2 border border-gray-300 rounded" value={appData['legal-work'] || ''} onChange={(e) => handleDataChange('legal-work', e.target.value)}>
                          <option value="">Select...</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                      </select>
                  ) : renderBooleanStatus(appData['legal-work'], 'Authorized', 'Not Authorized')}
              </div>

              <div className="col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">English Fluency</label>
                  {isEditing ? (
                      <select className="w-full p-2 border border-gray-300 rounded" value={appData['english-fluency'] || ''} onChange={(e) => handleDataChange('english-fluency', e.target.value)}>
                          <option value="">Select...</option>
                          <option value="yes">Fluent</option>
                          <option value="no">Not Fluent</option>
                      </select>
                  ) : renderBooleanStatus(appData['english-fluency'], 'Fluent', 'Not Fluent')}
              </div>

              {/* --- SAFETY SENSITIVE --- */}
              <div className="col-span-1 pt-4 md:pt-0">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Drug/Alcohol History</label>
                   {isEditing ? (
                      <select className="w-full p-2 border border-gray-300 rounded" value={appData['drug-test-positive'] || ''} onChange={(e) => handleDataChange('drug-test-positive', e.target.value)}>
                          <option value="">Select...</option>
                          <option value="yes">Positive/Refusal</option>
                          <option value="no">Clean Record</option>
                      </select>
                  ) : renderBooleanStatus(appData['drug-test-positive'], 'Positive/Refusal Found', 'Clean Record', true)}

                  {appData['drug-test-positive'] === 'yes' && (
                      <p className="text-xs text-red-600 mt-1 bg-red-50 p-2 rounded">
                          Explanation: {appData['drug-test-explanation'] || 'None provided'}
                      </p>
                  )}
              </div>

              {/* --- NEW: CLEARINGHOUSE --- */}
              <div className="col-span-1 pt-4 md:pt-0">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                      <Database size={12} className="text-blue-500" /> Clearinghouse Consent
                  </label>
                  {/* "agreed" comes from form data checkbox value */}
                  {renderBooleanStatus(appData['agree-clearinghouse'], 'Consent Granted', 'Not Granted')}
              </div>

           </InfoGrid>

           <div className="mt-6 pt-4 border-t border-gray-100">
               <h4 className="text-sm font-bold text-gray-700 mb-3">Commercial Driver's License</h4>
               <InfoGrid>
                   <InfoItem label="License Number" value={appData.cdlNumber} isEditing={isEditing} onChange={v => handleDataChange('cdlNumber', v)} />
                   <InfoItem label="State" value={appData.cdlState} isEditing={isEditing} onChange={v => handleDataChange('cdlState', v)} />
                   <InfoItem label="Class" value={appData.cdlClass} isEditing={isEditing} onChange={v => handleDataChange('cdlClass', v)} />
                   <InfoItem label="Expiration" value={appData.cdlExpiration} isEditing={isEditing} onChange={v => handleDataChange('cdlExpiration', v)} />
                   <InfoItem label="Endorsements" value={appData.endorsements} isEditing={isEditing} onChange={v => handleDataChange('endorsements', v)} />
               </InfoGrid>
           </div>
        </Section>
    );
  }

  // View Only Mode
  return (
    <Section title="Position & Qualifications">
      <InfoGrid>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Position Applied For</label>
          <p className="text-lg font-medium text-gray-900">{appData.positionApplyingTo || 'Not Specified'}</p>
        </div>

        <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Source</label>
            <p className="text-lg font-medium text-gray-900">{getSourceLabel()}</p>
        </div>

        <div className="col-span-1 md:col-span-2">
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Driver Types</label>
          <p className="text-lg font-medium text-gray-900">
            {Array.isArray(appData.driverType) ? appData.driverType.join(', ') : (appData.driverType || 'Not Specified')}
          </p>
        </div>

        <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Safety Record</label>
            {renderBooleanStatus(appData['drug-test-positive'], 'Issues Reported', 'Clean', true)}
        </div>

        <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Clearinghouse</label>
            {renderBooleanStatus(appData['agree-clearinghouse'], 'Consent Granted', 'Not Granted')}
        </div>
      </InfoGrid>
    </Section>
  );
}