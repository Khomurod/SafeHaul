import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import {
    Building, User, CreditCard, CheckCircle,
    FileSignature, Blocks, ArrowLeft, Users, Mail, Facebook, Briefcase
} from 'lucide-react';

import { CompanyProfileTab } from './CompanyProfileTab';
import { TeamManagementTab } from './TeamManagementTab';
import { EmailSettingsTab } from './EmailSettingsTab';
import { PersonalProfileTab } from './PersonalProfileTab';
import { IntegrationsTab } from './IntegrationsTab';
import { JobPostingManager } from './hiring/JobPostingManager';
import { ManageTeamModal } from '@shared/components/modals';
import { UnderDevelopmentAnimation } from '@shared/components/admin/UnderDevelopmentAnimation';
import { ESignatureAnimation } from '@shared/components/admin/ESignatureAnimation';

const SidebarItem = ({ id, label, icon: Icon, activeTab, onClick }) => (
    <button
        onClick={() => onClick(id)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 text-left ${activeTab === id
            ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
    >
        <Icon size={18} className={activeTab === id ? "text-blue-600" : "text-gray-400"} />
        {label}
    </button>
);

const SectionHeader = ({ title, subtitle }) => (
    <div className="border-b border-gray-200 pb-4 mb-6">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
    </div>
);

export function CompanySettings() {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const [activeTab, setActiveTab] = useState('company');
    const [successMsg, setSuccessMsg] = useState('');
    const [showManageTeam, setShowManageTeam] = useState(false);
    const navigate = useNavigate();

    const isCompanyAdmin = currentUserClaims?.roles?.[currentCompanyProfile?.id] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const showSuccess = (msg) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(''), 3000);
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'company':
                return (
                    <CompanyProfileTab
                        currentCompanyProfile={currentCompanyProfile}
                        onShowSuccess={showSuccess}
                    />
                );
            case 'team':
                return (
                    <TeamManagementTab
                        currentCompanyProfile={currentCompanyProfile}
                        isCompanyAdmin={isCompanyAdmin}
                        onShowSuccess={showSuccess}
                        onShowManageTeam={() => setShowManageTeam(true)}
                    />
                );
            case 'personal':
                return (
                    <PersonalProfileTab
                        currentUser={currentUser}
                        currentCompanyProfile={currentCompanyProfile}
                        onShowSuccess={showSuccess}
                    />
                );
            case 'email':
                return (
                    <EmailSettingsTab
                        currentCompanyProfile={currentCompanyProfile}
                        onShowSuccess={showSuccess}
                    />
                );
            case 'hiring':
                return (
                    <JobPostingManager
                        companyId={currentCompanyProfile?.id}
                        companyName={currentCompanyProfile?.name}
                        logoUrl={currentCompanyProfile?.logoUrl}
                    />
                );
            case 'integrations':
                return <IntegrationsTab />;
            case 'billing':
                return (
                    <div className="space-y-8 max-w-4xl animate-in fade-in">
                        <SectionHeader title="Billing & Plan" subtitle="Manage your subscription." />
                        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
                            <CreditCard size={48} className="mx-auto mb-4 opacity-20" />
                            <p>Current Plan: <strong>{currentCompanyProfile?.planType === 'paid' ? 'Pro Plan' : 'Free Plan'}</strong></p>
                            <p className="text-sm mt-2">To upgrade or cancel, please contact support.</p>
                        </div>
                    </div>
                );
            default:
                return <div className="p-10 text-center text-gray-500">Select a tab to view settings.</div>;
        }
    };

    if (!currentCompanyProfile) return null;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="h-16 bg-white border-b border-gray-200 mb-8 flex items-center px-8 sticky top-0 z-10">
                <button onClick={() => navigate('/company/dashboard')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors font-medium">
                    <ArrowLeft size={20} /> Back to Dashboard
                </button>
            </div>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
                <div className="flex flex-col md:flex-row gap-8">

                    <aside className="w-full md:w-64 flex-shrink-0">
                        <div className="sticky top-24 space-y-1 bg-white/50 backdrop-blur-md rounded-2xl p-2 border border-slate-200/60 shadow-sm">
                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 mt-2">Organization</h3>
                            <SidebarItem id="company" label="Company Profile" icon={Building} activeTab={activeTab} onClick={setActiveTab} />
                            <SidebarItem id="hiring" label="Job Board" icon={Briefcase} activeTab={activeTab} onClick={setActiveTab} />
                            <SidebarItem id="team" label="Team & Users" icon={Users} activeTab={activeTab} onClick={setActiveTab} />

                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-6 mb-3">Communication</h3>
                            <SidebarItem id="email" label="Email Settings" icon={Mail} activeTab={activeTab} onClick={setActiveTab} />

                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-6 mb-3">Revenue & Reach</h3>
                            <SidebarItem id="integrations" label="Integrations" icon={Blocks} activeTab={activeTab} onClick={setActiveTab} />

                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-6 mb-3">Account Control</h3>
                            <SidebarItem id="billing" label="Billing & Plan" icon={CreditCard} activeTab={activeTab} onClick={setActiveTab} />
                            <SidebarItem id="personal" label="Security Profile" icon={User} activeTab={activeTab} onClick={setActiveTab} />
                        </div>
                    </aside>

                    <main className="flex-1 min-h-[600px] relative">
                        {successMsg && (
                            <div className="fixed bottom-8 right-8 bg-green-600 text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-5 z-50">
                                <CheckCircle size={20} /> {successMsg}
                            </div>
                        )}
                        {renderContent()}
                    </main>
                </div>
            </div>

            {showManageTeam && (
                <ManageTeamModal
                    companyId={currentCompanyProfile.id}
                    onClose={() => setShowManageTeam(false)}
                />
            )}
        </div>
    );
}
