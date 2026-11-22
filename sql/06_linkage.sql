SET search_path = retail, public;

-- Eligibility uses observed line timestamps, with strict chronology. The capacity
-- reference and cancellation reference both point to original workbook rows.
CREATE TABLE sale_candidate AS
SELECT source_sheet, source_row, invoice_key, invoice_at, customer, market, product, unit_price, quantity
FROM classified_line WHERE disposition='Positive merchandise' AND customer IS NOT NULL;
ALTER TABLE sale_candidate ADD PRIMARY KEY (source_sheet,source_row);
CREATE INDEX ON sale_candidate (customer,product,unit_price,invoice_at DESC);

CREATE TABLE cancellation_event AS
SELECT source_sheet, source_row, invoice_key, invoice_at, customer, market, product, unit_price, -quantity AS demand
FROM classified_line WHERE disposition='Cancellation-coded merchandise';
ALTER TABLE cancellation_event ADD PRIMARY KEY (source_sheet,source_row);

CREATE TABLE allocation (
    lookback integer NOT NULL,
    cancel_sheet text NOT NULL,
    cancel_row integer NOT NULL,
    sale_sheet text NOT NULL,
    sale_row integer NOT NULL,
    units integer NOT NULL CHECK (units > 0),
    PRIMARY KEY (lookback,cancel_sheet,cancel_row,sale_sheet,sale_row),
    FOREIGN KEY (cancel_sheet,cancel_row) REFERENCES cancellation_event,
    FOREIGN KEY (sale_sheet,sale_row) REFERENCES sale_candidate
);

CREATE TABLE cancellation_match (
    lookback integer NOT NULL,
    cancel_sheet text NOT NULL,
    cancel_row integer NOT NULL,
    earlier_invoices integer NOT NULL,
    matched_units integer NOT NULL,
    window_reaches_before_source boolean NOT NULL,
    PRIMARY KEY (lookback,cancel_sheet,cancel_row),
    FOREIGN KEY (cancel_sheet,cancel_row) REFERENCES cancellation_event
);

-- Greedy latest-first. Each run starts with the full observed sale capacity.
-- Count all initially eligible invoice IDs, including previously consumed sales.
-- This makes ambiguity independent of which earlier cancellation depleted a sale.
DO $$
DECLARE
    window_days integer;
    event cancellation_event%ROWTYPE;
    candidate record;
    remaining integer;
    take_units integer;
    possible_invoices integer;
    observed_start timestamp;
BEGIN
    SELECT min(invoice_at) INTO observed_start FROM raw_line;
    CREATE TEMP TABLE consumed (
        sale_sheet text, sale_row integer, units integer NOT NULL,
        PRIMARY KEY (sale_sheet,sale_row)
    ) ON COMMIT DROP;

    FOREACH window_days IN ARRAY ARRAY[90,365] LOOP
        TRUNCATE consumed;
        FOR event IN SELECT * FROM cancellation_event ORDER BY invoice_at, source_sheet, source_row LOOP
            remaining := event.demand;
            possible_invoices := 0;
            IF event.customer IS NOT NULL THEN
                SELECT count(DISTINCT s.invoice_key) INTO possible_invoices
                FROM sale_candidate s
                WHERE (s.customer,s.product,s.unit_price)=(event.customer,event.product,event.unit_price)
                    AND s.invoice_at<event.invoice_at
                    AND s.invoice_at>=event.invoice_at-make_interval(days=>window_days);
                FOR candidate IN
                    SELECT s.source_sheet,s.source_row,s.quantity-coalesce(c.units,0) AS capacity
                    FROM sale_candidate s
                    LEFT JOIN consumed c ON (c.sale_sheet,c.sale_row)=(s.source_sheet,s.source_row)
                    WHERE (s.customer,s.product,s.unit_price)=(event.customer,event.product,event.unit_price)
                        AND s.invoice_at<event.invoice_at
                        AND s.invoice_at>=event.invoice_at-make_interval(days=>window_days)
                        AND s.quantity>coalesce(c.units,0)
                    ORDER BY s.invoice_at DESC,s.invoice_key,s.source_sheet,s.source_row
                LOOP
                    take_units := least(remaining,candidate.capacity);
                    INSERT INTO allocation VALUES
                        (window_days,event.source_sheet,event.source_row,candidate.source_sheet,candidate.source_row,take_units);
                    INSERT INTO consumed VALUES (candidate.source_sheet,candidate.source_row,take_units)
                        ON CONFLICT (sale_sheet,sale_row) DO UPDATE SET units=consumed.units+EXCLUDED.units;
                    remaining := remaining-take_units;
                    EXIT WHEN remaining=0;
                END LOOP;
            END IF;
            INSERT INTO cancellation_match VALUES (
                window_days,event.source_sheet,event.source_row,possible_invoices,event.demand-remaining,
                event.invoice_at-make_interval(days=>window_days)<observed_start
            );
        END LOOP;
    END LOOP;
END $$;

CREATE VIEW match_detail AS
SELECT a.lookback, c.*,
       CASE WHEN c.customer IS NULL THEN 'Missing customer ID'
            WHEN a.earlier_invoices=0 THEN 'No earlier candidate'
            WHEN a.matched_units=0 THEN 'Candidate capacity exhausted'
            WHEN a.earlier_invoices=1 THEN 'One candidate invoice'
            ELSE 'Several candidate invoices' END AS evidence,
       CASE WHEN a.matched_units=0 THEN 'Unlinked'
            WHEN a.matched_units<c.demand THEN 'Partial'
            ELSE 'Full' END AS completion,
       a.earlier_invoices, a.matched_units, a.window_reaches_before_source,
       c.demand*c.unit_price AS cancellation_value,
       a.matched_units*c.unit_price AS matched_value
FROM cancellation_match a JOIN cancellation_event c
    ON (a.cancel_sheet,a.cancel_row)=(c.source_sheet,c.source_row);

CREATE TABLE linkage_coverage AS
SELECT a.lookback,p.period,s.scope,a.evidence,a.completion,
       count(*) AS cancellation_lines,
       sum(cancellation_value) AS cancellation_value,
       sum(matched_value) AS matched_value,
       count(*) FILTER(WHERE window_reaches_before_source) AS lines_with_pre_window_risk,
       sum(cancellation_value) FILTER(WHERE window_reaches_before_source) AS value_with_pre_window_risk
FROM match_detail a
JOIN periods p ON a.invoice_at>=p.starts AND a.invoice_at<p.ends
JOIN market_scope s ON a.market=s.market
GROUP BY 1,2,3,4,5;

CREATE VIEW allocation_detail AS
SELECT a.*, c.invoice_at AS cancelled_at,s.invoice_at AS sold_at,
       c.market AS cancellation_market,s.market AS sale_market,
       extract(epoch FROM c.invoice_at-s.invoice_at) / 86400 AS lag_days,
       a.units*s.unit_price AS value
FROM allocation a
JOIN cancellation_event c ON (a.cancel_sheet,a.cancel_row)=(c.source_sheet,c.source_row)
JOIN sale_candidate s ON (a.sale_sheet,a.sale_row)=(s.source_sheet,s.source_row);

CREATE VIEW linkage_lag AS
SELECT a.lookback,p.period,s.scope,
       CASE WHEN a.lag_days<1 THEN 'Under 1 day'
            WHEN a.lag_days<8 THEN '1–7 days'
            WHEN a.lag_days<31 THEN '8–30 days'
            WHEN a.lag_days<91 THEN '31–90 days'
            ELSE '91+ days' END AS lag_band,
       count(*) AS allocation_slices, sum(a.units) AS units, sum(a.value) AS linked_value,
       sum(a.value) FILTER(WHERE a.cancellation_market<>a.sale_market) AS cross_country_linked_value
FROM allocation_detail a
JOIN periods p ON a.cancelled_at>=p.starts AND a.cancelled_at<p.ends
JOIN market_scope s ON a.cancellation_market=s.market
GROUP BY 1,2,3,4;

-- Mature sale lines only. A sale contributes once before aggregation.
-- The 90-day cohort ratio is inferred linked value / identified sales value.
CREATE VIEW linked_sale_cohort AS
WITH cutoff AS (SELECT max(invoice_at) AS observed_through FROM raw_line),
     sale_links AS (
         SELECT sale_sheet,sale_row,sum(units) AS linked_units
         FROM allocation WHERE lookback=90 GROUP BY 1,2
     )
SELECT date_trunc('month',c.invoice_at)::date AS sale_month,s.scope,
       count(*) AS mature_sale_lines,
       count(*) FILTER (WHERE a.linked_units>0) AS sale_lines_with_link,
       sum(c.quantity*c.unit_price) AS identified_gross,
       sum(coalesce(a.linked_units,0)*c.unit_price) AS linked_90d_value
FROM sale_candidate c
CROSS JOIN cutoff d
JOIN market_scope s ON c.market=s.market
LEFT JOIN sale_links a ON (a.sale_sheet,a.sale_row)=(c.source_sheet,c.source_row)
WHERE date_trunc('month',c.invoice_at)+interval '1 month 90 days'<=d.observed_through
GROUP BY 1,2;

-- Show the influence of unusually large cancellation events on observed linkage
-- coverage. This is a filter on allocations already computed by the stated rule.
CREATE VIEW linkage_value_sensitivity AS
SELECT lookback,
       CASE WHEN cancellation_value>=10000 THEN 'At least £10,000' ELSE 'Under £10,000' END AS size_group,
       count(*) AS cancellation_lines, count(*) FILTER (WHERE matched_units>0) AS linked_lines,
       sum(cancellation_value) AS cancellation_value, sum(matched_value) AS linked_value
FROM match_detail GROUP BY 1,2;
