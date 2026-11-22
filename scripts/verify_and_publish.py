"""Independently tie source controls to SQL. Publish deterministic review snapshots."""
from collections import Counter, defaultdict
import csv
from decimal import Decimal, ROUND_HALF_UP
from hashlib import file_digest
import json
from pathlib import Path
import re
from shutil import copyfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".build"
EXPORT = BUILD / "export"
OUTPUTS = ROOT / "outputs"
DASHBOARD = ROOT / "dashboard"
CATALOGUE = re.compile(r"[0-9]{5}[A-Z]{0,2}\Z")
INVOICE = re.compile(r"(C)?[0-9]{6}\Z")
PERIODS = {
    2010: "Jan–Nov 2010",
    2011: "Jan–Nov 2011",
}
DASHBOARD_TABLES = (
    "sales_totals", "monthly_sales", "market_growth", "material_markets", "growth_mix",
    "reconciliation", "cancellation_sensitivity", "cancellation_rank", "concentration",
    "cohort_repeat", "repeat_comparison", "linkage_coverage", "linkage_lag", "linked_sale_cohort",
    "quality_checks", "extreme_lines", "growth_sensitivity", "overlap_fingerprint",
    "linkage_value_sensitivity",
)


def read_csv(directory, name):
    with (directory / f"{name}.csv").open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def equal(label, actual, expected):
    if actual != expected:
        raise ValueError(f"{label}: SQL returned {actual}; independently expected {expected}")


def source_checks():
    workbook = {
        row["sheet"]: row
        for row in json.loads((BUILD / "workbook.json").read_text(encoding="utf-8"))
    }
    sources = read_csv(EXPORT, "source_profile")
    equal("Worksheet set", {row["source_sheet"] for row in sources}, set(workbook))
    for row in sources:
        source = workbook[row["source_sheet"]]
        for field in ("records", "missing_customer", "missing_description"):
            equal(f"{source['sheet']} {field}", int(row[field]), source[field])
        equal("Worksheet start", row["first_seen"], source["first"])
        equal("Worksheet end", row["last_seen"], source["last"])
        equal("Exact source signed value", Decimal(row["raw_exact_value"]), Decimal(source["raw_exact_value"]))


def check_main_totals():
    """Accumulate exact integer millipounds directly from extracted source cells."""
    expected = defaultdict(lambda: {"gross": 0, "cancelled": 0, "other_merchandise": 0,
                                    "identified_gross": 0, "sales_invoices": set(), "customers": set()})
    overlap = defaultdict(Counter)
    with (BUILD / "raw.csv").open(newline="", encoding="utf-8") as stream:
        for sheet, _, *fields in csv.reader(stream):
            invoice, product, _, units, stamp, price, customer, country, _ = fields
            if "2010-12-01" <= stamp[:10] <= "2010-12-09":
                overlap[sheet][tuple(fields)] += 1
                if sheet == "Year 2009-2010":
                    continue
            if not CATALOGUE.fullmatch(product.strip().upper()):
                continue
            unit_price = int((Decimal(price) * 1000).to_integral_value(rounding=ROUND_HALF_UP))
            if unit_price == 0:
                continue
            invoice = invoice.strip().upper()
            parsed = INVOICE.fullmatch(invoice)
            value = int(units) * unit_price
            if parsed and not parsed[1] and unit_price > 0 and int(units) > 0:
                bucket = "gross"
            elif parsed and parsed[1] and unit_price > 0 and int(units) < 0:
                bucket = "cancelled"
                value = -value
            else:
                bucket = "other_merchandise"
            year, month = int(stamp[:4]), stamp[5:7]
            windows = ["All dates"]
            if month != "12" and year in PERIODS:
                windows.append(PERIODS[year])
            elif stamp[:7] == "2010-12":
                windows.append("Dec 2010")
            elif stamp[:7] == "2011-12":
                windows.append("Partial Dec 2011")
            for period in windows:
                markets = ["All markets", country.strip()]
                if country.strip() != "United Kingdom":
                    markets.append("Outside UK")
                for scope in markets:
                    row = expected[period, scope]
                    row[bucket] += value
                    if bucket == "gross":
                        row["sales_invoices"].add(invoice)
                        if customer.strip():
                            row["identified_gross"] += value
                            row["customers"].add(customer.strip())

    equal("Exact fields and multiplicities in overlapping worksheet dates",
          overlap["Year 2009-2010"], overlap["Year 2010-2011"])
    equal("Number of mirrored rows", sum(overlap["Year 2009-2010"].values()), 22523)
    totals = read_csv(EXPORT, "sales_totals")
    for row in totals:
        key = row["period"], row["scope"]
        check = expected.pop(key, {"gross": 0, "cancelled": 0, "other_merchandise": 0,
                                   "identified_gross": 0, "sales_invoices": (), "customers": ()})
        for field in ("gross", "cancelled", "other_merchandise", "identified_gross"):
            equal(f"{key} {field}", Decimal(row[field]), Decimal(check[field]) / 1000)
        equal(f"{key} net", Decimal(row["net"]),
              Decimal(check["gross"] - check["cancelled"] + check["other_merchandise"]) / 1000)
        equal(f"{key} sales invoices", int(row["sales_invoices"]), len(check["sales_invoices"]))
        equal(f"{key} identified customers", int(row["identified_customers"]), len(check["customers"]))
    equal("No extra Python period/market keys", len(expected), 0)
    return len(totals)


def atomic_write(target, content):
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(target)


def publish():
    source_checks()
    scopes = check_main_totals()
    sql_checks = read_csv(EXPORT, "validation")
    equal("All SQL checks", [r["test"] for r in sql_checks if int(r["failures"])], [])
    independent = {
        "worksheet_checks": ["sheet coverage", "record counts", "date bounds",
                             "missing customer and description counts", "exact source signed value"],
        "mirrored_worksheet_rows_independently_matched": 22523,
        "sales_period_market_keys_checked": scopes,
        "sales_fields": ["gross", "cancellation magnitude", "other merchandise", "net",
                         "identified gross", "distinct sales invoices", "distinct customers"],
        "sql_validation_checks_passed": len(sql_checks),
        "status": "PASS",
    }
    atomic_write(EXPORT / "independent_checks.json", json.dumps(independent, indent=2) + "\n")
    copyfile(BUILD / "workbook.json", EXPORT / "workbook_profile.json")

    # Preserve decimal strings in both CSV and the dashboard payload. Conversion
    # to display numbers is done in the browser after the exact SQL computations.
    data = {name: read_csv(EXPORT, name) for name in DASHBOARD_TABLES}
    source_records = {row["source_sheet"]: row["records"] for row in read_csv(EXPORT, "source_profile")}
    data["source_records"] = source_records
    OUTPUTS.mkdir(exist_ok=True)
    DASHBOARD.mkdir(exist_ok=True)
    for source in sorted(EXPORT.iterdir()):
        if source.suffix in (".json", ".csv"):
            atomic_write(OUTPUTS / source.name, source.read_text(encoding="utf-8"))
    atomic_write(DASHBOARD / "data.js",
                 "window.RETAIL_DATA = " + json.dumps(data, ensure_ascii=True, separators=(",", ":")) + ";\n")

    paths = sorted(path for path in OUTPUTS.iterdir() if path.suffix in (".csv", ".json"))
    paths += [DASHBOARD / "data.js"]
    hashes = []
    for path in paths:
        with path.open("rb") as stream:
            digest = file_digest(stream, "sha256").hexdigest()
        hashes.append(f"{digest}  {path.relative_to(ROOT).as_posix()}")
    atomic_write(OUTPUTS / "sha256.txt", "\n".join(hashes) + "\n")
    print(f"Validated {len(sql_checks)} SQL controls, two worksheets and {scopes} period/market keys.")


if __name__ == "__main__":
    publish()
