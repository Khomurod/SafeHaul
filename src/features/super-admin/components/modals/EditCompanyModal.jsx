import React, { useState, useEffect } from 'react';
import { updateCompany } from '@features/companies/services/companyService';
import { uploadCompanyLogo } from '@lib/firebase';
import { X, CreditCard } from 'lucide-react';

function FormField({ id, label, ...props }) {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input id={id} className="w-full p-3 border border-gray-300 rounded-lg" {...props} />
      </div>
    );
}

export function EditCompanyModal({ companyDoc, onClose, onSave }) {
  const [formData, setFormData] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [originalSlug, setOriginalSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  useEffect(() => {
    if (companyDoc) {
      const company = companyDoc.data();
      setFormData({
        companyName: company.companyName || '',
        appSlug: company.appSlug || '',
        phone: company.contact?.phone || '',
        email: company.contact?.email || '',
        street: company.address?.street || '',
        city: company.address?.city || '',
        state: company.address?.state || '',
        zip: company.address?.zip || '',
        mcNumber: company.legal?.mcNumber || '',
        dotNumber: company.legal?.dotNumber || '',
        companyLogoUrl: company.companyLogoUrl || '',
        planType: company.planType || 'free', // Default to Free
      });
      setOriginalSlug(company.appSlug || '');
    }
  }, [companyDoc]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setLogoFile(e.target.files[0]);
    } else {
      setLogoFile(null);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage('');
    setMessageType('');

    let newLogoUrl = formData.companyLogoUrl;
    try {
      if (logoFile) {
        setMessage('Uploading logo...');
        newLogoUrl = await uploadCompanyLogo(companyDoc.id, logoFile);
      }

      const companyData = {
        companyName: formData.companyName,
        appSlug: formData.appSlug.toLowerCase().trim(),
        address: {
          street: formData.street, city: formData.city,
          state: formData.state.toUpperCase(), zip: formData.zip,
        },
        contact: { phone: formData.phone, email: formData.email },
        legal: { mcNumber: formData.mcNumber, dotNumber: formData.dotNumber },
        companyLogoUrl: newLogoUrl,
        planType: formData.planType, // Save the plan type!
      };

      setMessage('Saving company data...');
      await updateCompany(companyDoc.id, companyData, originalSlug);

      setMessage('Successfully saved!');
      setMessageType('success');
      await onSave();
      setTimeout(onClose, 1500);
    } catch (error) {
      console.error("Error updating company:", error);
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="edit-company-modal" className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200">
        <header className="p-5 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Edit Company</h2>
          <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="p-5 overflow-y-auto space-y-6">

          {/* --- Subscription Plan Section --- */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <div className="flex items-center gap-2 mb-3 text-blue-800 font-bold">
               <CreditCard size={20} /> Subscription Plan
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all ${formData.planType === 'free' ? 'bg-white border-blue-500 ring-2 ring-blue-200' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
                    <span className="text-sm font-medium text-gray-700">Free Plan<br/><span className="text-xs text-gray-500">50 Leads/Day</span></span>
                    <input type="radio" name="planType" id="planType" value="free" checked={formData.planType === 'free'} onChange={(e) => setFormData({...formData, planType: 'free'})} className="h-4 w-4 text-blue-600" />
                </label>

                <label className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all ${formData.planType === 'paid' ? 'bg-white border-green-500 ring-2 ring-green-200' : 'bg-white border-gray-200 hover:border-green-300'}`}>
                    <span className="text-sm font-medium text-gray-700">Paid Plan<br/><span className="text-xs text-gray-500">200 Leads/Day</span></span>
                    <input type="radio" name="planType" id="planType" value="paid" checked={formData.planType === 'paid'} onChange={(e) => setFormData({...formData, planType: 'paid'})} className="h-4 w-4 text-green-600" />
                </label>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField id="companyName" label="Company Name" required value={formData.companyName} onChange={handleChange} />
            <FormField id="appSlug" label="Unique URL Slug" required value={formData.appSlug} onChange={handleChange} />
          </div>

          <div>
            <label htmlFor="logo" className="block text-sm font-medium text-gray-700 mb-1">Company Logo</label>
            <div className="flex items-center gap-4">
              {formData.companyLogoUrl && (
                <img 
                  src={formData.companyLogoUrl} 
                  alt="Current Logo" 
                  className="w-16 h-16 object-contain rounded-lg border border-gray-200 p-1 bg-gray-50"
                />
              )}
              <input 
                type="file" 
                id="logo" 
                className="w-full p-3 border border-gray-300 rounded-lg" 
                onChange={handleFileChange} 
                accept="image/png, image/jpeg" 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField id="phone" label="Contact Phone" type="tel" value={formData.phone} onChange={handleChange} />
            <FormField id="email" label="Contact Email" type="email" value={formData.email} onChange={handleChange} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField id="city" label="City" value={formData.city} onChange={handleChange} />
            <FormField id="state" label="State" value={formData.state} onChange={handleChange} maxLength="2" />
            <FormField id="zip" label="ZIP Code" value={formData.zip} onChange={handleChange} />
          </div>
        </div>

        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center rounded-b-xl">
          <p className={`text-sm ${messageType === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
          <div className="flex gap-3">
            <button className="px-5 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all" onClick={onClose}>
              Cancel
            </button>
            <button className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md" onClick={handleSave} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}