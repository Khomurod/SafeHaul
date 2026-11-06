import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/** The connection fields, in page order, with the names the save bar uses. */
const CONNECTION = [
    ['smtpHost', 'SMTP Host'],
    ['smtpPort', 'SMTP Port'],
    ['smtpUser', 'SMTP Username'],
];

const BLANK = { smtpHost: '', smtpPort: 587, smtpUser: '', signature: '' };

const fieldsOf = (settings) => ({
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    signature: settings.signature,
});

// An emptied port field shows 587, so it is no change from 587.
const same = (field, a, b) => (field === 'smtpPort' ? (a || 587) === (b || 587) : a === b);

/**
 * Settings → Email's server connection: the SMTP fields as saved, the edit of
 * them, and Test Connection.
 *
 * Settings are read through `getEmailSettingsMeta` and written through
 * `saveEmailSettings`; neither returns the password. The password field is
 * never filled from anywhere, is sent only when something was typed into it
 * (otherwise the server keeps the saved one), and is emptied once a save has
 * sent it. "Successfully Linked" follows the server: the saved settings opened
 * a connection, and none of the connection fields or the password is changed.
 *
 * Test Connection checks what is typed, password included, and on success
 * saves it (the server checks the connection again on every save).
 */
export function useSmtpSettingsDraft(companyId) {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(true);
    // What the server holds, and whether a connection with it opened.
    const [saved, setSaved] = useState({ ...BLANK, isVerified: false });
    const [form, setForm] = useState(BLANK);
    // Password input state — NEVER hydrated from any source, always starts empty.
    const [password, setPassword] = useState('');
    // Whether the company already has an SMTP password saved (from the callable).
    const [hasPassword, setHasPassword] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    // Never read smtpPass from Firestore directly: the callable returns
    // sanitized settings (a hasPassword flag, no password).
    useEffect(() => {
        if (!companyId) {
            setLoading(false);
            return;
        }

        const loadSettings = async () => {
            setLoading(true);
            try {
                const getMetaFn = httpsCallable(functions, 'getEmailSettingsMeta');
                const result = await getMetaFn({ companyId });

                if (result.data?.success && result.data.settings) {
                    const meta = result.data.settings;
                    const loaded = {
                        smtpHost: meta.smtpHost || '',
                        smtpPort: meta.smtpPort || 587,
                        smtpUser: meta.smtpUser || '',
                        signature: meta.signature || '',
                    };
                    setSaved({ ...loaded, isVerified: meta.isVerified || false });
                    setForm(loaded);
                    setHasPassword(meta.hasPassword || false);
                }
            } catch (err) {
                console.warn('[EmailSettingsTab] Failed to load settings meta:', err.message);
                // Gracefully degrade — settings form still usable for first-time setup
            } finally {
                setLoading(false);
            }
        };

        loadSettings();
    }, [companyId]);

    const connectionChanged = Boolean(password)
        || CONNECTION.some(([field]) => !same(field, form[field], saved[field]));
    const changed = [
        ...CONNECTION.filter(([field]) => !same(field, form[field], saved[field])).map(([, label]) => label),
        ...(password ? ['SMTP Password'] : []),
        ...(form.signature !== saved.signature ? ['Signature'] : []),
    ];
    const isConnected = Boolean(saved.isVerified && !connectionChanged && saved.smtpUser);

    const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

    // The server checks the connection on every save; "Successfully Linked" follows its answer.
    const reportUnverifiedSave = (data) => {
        setTestResult({
            success: false,
            message: `Settings saved, but the server could not connect with them: ${data.verificationError || 'The connection could not be verified.'}`,
        });
        showError('Settings saved, but the connection could not be verified.');
    };

    /**
     * What the server now holds. `verifiedBefore` stands when the server does
     * not say whether the connection opened.
     */
    const recordSave = (sent, sentPassword, data, verifiedBefore) => {
        if (sentPassword) setHasPassword(true);
        // A password typed again while the save was on its way is new, and unsaved.
        setPassword((current) => (current === sentPassword ? '' : current));
        setSaved({ ...sent, isVerified: typeof data?.verified === 'boolean' ? data.verified : verifiedBefore });
        if (data?.verified === false) reportUnverifiedSave(data);
        return data?.verified !== false;
    };

    /** The reason the settings cannot be saved as they are, or null. */
    const validate = () => {
        if (!form.smtpHost || !form.smtpUser) return 'Please fill in SMTP Host and Username.';
        if (!password && !hasPassword) return 'Please enter your SMTP password.';
        return null;
    };

    /** Saves the settings; resolves to null, or to what to tell the person when they were not saved. */
    const save = async () => {
        const sent = { ...form };
        const sentPassword = password;
        // PARTIAL UPDATE: Only include smtpPass if user entered a new one.
        // If empty, the backend will preserve the existing password in the subcollection.
        const payload = {
            companyId,
            smtpHost: sent.smtpHost,
            smtpPort: sent.smtpPort,
            smtpUser: sent.smtpUser,
            signature: sent.signature,
        };
        if (sentPassword) {
            payload.smtpPass = sentPassword; // Only send plaintext if user typed a new password
        }
        try {
            const saveSettingsFn = httpsCallable(functions, 'saveEmailSettings');
            const result = await saveSettingsFn(payload);
            if (recordSave(sent, sentPassword, result?.data, isConnected)) {
                showSuccess('Email settings saved securely!');
                setTestResult(null);
            }
            return null;
        } catch (error) {
            // The failure carries no password; the payload is never logged.
            console.error('Error saving email settings:', error);
            return plainErrorMessage(error, 'The email settings could not be saved.');
        }
    };

    const discard = () => {
        setForm(fieldsOf(saved));
        setPassword('');
    };

    const test = async () => {
        // Test connection always requires a plaintext password from user input.
        if (!password) {
            showError('Please enter your SMTP password to test the connection.');
            return;
        }

        const sent = { ...form };
        const sentPassword = password;
        setTesting(true);
        setTestResult(null);

        try {
            const testEmailConnectionFn = httpsCallable(functions, 'testEmailConnection');
            const result = await testEmailConnectionFn({
                smtpHost: sent.smtpHost,
                smtpPort: sent.smtpPort,
                smtpUser: sent.smtpUser,
                smtpPass: sentPassword, // Always plaintext from user input
            });

            if (result.data.success) {
                // Auto-save on successful test
                try {
                    const saveSettingsFn = httpsCallable(functions, 'saveEmailSettings');
                    const savedResult = await saveSettingsFn({
                        companyId,
                        smtpHost: sent.smtpHost,
                        smtpPort: sent.smtpPort,
                        smtpUser: sent.smtpUser,
                        smtpPass: sentPassword, // Always plaintext from user input
                        signature: sent.signature,
                    });
                    if (recordSave(sent, sentPassword, savedResult?.data, true)) {
                        setTestResult({ success: true, message: 'Settings verified and saved securely!' });
                        showSuccess('✅ Connection successful and settings saved!');
                    }
                } catch (saveError) {
                    console.error('Save error:', saveError);
                    setTestResult({ success: false, message: 'Verified but failed to save to database.' });
                    showError('Verified but failed to save.');
                }
            } else {
                setTestResult({ success: false, message: result.data.error });
                showError(`Connection failed: ${result.data.error}`);
            }
        } catch (error) {
            console.error('Test connection error:', error);
            setTestResult({
                success: false,
                message: plainErrorMessage(error, 'The connection could not be tested.'),
            });
            showError('Connection test failed. Please check your credentials.');
        } finally {
            setTesting(false);
        }
    };

    return {
        loading,
        form,
        setField,
        password,
        setPassword,
        hasPassword,
        changed,
        dirty: changed.length > 0,
        isConnected,
        savedUser: saved.smtpUser,
        validate,
        save,
        discard,
        test,
        testing,
        testResult,
    };
}
