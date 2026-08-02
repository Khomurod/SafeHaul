jest.mock('@ringcentral/sdk', () => {
  class SDK {
    constructor() {}
  }
  SDK.server = { sandbox: 'sandbox', production: 'production' };
  return { SDK };
});

const RingCentralAdapter = require('../../integrations/adapters/ringcentral');

function adapterWithMockedSend(config = {}) {
  const adapter = new RingCentralAdapter({
    clientId: 'cid',
    clientSecret: 'secret',
    jwt: 'jwt',
    defaultPhoneNumber: '+15550000001',
    ...config,
  });
  adapter.ensureLoggedIn = jest.fn().mockResolvedValue(undefined);
  return adapter;
}

describe('RingCentralAdapter explicit from fallback', () => {
  it('retries without explicit from when RingCentral says the line is not on the JWT extension', async () => {
    const adapter = adapterWithMockedSend({ assignments: { user1: '+15550000001' } });
    const rcError = new Error("Phone number doesn't belong to extension");
    rcError.response = { status: 400, data: { message: "Phone number doesn't belong to extension" } };
    adapter._sendWithRetry = jest.fn()
      .mockRejectedValueOnce(rcError)
      .mockResolvedValueOnce(undefined);

    await expect(adapter.sendSMS('+15558675309', 'hello', 'user1')).resolves.toBe(true);

    expect(adapter._sendWithRetry).toHaveBeenCalledTimes(2);
    expect(adapter._sendWithRetry.mock.calls[0][1]).toMatchObject({
      from: { phoneNumber: '+15550000001' },
      to: [{ phoneNumber: '+15558675309' }],
      text: 'hello',
    });
    expect(adapter._sendWithRetry.mock.calls[1][1]).toEqual({
      to: [{ phoneNumber: '+15558675309' }],
      text: 'hello',
    });
  });

  it('also retries without explicit from when RingCentral reports an invalid from parameter', async () => {
    const adapter = adapterWithMockedSend();
    const rcError = new Error('Parameter [from] value is invalid');
    rcError.response = { status: 400, data: { message: 'Parameter [from] value is invalid' } };
    adapter._sendWithRetry = jest.fn()
      .mockRejectedValueOnce(rcError)
      .mockResolvedValueOnce(undefined);

    await expect(adapter.sendSMS('+15558675309', 'hello')).resolves.toBe(true);

    expect(adapter._sendWithRetry).toHaveBeenCalledTimes(2);
    expect(adapter._sendWithRetry.mock.calls[0][1]).toMatchObject({
      from: { phoneNumber: '+15550000001' },
      to: [{ phoneNumber: '+15558675309' }],
      text: 'hello',
    });
    expect(adapter._sendWithRetry.mock.calls[1][1]).toEqual({
      to: [{ phoneNumber: '+15558675309' }],
      text: 'hello',
    });
  });
});
