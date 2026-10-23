const { test, expect } = require('@playwright/test');
const {
  chooseRadio,
  continueToStep,
  fillMonthYear,
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  pdfFile,
  uploadStandardDocuments,
  waitForUploads,
} = require('./helpers/wizardHelpers.cjs');

/**
 * The driver application on a narrow Android phone keeps every field inside
 * its card. Run by the `mobile-chrome` lane (Pixel 7) at 360 px, the width of
 * most Android phones, and of a 412 px phone with its larger text setting.
 *
 * Two layouts gave way there:
 *  - an uploaded file's name set the width of the whole License card, so the
 *    upload rows, the license number and the date boxes ran past its border and
 *    the page scrolled sideways;
 *  - the month and year boxes in a list row (employers, schools, violations…)
 *    sat side by side even when neither could show its value, so a chosen year
 *    read "202".
 */

test.use({ viewport: { width: 360, height: 800 } });

/** Names a phone gives its camera shots and scans. */
const PHONE_FILE_NAMES = {
  'cdl-front': 'Scanned_20261022-143512_CDL_front.pdf',
  'cdl-back': 'Scanned_20261022-143547_CDL_back.pdf',
  'medical-card-upload': 'Scanned_20261022-143612_Medical_Card.pdf',
};

async function openWizard(page) {
  await page.goto('/apply/e2e-company');
  await fillStep1(page, 'phone');
  await fillStep2(page);
}

/** How far the page and the License card are wider than what they show. */
async function horizontalSpill(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-upload-field="cdl-front"]').closest('.ds-form-section');
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      card: card.scrollWidth - card.clientWidth,
    };
  });
}

/**
 * The selects whose chosen text does not fit, with how many pixels short they
 * are. What a select needs is measured by the browser itself: a copy holding
 * only the chosen option, sized to its content, beside the original.
 */
async function clippedSelects(page, ids) {
  return page.evaluate((selectIds) => selectIds.map((id) => {
    const select = document.getElementById(id);
    const copy = select.cloneNode(false);
    copy.removeAttribute('id');
    copy.append(new Option(select.options[select.selectedIndex].text));
    copy.style.cssText = 'position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none';
    select.parentElement.append(copy);
    const needed = copy.getBoundingClientRect().width;
    copy.remove();
    return { id, short: Math.ceil(needed - select.getBoundingClientRect().width) };
  }).filter((entry) => entry.short > 0), ids);
}

test.describe('driver application on a narrow phone @mobile', () => {
  test.describe.configure({ timeout: 90_000 });

  test('uploaded files with phone-style names stay inside the License card @mobile', async ({ page }) => {
    await openWizard(page);
    await fillStep3RequiredFields(page);
    for (const [field, name] of Object.entries(PHONE_FILE_NAMES)) {
      await page.setInputFiles(`input[name="${field}"]`, pdfFile(name));
    }
    await waitForUploads(page, Object.keys(PHONE_FILE_NAMES));

    expect(await horizontalSpill(page)).toEqual({ page: 0, card: 0 });
    // The whole name is shown, wrapped inside the row rather than cut short.
    const fileName = page.getByText(PHONE_FILE_NAMES['cdl-front'], { exact: true });
    await expect(fileName).toBeVisible();
    expect(await fileName.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await continueToStep(page, 'Motor Vehicle Record');
  });

  test('month and year in an employer row both show their value @mobile', async ({ page }) => {
    await openWizard(page);
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

    await page.getByRole('button', { name: '+ Add Employer' }).click();
    await fillMonthYear(page, 'emp-start-0', { month: 9, year: 2024 });

    expect(await clippedSelects(page, ['emp-start-0-month', 'emp-start-0-year'])).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
});
