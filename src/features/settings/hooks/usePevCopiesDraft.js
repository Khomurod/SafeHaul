import { useState } from 'react';
import { saveCompanySettings } from '@features/companies';
import { useToast } from '@shared/components/feedback';
import { formatPevCopies, parsePevCopies } from '@features/company-admin/utils/pevCopies';
import { usePevDefaultCopies } from '@features/company-admin/hooks/usePevDefaultCopies';

/**
 * Settings → Email's verification copies: the people every previous employment
 * verification request copies (CC) by default, `companies/{id}.pevCcEmails`,
 * as saved and as edited. The Email page saves them with its one Save.
 *
 * The list is read from the company document when the page opens: the
 * signed-in profile is loaded once per session, so a list saved since would
 * otherwise show as empty. That read never replaces what the admin has changed,
 * and never a list saved here (it may be the older of the two).
 */
export function usePevCopiesDraft(currentCompanyProfile) {
    const companyId = currentCompanyProfile?.id;
    const { showSuccess } = useToast();
    const { copies } = usePevDefaultCopies(companyId, currentCompanyProfile?.pevCcEmails);
    const [saved, setSaved] = useState(() => formatPevCopies(copies));
    const [text, setText] = useState(saved);
    const [error, setError] = useState('');
    const [savedHere, setSavedHere] = useState(false);

    // The company document's answer, taken in the render it arrives.
    const [seenCopies, setSeenCopies] = useState(copies);
    if (copies !== seenCopies) {
        setSeenCopies(copies);
        if (!savedHere) {
            const next = formatPevCopies(copies);
            setSaved(next);
            if (text === saved) setText(next);
        }
    }

    const onChange = (value) => {
        setText(value);
        if (error) setError('');
    };

    /** Marks the field when the list cannot be saved as typed; returns what the save bar says, or null. */
    const validate = () => {
        const { error: parseError } = parsePevCopies(text);
        if (!parseError) return null;
        setError(parseError);
        return 'Check the CC addresses, then save again.';
    };

    /** Saves the list; resolves to null, or to what to tell the person when it was not saved. */
    const save = async () => {
        const sentText = text;
        const { emails } = parsePevCopies(sentText);
        try {
            await saveCompanySettings(companyId, { pevCcEmails: emails });
            const savedText = formatPevCopies(emails);
            setSavedHere(true);
            setSaved(savedText);
            // The field shows the list as saved (lower-cased, each once), unless typed in meanwhile.
            setText((current) => (current === sentText ? savedText : current));
            showSuccess(emails.length > 0 ? 'Verification copies saved.' : 'Verification requests will copy no one by default.');
            return null;
        } catch (saveError) {
            console.error('Could not save the verification copies:', saveError);
            return 'Could not save the verification copies. Try again.';
        }
    };

    const discard = () => {
        setText(saved);
        setError('');
    };

    return { text, onChange, error, dirty: text !== saved, validate, save, discard };
}
