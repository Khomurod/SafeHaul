/**
 * What the RingCentral adapter keeps of a send, and how it reads the line's
 * sent texts back. RingCentral answers a send with the message record (its id
 * and "Queued"); the adapter used to throw that answer away, so nothing could
 * later ask whether the text arrived. All data is artificial.
 */

jest.mock('@ringcentral/sdk', () => {
    class SDK {
        constructor() {}
    }
    SDK.server = { sandbox: 'sandbox', production: 'production' };
    return { SDK };
});

const RingCentralAdapter = require('../../integrations/adapters/ringcentral');

const json = (body) => ({ json: async () => body });

function adapterWith(rc) {
    const adapter = new RingCentralAdapter({ clientId: 'cid', clientSecret: 'secret', jwt: 'jwt', defaultPhoneNumber: '+15550000001' });
    adapter.rc = rc;
    adapter.ensureLoggedIn = jest.fn().mockResolvedValue(undefined);
    return adapter;
}

describe('sending', () => {
    it("keeps RingCentral's message id and first status", async () => {
        const adapter = adapterWith({ post: jest.fn().mockResolvedValue(json({ id: 402406986008, messageStatus: 'Queued' })) });

        await expect(adapter.sendSMSWithReceipt('+15558675309', 'hello')).resolves.toEqual({
            providerMessageId: '402406986008',
            providerStatus: 'Queued',
        });
    });

    it('still answers true to the callers of sendSMS', async () => {
        const adapter = adapterWith({ post: jest.fn().mockResolvedValue(json({ id: 7, messageStatus: 'Queued' })) });

        await expect(adapter.sendSMS('+15558675309', 'hello')).resolves.toBe(true);
    });

    it('counts a text as sent when the answer has no readable body', async () => {
        const adapter = adapterWith({ post: jest.fn().mockResolvedValue({ json: async () => { throw new Error('bad body'); } }) });

        await expect(adapter.sendSMSWithReceipt('+15558675309', 'hello')).resolves.toEqual({ providerMessageId: null, providerStatus: null });
    });

    it('keeps the id of the send that went out without the rejected from line', async () => {
        const rejected = Object.assign(new Error("Phone number doesn't belong to extension"), {
            response: { status: 400, data: { message: "Phone number doesn't belong to extension" } },
        });
        const post = jest.fn()
            .mockRejectedValueOnce(rejected)
            .mockResolvedValueOnce(json({ id: 55, messageStatus: 'Queued' }));
        const adapter = adapterWith({ post });

        await expect(adapter.sendSMSWithReceipt('+15558675309', 'hello')).resolves.toEqual({ providerMessageId: '55', providerStatus: 'Queued' });
        expect(post).toHaveBeenCalledTimes(2);
    });
});

describe('listSentSms', () => {
    const query = { dateFrom: '2026-10-20T14:50:00.000Z', dateTo: '2026-10-20T15:10:00.000Z' };

    it("reads the line's sent texts in the window, page by page", async () => {
        const get = jest.fn()
            .mockResolvedValueOnce(json({ records: [{ id: 1 }, { id: 2 }], paging: { page: 1, totalPages: 2 } }))
            .mockResolvedValueOnce(json({ records: [{ id: 3 }], paging: { page: 2, totalPages: 2 } }));
        const adapter = adapterWith({ get });

        await expect(adapter.listSentSms(query)).resolves.toEqual({ records: [{ id: 1 }, { id: 2 }, { id: 3 }], complete: true });
        expect(get).toHaveBeenNthCalledWith(1, '/restapi/v1.0/account/~/extension/~/message-store', {
            direction: 'Outbound', messageType: 'SMS', ...query, perPage: 1000, page: 1,
        });
        expect(get.mock.calls[1][1].page).toBe(2);
        expect(adapter.ensureLoggedIn).toHaveBeenCalled();
    });

    it('says the listing is incomplete when there are more pages than it reads', async () => {
        const get = jest.fn().mockResolvedValue(json({ records: [{ id: 1 }], paging: { totalPages: 9 } }));
        const adapter = adapterWith({ get });

        await expect(adapter.listSentSms({ ...query, maxPages: 2 })).resolves.toEqual({ records: [{ id: 1 }, { id: 1 }], complete: false });
        expect(get).toHaveBeenCalledTimes(2);
    });

    it("passes RingCentral's refusal on, so the check can say the app may not read messages", async () => {
        const refused = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
        const adapter = adapterWith({ get: jest.fn().mockRejectedValue(refused) });

        await expect(adapter.listSentSms(query)).rejects.toBe(refused);
    });
});
