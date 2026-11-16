import { useCallback, useEffect, useState } from 'react';
import { normalizePhone } from '@shared/utils/helpers';
import { addSmsOptOut, checkSmsOptOut } from '@features/settings/components/sms/smsOptOutService';

/**
 * A number as the opt-out list can be matched by: its digits, a US number
 * without its leading 1, so "(512) 555-1234" and the list's "+15125551234"
 * agree. Empty for anything the server would refuse to check (Settings'
 * `looksLikeNumber`: 10 to 15 digits).
 */
export function optOutKeyOf(phone) {
    const digits = normalizePhone(phone);
    return digits.length >= 10 && digits.length <= 15 ? digits : '';
}

/**
 * Whether the dossier's phone number is on the company's SMS opt-out list
 * ("do not text"), and a way to put it there.
 *
 * The list is the one Settings → Text messages keeps and every automatic text and
 * campaign checks (`companies/{id}/blacklist`, reached only through callables,
 * which let any team member check and add). The dossier asks about its one
 * number (`checkSmsOptOut`, one read on the server), never for the whole list.
 * Nothing here removes a number: that stays a Company Admin's, in Settings.
 *
 * - `checking` until the server has answered for this number and company; the
 *   dossier offers nothing until it knows.
 * - `listed` once the number is on the list, or once it was added here.
 * - A check that failed leaves the action offered: adding a number already
 *   listed keeps its first entry (`added: false`) and is shown as listed all the same.
 * - An answer for a number or company the dossier has since left is dropped.
 */
export function useDoNotText(companyId, phone) {
    const key = optOutKeyOf(phone);
    const usable = Boolean(key && companyId);
    // What is asked about, so an answer is known to be for this company and number.
    const asked = usable ? `${companyId} ${key}` : '';
    const [answer, setAnswer] = useState({ asked: '', listed: false });
    // The number added here, so it reads as listed whatever a check said.
    const [addedFor, setAddedFor] = useState('');

    useEffect(() => {
        if (!asked) return undefined;
        let current = true;
        checkSmsOptOut({ companyId, phone })
            .then((listed) => { if (current) setAnswer({ asked, listed }); })
            .catch(() => { if (current) setAnswer({ asked, listed: false }); });
        return () => { current = false; };
    }, [asked, companyId, phone]);

    const listed = usable && (addedFor === asked || (answer.asked === asked && answer.listed));

    const markDoNotText = useCallback(async () => {
        const result = await addSmsOptOut({ companyId, phone });
        setAddedFor(asked);
        return result;
    }, [companyId, phone, asked]);

    return {
        usable,
        checking: usable && answer.asked !== asked && !listed,
        listed,
        markDoNotText,
    };
}
