import React, { useState, useEffect } from 'react';
import { createNewCompany } from '@features/companies/services/companyService';
import { Plus, UserPlus, Save, Loader2, CreditCard, Shield, Crown, Truck, Globe, X } from 'lucide-react';

function Card({ title, icon, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden ${className}`}>
      <div className="p-5 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-700 flex items-center gap-3">
          {icon}
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FormField({ id, label, type = 'text', required = false, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        id={id}
        name={id}
        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
        required={required}
        {...props}
      />
    </div>
  );
}

export function CreateView({ onDataUpdate, setActiveView }) {
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    companyName: '',
    appSlug: '', // NEW: Slug
    mcNumber: '', // NEW: MC
    dotNumber: '', // NEW: DOT
    email: '', 
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    planType: 'free'
  });

  const [createAdmin, setCreateAdmin] = useState(true);
  const [adminData, setAdminData] = useState({
      name: '',
      email: '',
      password: '',
      role: 'company_admin' // NEW: Role Selector
  });

  // Auto-generate slug from name
  useEffect(() => {
      if (formData.companyName && !formData.appSlug) {
          const slug = formData.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
          setFormData(prev => ({ ...prev, appSlug: slug }));
      }
  }, [formData.companyName]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAdminChange = (e) => {
      setAdminData({ ...adminData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const calculatedQuota = formData.planType === 'paid' ? 200 : 50;

      const payload = {
          ...formData,
          dailyQuota: calculatedQuota,
          adminUser: createAdmin ? {
              name: adminData.name,
              email: adminData.email,
              password: adminData.password,
              role: adminData.role // Pass selected role
          } : null
      };

      await createNewCompany(payload);
      alert('Company created successfully!');

      // Reset
      setFormData({ 
          companyName: '', appSlug: '', mcNumber: '', dotNumber: '',
          email: '', phone: '', address: '', city: '', state: '', zip: '',
          planType: 'free' 
      });
      setAdminData({ name: '', email: '', password: '', role: 'company_admin' });

      if (onDataUpdate) onDataUpdate();
      // Optional: Redirect to list after success
      // if (setActiveView) setActiveView('companies');

    } catch (error) {
      console.error("Error creating company:", error);
      alert(`Failed to create company: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-10">
      <header className="flex justify-between items-start">
        <div>
            <h1 className="text-3xl font-bold text-gray-900">Create New Company</h1>
            <p className="text-gray-500 mt-2">Onboard a new carrier and set up their portal.</p>
        </div>
        {/* NEW: Cancel Button logic */}
        {setActiveView && (
            <button 
                onClick={() => setActiveView('companies')}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg flex items-center gap-2"
            >
                <X size={20} /> Cancel
            </button>
        )}
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* SECTION 1: COMPANY DETAILS */}
        <Card title="Company Details" icon={<Plus className="text-blue-600" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Plan Selection */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
                <div 
                    onClick={() => setFormData({...formData, planType: 'free'})}
                    className={`p-4 border-2 rounded-xl cursor-pointer transition-all flex items-center gap-3 ${
                        formData.planType === 'free' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                    }`}
                >
                    <div className="p-2 bg-white rounded-full shadow-sm text-gray-600"><Shield size={20}/></div>
                    <div>
                        <h3 className="font-bold text-gray-800">Free Plan</h3>
                        <p className="text-xs text-gray-500">50 Leads Daily Limit</p>
                    </div>
                </div>

                <div 
                    onClick={() => setFormData({...formData, planType: 'paid'})}
                    className={`p-4 border-2 rounded-xl cursor-pointer transition-all flex items-center gap-3 ${
                        formData.planType === 'paid' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 hover:border-yellow-200'
                    }`}
                >
                    <div className="p-2 bg-white rounded-full shadow-sm text-yellow-600"><Crown size={20}/></div>
                    <div>
                        <h3 className="font-bold text-gray-800">Pro Plan</h3>
                        <p className="text-xs text-gray-500">200 Leads Daily Limit</p>
                    </div>
                </div>
            </div>

            <div className="md:col-span-2">
              <FormField 
                id="companyName" label="Company Name" placeholder="e.g. Speedy Transport LLC"
                value={formData.companyName} onChange={handleChange} required
              />
            </div>

            {/* NEW: SLUG & TRUCKING INFO */}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="md:col-span-3 mb-2 flex items-center gap-2 text-blue-800 font-bold text-sm">
                    <Truck size={16} /> Carrier Information
                </div>

                <FormField 
                    id="appSlug" label="URL Slug (myapp.com/apply/...)" 
                    value={formData.appSlug} onChange={handleChange} required
                    placeholder="speedy-transport"
                />
                <FormField 
                    id="mcNumber" label="MC Number" 
                    value={formData.mcNumber} onChange={handleChange} 
                    placeholder="MC-123456"
                />
                <FormField 
                    id="dotNumber" label="DOT Number" 
                    value={formData.dotNumber} onChange={handleChange} 
                    placeholder="1234567"
                />
            </div>

            <FormField 
              id="email" label="Primary Contact Email" type="email" 
              value={formData.email} onChange={handleChange} required
            />
            <FormField 
              id="phone" label="Phone Number" type="tel" 
              value={formData.phone} onChange={handleChange}
            />

            <div className="md:col-span-2 pt-4 border-t border-gray-100 mt-2">
                <h3 className="text-sm font-bold text-gray-900 mb-4">Physical Address</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3">
                        <FormField id="address" label="Street Address" value={formData.address} onChange={handleChange} />
                    </div>
                    <FormField id="city" label="City" value={formData.city} onChange={handleChange} />
                    <FormField id="state" label="State" value={formData.state} onChange={handleChange} />
                    <FormField id="zip" label="Zip Code" value={formData.zip} onChange={handleChange} />
                </div>
            </div>
          </div>
        </Card>

        {/* SECTION 2: ADMIN USER CREATION */}
        <Card title="Initial User Setup" icon={<UserPlus className="text-purple-600" />}>
            <div className="mb-6 flex items-center gap-2">
                <input 
                    type="checkbox" id="createAdmin" 
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    checked={createAdmin} onChange={(e) => setCreateAdmin(e.target.checked)}
                />
                <label htmlFor="createAdmin" className="text-gray-900 font-medium">
                    Create a portal user for this company now
                </label>
            </div>

            {createAdmin && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">

                    <FormField 
                        id="name" label="User Full Name" 
                        value={adminData.name} onChange={handleAdminChange} required={createAdmin}
                    />
                    <FormField 
                        id="email" label="Login Email" type="email"
                        value={adminData.email} onChange={handleAdminChange} required={createAdmin}
                    />

                    {/* NEW: Role Selector */}
                    <div>
                        <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">User Role</label>
                        <select
                            id="role" name="role"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                            value={adminData.role} onChange={handleAdminChange}
                        >
                            <option value="company_admin">Company Admin (Full Access)</option>
                            <option value="hr_user">HR User (Restricted)</option>
                        </select>
                    </div>

                    <div>
                        <FormField 
                            id="password" label="Temporary Password" type="text"
                            value={adminData.password} onChange={handleAdminChange} required={createAdmin} minLength={6}
                        />
                        <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters.</p>
                    </div>
                </div>
            )}
        </Card>

        <div className="flex justify-end pt-4 gap-4">
            {/* CANCEL BUTTON (Visible at bottom too) */}
            {setActiveView && (
                <button
                    type="button"
                    onClick={() => setActiveView('companies')}
                    className="px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-all"
                >
                    Cancel
                </button>
            )}

            <button
                type="submit"
                disabled={loading}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 disabled:opacity-50 text-lg"
            >
                {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                Create Company & User
            </button>
        </div>

      </form>
    </div>
  );
}