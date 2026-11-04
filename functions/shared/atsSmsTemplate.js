/**
 * Interpolate ATS automated SMS templates.
 * Placeholders: {driver name}, {user name}, {application link} (case-insensitive).
 * The link is the company's application page with the recruiter's link code
 * (`applicationLink.js`); the caller looks it up only when the template uses it.
 */
const APPLICATION_LINK = /\{application link\}/gi;

/** Whether a template uses {application link}. */
function mentionsApplicationLink(template) {
  return /\{application link\}/i.test(template == null ? '' : String(template));
}

function safeSegment(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function parseAtsSmsTemplate(template, { driverName, userName, applicationLink } = {}) {
  let out = template == null ? '' : String(template);
  const dn = safeSegment(driverName);
  const un = safeSegment(userName);
  const link = safeSegment(applicationLink);
  out = out.replace(/\{driver name\}/gi, dn);
  out = out.replace(/\{user name\}/gi, un);
  // A function replacer: a "$&" in the address is text, not a replacement pattern.
  out = out.replace(APPLICATION_LINK, () => link);
  return out;
}

module.exports = { parseAtsSmsTemplate, mentionsApplicationLink };
