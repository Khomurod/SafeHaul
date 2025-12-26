import { useState, useEffect } from 'react';
import { db, auth, functions } from '@lib/firebase';
import { addDoc, collection, serverTimestamp, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { sendNotification } from '@lib/notificationService';
import { useToast } from '@shared/components/feedback/ToastProvider';

const OUTCOMES = [
    { id: 'interested', isContact: true, label: 'Connected / Interested', status: 'Contacted', archive: false },
    { id: 'callback', isContact: true, label: 'Connected / Scheduled Callback', status: 'Contacted', archive: false },
    { id: 'not_qualified', isContact: true, label: 'Connected / Not Qualified', status: 'Disqualified', archive: true },
    { id: 'not_interested', isContact: true, label: 'Connected / Not Interested', status: 'Rejected', archive: true },
    { id: 'hired_elsewhere', isContact: true, label: 'Connected / Hired Elsewhere', status: 'Disqualified', archive: true },
    { id: 'voicemail', isContact: false, label: 'Left Voicemail', status: 'Attempted', archive: false },
    { id: 'no_answer', isContact: false, label: 'No Answer', status: 'Attempted', archive: false },
    { id: 'wrong_number', isContact: false, label: 'Wrong Number', status: 'Disqualified', archive: true }
];

export function useCallOutcome(lead, companyId, onUpdate, onClose) {
    const { showSuccess, showError } = useToast();
    
    const [outcome, setOutcome] = useState('interested');
    const [notes, setNotes] = useState('');
    
    const [driverType, setDriverType] = useState(lead.driverType || '');
    const [experienceLevel, setExperienceLevel] = useState(lead.experienceLevel || lead.experience || '');
    const [position, setPosition] = useState(lead.positionApplyingTo || '');

    const [callbackDate, setCallbackDate] = useState('');
    const [callbackTime, setCallbackTime] = useState('');
    const [saving, setSaving] = useState(false);
    const [authorName, setAuthorName] = useState('Recruiter');
    
    const [companySlug, setCompanySlug] = useState('');

    useEffect(() => {
        const initData = async () => {
            if (!auth.currentUser) return;
            
            let name = auth.currentUser.displayName;
            if (!name) {
                const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
                if (userDoc.exists() && userDoc.data().name) {
                    name = userDoc.data().name;
                }
            }
            if (name) setAuthorName(name);

            if (companyId) {
                try {
                    const compDoc = await getDoc(doc(db, "companies", companyId));
                    if (compDoc.exists()) {
                        setCompanySlug(compDoc.data().appSlug || companyId);
                    }
                } catch (e) {
                    console.error("Error fetching company slug", e);
                }
            }
        };
        initData();
    }, [companyId]);

    const showDetailInputs = ['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere'].includes(outcome);
    const showCallbackSelect = outcome === 'callback';

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!auth.currentUser) return;

        if (showCallbackSelect && (!callbackDate || !callbackTime)) {
            showError("Please select a date and time for the callback.");
            return;
        }

        setSaving(true);

        const outcomeConfig = OUTCOMES.find(o => o.id === outcome) || OUTCOMES[0];
        const outcomeLabel = outcomeConfig.label;
        const newStatus = outcomeConfig.status;
        const shouldArchive = outcomeConfig.archive;

        const collectionName = (lead.submittedAt || lead.sourceType === 'Company App') ? 'applications' : 'leads';

        try {
            const companyLeadRef = doc(db, 'companies', companyId, collectionName, lead.id);
            const leadSnap = await getDoc(companyLeadRef);

            if (!leadSnap.exists()) {
                await setDoc(companyLeadRef, {
                    ...lead,
                    status: 'Attempted',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    source: 'Search DB Call',
                    isPlatformLead: true,
                    originalLeadId: lead.id
                });
            }

            const updateData = { 
                lastContactedAt: serverTimestamp(),
                lastContactedBy: auth.currentUser.uid,
                lastCallOutcome: outcomeLabel,
                status: newStatus
            };

            if (shouldArchive) {
                updateData.archived = true;
                updateData.archivedAt = serverTimestamp();
            }

            let dataChanged = false;
            
            if (showDetailInputs) {
                if (driverType !== (lead.driverType || '')) {
                    updateData.driverType = driverType;
                    dataChanged = true;
                }
                if (experienceLevel !== (lead.experienceLevel || '')) {
                    updateData.experienceLevel = experienceLevel;
                    updateData.experience = experienceLevel; 
                    dataChanged = true;
                }
                if (position !== (lead.positionApplyingTo || '')) {
                    updateData.positionApplyingTo = position;
                    dataChanged = true;
                }

                if (dataChanged) {
                    updateData.infoSource = 'recruiter';
                    updateData.driverTypeSource = 'recruiter'; 
                }
            }

            await updateDoc(companyLeadRef, updateData);

            await addDoc(collection(db, 'companies', companyId, collectionName, lead.id, 'activities'), {
                type: 'call',
                outcome: outcome,
                outcomeLabel: outcomeLabel,
                isContact: outcomeConfig.isContact,
                notes: notes,
                dataChanged: dataChanged,
                performedBy: auth.currentUser.uid,
                performedByName: authorName, 
                companyId: companyId, 
                leadId: lead.id,      
                timestamp: serverTimestamp()
            });

            let noteText = `[Call Log: ${outcomeLabel}]`;
            if (showDetailInputs && dataChanged) {
                 noteText += `\n[Updated Details]: Type: ${driverType}, Exp: ${experienceLevel}, Pos: ${position}`;
            }
            if (showCallbackSelect) noteText += `\n📅 Callback: ${callbackDate} at ${callbackTime}`;
            if (notes) noteText += `\n${notes}`;

            await addDoc(collection(db, 'companies', companyId, collectionName, lead.id, 'internal_notes'), {
                text: noteText,
                author: authorName,
                createdAt: serverTimestamp(),
                type: 'call_log' 
            });

            const globalDriverRef = doc(db, "drivers", lead.id);
            const globalUpdate = {
                lastNetworkCall: {
                    outcome: outcomeLabel,
                    timestamp: serverTimestamp() 
                }
            };
            if (dataChanged) {
                if (driverType) globalUpdate['driverProfile.type'] = driverType;
                if (experienceLevel) globalUpdate['qualifications.experienceYears'] = experienceLevel;
                globalUpdate.infoSource = 'recruiter';
            }
            
            await setDoc(globalDriverRef, globalUpdate, { merge: true }).catch(err => console.log("Skipped global update:", err));

            if (lead.isPlatformLead && (outcome === 'hired_elsewhere' || outcome === 'not_interested' || outcome === 'not_qualified')) {
                const handleOutcomeFn = httpsCallable(functions, 'handleLeadOutcome');
                handleOutcomeFn({
                    leadId: lead.originalLeadId || lead.id, 
                    companyId: companyId,
                    outcome: outcome 
                }).catch(err => console.error("Failed to report outcome to pool:", err));
            }

            if (showCallbackSelect) {
                const scheduledTime = new Date(`${callbackDate}T${callbackTime}`);
                await sendNotification({
                    recipientId: auth.currentUser.uid,
                    title: `📞 Callback: ${lead.firstName} ${lead.lastName}`,
                    message: notes || "Scheduled followup call.",
                    type: 'callback',
                    scheduledFor: scheduledTime,
                    metadata: { 
                        leadId: lead.id, 
                        companyId: companyId,
                        phone: lead.phone 
                    } 
                });
            }

            if (['no_answer', 'voicemail'].includes(outcome) && lead.email && !lead.email.includes('placeholder.com')) {
                const sendEmail = httpsCallable(functions, 'sendAutomatedEmail');
                sendEmail({
                    companyId,
                    recipientEmail: lead.email,
                    triggerType: 'no_answer',
                    placeholders: {
                        driverfullname: `${lead.firstName} ${lead.lastName}`,
                        driverfirstname: lead.firstName,
                        recruitername: authorName
                    }
                }).catch(err => console.error("Automation failed silently:", err));
            }

            showSuccess(`Call logged as ${outcomeLabel}`);
            if (onUpdate) onUpdate();
            onClose();

        } catch (error) {
            console.error("Error logging call:", error);
            showError(`Failed to save call log. Error: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    return {
        outcome, setOutcome,
        notes, setNotes,
        driverType, setDriverType,
        experienceLevel, setExperienceLevel,
        position, setPosition,
        
        callbackDate, setCallbackDate,
        callbackTime, setCallbackTime,
        saving, 
        handleSave,
        showDetailInputs,
        showCallbackSelect,
        showSuccess,
        companySlug,
        onQuickReminder: () => {}, 
    };
}
