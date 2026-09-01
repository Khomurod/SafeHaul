/**
 * The Documents workspace's template-send flow: everything between "Use
 * template" and the signing request existing — the wizard's recipient and
 * delivery state, the driver picker's data, the prefill state and partition,
 * and `executeTemplateSend` itself, which builds the signing request, writes
 * it with its access token in one batch, and delivers by email, SMS or
 * copied link. Extracted verbatim from `views/DocumentsManager.jsx`; the
 * view wires the returned state into `SendTemplateWizard` and the panels.
 */

import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, doc, getDocs, Timestamp, writeBatch, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import {
    buildPrefillContext,
    buildEditablePrefillGroups,
    buildPrefillOverridesForSend,
    initialGroupedPrefillState,
    initialPlainPrefillState,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';

export function useTemplateSendFlow({
    currentCompanyProfile,
    isE2EEdocMock,
    navigate,
    setActiveTab,
    showSuccess,
    showError,
}) {
    const [showDriverPicker, setShowDriverPicker] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [drivers, setDrivers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sending, setSending] = useState(false);

    // FEAT-2/3/4: Manual entry + delivery method state
    const [manualName, setManualName] = useState('');
    const [manualEmail, setManualEmail] = useState('');
    const [manualPhone, setManualPhone] = useState('');
    const [deliveryMethod, setDeliveryMethod] = useState('email'); // 'email' | 'sms' | 'both' | 'copy'

    // Template pre-fill: grouped keys share one control; plain text fields stay per-slot
    const [prefillValues, setPrefillValues] = useState({});
    const [prefillValuesByGroupKey, setPrefillValuesByGroupKey] = useState({});

    // Fetch Drivers for Picker
    useEffect(() => {
        if (showDriverPicker && currentCompanyProfile?.id) {
            if (isE2EEdocMock) {
                setDrivers([
                    {
                        id: 'lead_e2e_1',
                        firstName: 'E2E',
                        lastName: 'Driver',
                        email: 'driver@safehaul.local',
                        phone: '5551112222',
                    },
                ]);
                return;
            }
            const fetchDrivers = async () => {
                const q = query(collection(db, 'companies', currentCompanyProfile.id, 'leads'));
                const snap = await getDocs(q);
                setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            };
            fetchDrivers();
        }
    }, [showDriverPicker, currentCompanyProfile?.id, isE2EEdocMock]);

    const handleUseTemplate = (template) => {
        setSelectedTemplate(template);
        setManualName('');
        setManualEmail('');
        setManualPhone('');
        setDeliveryMethod('email');
        const { groups, plainFields } = buildEditablePrefillGroups(template.fields || []);
        setPrefillValuesByGroupKey(initialGroupedPrefillState(groups));
        setPrefillValues(initialPlainPrefillState(plainFields));
        setShowDriverPicker(true);
    };

    const editablePrefillPartition = useMemo(() => {
        if (!selectedTemplate?.fields) return { groups: [], plainFields: [] };
        return buildEditablePrefillGroups(selectedTemplate.fields);
    }, [selectedTemplate]);

    // FEAT-2: Quick-select a driver to auto-fill manual entry fields
    const handleQuickSelect = (driver) => {
        setManualName(`${driver.firstName || ''} ${driver.lastName || ''}`.trim());
        setManualEmail(driver.email || '');
        setManualPhone(driver.phone || driver.phoneNumber || '');
    };


    const executeTemplateSend = async () => {
        // Guard against a second submission while the first is still in flight.
        if (sending) return;
        // FEAT-2: Validate based on delivery method
        if (!manualName.trim()) {
            showError('Please enter a recipient name.');
            return;
        }
        if ((deliveryMethod === 'email' || deliveryMethod === 'both') && !manualEmail.trim()) {
            showError('Email address is required for email delivery.');
            return;
        }
        if ((deliveryMethod === 'sms' || deliveryMethod === 'both') && !manualPhone.trim()) {
            showError('Phone number is required for SMS delivery.');
            return;
        }

        setSending(true);
        try {
            if (isE2EEdocMock) {
                setShowDriverPicker(false);
                showSuccess('Document created! Email delivery in progress...');
                navigate(`/sign/${currentCompanyProfile.id}/e2e-edoc-send-req?token=e2e-token&e2eSign=mock`);
                return;
            }

            const accessToken = uuidv4();

            const resolvedRecipientName = manualName.trim();
            const resolvedRecipientEmail = manualEmail.trim();
            const resolvedRecipientPhone = manualPhone.trim();

            const prefillContext = buildPrefillContext({
                recipientName: resolvedRecipientName,
                recipientEmail: resolvedRecipientEmail,
                recipientPhone: resolvedRecipientPhone,
                companyName: currentCompanyProfile?.companyName || currentCompanyProfile?.name || '',
            });

            const overridesByFieldId = buildPrefillOverridesForSend(selectedTemplate.fields || [], {
                prefillValues,
                prefillValuesByGroupKey,
            });

            const { fields: autoFilledFields, missingLockedRequired } = resolveFieldsForSend(
                selectedTemplate.fields || [],
                prefillContext,
                { overridesByFieldId },
            );

            if (missingLockedRequired.length > 0) {
                showError(`Cannot send this template yet. Missing locked prefill data: ${missingLockedRequired.join(', ')}.`);
                return;
            }

            const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';

            // FEAT-3/4: Set delivery flags based on method
            const sendEmail = deliveryMethod === 'email' || deliveryMethod === 'both';
            const sendSms = deliveryMethod === 'sms' || deliveryMethod === 'both';

            const docData = {
                companyId: currentCompanyProfile.id,
                recipientEmail: resolvedRecipientEmail || null,
                recipientName: resolvedRecipientName,
                recipientPhone: resolvedRecipientPhone || null,
                title: selectedTemplate.title,
                status: 'sent',
                createdAt: serverTimestamp(),
                expiresAt,
                storagePath: selectedTemplate.storagePath,
                senderId: auth.currentUser.uid,
                senderName,
                sendEmail,
                sendSms: false, // SMS is sent directly by frontend callable; do not trigger async function.
                deliveryMethod, // Record what user chose for audit trail
                appBaseUrl: window.location.origin, // DOMAIN FIX: Store sender's domain for backend link generation
                fields: autoFilledFields,
                templateId: selectedTemplate.id,
                fieldValues: autoFilledFields.reduce((acc, f) => {
                    if (f.defaultValue) acc[f.id] = f.defaultValue;
                    return acc;
                }, {})
            };

            // BUG-2 FIX: Use batch write to store accessToken in secrets subcollection
            const signingRef = doc(collection(db, 'companies', currentCompanyProfile.id, 'signing_requests'));
            const batch = writeBatch(db);
            batch.set(signingRef, docData);
            batch.set(doc(signingRef, 'secrets', 'token'), { accessToken });
            await batch.commit();

            // FEAT-4: Copy Link mode - copy URL to clipboard instead of sending
            if (deliveryMethod === 'copy') {
                const baseUrl = window.location.origin;
                const link = `${baseUrl}/sign/${currentCompanyProfile.id}/${signingRef.id}?token=${accessToken}`;
                await navigator.clipboard.writeText(link);
                showSuccess('Signing link copied to clipboard!');
            } else {
                // Send SMS directly via callable (not relying on async trigger)
                if (sendSms && resolvedRecipientPhone) {
                    try {
                        const baseUrl = window.location.origin;
                        const signingLink = `${baseUrl}/sign/${currentCompanyProfile.id}/${signingRef.id}?token=${accessToken}`;
                        const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';
                        const smsMessage = `${senderName} sent you "${selectedTemplate.title}" to sign: ${signingLink}`;

                        const functions = getFunctions();
                        const sendSMSCallable = httpsCallable(functions, 'sendSMS');
                        await sendSMSCallable({
                            companyId: currentCompanyProfile.id,
                            recipientPhone: resolvedRecipientPhone,
                            messageBody: smsMessage
                        });
                        showSuccess('Document created & SMS sent!');
                    } catch (smsErr) {
                        console.error('SMS send failed:', smsErr);
                        showError(`Document created but SMS failed: ${smsErr.message}`);
                    }
                } else {
                    const methodLabel = deliveryMethod === 'both' ? 'Email + SMS' : 'Email';
                    showSuccess(`Document created! ${methodLabel} delivery in progress...`);
                }
            }

            setShowDriverPicker(false);
            setActiveTab('sent');
        } catch (err) {
            console.error(err);
            showError("Failed to send template.");
        } finally {
            setSending(false);
        }
    };

    return {
        showDriverPicker,
        setShowDriverPicker,
        selectedTemplate,
        setSelectedTemplate,
        drivers,
        searchQuery,
        setSearchQuery,
        sending,
        manualName,
        setManualName,
        manualEmail,
        setManualEmail,
        manualPhone,
        setManualPhone,
        deliveryMethod,
        setDeliveryMethod,
        prefillValues,
        setPrefillValues,
        prefillValuesByGroupKey,
        setPrefillValuesByGroupKey,
        editablePrefillPartition,
        handleUseTemplate,
        handleQuickSelect,
        executeTemplateSend,
    };
}
