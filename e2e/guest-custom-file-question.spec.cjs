/**
 * A company's custom "file upload" question, in a real browser.
 *
 * Until 2026-10-02 the question recorded the chosen file's NAME the moment a file
 * was picked — before the upload had finished, and whether or not it ever did —
 * and threw away the storage path the upload returned. So the company saw a
 * filename that nothing referenced, and a failed upload still read as answered.
 * The answer is the uploaded file now, recorded only once it has landed.
 *
 * The fixture company carries no custom questions unless `?e2eCustomQuestions=file`
 * gives it one (`buildE2EPublicProfile`), because a custom step renumbers every
 * step title the other specs are written against. Uploads use the E2E double in
 * `useGuestFileUpload`: `?e2eUpload=deny:<field>` makes it refuse that one, and
 * `slow:<field>` keeps that one on its way.
 */
const { test, expect } = require('@playwright/test');
const {
    chooseRadio,
    continueAnywayPastEmploymentCoverage,
    continueToStep,
    expectStep,
    fillStep1,
    fillStep2,
    fillStep3RequiredFields,
    pdfFile,
    uploadStandardDocuments,
} = require('./helpers/wizardHelpers.cjs');

/** From page one to the custom question, the same way every guest spec gets there. */
async function reachAdditionalQuestions(page, query = '') {
    await page.goto(`/apply/e2e-company?e2eCustomQuestions=file${query}`);
    await fillStep1(page);
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await chooseRadio(page, 'consent-mvr-yes');
    await chooseRadio(page, 'revoked-licenses-no');
    await chooseRadio(page, 'driving-convictions-no');
    await chooseRadio(page, 'drug-alcohol-convictions-no');
    await chooseRadio(page, 'has-violations-no');
    await continueToStep(page, 'Accident History');
    await chooseRadio(page, 'has-accidents-no');
    await continueToStep(page, 'Employment History');
    await continueAnywayPastEmploymentCoverage(page);
    await chooseRadio(page, 'has-felony-no');
    await continueToStep(page, 'Additional Questions');
}

test.describe('a custom file upload question', () => {
    test('keeps the uploaded file, and the review shows it by name', async ({ page }) => {
        await reachAdditionalQuestions(page);

        await page.getByLabel(/Upload your resume/).setInputFiles(pdfFile('resume.pdf'));

        await expect(page.getByText('✓ Selected: resume.pdf')).toBeVisible();
        await continueToStep(page, 'Review Information');
        const section = page.locator('section, div').filter({ has: page.getByText('Upload your resume', { exact: true }) }).last();
        await expect(section.getByText('resume.pdf', { exact: true })).toBeVisible();
        await expect(page.getByText('[object Object]')).toHaveCount(0);
    });

    test('shows the upload on its way with Cancel, which gives the picker back', async ({ page }) => {
        // Only this question's upload is held on its way.
        await reachAdditionalQuestions(page, '&e2eUpload=slow:e2e-resume');

        await page.getByLabel(/Upload your resume/).setInputFiles(pdfFile('resume.pdf'));
        // Named: the wizard's own step progress is a progress bar too.
        const progress = page.getByRole('progressbar', { name: 'Upload your resume upload progress' });
        await expect(progress).toBeVisible();
        await page.getByRole('button', { name: 'Cancel upload of Upload your resume' }).click();

        await expect(progress).toHaveCount(0);
        await expect(page.getByLabel(/Upload your resume/)).toBeEnabled();
        await expect(page.getByText(/✓ Selected/)).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    test('records nothing when the upload fails, and the required question still stops the driver', async ({ page }) => {
        // Only this question's upload is refused; the licence and medical card still land.
        await reachAdditionalQuestions(page, '&e2eUpload=deny:e2e-resume');

        await page.getByLabel(/Upload your resume/).setInputFiles(pdfFile('resume.pdf'));

        // Beside the question, where it outlasts the toast, with a way to send it again.
        const failure = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Try again', exact: true }) });
        await expect(failure).toContainText('Upload failed. Please try again.');
        await expect(page.getByText(/✓ Selected/)).toHaveCount(0);
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText('Please answer required question: Upload your resume')).toBeVisible();
        await expectStep(page, 'Additional Questions');
    });
});
