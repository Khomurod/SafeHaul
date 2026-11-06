import { useCallback, useState } from 'react';
import { normalizePhone } from '@shared/utils/helpers';
import { useSmsOptOuts } from '@features/settings/components/sms/useSmsOptOuts';

/**
 * A number as the opt-out list can be matched by: its digits, a US number
 * without its leading 1, so "(512) 555-1234" and the list's "+15125551234"
 * agree. Empty for anything the server would refuse to list (Settings'
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
 * campaign checks (`companies/{id}/blacklist`, reached only through the
 * `listSmsOptOuts` / `addSmsOptOut` callables, which let any team member list
 * and add). Nothing here removes a number: that stays a Company Admin's, in
 * Settings.
 *
 * - `checking` while the list loads; the dossier offers nothing until it knows.
 * - `listed` once the number is on the list, or once it was added here.
 * - A list that could not be read, or that shows only its newest entries, leaves
 *   the action offered: adding a number already listed keeps its first entry
 *   (`added: false`) and is shown as listed all the same.
 */
export function useDoNotText(companyId, phone) {
    const key = optOutKeyOf(phone);
    const { entries, loading, add } = useSmsOptOuts(key ? companyId : undefined);
    // The number added here, so it reads as listed before the list reloads.
    const [addedKey, setAddedKey] = useState('');

    const listed = Boolean(key) && (
        addedKey === key || entries.some((entry) => optOutKeyOf(entry.phone) === key)
    );

    const markDoNotText = useCallback(async () => {
        const result = await add({ phone });
        setAddedKey(key);
        return result;
    }, [add, phone, key]);

    return {
        usable: Boolean(key && companyId),
        checking: Boolean(key && companyId) && loading && !listed,
        listed,
        markDoNotText,
    };
}
