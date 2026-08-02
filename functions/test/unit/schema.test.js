const { companyUpdateSchema, emailSchema, sendEmailSchema } = require('../../shared/schema');

describe('Validation Schemas', () => {
    describe('emailSchema', () => {
        it('should validate correct emails', () => {
            const { error, value } = emailSchema.validate('Test@Example.com');
            expect(error).toBeUndefined();
            expect(value).toBe('test@example.com'); // Lowercase transform
        });

        it('should reject invalid emails', () => {
            const { error } = emailSchema.validate('invalid-email');
            expect(error).toBeDefined();
        });
    });

    describe('companyUpdateSchema', () => {
        it('should validate valid company updates', () => {
            const payload = {
                companyId: 'comp123',
                updates: {
                    name: 'New Name',
                    dailyQuota: 50
                }
            };
            const { error } = companyUpdateSchema.validate(payload);
            expect(error).toBeUndefined();
        });

        it('should reject updates with missing required fields', () => {
            const payload = {
                companyId: 'comp123'
                // Missing 'updates' object
            };
            const { error } = companyUpdateSchema.validate(payload);
            expect(error).toBeDefined();
        });

        it('should reject negative quotas', () => {
            const payload = {
                companyId: 'comp123',
                updates: { dailyQuota: -1 }
            };
            const { error } = companyUpdateSchema.validate(payload);
            expect(error).toBeDefined();
        });
    });

    describe('sendEmailSchema', () => {
        it('should validate pev_request trigger type', () => {
            const payload = {
                companyId: 'comp123',
                recipientEmail: 'hr@previousemployer.com',
                triggerType: 'pev_request',
                placeholders: {
                    applicantname: 'John Doe',
                    employername: 'Previous Corp',
                    companyname: 'Current Trucking LLC',
                    employmentdates: '01/2020 to 06/2023'
                }
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeUndefined();
        });

        it('should validate no_answer trigger type', () => {
            const payload = {
                companyId: 'comp123',
                recipientEmail: 'driver@test.com',
                triggerType: 'no_answer',
                placeholders: {
                    driverfirstname: 'Jane',
                    companyname: 'Test Trucking'
                }
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeUndefined();
        });

        it('should reject invalid trigger types', () => {
            const payload = {
                companyId: 'comp123',
                recipientEmail: 'test@test.com',
                triggerType: 'invalid_type',
                placeholders: {}
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeDefined();
        });

        it('should reject missing recipientEmail', () => {
            const payload = {
                companyId: 'comp123',
                triggerType: 'pev_request',
                placeholders: {}
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeDefined();
        });

        it('should reject missing companyId', () => {
            const payload = {
                recipientEmail: 'test@test.com',
                triggerType: 'pev_request',
                placeholders: {}
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeDefined();
        });

        it('should allow unknown placeholder fields for pev_request', () => {
            const payload = {
                companyId: 'comp123',
                recipientEmail: 'hr@company.com',
                triggerType: 'pev_request',
                placeholders: {
                    applicantname: 'John Doe',
                    employername: 'Prev Corp',
                    customfield: 'custom value'
                }
            };
            const { error } = sendEmailSchema.validate(payload);
            expect(error).toBeUndefined();
        });
    });
});
