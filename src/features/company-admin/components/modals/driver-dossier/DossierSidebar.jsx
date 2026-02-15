import React from 'react';
import {
    LayoutDashboard,
    FileText,
    ShieldCheck,
    Activity,
    StickyNote,
    Phone,
    User,
    CheckCircle2,
    AlertCircle,
    Clock,
    Mail,
    Send,
    Building2
} from 'lucide-react';
import { StatusBadge } from '@shared/components/badges/StatusBadge';
import { formatPhoneNumber } from '@shared/utils/helpers';

export function DossierSidebar({
    appData,
    currentStatus,
    activeTab,
    setActiveTab,
    loading,
    dqStatus
}) {
    // Navigation Items
    const navItems = [
        { id: 'application', label: 'Application', icon: LayoutDashboard },
        { id: 'documents', label: 'Documents', icon: FileText },
        { id: 'dq', label: 'DQ File', icon: ShieldCheck },
        { id: 'activity', label: 'Activity', icon: Activity },
        { id: 'notes', label: 'Notes', icon: StickyNote },
    ];

    // Contact Logic
    const email = appData?.email || '';
    const phone = appData?.phone || '';

    // Sanitize for Telegram (remove non-digits)
    const telegramLink = phone ? `https://t.me/+${phone.replace(/\D/g, '')}` : '#';

    return (
        <div className="flex flex-col h-full">
            {/* Identity Header */}
            <div className="p-6 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-bold border-2 border-white shadow-sm">
                        {appData?.firstName?.[0]}{appData?.lastName?.[0]}
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg leading-tight">
                            {appData?.firstName} {appData?.lastName}
                        </h3>
                        <div className="mt-1"><StatusBadge status={currentStatus} /></div>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === item.id
                            ? 'bg-white text-blue-700 shadow-sm border border-gray-200 translate-x-1'
                            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                            }`}
                    >
                        <item.icon size={18} className={activeTab === item.id ? 'text-blue-600' : 'text-gray-400'} />
                        <span>{item.label}</span>
                        {item.id === 'dq' && dqStatus === 'incomplete' && (
                            <div className="ml-auto w-2 h-2 rounded-full bg-red-500" />
                        )}
                    </button>
                ))}
            </div>

            {/* Contact Footer (Grid Layout) */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <div className="grid grid-cols-3 gap-2">
                    {/* Phone */}
                    <a
                        href={`tel:${phone}`}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-colors ${phone
                            ? 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700'
                            : 'border-gray-100 bg-gray-50 text-gray-300 pointer-events-none'
                            }`}
                        title={phone || "No Phone"}
                    >
                        <Phone size={18} className="mb-1" />
                        <span className="text-[10px] font-bold">Call</span>
                    </a>

                    {/* Email */}
                    <a
                        href={`mailto:${email}`}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-colors ${email
                            ? 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700'
                            : 'border-gray-100 bg-gray-50 text-gray-300 pointer-events-none'
                            }`}
                        title={email || "No Email"}
                    >
                        <Mail size={18} className="mb-1" />
                        <span className="text-[10px] font-bold">Email</span>
                    </a>

                    {/* Telegram */}
                    <a
                        href={telegramLink}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-colors ${phone
                            ? 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700'
                            : 'border-gray-100 bg-gray-50 text-gray-300 pointer-events-none'
                            }`}
                        title="Open Telegram"
                    >
                        <Send size={18} className="mb-1" />
                        <span className="text-[10px] font-bold">Telegram</span>
                    </a>
                </div>
            </div>
        </div>
    );
}
