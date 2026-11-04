/**
 * Each RingCentral SDK keeps its own session. Under Node the SDK's default
 * store is one module-wide object, and every SDK uses the same key in it, so a
 * second SDK alive in the same function instance (another line, another
 * company) would read, refresh or overwrite the first one's tokens.
 *
 * The real SDK on purpose; nothing is sent anywhere (tokens are set directly).
 */

const { createRingCentralSdk } = require('../../integrations/adapters/ringcentralSdk');

const sdk = () => createRingCentralSdk({ server: 'http://127.0.0.1:9', clientId: 'c', clientSecret: 's' });

it("does not let one SDK read another's tokens", async () => {
    const lineA = sdk();
    const lineB = sdk();

    await lineA.platform().auth().setData({ access_token: 'token-a', refresh_token: 'refresh-a' });

    expect((await lineA.platform().auth().data()).access_token).toBe('token-a');
    expect((await lineB.platform().auth().data()).access_token).not.toBe('token-a');

    await lineB.platform().auth().setData({ access_token: 'token-b', refresh_token: 'refresh-b' });
    expect((await lineA.platform().auth().data()).access_token).toBe('token-a');
});

it("clears only its own session", async () => {
    const lineA = sdk();
    const lineB = sdk();
    await lineA.platform().auth().setData({ access_token: 'token-a' });
    await lineB.platform().auth().setData({ access_token: 'token-b' });

    await lineB.cache().clean();

    expect((await lineA.platform().auth().data()).access_token).toBe('token-a');
    expect((await lineB.platform().auth().data()).access_token).not.toBe('token-b');
});
