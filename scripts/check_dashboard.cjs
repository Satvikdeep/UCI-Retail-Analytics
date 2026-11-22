// Optional local browser QA. See docs/VALIDATION.md for setup.
const assert = require("node:assert/strict");
const {existsSync} = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("../.build/qa/node_modules/playwright-core");

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.RETAIL_CHROME || (existsSync(chrome) ? chrome : undefined);
const origin = process.env.RETAIL_DASHBOARD_URL || "http://127.0.0.1:8765/dashboard/";
const money = new Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP", maximumFractionDigits: 2});
const counts = new Intl.NumberFormat("en-GB");
const pct = new Intl.NumberFormat("en-GB", {style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1});

async function verify() {
  const browser = await chromium.launch({executablePath, headless: true});
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(origin);
    const datasets = await page.evaluate(() => window.RETAIL_DATA);
    const views = {
      "Sales overview": "sales",
      "Reconciliation": "reconciliation",
      "Customer risk": "customers",
      "Linkage & quality": "linkage"
    };
    const row = (table, scope, period) => datasets[table].find(r => r.scope === scope && r.period === period);
    const select = (id, value) => page.locator("#" + id).selectOption(String(value));
    async function view(name) {
      await page.getByRole("link", {name, exact: true}).click();
      await page.waitForFunction(id => location.hash === "#" + id &&
        document.querySelector(`[href="#${id}"]`).getAttribute("aria-current") === "page", views[name]);
    }
    const metric = index => page.locator(".metric strong").nth(index);
    async function assertTitle(index, expected) {
      assert.equal(await metric(index).getAttribute("title"), money.format(expected));
    }
    async function assertGeometry() {
      const fits = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= innerWidth + 1,
        canvas: [...document.querySelectorAll("canvas")].every(c => c.width > 100 && c.height > 100),
        content: document.querySelector("main").clientWidth <= innerWidth,
        metrics: [...document.querySelectorAll(".metric")].every(card =>
          card.scrollWidth <= card.clientWidth + 1)
      }));
      assert.ok(fits.document && fits.canvas && fits.content && fits.metrics, JSON.stringify(fits));
    }
    await assertTitle(0, row("sales_totals", "All markets", "All dates").gross);
    await assertTitle(1, row("sales_totals", "All markets", "All dates").net);
    await page.getByText("Monthly values", {exact: true}).click();
    assert.equal(await page.getByRole("region", {name: "Monthly sales values"}).locator("tbody tr").count(), 25);
    await select("scope", "Outside UK");
    await select("period", "Jan–Nov 2011");
    const outside = row("sales_totals", "Outside UK", "Jan–Nov 2011");
    await assertTitle(0, outside.gross);
    assert.equal(await metric(2).textContent(), counts.format(outside.sales_invoices));
    await page.getByText("Monthly values", {exact: true}).click();
    assert.equal(await page.getByRole("region", {name: "Monthly sales values"}).locator("tbody tr").count(), 11);

    await view("Reconciliation");
    await assertTitle(2, outside.cancelled);
    await page.getByText("Raw-to-net disposition ledger", {exact: true}).click();
    const disposition = page.getByRole("region", {name: "Raw-to-net dispositions"});
    const expected = datasets.reconciliation.filter(r => r.scope === "Outside UK" && r.period === "Jan–Nov 2011");
    assert.equal(await disposition.locator("tbody tr").count(), expected.length);
    const positive = expected.find(r => r.disposition === "Positive merchandise");
    assert.ok((await disposition.getByRole("row", {name: /Positive merchandise/}).textContent()).includes(money.format(positive.normalized_signed_value)));
    await select("scope", "All markets");
    await select("period", "Dec 2010");
    await page.getByText("Raw-to-net disposition ledger", {exact: true}).click();
    assert.ok((await disposition.getByRole("row", {name: /Mirrored worksheet overlap/}).textContent()).includes("22,523"));

    await view("Customer risk");
    await select("scope", "United Kingdom");
    await select("period", "Jan–Nov 2011");
    const uk = row("concentration", "United Kingdom", "Jan–Nov 2011");
    assert.equal(await metric(2).textContent(), pct.format(uk.top1_share_identified));
    for (const age of [90, 180]) {
      await select("age", age);
      const r = datasets.repeat_comparison.find(r => r.scope === "United Kingdom" && r.cohort_year === "2011" && Number(r.days) === age);
      const cohort = page.getByRole("region", {name: "Equal-age repeat comparison"}).getByRole("row", {name: /2011/});
      assert.ok((await cohort.textContent()).includes(pct.format(r.repeat_rate)));
      assert.ok((await cohort.textContent()).includes(counts.format(r.eligible_customers)));
    }
    await page.getByText("Cohort denominators and maturity").click();
    await page.getByText("Still maturing", {exact: true}).first().waitFor({state: "visible"});

    await view("Linkage & quality");
    await select("scope", "All markets");
    await select("period", "All dates");
    for (const lookback of [90, 365]) {
      await select("lookback", lookback);
      const rows = datasets.linkage_coverage.filter(r => r.scope === "All markets" && r.period === "All dates" && Number(r.lookback) === lookback);
      const sum = key => rows.reduce((a, r) => a + Number(r[key]), 0);
      assert.equal(await metric(0).textContent(), counts.format(sum("cancellation_lines")));
      assert.equal(await metric(2).textContent(), pct.format(sum("matched_value") / sum("cancellation_value")));
    }
    await select("period", "Jan–Nov 2011");
    await select("scope", "Outside UK");
    assert.ok((await page.locator(".metric").first().textContent()).includes(money.format(outside.cancelled)));
    const missing = [...new Set(datasets.sales_totals.map(row => row.scope))]
      .find(scope => !row("sales_totals", scope, "Jan–Nov 2011"));
    assert.ok(missing);
    await select("scope", missing);
    await page.getByText("No eligible cancellation-coded merchandise for this market and period.").waitFor();
    await view("Sales overview");
    await page.getByText("No records for the selected market and period.", {exact: true}).first().waitFor();
    await view("Reconciliation");
    await page.getByText("No records for the selected market and period.", {exact: true}).waitFor();
    await view("Customer risk");
    await page.getByText("No eligible positive sales in the selected market and period.").waitFor();

    await select("scope", "All markets");
    await select("period", "All dates");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      for (const [name, id] of Object.entries(views)) {
        await view(name);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await assertGeometry();
        await page.screenshot({path: `.build/qa/${id}-${width}.png`, fullPage: width !== 320});
      }
      await page.getByRole("link", {name: "Executive report"}).click();
      await page.getByRole("heading", {name: "Principal findings"}).waitFor();
      const findings = await page.locator("#findings").textContent();
      assert.ok(findings.includes(money.format(row("sales_totals", "All markets", "All dates").net)));
      assert.ok(findings.includes("£160,717.84") && findings.includes("38.8%") && findings.includes("£618,280.85"));
      assert.equal(await page.locator(".priorities li").count(), 4);
      await assertGeometry();
      await page.screenshot({path: `.build/qa/report-${width}.png`, fullPage: width !== 320});
      await page.getByRole("link", {name: "Documentation", exact: true}).click();
      await page.getByRole("heading", {name: /International Sales, Cancellations/}).waitFor();
      await assertGeometry();
      const documents = page.getByRole("navigation", {name: "Documents"});
      const libraryPages = await documents.getByRole("link").all();
      assert.equal(libraryPages.length, 9);
      if (width === 1440) {
        const urls = await documents.getByRole("link").evaluateAll(links => links.map(link => link.href));
        for (const url of urls) {
          await page.goto(url);
          await assertGeometry();
          assert.equal(await documents.locator('[aria-current="page"]').count(), 1);
          assert.ok(await page.locator(".doc-content").textContent());
          const source = page.getByRole("link", {name: "View Markdown"});
          assert.ok((await source.getAttribute("href")).endsWith(".md"));
        }
      }
      await documents.getByRole("link", {name: "Technical appendix", exact: true}).click();
      await page.getByRole("heading", {name: "Technical appendix", exact: true}).waitFor();
      await assertGeometry();
      assert.ok(await page.locator(".model-flow dl > div").count() > 3);
      await page.screenshot({path: `.build/qa/library-${width}.png`, fullPage: false});
      await page.getByRole("navigation", {name: "On this page"}).getByText("Metric dictionary").click();
      assert.equal(new URL(page.url()).hash, "#metric-dictionary");
      await page.getByRole("link", {name: "Dashboard", exact: true}).click();
    }
    const direct = pathToFileURL(path.resolve("dashboard/index.html")).href;
    await page.goto(direct);
    await assertTitle(0, row("sales_totals", "All markets", "All dates").gross);
    await page.getByRole("link", {name: "Documentation", exact: true}).click();
    await page.getByRole("navigation", {name: "Documents"}).getByText("Findings register", {exact: true}).click();
    await page.getByRole("heading", {name: "Findings register", exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS: four views, filters, SQL-backed values, empty states, executive report, nine documentation pages, anchored navigation, file-only mode and 1440/390/320px viewports.");
  } finally {
    await browser.close();
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
