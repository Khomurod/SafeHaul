import React from 'react';
import { Loader2, User, FileText, Truck, AlertTriangle, Briefcase, ArrowLeft, Save } from 'lucide-react';
import { useDriverProfile } from '../hooks/useDriverProfile';

// Import Steps with correct names
import Step1_Contact from './application/steps/Step1_Contact';
import Step2_Qualifications from './application/steps/Step2_Qualifications';
import Step3_License from './application/steps/Step3_License';
import Step4_Violations from './application/steps/Step4_Violations';
import Step5_Accidents from './application/steps/Step5_Accidents';
import Step6_Employment from './application/steps/Step6_Employment';
import Step7_General from './application/steps/Step7_General';

export function DriverProfile() {
  const { 
      formData, 
      updateFormData, 
      loading, 
      saving, 
      handleSave, 
      navigate 
  } = useDriverProfile();

  // Mock handler for file inputs in edit mode
  const handleMockUpload = (name, file) => {
      alert(`File upload for "${name}" will be available soon. Please use the main application form to upload documents.`);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* Hide internal step headers to create a seamless profile view */}
        <style>{`
          .profile-editor-section h3.text-xl { display: none !important; }
          .profile-editor-section legend { display: none !important; }
          .profile-editor-section .form-step { padding-top: 0 !important; }
          .profile-editor-section .flex.justify-between.pt-6 { display: none !important; } 
          .profile-editor-section .flex.flex-col.sm\\:flex-row.sm\\:justify-end { display: none !important; }
          .profile-editor-section fieldset { border: none !important; padding: 0 !important; }
        `}</style>

        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-white sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/driver/dashboard')} className="text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Edit Master Profile</h1>
          </div>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="hidden sm:flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md"
          >
            {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            Save Changes
          </button>
        </div>

        <div className="p-6 sm:p-10 space-y-12">

           {/* --- DRIVER STATUS SECTION --- */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <Truck size={20} className="text-blue-600" /> Driver Status
             </h2>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">I am a...</label>
                  <select
                    value={formData.driverType} 
                    onChange={(e) => updateFormData('driverType', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="">-- Select Type --</option>
                    <option value="companyDriverSolo">Company Driver (Solo)</option>
                    <option value="companyDriverTeam">Company Driver (Team)</option>
                    <option value="ownerOperatorSolo">Owner Operator (Solo)</option>
                    <option value="ownerOperatorTeam">Owner Operator (Team)</option>
                    <option value="leaseOperatorSolo">Lease Operator (Solo)</option>
                    <option value="leaseOperatorTeam">Lease Operator (Team)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Availability Status</label>
                  <select 
                    value={formData.availability} 
                    onChange={(e) => updateFormData('availability', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="actively_looking">Actively Looking</option>
                    <option value="reviewing_offers">Reviewing Offers</option>
                    <option value="not_available">Working / Not Available</option>
                  </select>
                </div>

                {(formData.driverType?.toLowerCase().includes('owner') || formData.driverType?.toLowerCase().includes('lease')) && (
                   <div className="md:col-span-2">
                     <label className="block text-sm font-medium text-gray-700 mb-1">Truck Info (Year, Make, Model)</label>
                     <input 
                       type="text" 
                       value={formData.truckType} 
                       onChange={(e) => updateFormData('truckType', e.target.value)}
                       className="w-full p-3 border border-gray-300 rounded-lg" 
                       placeholder="e.g., 2020 Peterbilt 579"
                     />
                   </div>
                )}
             </div>
           </div>

           {/* SECTION 1 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <User size={20} className="text-blue-600" /> Personal Information
             </h2>
             <div className="profile-editor-section">
                <Step1_Contact 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  onNavigate={() => {}} 
                  onPartialSubmit={() => {}}
               />
             </div>
           </div>

           {/* SECTION 2 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <FileText size={20} className="text-blue-600" /> Qualifications
             </h2>
             <div className="profile-editor-section">
               <Step2_Qualifications 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  onNavigate={() => {}} 
               />
             </div>
           </div>

           {/* SECTION 3 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <Truck size={20} className="text-blue-600" /> License Information
             </h2>
             <div className="profile-editor-section">
               <Step3_License 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  handleFileUpload={handleMockUpload}
                  onNavigate={() => {}} 
               />
             </div>
           </div>

           {/* SECTION 4 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <AlertTriangle size={20} className="text-blue-600" /> Violations & Convictions
             </h2>
             <div className="profile-editor-section">
               <Step4_Violations 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  handleFileUpload={handleMockUpload}
                  onNavigate={() => {}} 
               />
             </div>
           </div>

           {/* SECTION 5 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <AlertTriangle size={20} className="text-blue-600" /> Accident History
             </h2>
             <div className="profile-editor-section">
               <Step5_Accidents 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  onNavigate={() => {}} 
               />
             </div>
           </div>

           {/* SECTION 6 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <Briefcase size={20} className="text-blue-600" /> Employment History
             </h2>
             <div className="profile-editor-section">
               <Step6_Employment 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  onNavigate={() => {}} 
               />
             </div>
           </div>

           {/* SECTION 7 */}
           <div className="bg-white">
             <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
               <FileText size={20} className="text-blue-600" /> Additional Questions
             </h2>
             <div className="profile-editor-section">
               <Step7_General 
                  formData={formData} 
                  updateFormData={updateFormData} 
                  onNavigate={() => {}} 
               />
             </div>
           </div>

        </div>

        {/* BOTTOM SAVE BAR */}
        <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end sticky bottom-0 z-20">
           <button 
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            Save All Changes
          </button>
        </div>

      </div>
    </div>
  );
}