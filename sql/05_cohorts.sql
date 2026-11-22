SET search_path = retail, public;

-- Cohort membership is global, attributed to first-purchase country. Repeat purchases
-- may occur in any country. Anchor on the latest transaction timestamp.
CREATE TABLE customer_repeat AS
SELECT f.customer, f.first_at, f.first_market, f.first_invoice,
       min(i.invoice_at) FILTER (WHERE i.invoice_key <> f.first_invoice) AS second_at
FROM customer_first f JOIN purchase_invoice i USING (customer)
GROUP BY f.customer, f.first_at, f.first_market, f.first_invoice;

CREATE TABLE cohort_repeat AS
WITH cutoff AS (SELECT max(invoice_at) AS observed_through FROM raw_line),
     ages(days) AS (VALUES (30),(60),(90),(180))
SELECT date_trunc('month',r.first_at)::date AS cohort, s.scope, a.days,
       count(*) AS cohort_size,
       count(*) FILTER (WHERE r.first_at+make_interval(days=>a.days)<=c.observed_through) AS eligible_customers,
       count(*) FILTER (WHERE r.first_at+make_interval(days=>a.days)<=c.observed_through
                            AND r.second_at<=r.first_at+make_interval(days=>a.days)) AS repeaters
FROM customer_repeat r JOIN market_scope s ON r.first_market=s.market
CROSS JOIN ages a CROSS JOIN cutoff c GROUP BY 1,2,3;

-- Compare equivalent acquisition months and require every cohort member to mature.
CREATE VIEW repeat_comparison AS
SELECT scope, extract(year FROM cohort)::integer AS cohort_year, days,
       sum(cohort_size) AS eligible_customers, sum(repeaters) AS repeaters,
       sum(repeaters)::numeric / nullif(sum(cohort_size),0) AS repeat_rate
FROM cohort_repeat
WHERE cohort >= DATE '2010-01-01' AND extract(month FROM cohort) BETWEEN 1 AND 5
  AND eligible_customers=cohort_size AND extract(year FROM cohort) IN (2010,2011)
GROUP BY 1,2,3;
