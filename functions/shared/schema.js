const Joi = require('joi');

// Common schemas
const emailSchema = Joi.string().email().trim().lowercase().required();
const optionalEmailSchema = Joi.string().email().trim().lowercase();
const idSchema = Joi.string().min(1).max(100).required();
const optionalIdSchema = Joi.string().min(1).max(100);

// Data structure schemas
const companyUpdateSchema = Joi.object({
    companyId: idSchema,
    updates: Joi.object({
        name: Joi.string().min(2).max(100),
        dailyQuota: Joi.number().integer().min(0).max(10000),
        isActive: Joi.boolean()
    }).min(1).required()
});

const sendEmailSchema = Joi.object({
    companyId: idSchema,
    recipientEmail: emailSchema,
    triggerType: Joi.string().valid('no_answer', 'generic', 'follow_up').required(),
    placeholders: Joi.object({
        driverfirstname: Joi.string().allow('', null),
        companyname: Joi.string().allow('', null),
        companyslug: Joi.string().allow('', null),
        recruitername: Joi.string().allow('', null)
    }).unknown(true)
});

const deleteCompanySchema = Joi.object({
    companyId: idSchema
});

const initBulkSessionSchema = Joi.object({
    companyId: idSchema,
    filters: Joi.object().required(),
    messageConfig: Joi.object().required(),
    scheduledFor: Joi.string().isoDate().allow(null),
    name: Joi.string().allow('', null),
    rawData: Joi.array().items(Joi.object()).allow(null)
});

module.exports = {
    emailSchema,
    idSchema,
    companyUpdateSchema,
    sendEmailSchema,
    deleteCompanySchema,
    initBulkSessionSchema
};
