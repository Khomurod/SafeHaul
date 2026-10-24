// A made-up lead file, uploaded on the Import Leads page as a person would, so
// its preview table can be measured and pictured. The file goes through the
// real import worker; nothing reaches Firestore before Confirm Upload.

const LEAD_FILE = [
  'First Name,Last Name,Email,Phone,City,State,Experience,Job Type',
  'Rosa,Delgado,rosa.delgado@example.test,(555) 010-3321,Dallas,TX,5,OTR',
  'Jean-Baptiste,Okonkwo-Fairweather,jean-baptiste.okonkwo-fairweather@example.test,(555) 010-4410,Oklahoma City,OK,12,Regional',
  'Ali,Hassan,ali.hassan@example.test,(555) 010-7788,Austin,TX,2,Local',
].join('\n');

/** Picks the file in the upload step; the preview follows. */
async function uploadLeadFile(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'artificial-leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(LEAD_FILE, 'utf8'),
  });
}

module.exports = { uploadLeadFile };
