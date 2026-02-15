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
});
