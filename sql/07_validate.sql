SET search_path = retail, public;

CREATE TABLE validation AS
WITH line_bridge AS (
    SELECT period,scope,sum(lines) AS lines,sum(raw_exact_value) AS raw_exact_value,
           sum(normalized_signed_value-precision_bridge) AS bridged_raw,
           coalesce(sum(normalized_signed_value) FILTER(WHERE disposition='Positive merchandise'),0) AS gross,
           coalesce(sum(-normalized_signed_value) FILTER(WHERE disposition='Cancellation-coded merchandise'),0) AS cancelled,
           coalesce(sum(normalized_signed_value) FILTER(WHERE disposition='Other catalogue adjustment'),0) AS other
    FROM reconciliation GROUP BY 1,2
), cancellation_balance AS (
    SELECT lookback,cancel_sheet,cancel_row,sum(units) AS units FROM allocation GROUP BY 1,2,3
), sale_balance AS (
    SELECT lookback,sale_sheet,sale_row,sum(units) AS units FROM allocation GROUP BY 1,2,3
)
SELECT * FROM (
    SELECT 'UCI record-count difference' AS test, abs(count(*)-1067371)::bigint AS failures FROM raw_line
    UNION ALL SELECT 'Raw/classified population or original values differ', count(*)
    FROM raw_line r FULL JOIN classified_line l USING (source_sheet,source_row)
    WHERE (r.invoice,r.stock_code,r.description,r.quantity,r.invoice_at,r.source_price,r.customer_id,r.country,r.excel_date_serial)
       IS DISTINCT FROM (l.invoice,l.stock_code,l.description,l.quantity,l.invoice_at,l.source_price,l.customer_id,l.country,l.excel_date_serial)
       OR l.disposition IS NULL
    UNION ALL SELECT 'Mirrored worksheet exclusion differs from paired full-field multiset', count(*)
    FROM overlap_fingerprint o
    WHERE o.unpaired_signatures<>0 OR o.paired_lines<>22523
       OR o.paired_lines<>(SELECT count(*) FROM classified_line WHERE disposition='Mirrored worksheet overlap')
       OR o.paired_exact_signed_value IS DISTINCT FROM
          (SELECT sum(raw_value) FROM classified_line WHERE disposition='Mirrored worksheet overlap')
    UNION ALL SELECT 'Price normalization exceeds Excel precision tolerance', count(*)
    FROM classified_line WHERE abs(source_price-unit_price)>0.000000001
    UNION ALL SELECT 'Invoice crosses country, date or customer key', count(*)
    FROM invoice WHERE country_keys<>1 OR customer_keys<>1 OR date_keys<>1
    UNION ALL SELECT 'Country conflicts with reserved dashboard scope', count(*)
    FROM invoice WHERE market IN ('All markets','Outside UK')
    UNION ALL SELECT 'Raw-to-final bridge or line/invoice mart mismatch', count(*)
    FROM line_bridge b FULL JOIN sales_totals t USING (period,scope)
    WHERE (b.lines,b.raw_exact_value,b.bridged_raw,b.gross,b.cancelled,b.other,b.gross-b.cancelled+b.other)
       IS DISTINCT FROM (t.raw_lines,t.raw_exact_value,t.raw_exact_value,t.gross,t.cancelled,t.other_merchandise,t.net)
    UNION ALL SELECT 'Identified sales and customer mart mismatch',count(*)
    FROM sales_totals t LEFT JOIN (
        SELECT period,scope,sum(gross) AS gross,count(*) AS customers FROM customer_period GROUP BY 1,2
    ) c USING (period,scope)
    WHERE (t.identified_gross,t.identified_customers) IS DISTINCT FROM (coalesce(c.gross,0),coalesce(c.customers,0))
    UNION ALL SELECT 'Customer-mix components fail to tie to gross sales', count(*)
    FROM growth_mix WHERE gross<>prior_observed_gross+first_observed_in_period_gross+anonymous_gross
       OR first_observed_in_period_gross<>first_invoice_gross+subsequent_new_customer_gross
    UNION ALL SELECT 'Market growth driver bridge fails to tie', count(*)
    FROM market_growth WHERE volume_effect+aiv_effect<>gross_change
    UNION ALL SELECT 'Baseline sensitivity totals differ',count(*)
    FROM sales_totals t LEFT JOIN cancellation_sensitivity a USING (period,scope)
    WHERE a.variant='Baseline' AND (a.gross,a.cancelled) IS DISTINCT FROM (t.gross,t.cancelled)
    UNION ALL SELECT 'Sales cohorts have invalid repeat denominators', count(*)
    FROM cohort_repeat WHERE repeaters>eligible_customers OR eligible_customers>cohort_size
    UNION ALL SELECT 'Cancellation event lacks exactly one result per lookback', count(*)
    FROM cancellation_event c CROSS JOIN (VALUES (90),(365)) v(days)
    LEFT JOIN cancellation_match a ON (a.cancel_sheet,a.cancel_row,a.lookback)=(c.source_sheet,c.source_row,v.days)
    WHERE a.lookback IS NULL
    UNION ALL SELECT 'Cancellation completion differs from allocated units or exceeds demand', count(*)
    FROM match_detail a LEFT JOIN cancellation_balance b ON
        (a.lookback,a.source_sheet,a.source_row)=(b.lookback,b.cancel_sheet,b.cancel_row)
    WHERE a.matched_units<>coalesce(b.units,0) OR a.matched_units>a.demand OR a.matched_units<0
       OR (a.matched_units>0 AND a.earlier_invoices=0)
    UNION ALL SELECT 'Sale quantity overallocated',count(*)
    FROM sale_balance a JOIN sale_candidate s ON (a.sale_sheet,a.sale_row)=(s.source_sheet,s.source_row)
    WHERE a.units>s.quantity
    UNION ALL SELECT 'Allocation violates chronology, window, product, customer or price',count(*)
    FROM allocation a
    JOIN sale_candidate s ON (a.sale_sheet,a.sale_row)=(s.source_sheet,s.source_row)
    JOIN cancellation_event c ON (a.cancel_sheet,a.cancel_row)=(c.source_sheet,c.source_row)
    WHERE s.invoice_at>=c.invoice_at OR s.invoice_at<c.invoice_at-make_interval(days=>a.lookback)
       OR (s.customer,s.product,s.unit_price) IS DISTINCT FROM (c.customer,c.product,c.unit_price)
    UNION ALL SELECT 'Linkage population fails to match baseline cancellation value',count(*)
    FROM sales_totals t CROSS JOIN (VALUES (90),(365)) v(days)
    LEFT JOIN (SELECT period,scope,lookback,sum(cancellation_value) AS cancelled
               FROM linkage_coverage GROUP BY 1,2,3) a
        ON (t.period,t.scope,v.days)=(a.period,a.scope,a.lookback)
    WHERE t.cancelled<>coalesce(a.cancelled,0)
) checks;

DO $$
DECLARE problems text;
BEGIN
    SELECT string_agg(test||' ('||failures||')',', ') INTO problems FROM validation WHERE failures<>0;
    IF problems IS NOT NULL THEN
        RAISE EXCEPTION 'Data validation failed: %', problems;
    END IF;
END $$;
