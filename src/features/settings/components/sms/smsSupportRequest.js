/** The message an admin sends SafeHaul support to have text messaging set up. */
export function supportRequestText({ companyName, companyId }) {
    return `Hello SafeHaul support, please set up text messaging (SMS) for ${companyName || 'our company'} `
        + `(company id ${companyId}). We need our RingCentral account connected and our first phone line added.`;
}
