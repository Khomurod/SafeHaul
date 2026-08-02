const { assertCompanyAccess } = require("../../shared/companyAccess");

/**
 * Backward-compatible helper used by bulk action modules.
 * Enforces strict tenant RBAC based on explicit company roles.
 */
const assertCompanyAdmin = async (userId, companyId) => {
    await assertCompanyAccess(userId, companyId);
};

module.exports = { assertCompanyAdmin };
