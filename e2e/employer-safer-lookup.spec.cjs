const { test, expect } = require('@playwright/test');
const {
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  uploadStandardDocuments,
  continueToStep,
  chooseRadio,
} = require('./helpers/wizardHelpers.cjs');

/**
 * The Employment page's employer lookup, against FMCSA's census as this spec
 * answers it. CI builds without a Socrata app token, so `?e2eSafer=mock` gives the
 * page a placeholder one (only in a browser test) and every request to the census
 * is answered here: nothing leaves the machine.
 *
 * The rows are shaped like real census rows (2026-10-07): an email of "NONE", a
 * Canadian province, a closed carrier, a trade name.
 */
const CENSUS = 'https://data.transportation.gov/resource/az4n-8mr2.json**';

const TEXAS = {
  dot_number: '1000001', legal_name: 'LONE STAR FREIGHT LLC', phy_street: '100 MAIN ST', phy_city: 'AUSTIN',
  phy_state: 'TX', phy_country: 'US', phone: '5125550100', email_address: 'dispatch@lonestarfreight.com', status_code: 'A',
};
const TEXAS_CLOSED = { ...TEXAS, dot_number: '1000002', legal_name: 'LONE STAR HAULING INC', status_code: 'I' };
const ONTARIO = {
  dot_number: '2000002', legal_name: '1788084 ONTARIO INC', dba_name: 'NORTHERN LINE', phy_street: '55 KING ST',
  phy_city: 'TORONTO', phy_state: 'ON', phy_country: 'CA', email_address: 'NONE', status_code: 'A',
};

/** Answers each census query the way Socrata would for these rows. */
async function answerCensus(page) {
  const asked = [];
  await page.route(CENSUS, async (route) => {
    const where = new URL(route.request().url()).searchParams.get('$where') || '';
    asked.push(where);
    const rows = [TEXAS, TEXAS_CLOSED, ONTARIO].filter((row) => {
      if (where.startsWith('dot_number = ')) return where === `dot_number = ${row.dot_number}`;
      const text = /upper\('([^']*)'\)/.exec(where)?.[1]?.toUpperCase() || '';
      const named = row.legal_name.startsWith(text) || (row.dba_name || '').startsWith(text);
      const active = row.status_code === 'A';
      return named && (where.startsWith("status_code = 'A'") ? active : !active);
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  return asked;
}

async function reachEmployment(page) {
  await page.goto('/apply/e2e-company?e2eSafer=mock');
  await fillStep1(page, 'safer');
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
  await page.getByRole('button', { name: '+ Add Employer' }).click();
}

test.describe('the employer lookup', () => {
  test.describe.configure({ timeout: 90_000 });

  test('lists active carriers first, fills a pick, and a second pick leaves nothing of the first', async ({ page }) => {
    const asked = await answerCensus(page);
    await reachEmployment(page);
    const name = page.locator('#emp-name-0');

    await name.fill('LONE');
    // The lookup's own list; every state picker on the page holds options too.
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('LONE STAR FREIGHT LLC');
    await expect(options.nth(1)).toContainText('LONE STAR HAULING INC');
    await expect(options.nth(1)).toContainText('Inactive');
    await options.nth(0).click();

    await expect(page.locator('#emp-street-0')).toHaveValue('100 MAIN ST');
    await expect(page.locator('#emp-city-0')).toHaveValue('AUSTIN');
    await expect(page.locator('#emp-state-0')).toHaveValue('Texas');
    await expect(page.locator('#emp-phone-0')).toHaveValue('5125550100');
    await expect(page.locator('#emp-co-email-0')).toHaveValue('dispatch@lonestarfreight.com');

    // Found by its trade name; a province, and no "NONE" for an email.
    await name.fill('NORTHERN');
    const ontario = page.getByRole('listbox').getByRole('option', { name: /1788084 ONTARIO INC/ });
    await expect(ontario).toContainText('d/b/a NORTHERN LINE');
    await expect(ontario).toContainText('TORONTO, ON, Canada');
    await ontario.click();

    await expect(page.locator('#emp-name-0')).toHaveValue('1788084 ONTARIO INC');
    await expect(page.locator('#emp-street-0')).toHaveValue('55 KING ST');
    await expect(page.locator('#emp-state-0')).toHaveValue('Ontario');
    await expect(page.locator('#emp-phone-0')).toHaveValue('');
    await expect(page.locator('#emp-co-email-0')).toHaveValue('');

    expect(asked.some((where) => where.startsWith("status_code = 'A' AND"))).toBe(true);
  });

  test('finds a carrier by USDOT number, and says when nothing matches', async ({ page }) => {
    await answerCensus(page);
    await reachEmployment(page);
    const name = page.locator('#emp-name-0');

    await name.fill('2000002');
    await expect(page.getByRole('listbox').getByRole('option', { name: /1788084 ONTARIO INC/ })).toBeVisible();

    await name.fill('ZZQX');
    await expect(page.getByText('No carrier found under that name or USDOT number.', { exact: false })).toBeVisible();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    // Typed in by hand, the name stays.
    await expect(name).toHaveValue('ZZQX');
  });
});
