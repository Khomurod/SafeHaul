/**
 * The Documents workspace's template-send flow: everything between "Use
 * template" and the signing request existing — the wizard's recipient and
 * delivery state, the driver picker's data, the prefill state and partition,
 * and `executeTemplateSend` itself, which builds the signing request from the
 * template and sends it by email, SMS or copied link (`signingRequestWrite.js`
 * writes it). `views/DocumentsManager.jsx` wires the returned state into
 * `SendTemplateWizard` and the panels.
 */

import { useState, useEffect, useMemo } from 'react';
import {
    buildPrefillContext,
    buildEditablePrefillGroups,
    buildPrefillOverridesForSend,
    initialGroupedPrefillState,
    initialPlainPrefillState,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { resolveSignedDateValue } from '@features/signing/utils/signedDate';
import { createSigningRequest, announceSigningRequest } from '@features/signing/utils/signingRequestWrite';

// The picker's leads load when it opens (`pickerLeads.js`), never the whole list.
const loadPickerLeads = () => import('./pickerLeads');

/** A search waits for a pause in typing; the newest leads load at once. */
const SEARCH_PAUSE_MS = 300;

/** The browser tests' lead: they run without a backend. */
const E2E_PICKER_LEADS = [
    {
        id: 'lead_e2e_1',
        firstName: 'E2E',
        lastName: 'Driver',
        email: 'driver@safehaul.local',
        phone: '5551112222',
    },
];

export function useTemplateSendFlow({
    currentCompanyProfile,
    isE2EEdocMock,
    navigate,
    setActiveTab,
    showSuccess,
    showError,
    showWarning,
}) {
    const [showDriverPicker, setShowDriverPicker] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [drivers, setDrivers] = useState([]);
    // What the picker shows in place of rows: 'loading', 'ready' or 'failed'.
    const [driversStatus, setDriversStatus] = useState('loading');
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

    // The picker's leads: the newest 20, or the matches for what is typed,
    // found on the server the way the leads list finds them.
    useEffect(() => {
        if (!showDriverPicker || !currentCompanyProfile?.id) return undefined;
        const companyId = currentCompanyProfile.id;
        const term = searchQuery;
        let current = true;
        setDriversStatus('loading');
        const timer = setTimeout(async () => {
            try {
                const { findPickerLeads, matchPickerLeads } = await loadPickerLeads();
                const found = isE2EEdocMock
                    ? matchPickerLeads(E2E_PICKER_LEADS, term)
                    : await findPickerLeads(companyId, term);
                if (!current) return;
                setDrivers(found);
                setDriversStatus('ready');
            } catch (error) {
                console.error('Error loading leads for the template picker:', error);
                if (!current) return;
                setDrivers([]);
                setDriversStatus('failed');
            }
        }, term.trim() ? SEARCH_PAUSE_MS : 0);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [showDriverPicker, currentCompanyProfile?.id, isE2EEdocMock, searchQuery]);

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

            const link = await createSigningRequest({
                companyId: currentCompanyProfile.id,
                recipientName: resolvedRecipientName,
                recipientEmail: resolvedRecipientEmail,
                recipientPhone: resolvedRecipientPhone,
                deliveryMethod,
                content: {
                    title: selectedTemplate.title,
                    storagePath: selectedTemplate.storagePath,
                    fields: autoFilledFields,
                    templateId: selectedTemplate.id,
                    // A Date Signed field has no value yet — it is stamped when the
                    // signer submits — so it is deliberately absent here rather than
                    // seeded with its own unresolved placeholder.
                    fieldValues: autoFilledFields.reduce((acc, f) => {
                        if (f.defaultValue && resolveSignedDateValue(f) === null) acc[f.id] = f.defaultValue;
                        return acc;
                    }, {}),
                },
            });
            await announceSigningRequest({ link, deliveryMethod, showSuccess, showWarning });

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
        drivers,
        driversStatus,
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
