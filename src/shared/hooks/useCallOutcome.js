import { useState, useEffect } from 'react';
import { db, auth, functions } from '@lib/firebase';
import { addDoc, collection, serverTimestamp, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { isPlaceholderEmail } from '@/config/placeholderDomains';
import { toIsoDay } from '@/config/applicationDates';
import { ATS_INTERESTED_STATUS } from '@shared/constants/atsStatus';
import { normalizeApplicationStatus } from '@shared/utils/applicationStatus';
import { statusChangeStamp } from '@shared/utils/changeStamps';

const DECLINED = 'Declined';

/**
 * Each call result and the pipeline stage it moves the record to (owner
 * decision Д3): Interested to `Interested`, Not Interested and Wrong Number to
 * `Declined`; `stage: null` keeps the stage. The result itself is always kept
 * as the last call (`lastCallOutcome`), which the list's "Last call" shows.
 */
const OUTCOMES = [
    { id: 'interested', isContact: true, label: 'Connected / Interested', stage: ATS_INTERESTED_STATUS },
    { id: 'callback', isContact: true, label: 'Connected / Scheduled Callback', stage: null },
    { id: 'not_qualified', isContact: true, label: 'Connected / Not Qualified', stage: null },
    { id: 'not_interested', isContact: true, label: 'Connected / Not Interested', stage: DECLINED },
    { id: 'hired_elsewhere', isContact: true, label: 'Connected / Hired Elsewhere', stage: null },
    { id: 'voicemail', isContact: false, label: 'Left Voicemail', stage: null },
    { id: 'no_answer', isContact: false, label: 'No Answer', stage: null },
    { id: 'wrong_number', isContact: false, label: 'Wrong Number', stage: DECLINED }
];

/**
 * A hired, terminated or declined record keeps its stage whatever a call says: a
 * call does not undo a hire, and a declined record is archived, so a call does
 * not reopen it (the recruiter changes the stage by hand).
 */
const STAGES_A_CALL_KEEPS = new Set(['hired', 'terminated', 'declined']);

/**
 * The stage a call moves a record to, or null to leave it: for a result that
 * keeps the stage, a hired, terminated or declined record (`Rejected` is
 * Declined), or one already there in any spelling. Writing no change sends no "status
 * changed" notice (`functions/notificationTriggers.js`).
 */
function stageAfterCall(target, currentStatus) {
    if (!target || currentStatus === target) return null;
    const current = normalizeApplicationStatus(currentStatus);
    if (STAGES_A_CALL_KEEPS.has(current)) return null;
    const targetGroup = normalizeApplicationStatus(target);
    if (targetGroup !== 'other' && targetGroup === current) return null;
    return target;
}

/** "Oct 22 at 3:00 PM": the time as the recruiter chose it, in their own clock. */
function reminderLabelOf(date, time) {
    const at = date && time ? new Date(`${date}T${time}`) : null;
    if (!at || Number.isNaN(at.getTime())) return '';
    const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${day} at ${clock}`;
}

export function useCallOutcome(lead, companyId, onUpdate, onClose) {
    const { showSuccess, showError } = useToast();

    const [outcome, setOutcome] = useState('interested');
    const [notes, setNotes] = useState('');

    const [driverType, setDriverType] = useState(lead.driverType || '');
    const [experienceLevel, setExperienceLevel] = useState(lead.experienceLevel || lead.experience || '');
    const [position, setPosition] = useState(lead.positionApplyingTo || '');

    const [callbackDate, setCallbackDate] = useState('');
    const [callbackTime, setCallbackTime] = useState('');
    // "Remind me in 1 Hour" after No Answer: a reminder that keeps the result.
    const [quickReminder, setQuickReminder] = useState(false);
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
    const hasReminder = showCallbackSelect || (quickReminder && outcome === 'no_answer');
    const reminderLabel = hasReminder ? reminderLabelOf(callbackDate, callbackTime) : '';

    const onQuickReminder = () => {
        const at = new Date(Date.now() + 60 * 60 * 1000);
        setCallbackDate(toIsoDay(at));
        setCallbackTime(at.toTimeString().slice(0, 5));
        setQuickReminder(true);
    };

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

        const collectionName = (lead.submittedAt || lead.sourceType === 'Company App') ? 'applications' : 'leads';

        try {
            const companyLeadRef = doc(db, 'companies', companyId, collectionName, lead.id);
            const leadSnap = await getDoc(companyLeadRef);

            const updateData = {
                lastContactedAt: serverTimestamp(),
                lastContactedBy: auth.currentUser.uid,
                lastCallOutcome: outcomeLabel,
            };

            // The stage as stored now, not as the list row last read it.
            const newStage = stageAfterCall(
                outcomeConfig.stage,
                leadSnap.exists() ? leadSnap.data()?.status : undefined,
            );
            if (newStage) {
                updateData.status = newStage;
                updateData.statusEnteredAt = serverTimestamp();
                // Who moved it: the bell does not tell them about it.
                Object.assign(updateData, statusChangeStamp(auth.currentUser.uid));
            }
            // `archived` marks only a record a call declined (no screen reads it yet).
            if (newStage === DECLINED) {
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

            // CHECK FOR CONVERSION: Leads -> Applications (If Interested)
            // USER REQUEST: Disable auto-conversion. Driver must accept manually.
            const isConversion = false; // Strictly enforced to FALSE

            // NORMAL UPDATE
            if (!leadSnap.exists()) {
                await setDoc(companyLeadRef, {
                    ...lead,
                    status: 'Attempted',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    source: 'Search DB Call',
                    originalLeadId: lead.id
                });
            }

            await updateDoc(companyLeadRef, updateData);


            // --- Activity Logging (Always Log) ---
            // Write to activity_logs (modern path) which triggers statsAggregator
            const targetCollection = isConversion ? 'applications' : collectionName;

            await addDoc(collection(db, 'companies', companyId, targetCollection, lead.id, 'activity_logs'), {
                type: 'call',
                action: 'Call Logged',
                outcome: outcome,
                outcomeLabel: outcomeLabel,
                isContact: outcomeConfig.isContact,
                details: `${outcomeLabel}${notes ? `: ${notes}` : ''}`,
                // The server reminds the recruiter in their bell (notificationTriggers.js).
                ...(reminderLabel && {
                    callbackAt: new Date(`${callbackDate}T${callbackTime}`).toISOString(),
                    callbackLabel: reminderLabel,
                }),
                dataChanged: dataChanged,
                performedBy: auth.currentUser.uid,
                performedByName: authorName,
                companyId: companyId,
                leadId: lead.id,
                timestamp: serverTimestamp()
            });

            // --- Internal Notes ---
            let noteText = `[Call Log: ${outcomeLabel}]`;
            if (showDetailInputs && dataChanged) {
                noteText += `\n[Updated Details]: Type: ${driverType}, Exp: ${experienceLevel}, Pos: ${position}`;
            }
            if (reminderLabel) noteText += `\n📅 Callback: ${reminderLabel}`;
            if (notes) noteText += `\n${notes}`;

            await addDoc(collection(db, 'companies', companyId, targetCollection, lead.id, 'internal_notes'), {
                text: noteText,
                author: authorName,
                createdAt: serverTimestamp(),
                type: 'call_log'
            });

            // --- Global Updates (Handled by Cloud Trigger now) ---
            // The client no longer writes to drivers/{lead.id} directly to avoid permission errors.
            // See functions/driverSync.js -> syncDriverOnLog

            // Not to a lead without a real address: the import gives one a made-up
            // address, and an email to it only bounces.
            if (['no_answer', 'voicemail'].includes(outcome) && !isPlaceholderEmail(lead.email)) {
                const sendEmail = httpsCallable(functions, 'sendAutomatedEmail');
                sendEmail({
                    companyId,
                    recipientEmail: lead.email,
                    triggerType: 'no_answer',
                    placeholders: {
                        driverfullname: `${lead.firstName} ${lead.lastName}`,
                        driverfirstname: lead.firstName,
                        recruitername: authorName,
                        recruiteremail: auth.currentUser?.email || '',
                        companyslug: companySlug
                    }
                }).catch(err => console.error("Automation failed silently:", err));
            }

            showSuccess(`Call logged as ${outcomeLabel}`);

            // NOTIFY PARENT
            if (onUpdate) {
                onUpdate({
                    converted: isConversion,
                    applicationId: lead.id
                });
            }
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
        reminderLabel,
        onQuickReminder,
    };
}
