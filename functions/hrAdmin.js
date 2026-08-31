// hr portal/functions/hrAdmin.js
//
// The HR admin surface: five deployed functions re-exported from modules
// split by what each does. `functions/index.js` reads each handler by name
// off this module, so these names are the deployment contract.

const { createPortalUser } = require("./hrAdmin/createUser");
const { onMembershipWrite } = require("./hrAdmin/membership");
const { deletePortalUser, updatePortalUser } = require("./hrAdmin/manageUser");
const { listCompanyTeam } = require("./hrAdmin/team");

module.exports = {
    createPortalUser,
    onMembershipWrite,
    deletePortalUser,
    updatePortalUser,
    listCompanyTeam,
};
