# International Sales, Cancellations & Customer Risk Analytics

A PostgreSQL portfolio project for a UK retailer’s commercial leadership. It examines comparable international sales, cancellation exposure, dependence on large customers, repeat purchasing and the quality of inferred earlier-sale links. The source is Daqing Chen’s original UCI Online Retail II workbook. All values are in sterling, and geography represents customer location.

## Start here

[Open the public project](https://satvikdeep.github.io/UCI-Retail-Analytics/) for the dashboard, executive report and supporting documentation.

- [Executive report](dashboard/report.html) for four findings and ranked investigation priorities
- [Interactive dashboard](dashboard/index.html) for market, reconciliation, customer and linkage analysis
- [Documentation library](dashboard/library/index.html) for methods, source notes, validation and interview prep

The dashboard, report and documentation library open directly in a browser and work offline with the included snapshot. For a local HTTP preview:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Browse to <http://127.0.0.1:8765/dashboard/>. In **Sales overview**, choose Outside UK to see invoice volume and average invoice value move in opposite directions. In **Reconciliation**, select Dec 2010 and open the disposition ledger to see the mirrored overlap. In **Customer risk**, compare 90- and 180-day follow-up. In **Linkage & quality**, switch from 90 to 365 days and inspect candidate evidence. Each view describes which filters affect each panel.

## Rebuild from the original

Requirements are Python 3.11+ and PostgreSQL command-line tools on `PATH` (`initdb`, `pg_ctl`, `psql`). Verified on macOS with Python 3.13.7 and homebrew PostgreSQL 14.19. Python uses only its standard library. Run as your normal local user from the project directory.

```sh
./scripts/rebuild.sh
shasum -a 256 -c outputs/sha256.txt
```

The rebuild verifies the SHA-256 of `data/raw/online_retail_II.xlsx`. If the workbook is missing, it downloads the official UCI archive and verifies the workbook before moving it into place. The raw workbook is ignored by Git and preserved unchanged locally. Run `python3 scripts/workbook.py download` to download and check it separately. Existing PostgreSQL services and data directories are outside the workflow. The script uses a cluster under `.build/pg`, a project-owned Unix socket on port 55432 and a single transaction to replace the project schema. It stops the instance when it started it. Budget around 2 GB for rebuild intermediates and the local cluster.

The rebuild writes the reviewed CSVs and checks to [outputs](outputs/) and generates the offline [dashboard data](dashboard/data.js) from those same SQL results. [Validation](docs/VALIDATION.md) describes the independent controls, repeat build and browser checks. [Source and attribution](docs/SOURCE.md) records the download, hash, licence and field verification.

## Query the model

After rebuilding, start the project instance and connect from the root directory.

```sh
pg_ctl -D .build/pg -l .build/postgres.log -o "-c listen_addresses='' -k '$PWD/.build' -p 55432" -w start
psql -X -h "$PWD/.build" -p 55432 -d postgres
```

```sql
SET search_path = retail, public;
SELECT period, gross, cancelled, net
FROM sales_totals
WHERE scope = 'Outside UK'
ORDER BY period;
```

Exit with `\q`, then run `pg_ctl -D .build/pg -m fast -w stop`. The [technical appendix](docs/TECHNICAL.md) includes the model diagram, data and metric dictionaries, populations and interpretation limits.

| Layer | SQL | Grain |
|---|---|---|
| Raw and classification | [01](sql/01_raw.sql), [02](sql/02_model.sql) | Workbook sheet and row, preserved through classification |
| Profiling | [03](sql/03_quality.sql) | Sheet, invoice convention, product, exception or overlap signature |
| Sales and customer marts | [04](sql/04_sales.sql), [05](sql/05_cohorts.sql) | Invoice, period and market, customer or first-observed cohort |
| Cancellation allocation | [06](sql/06_linkage.sql) | Lookback and cancellation line, with row-to-row allocations |
| Controls and snapshots | [07](sql/07_validate.sql), [08](sql/08_export.sql) | Validation check or documented export grain |

[Decision log](docs/DECISIONS.md) · [Progress and continuation](docs/PROGRESS.md)

## Update the documentation edition

The Markdown files are the editable source for the static documentation library. The analytics rebuild remains independent of the documentation renderer. After changing a source page, regenerate the reader pages locally.

```sh
python3 -m venv .build/docs-venv
.build/docs-venv/bin/python -m pip install -r scripts/docs-requirements.txt
.build/docs-venv/bin/python scripts/build_docs.py
```
