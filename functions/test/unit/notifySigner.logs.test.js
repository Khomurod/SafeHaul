/**
 * The signing email's logs name the request, never the signer's address: a
 * Cloud Functions log is read by everyone who can read the project's logs.
 * The address below is artificial.
 */
jest.mock('firebase-functions/v1', () => ({
    runWith: () => ({ firestore: { document: () => ({ onCreate: (fn) => fn }) } }),
}));
jest.mock('../../firebaseAdmin', () => ({ admin: {}, db: {} }));
const mockSend = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSend(...args) }));

const { emailSigningLink } = require('../../notifySigner');

const ADDRESS = 'dana.driver@example.test';
const ref = { update: jest.fn(async () => {}) };
const send = () => emailSigningLink({
    companyId: 'co-1',
    requestId: 'req-1',
    ref,
    data: { recipientEmail: ADDRESS, recipientName: 'Dana', title: 'Offer Letter', appBaseUrl: 'https://truckerapp-system.web.app' },
    accessToken: 'token-1',
});
const logged = () => [console.log, console.warn, console.error]
    .flatMap((spy) => spy.mock.calls.flat())
    .map((value) => (value instanceof Error ? value.message : String(value)))
    .join('\n');

beforeEach(() => {
    jest.resetAllMocks();
    ref.update.mockImplementation(async () => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('logs a sent email by its request, without the address', async () => {
    mockSend.mockResolvedValue(undefined);
    await send();
    expect(mockSend).toHaveBeenCalledWith('co-1', ADDRESS, expect.any(String), expect.any(String));
    expect(logged()).toContain('req-1');
    expect(logged()).not.toContain(ADDRESS);
});

it('logs a failed email without the address, even when the mail server names it', async () => {
    mockSend.mockRejectedValue(new Error(`550 mailbox ${ADDRESS} unavailable`));
    await send();
    expect(logged()).toContain('req-1');
    expect(logged()).not.toContain(ADDRESS);
});
