SET search_path = retail, public;

-- All flow amounts have one row per scope, period and mutually exclusive disposition.
CREATE TABLE reconciliation AS
SELECT p.period, s.scope, l.disposition, count(*) AS lines,
       sum(l.raw_value) AS raw_exact_value, sum(l.line_value) AS normalized_signed_value,
       sum(l.line_value - l.raw_value) AS precision_bridge
FROM classified_line l
JOIN periods p ON l.invoice_at >= p.starts AND l.invoice_at < p.ends
JOIN market_scope s ON l.market = s.market
GROUP BY 1,2,3;

CREATE TABLE sales_totals AS
SELECT p.period, s.scope, count(*) AS invoices_with_any_lines, sum(i.lines) AS raw_lines,
       sum(i.gross) AS gross, sum(i.cancelled) AS cancelled,
       sum(i.other_merchandise) AS other_merchandise,
       sum(i.gross - i.cancelled + i.other_merchandise) AS net,
       sum(i.cancelled) / nullif(sum(i.gross),0) AS cancellation_value_ratio,
       count(*) FILTER (WHERE i.gross > 0) AS sales_invoices,
       sum(i.gross) / nullif(count(*) FILTER (WHERE i.gross > 0),0) AS average_invoice,
       coalesce(sum(i.gross) FILTER (WHERE i.customer IS NOT NULL),0) AS identified_gross,
       coalesce(sum(i.gross) FILTER (WHERE i.customer IS NOT NULL),0) / nullif(sum(i.gross),0) AS identified_share,
       count(DISTINCT i.customer) FILTER (WHERE i.gross > 0) AS identified_customers,
       sum(i.raw_value) AS raw_exact_value
FROM invoice i
JOIN periods p ON i.invoice_at >= p.starts AND i.invoice_at < p.ends
JOIN market_scope s ON i.market = s.market
GROUP BY 1,2;

CREATE VIEW monthly_sales AS
SELECT date_trunc('month',i.invoice_at)::date AS month, s.scope,
       CASE WHEN date_trunc('month',i.invoice_at)::date = DATE '2011-12-01' THEN 'Partial' ELSE 'Calendar month' END AS coverage,
       sum(i.gross) AS gross, sum(i.cancelled) AS cancelled, sum(i.other_merchandise) AS other_merchandise,
       sum(i.gross - i.cancelled + i.other_merchandise) AS net,
       count(*) FILTER(WHERE i.gross>0) AS sales_invoices,
       coalesce(sum(i.gross) FILTER(WHERE i.customer IS NOT NULL),0) AS identified_gross
FROM invoice i JOIN market_scope s ON i.market=s.market GROUP BY 1,2,3;

-- Material international markets are named countries with >= £100k pooled
-- Jan–Nov gross, >= 30 positive invoices and >= 80% identified gross in each period.
CREATE VIEW material_markets AS
SELECT scope, sum(gross) AS pooled_gross, min(sales_invoices) AS minimum_invoices,
       min(identified_share) AS minimum_id_share
FROM sales_totals
WHERE period IN ('Jan–Nov 2010','Jan–Nov 2011') AND scope NOT IN
      ('All markets','Outside UK','United Kingdom','Unspecified','European Community')
GROUP BY scope
HAVING count(*)=2 AND sum(gross)>=100000 AND min(sales_invoices)>=30 AND min(identified_share)>=0.80;

-- Symmetric two-factor bridge. Compute the second driver as the residual so
-- the displayed exact-decimal effects tie out even for repeating AIV decimals.
CREATE VIEW market_growth AS
WITH paired AS (
    SELECT a.scope, a.gross AS gross_2010, b.gross AS gross_2011,
           a.net AS net_2010, b.net AS net_2011,
           a.sales_invoices AS invoices_2010, b.sales_invoices AS invoices_2011,
           a.average_invoice AS aiv_2010, b.average_invoice AS aiv_2011,
           a.identified_share AS id_share_2010, b.identified_share AS id_share_2011,
           (b.sales_invoices - a.sales_invoices) * (a.average_invoice + b.average_invoice) / 2 AS volume_effect
    FROM sales_totals a JOIN sales_totals b USING (scope)
    WHERE a.period='Jan–Nov 2010' AND b.period='Jan–Nov 2011'
)
SELECT *, gross_2011 - gross_2010 AS gross_change,
       gross_2011 / nullif(gross_2010,0) - 1 AS gross_change_rate,
       gross_2011 - gross_2010 - volume_effect AS aiv_effect,
       scope IN (SELECT scope FROM material_markets) AS material_international
FROM paired;

CREATE TABLE customer_period AS
SELECT p.period, s.scope, i.customer, sum(i.gross) AS gross, count(*) AS sales_invoices
FROM purchase_invoice i
JOIN periods p ON i.invoice_at >= p.starts AND i.invoice_at < p.ends
JOIN market_scope s ON i.market=s.market
WHERE i.customer IS NOT NULL GROUP BY 1,2,3;

CREATE VIEW concentration AS
WITH ranked AS (
    SELECT *, row_number() OVER (PARTITION BY period,scope ORDER BY gross DESC,customer) AS rank
    FROM customer_period
), amounts AS (
    SELECT period, scope, sum(gross) FILTER (WHERE rank=1) AS top1,
           sum(gross) FILTER (WHERE rank<=5) AS top5,
           sum(gross) FILTER (WHERE rank<=10) AS top10
    FROM ranked GROUP BY 1,2
)
SELECT t.period, t.scope, t.gross, t.identified_gross, t.identified_share, t.identified_customers,
       coalesce(a.top1,0) AS top1, coalesce(a.top5,0) AS top5, coalesce(a.top10,0) AS top10,
       coalesce(a.top1,0) / nullif(t.identified_gross,0) AS top1_share_identified,
       coalesce(a.top5,0) / nullif(t.identified_gross,0) AS top5_share_identified,
       coalesce(a.top10,0) / nullif(t.identified_gross,0) AS top10_share_identified,
       coalesce(a.top1,0) / nullif(t.gross,0) AS top1_share_all_sales
FROM sales_totals t LEFT JOIN amounts a USING (period,scope);

CREATE VIEW growth_mix AS
WITH pooled_rank AS (
    SELECT scope, customer,
           row_number() OVER (PARTITION BY scope ORDER BY sum(gross) DESC,customer) AS rank
    FROM customer_period WHERE period IN ('Jan–Nov 2010','Jan–Nov 2011') GROUP BY 1,2
)
SELECT p.period, s.scope, sum(i.gross) AS gross,
       coalesce(sum(i.gross) FILTER (WHERE f.first_at < p.starts),0) AS prior_observed_gross,
       coalesce(sum(i.gross) FILTER (WHERE f.first_at >= p.starts),0) AS first_observed_in_period_gross,
       coalesce(sum(i.gross) FILTER (WHERE i.invoice_key=f.first_invoice),0) AS first_invoice_gross,
       coalesce(sum(i.gross) FILTER (WHERE f.first_at >= p.starts AND i.invoice_key<>f.first_invoice),0) AS subsequent_new_customer_gross,
       coalesce(sum(i.gross) FILTER (WHERE i.customer IS NULL),0) AS anonymous_gross,
       coalesce(sum(i.gross) FILTER (WHERE r.rank=1),0) AS pooled_top1_gross,
       coalesce(sum(i.gross) FILTER (WHERE r.rank<=5),0) AS pooled_top5_gross,
       sum(i.gross) - coalesce(sum(i.gross) FILTER (WHERE r.rank<=5),0) AS gross_without_pooled_top5
FROM purchase_invoice i
JOIN periods p ON i.invoice_at >= p.starts AND i.invoice_at < p.ends
JOIN market_scope s ON i.market=s.market
LEFT JOIN customer_first f USING (customer)
LEFT JOIN pooled_rank r ON i.customer=r.customer AND s.scope=r.scope
WHERE p.period IN ('Jan–Nov 2010','Jan–Nov 2011')
GROUP BY 1,2;

CREATE TABLE cancellation_sensitivity AS
WITH variants(name) AS (VALUES ('Baseline'), ('Collapse exact repeats'),
                             ('Include possible catalogue'), ('All priced codes on numeric/C invoices'),
                             ('Exclude absolute lines ≥ £10,000'), ('Include mirrored worksheet overlap'))
SELECT v.name AS variant, p.period, s.scope,
       count(*) AS retained_lines,
       coalesce(sum(l.line_value) FILTER (WHERE l.invoice_type='Standard invoice' AND l.quantity>0
           AND l.unit_price>0 AND (v.name='All priced codes on numeric/C invoices'
           OR l.code_type='Standard catalogue' OR (v.name='Include possible catalogue' AND l.code_type='Possible catalogue'))),0) AS gross,
       coalesce(sum(-l.line_value) FILTER (WHERE l.invoice_type='Cancellation code' AND l.quantity<0
           AND l.unit_price>0 AND (v.name='All priced codes on numeric/C invoices'
           OR l.code_type='Standard catalogue' OR (v.name='Include possible catalogue' AND l.code_type='Possible catalogue'))),0) AS cancelled
FROM classified_line l
CROSS JOIN variants v
JOIN periods p ON l.invoice_at >= p.starts AND l.invoice_at < p.ends
JOIN market_scope s ON l.market=s.market
WHERE (v.name = 'Include mirrored worksheet overlap' OR l.disposition <> 'Mirrored worksheet overlap')
  AND (v.name <> 'Collapse exact repeats' OR l.duplicate_rank=1)
  AND (v.name <> 'Exclude absolute lines ≥ £10,000' OR abs(l.line_value)<10000)
GROUP BY 1,2,3;

-- Ranking universe includes all product/customer buckets before the top ten are taken.
-- Anonymous rows are shown as their own bucket and can never be called an account.
CREATE TABLE cancellation_rank AS
WITH exposure AS (
    SELECT p.period, s.scope, k.grain, k.label,
           coalesce(sum(l.line_value) FILTER(WHERE l.disposition='Positive merchandise'),0) AS gross,
           coalesce(sum(-l.line_value) FILTER(WHERE l.disposition='Cancellation-coded merchandise'),0) AS cancelled,
           count(*) FILTER(WHERE l.disposition='Cancellation-coded merchandise') AS cancellation_lines
    FROM classified_line l
    JOIN periods p ON l.invoice_at>=p.starts AND l.invoice_at<p.ends
    JOIN market_scope s ON l.market=s.market
    CROSS JOIN LATERAL (VALUES ('Product',l.product), ('Customer',coalesce(l.customer,'Anonymous'))) AS k(grain,label)
    WHERE l.disposition IN ('Positive merchandise','Cancellation-coded merchandise')
    GROUP BY 1,2,3,4
), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY period,scope,grain ORDER BY cancelled DESC,label) AS rank,
           sum(cancelled) OVER (PARTITION BY period,scope,grain) AS scope_cancelled
    FROM exposure
)
SELECT *, cancelled / nullif(gross,0) AS value_ratio,
       cancelled / nullif(scope_cancelled,0) AS share_of_scope_cancellations
FROM ranked WHERE rank<=10 AND cancelled>0;

-- Drivers remain visible under alternate line treatments on equal date windows.
CREATE VIEW growth_sensitivity AS
SELECT a.scope, a.variant, a.gross AS gross_2010, b.gross AS gross_2011,
       b.gross-a.gross AS change, b.gross/nullif(a.gross,0)-1 AS change_rate,
       a.cancelled/nullif(a.gross,0) AS cancellation_ratio_2010,
       b.cancelled/nullif(b.gross,0) AS cancellation_ratio_2011
FROM cancellation_sensitivity a JOIN cancellation_sensitivity b USING (scope,variant)
WHERE a.period='Jan–Nov 2010' AND b.period='Jan–Nov 2011';
