SET search_path = retail, public;

-- Identify exact same workbook fields across both sheets before applying normalization.
-- Preserve every raw row. Give the later worksheet priority in duplicate ordering.
CREATE TABLE classified_line AS
WITH tagged AS (
    SELECT r.*,
           upper(btrim(stock_code)) AS product,
           upper(btrim(invoice)) AS invoice_key,
           nullif(btrim(customer_id), '') AS customer,
           btrim(country) AS market,
           round(source_price, 3) AS unit_price,
           row_number() OVER (
               PARTITION BY invoice, stock_code, description, quantity, excel_date_serial,
                            source_price, customer_id, country
               ORDER BY source_sheet DESC, source_row
           ) AS duplicate_rank,
           count(*) FILTER (WHERE source_sheet='Year 2010-2011') OVER (
               PARTITION BY invoice, stock_code, description, quantity, excel_date_serial,
                            source_price, customer_id, country
           ) AS copies_on_later_sheet
    FROM raw_line r
), code_types AS (
    SELECT *,
           CASE
               WHEN product IN ('POST','DOT','C2') THEN 'Postage and carriage'
               WHEN product IN ('AMAZONFEE','BANK CHARGES','CRUK') THEN 'Fees and commission'
               WHEN product = 'D' THEN 'Discount'
               WHEN product IN ('M','B','ADJUST','ADJUST2') THEN 'Manual and accounting adjustments'
               WHEN product = 'S' THEN 'Samples'
               WHEN product LIKE 'GIFT%' THEN 'Vouchers'
               WHEN product LIKE 'TEST%' THEN 'Test items'
               WHEN product ~ '^[0-9]{5}[A-Z]{0,2}$' THEN 'Standard catalogue'
               WHEN product ~ '^DCGS' OR product IN ('PADS','SP1002') THEN 'Possible catalogue'
               ELSE 'Unclassified code'
           END AS code_type,
           CASE
               WHEN invoice_key ~ '^C[0-9]{6}$' THEN 'Cancellation code'
               WHEN invoice_key ~ '^[0-9]{6}$' THEN 'Standard invoice'
               ELSE 'Other invoice code'
           END AS invoice_type
    FROM tagged
)
SELECT *,
       source_price * quantity AS raw_value,
       unit_price * quantity AS line_value,
       CASE
           WHEN source_sheet='Year 2009-2010' AND copies_on_later_sheet>0
                AND duplicate_rank<=2*copies_on_later_sheet THEN 'Mirrored worksheet overlap'
           WHEN code_type <> 'Standard catalogue' THEN code_type
           WHEN unit_price = 0 THEN 'Zero-priced catalogue'
           WHEN unit_price < 0 OR quantity = 0 THEN 'Other catalogue adjustment'
           WHEN invoice_type = 'Cancellation code' AND quantity < 0 THEN 'Cancellation-coded merchandise'
           WHEN invoice_type = 'Standard invoice' AND quantity > 0 THEN 'Positive merchandise'
           ELSE 'Other catalogue adjustment'
       END AS disposition
FROM code_types;

ALTER TABLE classified_line ADD PRIMARY KEY (source_sheet, source_row);
CREATE INDEX ON classified_line (invoice_key);

-- Each invoice is one observed invoice ID. Line timestamps can differ within a day.
CREATE TABLE invoice AS
SELECT invoice_key, min(invoice_at) AS invoice_at, max(invoice_at) AS last_line_at,
       min(market) AS market, min(customer) AS customer,
       count(DISTINCT market) AS country_keys,
       count(DISTINCT coalesce(customer,'')) AS customer_keys,
       count(DISTINCT invoice_at::date) AS date_keys,
       count(DISTINCT invoice_at) AS timestamp_keys,
       count(DISTINCT source_sheet) AS sheet_keys,
       count(*) AS lines,
       sum(raw_value) AS raw_value,
       coalesce(sum(line_value) FILTER (WHERE disposition = 'Positive merchandise'), 0) AS gross,
       coalesce(sum(-line_value) FILTER (WHERE disposition = 'Cancellation-coded merchandise'), 0) AS cancelled,
       coalesce(sum(line_value) FILTER (WHERE disposition = 'Other catalogue adjustment'), 0) AS other_merchandise
FROM classified_line GROUP BY invoice_key;

ALTER TABLE invoice ADD PRIMARY KEY (invoice_key);

-- Keep empty and zero-value denominators explicit. The comparison avoids December and
-- uses Jan–Nov in both years. Calendar coverage is defined from the observed bounds.
CREATE VIEW periods AS
SELECT 'All dates'::text AS period, min(invoice_at)::date AS starts,
       max(invoice_at)::date + 1 AS ends FROM raw_line
UNION ALL VALUES ('Jan–Nov 2010', DATE '2010-01-01', DATE '2010-12-01'),
                 ('Jan–Nov 2011', DATE '2011-01-01', DATE '2011-12-01'),
                 ('Dec 2010', DATE '2010-12-01', DATE '2011-01-01'),
                 ('Partial Dec 2011', DATE '2011-12-01', DATE '2011-12-10');

-- Scope labels are reserved and cannot coincide with source countries (validated).
CREATE VIEW market_scope AS
SELECT market, market AS scope FROM (SELECT DISTINCT market FROM invoice) countries
UNION ALL
SELECT market, 'All markets' FROM (SELECT DISTINCT market FROM invoice) countries
UNION ALL
SELECT market, 'Outside UK' FROM (SELECT DISTINCT market FROM invoice WHERE market <> 'United Kingdom') countries;

CREATE TABLE purchase_invoice AS
SELECT invoice_key, invoice_at, market, customer, gross
FROM invoice WHERE gross > 0;
ALTER TABLE purchase_invoice ADD PRIMARY KEY (invoice_key);
CREATE INDEX ON purchase_invoice (customer, invoice_at) WHERE customer IS NOT NULL;

CREATE TABLE customer_first AS
SELECT DISTINCT ON (customer) customer, invoice_at AS first_at, market AS first_market, invoice_key AS first_invoice
FROM purchase_invoice WHERE customer IS NOT NULL
ORDER BY customer, invoice_at, invoice_key;
ALTER TABLE customer_first ADD PRIMARY KEY (customer);

ANALYZE classified_line;
ANALYZE invoice;
ANALYZE purchase_invoice;
ANALYZE customer_first;
