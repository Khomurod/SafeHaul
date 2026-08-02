// E2 coverage: structured logger emits scrubbed JSON with severity.
const logger = require('../../shared/logger');

describe('structured logger (E2)', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits a single JSON line with severity and message (info -> console.log)', () => {
    logger.info('hello', { companyId: 'co1' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({ severity: 'INFO', message: 'hello', companyId: 'co1' });
  });

  it('routes errors to console.error with severity ERROR', () => {
    logger.error('boom', {});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0]).severity).toBe('ERROR');
  });

  it('scrubs PII in the context before emitting', () => {
    logger.warn('contacting lead', { phone: '555-123-4567', note: 'email a@b.com' });
    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload.severity).toBe('WARNING');
    expect(payload.phone).toBe('[redacted]'); // key match
    expect(payload.note).toBe('email [email]'); // value mask
  });

  it('never throws on unserializable context', () => {
    const circular = {};
    circular.self = circular;
    expect(() => logger.error('cycle', circular)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
