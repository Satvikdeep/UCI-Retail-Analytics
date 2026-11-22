SET search_path = retail, public;

CREATE VIEW source_profile AS
SELECT source_sheet, count(*) AS records, min(invoice_at) AS first_seen, max(invoice_at) AS last_seen,
       count(*) FILTER (WHERE customer_id IS NULL) AS missing_customer,
       count(*) FILTER (WHERE description IS NULL) AS missing_description,
       sum(quantity * source_price) AS raw_exact_value
FROM raw_line GROUP BY source_sheet;

CREATE VIEW quality_checks AS
WITH code_conflicts AS (
    SELECT product, count(DISTINCT upper(btrim(description))) AS names
    FROM classified_line WHERE code_type = 'Standard catalogue' AND nullif(btrim(description),'') IS NOT NULL
    GROUP BY product
)
SELECT * FROM (
    SELECT 'Missing customer ID' AS issue, count(*) AS records, sum(line_value) AS signed_value, 'Line' AS grain
    FROM classified_line WHERE customer IS NULL
    UNION ALL SELECT 'Missing description', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE nullif(btrim(description),'') IS NULL
    UNION ALL SELECT 'Duplicate-looking excess rows', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE duplicate_rank > 1
    UNION ALL SELECT 'Retained duplicate-looking excess rows', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE duplicate_rank>1 AND disposition<>'Mirrored worksheet overlap'
    UNION ALL SELECT 'Mirrored worksheet overlap', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE disposition='Mirrored worksheet overlap'
    UNION ALL SELECT 'Zero unit price', count(*), sum(line_value), 'Line' FROM classified_line WHERE unit_price = 0
    UNION ALL SELECT 'Negative unit price', count(*), sum(line_value), 'Line' FROM classified_line WHERE unit_price < 0
    UNION ALL SELECT 'Negative quantity', count(*), sum(line_value), 'Line' FROM classified_line WHERE quantity < 0
    UNION ALL SELECT 'Zero quantity', count(*), sum(line_value), 'Line' FROM classified_line WHERE quantity = 0
    UNION ALL SELECT 'Positive quantity on C invoice', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE invoice_type = 'Cancellation code' AND quantity > 0
    UNION ALL SELECT 'Other invoice code', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE invoice_type = 'Other invoice code'
    UNION ALL SELECT 'Absolute line value ≥ £10,000', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE abs(line_value) >= 10000
    UNION ALL SELECT 'Possible catalogue code', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE code_type = 'Possible catalogue'
    UNION ALL SELECT 'Unclassified code', count(*), sum(line_value), 'Line'
    FROM classified_line WHERE code_type = 'Unclassified code'
    UNION ALL SELECT 'Catalogue codes with conflicting descriptions', count(*), NULL, 'Product'
    FROM code_conflicts WHERE names > 1
    UNION ALL SELECT 'Several timestamps', count(*), NULL, 'Invoice' FROM invoice WHERE timestamp_keys > 1
    UNION ALL SELECT 'Several dates', count(*), NULL, 'Invoice' FROM invoice WHERE date_keys > 1
    UNION ALL SELECT 'Several countries', count(*), NULL, 'Invoice' FROM invoice WHERE country_keys > 1
    UNION ALL SELECT 'Several customer keys', count(*), NULL, 'Invoice' FROM invoice WHERE customer_keys > 1
    UNION ALL SELECT 'Invoice occurs in both sheets', count(*), NULL, 'Invoice' FROM invoice WHERE sheet_keys > 1
) findings;

CREATE VIEW duplicate_profile AS
SELECT disposition, count(*) FILTER (WHERE duplicate_rank=1) AS distinct_rows,
       count(*) FILTER (WHERE duplicate_rank>1) AS excess_rows,
       count(*) FILTER (WHERE duplicate_rank>1 AND customer IS NOT NULL) AS excess_identified_rows,
       coalesce(sum(line_value) FILTER (WHERE duplicate_rank>1),0) AS excess_signed_value
FROM classified_line GROUP BY disposition;

CREATE VIEW code_profile AS
SELECT product, code_type, min(nullif(btrim(description),'')) AS example_description,
       count(DISTINCT nullif(upper(btrim(description)),'')) AS description_variants,
       count(*) AS lines, sum(line_value) AS signed_value
FROM classified_line GROUP BY 1,2;

CREATE VIEW invoice_conventions AS
SELECT invoice_type, sign(quantity) AS quantity_sign, sign(unit_price) AS price_sign,
       count(*) AS lines, sum(line_value) AS signed_value
FROM classified_line GROUP BY 1,2,3;

CREATE VIEW sheet_overlap AS
SELECT source_sheet, invoice_at::date AS calendar_date, count(*) AS lines,
       count(DISTINCT invoice_key) AS invoices, sum(line_value) AS signed_value
FROM classified_line
WHERE invoice_at >= DATE '2010-12-01' AND invoice_at < DATE '2010-12-10'
GROUP BY 1,2;

-- Compare full raw-field multisets in the observed overlap. Repetition within each
-- sheet is preserved by matching multiplicities rather than a DISTINCT operation.
CREATE VIEW overlap_fingerprint AS
WITH copies AS (
    SELECT invoice,stock_code,description,quantity,excel_date_serial,source_price,customer_id,country,
           count(*) FILTER(WHERE source_sheet='Year 2009-2010') AS older,
           count(*) FILTER(WHERE source_sheet='Year 2010-2011') AS later
    FROM raw_line WHERE invoice_at>=DATE '2010-12-01' AND invoice_at<DATE '2010-12-10'
    GROUP BY 1,2,3,4,5,6,7,8
)
SELECT count(*) AS distinct_workbook_lines, sum(older) AS older_sheet_lines, sum(later) AS later_sheet_lines,
       sum(least(older,later)) AS paired_lines, count(*) FILTER(WHERE older<>later) AS unpaired_signatures,
       sum(least(older,later)*quantity*source_price) AS paired_exact_signed_value
FROM copies;
