export const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phone) => {
    // US Phone: 10 digits or 11 digits with leading country code '1'
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) return true;
    if (cleaned.length === 11 && cleaned.startsWith('1')) return true;
    return false;
};

/**
 * Normalize a US phone number to 10 digits by stripping the leading '1' country code.
 */
export const normalizePhone = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return cleaned.substring(1);
    }
    return cleaned;
};

export const isValidSSN = (ssn) => {
    // Basic format check: AAA-GG-SSSS or AAAGGSSSS
    const cleaned = ssn.replace(/\D/g, '');
    return cleaned.length === 9;
};

export const formatPhone = (value) => {
    if (!value) return value;
    let phoneNumber = value.replace(/[^\d]/g, '');
    // Strip leading '1' country code for formatting
    if (phoneNumber.length === 11 && phoneNumber.startsWith('1')) {
        phoneNumber = phoneNumber.substring(1);
    }
    const phoneNumberLength = phoneNumber.length;
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
        return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};
