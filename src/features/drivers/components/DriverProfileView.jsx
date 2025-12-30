// src/features/drivers/components/DriverProfileView.jsx
import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useData } from '@/context/DataContext';

import { 
    DriverHeader, 
    DriverIdentity, 
    RecruiterLink, 
    DriverDetails, 
    InviteBar, 
    NetworkInsights 
} from './profile';

export function DriverProfileView({ driver, onBack, onCallStart }) {
    const { currentCompanyProfile } = useData();
    const [activeTab, setActiveTab] = useState('profile'); 

    const [sending, setSending] = useState(false);
    const [inviteSent, setInviteSent] = useState(false);

    const pi = driver.personalInfo || {};

    const handleSendInvite = async () => {
        if (inviteSent) return;

        if (!pi.email || pi.email.includes('placeholder.com')) {
            alert("This driver does not have a valid email address.");
            return;
        }

        if (!window.confirm(`Send job invite to ${pi.firstName}?`)) return;

        setSending(true);
        try {
            const sendFn = httpsCallable(functions, 'sendDriverInvite');
            const result = await sendFn({
                driverEmail: pi.email,
                driverName: `${pi.firstName} ${pi.lastName}`,
                companyName: currentCompanyProfile?.companyName || "Our Company",
                message: "" 
            });

            if (result.data.success) {
                setInviteSent(true);
                alert("Invite sent successfully!");
            } else {
                alert("Failed to send: " + result.data.error);
            }
        } catch (err) {
            console.error(err);
            alert("Error sending invite: " + err.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">

            <DriverHeader 
                driver={driver} 
                onBack={onBack} 
                activeTab={activeTab} 
                setActiveTab={setActiveTab} 
            />

            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">

                {activeTab === 'profile' ? (
                    <>
                        <DriverIdentity 
                            driver={driver} 
                            onCallStart={onCallStart} 
                        />

                        {/* FIX: Passing leadId so the RecruiterLink generates a personalized Interest link.
                          This ensures the driver is correctly mapped back to this specific lead record.
                        */}
                        <RecruiterLink 
                            currentCompanyProfile={currentCompanyProfile} 
                            leadId={driver.id} 
                        />

                        <DriverDetails driver={driver} />

                        <InviteBar 
                            onSend={handleSendInvite} 
                            sending={sending} 
                            inviteSent={inviteSent} 
                        />
                    </>
                ) : (
                    <NetworkInsights driver={driver} />
                )}
            </div>
        </div>
    );
}