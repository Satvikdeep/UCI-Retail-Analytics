"""Read the pinned UCI workbook without modifying it. Python 3.11+, standard library."""
from collections import Counter
import csv
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from hashlib import file_digest
import json
from pathlib import Path, PurePosixPath
import sys
from urllib.request import urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/online_retail_II.xlsx"
BUILD = ROOT / ".build"
URL = "https://archive.ics.uci.edu/static/public/502/online%2Bretail%2Bii.zip"
SHA = "bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
HEADERS = ("Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country")
EXCEL_EPOCH = datetime(1899, 12, 30)


def checksum(path):
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def acquire():
    if RAW.is_file():
        if checksum(RAW) != SHA:
            raise ValueError(f"Checksum mismatch for {RAW}")
        return
    RAW.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=RAW.parent) as temporary:
        payload = Path(temporary) / "source.zip"
        with urlopen(URL, timeout=120) as response, payload.open("wb") as target:
            while block := response.read(1024 * 1024):
                target.write(block)
        with ZipFile(payload) as archive:
            path = Path(archive.extract(RAW.name, temporary))
        if checksum(path) != SHA:
            raise ValueError("Downloaded workbook differs from the pinned original")
        path.replace(RAW)


def sheets(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    properties = workbook.find(NS + "workbookPr")
    if properties is not None and properties.get("date1904") in ("1", "true"):
        raise ValueError("Unexpected 1904 Excel date system")
    relationships = {
        node.get("Id"): PurePosixPath("xl", node.get("Target")).as_posix()
        for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    }
    for node in workbook.find(NS + "sheets"):
        yield node.get("name"), relationships[node.get(REL + "id")]


def read_sheet(stream, strings):
    events = ET.iterparse(stream, events=("start", "end"))
    parent = None
    for event, node in events:
        if event == "start" and node.tag == NS + "sheetData":
            parent = node
        if event != "end" or node.tag != NS + "row":
            continue
        values = [None] * len(HEADERS)
        for cell in node:
            value = cell.findtext(NS + "v")
            if value is None:
                continue
            kind = cell.get("t", "n")
            if kind not in ("s", "n") or cell.find(NS + "f") is not None:
                raise ValueError(f"Unexpected cell type or formula at {cell.get('r')}")
            index = ord(cell.get("r")[0]) - ord("A")
            values[index] = strings[int(value)] if kind == "s" else value
        yield int(node.get("r")), tuple(values)
        parent.remove(node)


def extract():
    acquire()
    BUILD.mkdir(exist_ok=True)
    profile = []
    with ZipFile(RAW) as archive, (BUILD / "raw.csv").open("w", newline="", encoding="utf-8") as target:
        strings = [
            "".join(item.itertext())
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))
        ]
        writer = csv.writer(target, lineterminator="\n")
        for sheet, member in sheets(archive):
            stats = Counter()
            price_scale = Counter()
            total = Decimal(0)
            min_date = max_date = None
            with archive.open(member) as stream:
                rows = read_sheet(stream, strings)
                if next(rows) != (1, HEADERS):
                    raise ValueError(f"Unexpected headers in {sheet}")
                for row, values in rows:
                    if all(value is None for value in values):
                        stats["empty_xml_rows"] += 1
                        continue
                    invoice, stock, description, quantity, serial, price, customer, country = values
                    clock_seconds = Decimal(serial) * 86400
                    seconds = int(clock_seconds.to_integral_value(rounding=ROUND_HALF_UP))
                    if abs(clock_seconds - seconds) > Decimal("0.00001"):
                        raise ValueError(f"Subsecond timestamp at {sheet} row {row}")
                    stamp = EXCEL_EPOCH + timedelta(seconds=seconds)
                    min_date = min(min_date, stamp) if min_date else stamp
                    max_date = max(max_date, stamp) if max_date else stamp
                    unit_price = Decimal(price)
                    normalized = unit_price.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
                    price_scale[str(max(-normalized.normalize().as_tuple().exponent, 0))] += 1
                    if abs(unit_price - normalized) > Decimal("0.000000001"):
                        raise ValueError(f"Price has material precision beyond four places at {sheet} row {row}")
                    units = Decimal(quantity)
                    if units != int(units):
                        raise ValueError(f"Fractional quantity at {sheet} row {row}")
                    total += units * unit_price
                    stats["records"] += 1
                    stats["missing_customer"] += customer is None
                    stats["missing_description"] += description is None
                    writer.writerow((sheet, row, invoice, stock, description, int(units), stamp, price, customer, country, serial))
            profile.append(dict(sheet=sheet, headers=HEADERS, first=str(min_date), last=str(max_date),
                                raw_exact_value=str(total), price_scale=dict(sorted(price_scale.items())), **stats))
    if sum(row["records"] for row in profile) != 1067371:
        raise ValueError("Workbook count differs from the documented UCI total")
    (BUILD / "workbook.json").write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(profile, indent=2))


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "download":
        acquire()
    else:
        extract()
