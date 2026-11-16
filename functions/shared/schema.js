const Joi = require('joi');

// Common schemas
const emailSchema = Joi.string().email().trim().lowercase().required();
const idSchema = Joi.string().min(1).max(100).required();

// Data structure schemas
const sendEmailSchema = Joi.object({
    companyId: idSchema,
    recipientEmail: emailSchema,
    triggerType: Joi.string().valid('no_answer', 'generic', 'follow_up', 'pev_request', 'manual_email').required(),
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

module.exports = {
    emailSchema,
    idSchema,
    sendEmailSchema,
    deleteCompanySchema
};
