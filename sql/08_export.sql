SET search_path = retail, public;
\copy (SELECT * FROM source_profile ORDER BY source_sheet) TO '.build/export/source_profile.csv' CSV HEADER
\copy (SELECT * FROM quality_checks ORDER BY grain,issue) TO '.build/export/quality_checks.csv' CSV HEADER
\copy (SELECT * FROM duplicate_profile ORDER BY disposition) TO '.build/export/duplicate_profile.csv' CSV HEADER
\copy (SELECT * FROM code_profile ORDER BY product) TO '.build/export/code_profile.csv' CSV HEADER
\copy (SELECT * FROM invoice_conventions ORDER BY invoice_type,quantity_sign,price_sign) TO '.build/export/invoice_conventions.csv' CSV HEADER
\copy (SELECT * FROM sheet_overlap ORDER BY calendar_date,source_sheet) TO '.build/export/sheet_overlap.csv' CSV HEADER
\copy (SELECT source_sheet,source_row,invoice_key,invoice_at,market,product,code_type,disposition,quantity,unit_price,line_value,duplicate_rank FROM classified_line WHERE abs(line_value)>=10000 ORDER BY abs(line_value) DESC,source_sheet,source_row) TO '.build/export/extreme_lines.csv' CSV HEADER
\copy (SELECT * FROM reconciliation ORDER BY period,scope,disposition) TO '.build/export/reconciliation.csv' CSV HEADER
\copy (SELECT * FROM sales_totals ORDER BY period,scope) TO '.build/export/sales_totals.csv' CSV HEADER
\copy (SELECT * FROM monthly_sales ORDER BY month,scope) TO '.build/export/monthly_sales.csv' CSV HEADER
\copy (SELECT * FROM market_growth ORDER BY gross_2011 DESC,scope) TO '.build/export/market_growth.csv' CSV HEADER
\copy (SELECT * FROM material_markets ORDER BY pooled_gross DESC,scope) TO '.build/export/material_markets.csv' CSV HEADER
\copy (SELECT * FROM growth_mix ORDER BY period,scope) TO '.build/export/growth_mix.csv' CSV HEADER
\copy (SELECT * FROM cancellation_sensitivity ORDER BY period,scope,variant) TO '.build/export/cancellation_sensitivity.csv' CSV HEADER
\copy (SELECT * FROM cancellation_rank ORDER BY period,scope,grain,rank) TO '.build/export/cancellation_rank.csv' CSV HEADER
\copy (SELECT * FROM concentration ORDER BY period,scope) TO '.build/export/concentration.csv' CSV HEADER
\copy (SELECT * FROM cohort_repeat ORDER BY cohort,scope,days) TO '.build/export/cohort_repeat.csv' CSV HEADER
\copy (SELECT * FROM repeat_comparison ORDER BY scope,cohort_year,days) TO '.build/export/repeat_comparison.csv' CSV HEADER
\copy (SELECT * FROM linkage_coverage ORDER BY lookback,period,scope,evidence,completion) TO '.build/export/linkage_coverage.csv' CSV HEADER
\copy (SELECT * FROM linkage_lag ORDER BY lookback,period,scope,lag_band) TO '.build/export/linkage_lag.csv' CSV HEADER
\copy (SELECT * FROM linked_sale_cohort ORDER BY sale_month,scope) TO '.build/export/linked_sale_cohort.csv' CSV HEADER
\copy (SELECT * FROM validation ORDER BY test) TO '.build/export/validation.csv' CSV HEADER
\copy (SELECT * FROM overlap_fingerprint) TO '.build/export/overlap_fingerprint.csv' CSV HEADER
\copy (SELECT * FROM growth_sensitivity ORDER BY scope,variant) TO '.build/export/growth_sensitivity.csv' CSV HEADER
\copy (SELECT * FROM linkage_value_sensitivity ORDER BY lookback,size_group) TO '.build/export/linkage_value_sensitivity.csv' CSV HEADER
