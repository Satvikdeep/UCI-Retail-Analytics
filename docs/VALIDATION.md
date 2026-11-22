# Validation and reproducibility

## Recorded checks

| Scope | Check | Result |
|---|---|---|
| Original | Official archive and a clean-path scripted download produced the same pinned workbook SHA-256 | Pass |
| Source population | Python extractor and PostgreSQL matched both sheets, record counts, dates, missing-ID and missing-description counts, and exact signed values | Pass |
| Mirrored overlap | SQL full-field grouped fingerprints and independent Python tuple multisets matched 22,523 rows on both sheets | Pass |
| Main analytical totals | Independent Python integer-millipound sums and set counts matched 175 SQL period/market keys for gross, cancellations, other merchandise adjustments, net, identified gross, sales invoices and customers | Pass |
| SQL controls | 17 zero-failure checks for raw lineage, keys, disposition and exact money bridge, invoice consistency, customer-mix/driver additivity, cohorts, linkage population, chronology and both capacity bounds | Pass |
| Reproducibility | Two complete invocations of `scripts/rebuild.sh` re-extracted the preserved workbook. All 28 checksummed CSV, JSON and dashboard-data files were byte-identical. Second run exercised starting and stopping the project-only server. | Pass |
| Browser behaviour | Installed Chrome driven by Playwright verified all four views. Tested exact all-market and filtered sales, UK cohort rates and denominators, Outside UK reconciliation and linkage, 90/365-day linkage, Dec 2010 overlap, tab state, details and empty states. Also tested the report and local file mode. | Pass |
| Layout | Rendered four views and report at 1440, 390 and 320 CSS pixels. Checked page and chart geometry. Visual inspection identified a clipped chart tick and overly wide report table, then verified the corrected renders. | Pass |

[SQL validation results](../outputs/validation.csv) · [Independent checks](../outputs/independent_checks.json) · [SHA-256 manifest](../outputs/sha256.txt)

The SQL bridge uses exact signed decimals and fails the rebuild if any test fails. The Python check reads raw extracted source cells, accumulates signed amounts as integer millipounds and independently counts distinct invoice and customer keys. It also compares source control sums calculated during workbook extraction against SQL. These checks share the pinned source and extract. Testing a workbook from a different version would require explicit source verification.

The link audit validates candidate keys, strict chronology, lookback, event completion, and capacity per sale line and lookback. It can verify consistency with the stated rule. Original-order mappings, posting reasons, realized refunds and cash outcomes are unavailable in the workbook. Cross-browser and native spreadsheet app rendering were outside the verified environment. The dashboards use aggregated public-retail data locally.

## Presentation refresh

The executive layout refresh was checked in Chrome at 1,440, 390 and 320 CSS pixels. The browser test exercises the four analysis views, report, nine rendered Markdown pages, internal section navigation and local file mode. The analytics output manifest still verifies. The reader is generated from the editable Markdown and can be checked with `.build/docs-venv/bin/python scripts/build_docs.py --check`.

## Repeat the checks

```sh
./scripts/rebuild.sh
cp outputs/sha256.txt .build/previous.sha256
./scripts/rebuild.sh
cmp .build/previous.sha256 outputs/sha256.txt
shasum -a 256 -c outputs/sha256.txt
```

For optional browser verification, use installed Google Chrome and Node.js 20+. The dependency stays inside ignored project state. Start the local preview server in one terminal and run QA from the project root in another.

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

```sh
npm install --prefix .build/qa --no-audit --no-fund --save-exact playwright-core@1.60.0
node scripts/check_dashboard.cjs
```

On a system with Chrome installed elsewhere, set `RETAIL_CHROME` to its executable path. The script saves screenshots under `.build/qa`. Stop the preview with Ctrl-C.
