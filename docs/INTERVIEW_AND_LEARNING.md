# Interview and learning guide

## A 90-second project story

A UK retailer wanted to know whether recorded international growth came from broader activity or a few accounts and where to investigate cancellation exposure. I built a PostgreSQL model from both UCI Online Retail II sheets. The row count matched UCI, but December 2010 was mirrored across the worksheets. I preserved raw values and used a full-field multiset match to remove one copy from analytical sales.

Outside-UK positive merchandise sales rose 12.9% across equal Jan–Nov periods. Invoice volume explained the increase while average invoice value moved lower. Australia’s gain was concentrated in one account, while the Outside UK aggregate still grew after excluding its fixed top five. Two same-day UK sale and cancellation pairs made up 34.1% of cancellation value. A bounded SQL allocation linked much of the cancellation value to plausible earlier sales. I kept that inference separate from the sales figures. I would first review the two large pairs with Order Operations and Finance, then check account dependency and order reference capture.

## Likely follow-up questions

| Question | Answer to practise |
|---|---|
| What business decision does this support? | Prioritize investigation. Start with large, verifiable transaction exceptions and account exposure. Ask for original-order IDs and reason codes to resolve what the retail invoice lines cannot show. |
| Why is raw signed value different from net recorded sales? | Raw includes duplicate worksheet overlap and all commercial codes. The ledger assigns each row one disposition, adjusts negligible Excel precision residue and isolates merchandise. Discounts, postage, fees and accounting entries retain their own signed values. |
| How did you prevent double-counting? | Preserve sheet and row IDs, compare mirrored blocks as multisets, aggregate at serial invoice ID after validating its time and identity consistency, then join only to explicit scope memberships. Customer groups are formed before ranking. |
| Why use a multiset instead of SELECT DISTINCT? | The equal December block is independently verifiable. Repeated identical lines within the retained sheet could be genuine. The multiplicity-aware exclusion drops the mirrored copy and preserves each retained signature’s original frequency. The collapse variant tests the uncertain rows. |
| What makes the growth periods comparable? | They share the same January–November calendar dates. December 2011 ends on the ninth. The market matrix includes UK and Outside UK separately and chooses named international markets with volume and customer coverage thresholds. |
| How does the growth bridge work? | Use mean invoice value times the invoice-count change and mean invoice count times the invoice-value change. This splits their interaction symmetrically. The resulting invoice-value effect includes product and customer mix. |
| Why avoid a claim that the UK business grew? | UK gross was up 1.2% under the baseline, net rose only £2,668.07 and removing extreme lines reverses the direction of gross change. The small movement is sensitive to inclusion rules. |
| Could one market’s growth hide dependence? | Yes. Australia’s leading pooled account contributed about £105k of its £108k increase. Excluding the pooled top five reverses Australia’s direction. Outside UK overall still adds about £85k excluding its own fixed top five. |
| Could duplicate orders bias allocation? | Mirrored lines are removed before linkage. Retained repeats affect sale capacity because they may be legitimate. The duplicate sensitivity tests the exposure headline. A reliable allocation sensitivity to order-line deduplication would require source line identifiers. |
| How do you handle several plausible sales? | Match exact customer, product and price, require an earlier timestamp and allocate from the most recent eligible sale line with remaining quantity. Count all possible invoice candidates before consumption. Multiple candidates stay ambiguous even if remaining capacity points to one. |
| How do you handle missing IDs, partials or cancellations older than the workbook? | Missing IDs remain unmatched. Partial allocations retain their residual, and over-allocation produces a validation failure. Mark events with a lookback crossing the observed start. The 365-day alternative recovers plausible older links while increasing ambiguity. |
| What is the difference between a period cancellation ratio and a sale-cohort measure? | Period ratio uses posted cancellation value and posted gross in the same calendar window. Cohort analysis uses attributed cancellation value within a fixed age of observed sale lines and includes all mature eligible sales in its denominator. Both describe recorded retail activity. |
| Does repeat decline imply churn? | It describes the share of identified first-observed customers placing a second eligible invoice within the same age. Earlier order history, identification coverage and mix may differ, and anonymous purchases cannot be linked. |
| How does this differ from your Olist work? | This project focuses on signed transaction reconciliation, international market drivers, customer concentration, limited-window repeat behaviour and capacity-based cancellation inference. |
| How is this relevant to payments analytics? | It demonstrates documentation of financial metrics, exception reconciliation, comparable-market analysis, handling of missing references and communication of investigation priorities. A payment-network application would need the appropriate payment and settlement data and event definitions. |

The numerical examples use [F1–F4 in the findings register](FINDINGS.md).

## Learning walkthrough

1. Read [classification](../sql/02_model.sql). Trace one ordinary sale, one C-coded merchandise line, one mirror copy and one fee. Follow the order of CASE expressions and the full-field window partition.
2. Read [sales and movement](../sql/04_sales.sql). Reconstruct an Outside UK bridge with `sales_totals` and `market_growth`. Then read `growth_mix` to see why previously observed customers contributed more despite lower first-observed customer sales.
3. Read [allocation](../sql/06_linkage.sql). Follow the balance ledger and identify where each choice about ordering, capacity, ties and missing history is enforced. Compare 90- and 365-day candidate-count matrices.
4. Read [cohorts](../sql/05_cohorts.sql), then [assertions](../sql/07_validate.sql). Explain how varying maturity and repeated invoice lines could bias a naïve repeat rate.

### Exercises

- Recreate the bridge using `classified_line`, group by disposition and tie the SQL result independently to `sales_totals` for Jan–Nov 2011 Outside UK.
- Compare France and Australia before and after excluding pooled top accounts. Compare the remaining invoice counts by joining an account rank to `purchase_invoice` using a unique customer/scope key.
- Follow C541433 through `cancellation_event`, `allocation_detail` and `sale_candidate`. Explain why the matched transaction amount and elapsed time support plausibility and what would verify the match.
- Recompute the UK first-observed 90-day comparison by activity month. Add monthly denominators and compare the weighted result with a simple mean. Explain the difference.
- Modify the linkage query in a scratch copy to test FIFO rather than latest first. Compare allocated value, lag and ambiguous coverage. Reuse the chronology and capacity checks.

## Résumé bullets

- Built a reproducible PostgreSQL analytics pipeline from 1.07M UCI retail invoice lines, reconciled £19.70M in positive merchandise sales to £18.98M net, and verified 22,523 mirrored worksheet rows with source lineage.
- Decomposed 12.9% year-over-year growth in comparable outside-UK sales into invoice volume and average invoice value, then tested dependence on large accounts and assessed repeat purchases at equal cohort ages.
- Implemented quantity-capped, time-ordered SQL cancellation allocation and delivered a dashboard with reconciliation, market performance, cohort, and linkage evidence. Verified the rebuild and the dashboard’s desktop and narrow layouts.
