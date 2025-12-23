import React, { useState, useEffect } from 'react';
import { createNewCompany, loadCompanies } from '@features/companies/services/companyService';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Plus, UserPlus, Save, Loader2, Shield, Crown, Truck, Briefcase, User, X } from 'lucide-react';

// --- UI COMPONENTS ---
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

// --- MAIN COMPONENT ---
export function CreateView({ onDataUpdate, setActiveView }) {
  const [activeTab, setActiveTab] = useState('company'); // 'company' or 'user'
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);

  // --- STATE: CREATE COMPANY ---
  const [companyForm, setCompanyForm] = useState({
    companyName: '', appSlug: '', mcNumber: '', dotNumber: '',
    email: '', phone: '', address: '', city: '', state: '', zip: '',
    planType: 'free'
  });
  const [withAdmin, setWithAdmin] = useState(true);
  const [companyAdminData, setCompanyAdminData] = useState({
      name: '', email: '', password: '', role: 'company_admin'
  });

  // --- STATE: CREATE USER ---
  const [userForm, setUserForm] = useState({
      fullName: '', email: '', password: '', 
      companyId: '', role: 'hr_user'
  });

  // Load companies for the "New User" dropdown
  useEffect(() => {
      loadCompanies().then(snap => {
          const list = snap.docs.map(d => ({ id: d.id, name: d.data().companyName }));
          setCompanies(list);
      }).catch(console.error);
  }, []);

  // Auto-generate slug
  useEffect(() => {
      if (companyForm.companyName && !companyForm.appSlug) {
          const slug = companyForm.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
          setCompanyForm(prev => ({ ...prev, appSlug: slug }));
      }
  }, [companyForm.companyName]);

  // --- HANDLERS ---

  const handleCompanySubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const calculatedQuota = companyForm.planType === 'paid' ? 200 : 50;

      // 1. Create Company Doc
      const newCompanyRef = await createNewCompany({
          ...companyForm,
          dailyQuota: calculatedQuota,
          createdAt: new Date()
      });

      console.log("Company created with ID:", newCompanyRef.id);

      // 2. Create Admin User (If selected)
      if (withAdmin) {
          const createFn = httpsCallable(functions, 'createPortalUser');
          await createFn({
              fullName: companyAdminData.name,
              email: companyAdminData.email,
              password: companyAdminData.password,
              companyId: newCompanyRef.id,
              role: companyAdminData.role
          });
          console.log("Admin user created successfully.");
      }

      alert('Company (and Admin) created successfully!');
      if (onDataUpdate) onDataUpdate();
      setCompanyForm({ companyName: '', appSlug: '', mcNumber: '', dotNumber: '', email: '', phone: '', address: '', city: '', state: '', zip: '', planType: 'free' });
      setCompanyAdminData({ name: '', email: '', password: '', role: 'company_admin' });

    } catch (error) {
      console.error("Creation Error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUserSubmit = async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
          const createFn = httpsCallable(functions, 'createPortalUser');
          const result = await createFn({
              fullName: userForm.fullName,
              email: userForm.email,
              password: userForm.password,
              companyId: userForm.companyId,
              role: userForm.role
          });

          if (result.data?.error) throw new Error(result.data.error);

          alert('User created successfully!');
          setUserForm({ fullName: '', email: '', password: '', companyId: '', role: 'hr_user' });
          if (onDataUpdate) onDataUpdate();

      } catch (error) {
          console.error("User Creation Error:", error);
          alert(`Failed: ${error.message}`);
      } finally {
          setLoading(false);
      }
  };

  return (
    <div className="max-w-4xl mx-auto pb-10">

      {/* HEADER & TABS */}
      <div className="mb-8">
          <header className="flex justify-between items-center mb-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Create New Entity</h1>
                <p className="text-gray-500 mt-1">Add new companies or team members to the system.</p>
            </div>
            {setActiveView && (
                <button onClick={() => setActiveView('companies')} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg flex items-center gap-2">
                    <X size={20} /> Close
                </button>
            )}
          </header>

          <div className="flex gap-4 border-b border-gray-200">
              <button
                  onClick={() => setActiveTab('company')}
                  className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'company' ? 'border-b-4 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  <Briefcase size={18} /> New Company
              </button>
              <button
                  onClick={() => setActiveTab('user')}
                  className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'user' ? 'border-b-4 border-purple-600 text-purple-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  <UserPlus size={18} /> New User Only
              </button>
          </div>
      </div>

      {/* --- TAB 1: CREATE COMPANY --- */}
      {activeTab === 'company' && (
          <form onSubmit={handleCompanySubmit} className="space-y-6 animate-in fade-in slide-in-from-left-4">

            <Card title="Company Details" icon={<Briefcase className="text-blue-600" />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Plan Selection */}
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
                    <div onClick={() => setCompanyForm({...companyForm, planType: 'free'})} className={`p-4 border-2 rounded-xl cursor-pointer flex items-center gap-3 ${companyForm.planType === 'free' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                        <div className="p-2 bg-white rounded-full shadow-sm text-gray-600"><Shield size={20}/></div>
                        <div><h3 className="font-bold text-gray-800">Free Plan</h3><p className="text-xs text-gray-500">50 Leads Daily Limit</p></div>
                    </div>
                    <div onClick={() => setCompanyForm({...companyForm, planType: 'paid'})} className={`p-4 border-2 rounded-xl cursor-pointer flex items-center gap-3 ${companyForm.planType === 'paid' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'}`}>
                        <div className="p-2 bg-white rounded-full shadow-sm text-yellow-600"><Crown size={20}/></div>
                        <div><h3 className="font-bold text-gray-800">Pro Plan</h3><p className="text-xs text-gray-500">200 Leads Daily Limit</p></div>
                    </div>
                </div>

                <div className="md:col-span-2">
                  <FormField id="companyName" label="Company Name" value={companyForm.companyName} onChange={e => setCompanyForm({...companyForm, companyName: e.target.value})} required />
                </div>

                {/* Slug & DOT */}
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="md:col-span-3 mb-1 flex items-center gap-2 text-blue-800 font-bold text-sm"><Truck size={16} /> Carrier Information</div>
                    <FormField id="appSlug" label="URL Slug" value={companyForm.appSlug} onChange={e => setCompanyForm({...companyForm, appSlug: e.target.value})} required />
                    <FormField id="mcNumber" label="MC Number" value={companyForm.mcNumber} onChange={e => setCompanyForm({...companyForm, mcNumber: e.target.value})} />
                    <FormField id="dotNumber" label="DOT Number" value={companyForm.dotNumber} onChange={e => setCompanyForm({...companyForm, dotNumber: e.target.value})} />
                </div>

                <FormField id="email" label="Contact Email" type="email" value={companyForm.email} onChange={e => setCompanyForm({...companyForm, email: e.target.value})} required />
                <FormField id="phone" label="Phone" type="tel" value={companyForm.phone} onChange={e => setCompanyForm({...companyForm, phone: e.target.value})} />

                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                    <div className="md:col-span-3"><FormField id="address" label="Street Address" value={companyForm.address} onChange={e => setCompanyForm({...companyForm, address: e.target.value})} /></div>
                    <FormField id="city" label="City" value={companyForm.city} onChange={e => setCompanyForm({...companyForm, city: e.target.value})} />
                    <FormField id="state" label="State" value={companyForm.state} onChange={e => setCompanyForm({...companyForm, state: e.target.value})} />
                    <FormField id="zip" label="Zip" value={companyForm.zip} onChange={e => setCompanyForm({...companyForm, zip: e.target.value})} />
                </div>
              </div>
            </Card>

            <Card title="Initial User Setup" icon={<UserPlus className="text-purple-600" />}>
                <div className="mb-6 flex items-center gap-2">
                    <input type="checkbox" id="withAdmin" className="w-5 h-5 text-blue-600 rounded" checked={withAdmin} onChange={(e) => setWithAdmin(e.target.checked)} />
                    <label htmlFor="withAdmin" className="text-gray-900 font-medium">Create a portal user for this company now</label>
                </div>

                {withAdmin && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField id="adminName" label="Full Name" value={companyAdminData.name} onChange={e => setCompanyAdminData({...companyAdminData, name: e.target.value})} required={withAdmin} />
                        <FormField id="adminEmail" label="Login Email" type="email" value={companyAdminData.email} onChange={e => setCompanyAdminData({...companyAdminData, email: e.target.value})} required={withAdmin} />
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                            <select className="w-full p-3 border rounded-lg" value={companyAdminData.role} onChange={e => setCompanyAdminData({...companyAdminData, role: e.target.value})}>
                                <option value="company_admin">Company Admin</option>
                                <option value="hr_user">HR User</option>
                            </select>
                        </div>
                        <FormField id="adminPass" label="Password" value={companyAdminData.password} onChange={e => setCompanyAdminData({...companyAdminData, password: e.target.value})} required={withAdmin} minLength={6} />
                    </div>
                )}
            </Card>

            <div className="flex justify-end gap-4">
                <button type="submit" disabled={loading} className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 disabled:opacity-50">
                    {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />} Create Company
                </button>
            </div>
          </form>
      )}

      {/* --- TAB 2: CREATE USER --- */}
      {activeTab === 'user' && (
          <form onSubmit={handleUserSubmit} className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <Card title="Create Standalone User" icon={<User className="text-purple-600" />}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField id="newUserName" label="Full Name" value={userForm.fullName} onChange={e => setUserForm({...userForm, fullName: e.target.value})} required />
                      <FormField id="newUserEmail" label="Email Address" type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} required />

                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Company</label>
                          <select className="w-full p-3 border border-gray-300 rounded-lg" required value={userForm.companyId} onChange={e => setUserForm({...userForm, companyId: e.target.value})}>
                              <option value="">-- Select Company --</option>
                              {companies.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                          </select>
                      </div>

                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                          <select className="w-full p-3 border border-gray-300 rounded-lg" value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})}>
                              <option value="hr_user">HR User</option>
                              <option value="company_admin">Company Admin</option>
                              <option value="super_admin">Super Admin (Careful!)</option>
                          </select>
                      </div>

                      <div className="md:col-span-2">
                          <FormField id="newUserPass" label="Password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required minLength={6} />
                      </div>
                  </div>
              </Card>

              <div className="flex justify-end gap-4">
                  <button type="submit" disabled={loading} className="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 disabled:opacity-50">
                      {loading ? <Loader2 className="animate-spin" /> : <UserPlus size={20} />} Create User
                  </button>
              </div>
          </form>
      )}
    </div>
  );
}