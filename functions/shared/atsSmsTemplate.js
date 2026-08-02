/**
 * Interpolate ATS automated SMS templates.
 * Placeholders: {driver name}, {user name} (case-insensitive).
 */
function safeSegment(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function parseAtsSmsTemplate(template, { driverName, userName } = {}) {
  let out = template == null ? '' : String(template);
  const dn = safeSegment(driverName);
  const un = safeSegment(userName);
  out = out.replace(/\{driver name\}/gi, dn);
  out = out.replace(/\{user name\}/gi, un);
  return out;
}

module.exports = { parseAtsSmsTemplate };
