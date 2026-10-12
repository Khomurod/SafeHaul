// The pause between two sends of a bulk session, with the real clock faked:
// the suites that run the send loop answer it at once, so this is where its
// numbers are held.

const { pauseAfter, pauseBeforeNextSend } = require('../../bulkActions/workers/sendPacing');

describe('the pause between two sends', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('starts the next send three seconds after the last one started', () => {
        expect(pauseAfter(0)).toBe(3000);
        expect(pauseAfter(1200)).toBe(1800);
    });

    it('still pauses a tenth of a second after a send slower than that', () => {
        expect(pauseAfter(2950)).toBe(100);
        expect(pauseAfter(9000)).toBe(100);
    });

    it('really waits that long', async () => {
        let done = false;
        pauseBeforeNextSend(1200).then(() => { done = true; });

        await jest.advanceTimersByTimeAsync(1799);
        expect(done).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });
});
