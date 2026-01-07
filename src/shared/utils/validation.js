export const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phone) => {
    // Basic US Phone: (555) 555-5555, 555-555-5555, 5555555555
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 10;
};

export const isValidSSN = (ssn) => {
    // Basic format check: AAA-GG-SSSS or AAAGGSSSS
    const cleaned = ssn.replace(/\D/g, '');
    return cleaned.length === 9;
};

export const formatPhone = (value) => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, '');
    const phoneNumberLength = phoneNumber.length;
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
        return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};
