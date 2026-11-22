# Source and attribution

Daqing Chen (2012). *Online Retail II* [Dataset]. UCI Machine Learning Repository. DOI 10.24432/C5CG6D. Licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). This project extracts and classifies source records, identifies mirrored worksheet rows, and publishes derived analyses and charts locally. [UCI dataset and citation](https://archive.ics.uci.edu/dataset/502/online+retail+ii) · [Data DOI](https://doi.org/10.24432/C5CG6D).

| Item | Value |
|---|---|
| Acquired | 2026-11-22, Asia/Kolkata |
| Download | [Official UCI dataset 502 archive](https://archive.ics.uci.edu/static/public/502/online%2Bretail%2Bii.zip) |
| Archive SHA-256 | `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb` |
| Original workbook | `data/raw/online_retail_II.xlsx` (45,622,278 bytes; extracted byte for byte) |
| Workbook SHA-256 | `bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980` |
| Documented population | 1,067,371 records |
| Observed population | 1,067,371 non-header rows, across both sheets |

| Workbook sheet | Records | Earliest invoice timestamp | Latest invoice timestamp |
|---|---:|---|---|
| Year 2009-2010 | 525,461 | 2009-12-01 07:45 | 2010-12-09 20:01 |
| Year 2010-2011 | 541,910 | 2010-12-01 08:26 | 2011-12-09 12:50 |

The row count matches UCI exactly. The workbook includes 22,523 mirrored December 2010 rows in each sheet. The full-field multisets match, including repeat multiplicity. The baseline keeps one worksheet’s copy and reports all 1,067,371 raw rows in the reconciliation. A worksheet title alone is insufficient to assign rows to a year. The period comparisons use InvoiceDate.

The workbook headers are `Invoice`, `StockCode`, `Description`, `Quantity`, `InvoiceDate`, `Price`, `Customer ID`, and `Country`. UCI uses some different display names in its documentation. UCI specifies per-unit prices in sterling and country of customer residence. The workbook confirms one line per product/invoice entry, including special product codes and adjustment entries. Invoice identifiers recur across lines. A prefix of `C` signals a cancellation in UCI’s convention. The workbook also has six `A` invoices, all using the bad-debt stock code. No field directly names an original sale on a cancellation.

Dates are Excel serials with no supplied time zone. The extractor preserves the serial and recovers the displayed whole-second timestamp, allowing only a tiny serialization residual. Currency is sourced from UCI’s documentation and there is no separate currency field.

[SQL source profile](../outputs/source_profile.csv) · [Workbook extraction checks](../outputs/workbook_profile.json) · [Overlap fingerprint](../outputs/overlap_fingerprint.csv) · [Invoice conventions](../outputs/invoice_conventions.csv).
