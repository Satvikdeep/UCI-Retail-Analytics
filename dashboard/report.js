"use strict";

const salesRow = (scope, period = "All dates") => data.sales_totals.find(row => row.scope === scope && row.period === period);
const growthRow = scope => data.market_growth.find(row => row.scope === scope);
const concentrationRow = scope => data.concentration.find(row => row.scope === scope && row.period === "All dates");
const mixRows = scope => data.growth_mix.filter(row => row.scope === scope);
const whole = salesRow("All markets");
const international = growthRow("Outside UK");
const uk = growthRow("United Kingdom");
const australia = growthRow("Australia");
const australiaMix = mixRows("Australia");
const internationalMix = mixRows("Outside UK");
const netDelta = Number(uk.net_2011) - Number(uk.net_2010);
const two = data.extreme_lines.filter(row => row.disposition === "Cancellation-coded merchandise");
const largeCancellationValue = -sum(two, "line_value");
const sensitivity = data.cancellation_sensitivity.filter(row => row.scope === "All markets" && row.period === "All dates");
const cohort = (scope, age) => data.repeat_comparison.filter(row => row.scope === scope && Number(row.days) === age);
const uk90 = cohort("United Kingdom", 90);
const outside90 = cohort("Outside UK", 90);
const uk180 = cohort("United Kingdom", 180);
const allocation = days => data.linkage_coverage.filter(row => row.scope === "All markets" && row.period === "All dates" && Number(row.lookback) === days);
const a90 = allocation(90);
const a365 = allocation(365);
const allocated90 = sum(a90, "matched_value");
const allocated365 = sum(a365, "matched_value");
const cancellationLines = sum(a90, "cancellation_lines");
const linkedLines = sum(a90.filter(row => row.completion !== "Unlinked"), "cancellation_lines");
const ambiguous = sum(a90.filter(row => row.evidence === "Several candidate invoices"), "matched_value");
const missing = a90.find(row => row.evidence === "Missing customer ID");
const remaining = whole.cancelled - allocated90;
const overlap = data.overlap_fingerprint[0];
const smaller = data.linkage_value_sensitivity.find(row => row.lookback === "90" && row.size_group === "Under £10,000");

function evidence(...links) {
  return element("p", {class: "source-links"}, links.map(([file, label]) =>
    element("a", {href: `../outputs/${file}.csv`}, label)));
}

function finding(topic, title, caption, copy, visual, sources) {
  return element("article", {class: "brief-finding"},
    element("div", {class: "finding-copy"},
      element("p", {class: "finding-topic"}, topic), element("h3", {}, title),
      copy, sources),
    element("figure", {class: "finding-figure"}, element("figcaption", {}, caption), visual));
}

document.getElementById("report-metrics").append(metrics(
  metric("Net recorded merchandise sales", shortMoney(whole.net), "All markets · entire workbook", money(whole.net)),
  metric("Outside-UK sales growth", pct(international.gross_change_rate), "Jan–Nov 2011 vs Jan–Nov 2010"),
  metric("Cancellation value ratio", pct(whole.cancellation_value_ratio), "Cancellation value ÷ positive sales")
));

const treatments = ["Baseline", "Collapse exact repeats", "Exclude absolute lines ≥ £10,000",
  "All priced codes on numeric/C invoices"];
const findings = [
  finding("Cancellation exposure", "Two entries made up a third of cancellation value",
    "Cancellation value ÷ positive sales · all markets",
    [
      element("p", {}, `${money(whole.gross)} in positive merchandise sales less ${money(whole.cancelled)} in cancellation-coded merchandise yielded ${money(whole.net)} in net recorded sales. Two same-day UK sale and cancellation pairs account for ${money(largeCancellationValue)} (${pct(ratio(largeCancellationValue, whole.cancelled))}) of cancellation value.`),
      element("p", {}, `The raw bridge removes ${count(overlap.paired_lines)} exact mirrored lines worth ${money(overlap.paired_exact_signed_value)} signed. The broadest treatment includes fees and other commercial entries.`)
    ],
    bars(treatments.map(variant => {
      const row = sensitivity.find(row => row.variant === variant);
      const value = ratio(row.cancelled, row.gross);
      return {label: variant, value, text: pct(value), alt: variant !== "Baseline"};
    })),
    evidence(["reconciliation", "Reconciliation"], ["extreme_lines", "Extreme lines"], ["cancellation_sensitivity", "Sensitivity"])),
  finding("Market performance", "More invoices drove outside-UK sales growth",
    "Change in positive sales · Jan–Nov 2010 to Jan–Nov 2011",
    [
      element("p", {}, `Outside-UK positive sales grew ${pct(international.gross_change_rate)} (${money(international.gross_change)}). The volume change from ${count(international.invoices_2010)} to ${count(international.invoices_2011)} invoices contributed ${money(international.volume_effect)}. Lower average invoice value offset ${money(-international.aiv_effect)}. UK net recorded sales changed by ${money(netDelta)}.`),
      element("p", {}, `Australia added ${money(australia.gross_change)}, with ${money(australiaMix[1].pooled_top1_gross - australiaMix[0].pooled_top1_gross)} from its leading pooled account. Sales fell without its top five. Across Outside UK, sales excluding its pooled top five still rose ${money(internationalMix[1].gross_without_pooled_top5 - internationalMix[0].gross_without_pooled_top5)}.`),
      element("p", {}, `Over all dates, one customer accounted for ${pct(concentrationRow("Netherlands").top1_share_identified)} of Dutch sales and ${pct(concentrationRow("Australia").top1_share_identified)} of Australian sales. Both markets had full sales-value ID coverage.`)
    ],
    bars(["Outside UK", "Australia", "France", "Germany", "Netherlands", "EIRE", "United Kingdom"].map(scope => {
      const row = growthRow(scope);
      return {label: scope, value: Number(row.gross_change), text: money(row.gross_change)};
    }), undefined, true),
    evidence(["market_growth", "Growth drivers"], ["growth_mix", "Customer mix"], ["concentration", "Concentration"], ["growth_sensitivity", "Sensitivity"])),
  finding("Repeat purchasing", "The clearest decline was in UK cohorts",
    "Jan–May first-observed cohorts · equal follow-up",
    [
      element("p", {}, `UK 90-day repeat purchasing moved from ${pct(uk90[0].repeat_rate)} (${count(uk90[0].repeaters)} of ${count(uk90[0].eligible_customers)}) to ${pct(uk90[1].repeat_rate)} (${count(uk90[1].repeaters)} of ${count(uk90[1].eligible_customers)}). Outside the UK, it was ${pct(outside90[0].repeat_rate)} and ${pct(outside90[1].repeat_rate)}, from smaller cohorts of ${count(outside90[0].eligible_customers)} and ${count(outside90[1].eligible_customers)}.`),
      element("p", {}, "The earlier cohorts can include repeat buyers whose pre-window purchases are unavailable. This measure covers identified customers.")
    ],
    table(["First-purchase market", "Age", "2010", "2011"], [
      ["UK", "90 days", pct(uk90[0].repeat_rate), pct(uk90[1].repeat_rate)],
      ["UK", "180 days", pct(uk180[0].repeat_rate), pct(uk180[1].repeat_rate)],
      ["Outside UK", "90 days", pct(outside90[0].repeat_rate), pct(outside90[1].repeat_rate)]
    ], "Equal-age repeat rates", [2, 3]),
    evidence(["repeat_comparison", "Cohort denominators"], ["cohort_repeat", "Monthly cohorts"])),
  finding("Cancellation linkage", "Longer lookbacks add plausible matches and ambiguity",
    "Allocated share of cancellation value · all markets",
    [
      element("p", {}, `The 90-day rule allocated ${money(allocated90)} of ${money(whole.cancelled)} across ${count(linkedLines)} of ${count(cancellationLines)} cancellation lines. Several earlier invoice candidates account for ${money(ambiguous)} of allocated value. The 90-day rule left ${money(remaining)} unallocated, including ${money(missing.cancellation_value)} on ${count(missing.cancellation_lines)} anonymous lines.`),
      element("p", {}, `The 90-day rule covers ${pct(ratio(smaller.linked_value, smaller.cancellation_value))} of value on lines under £10,000. Both rules require earlier observed capacity and exact customer, product and unit price.`)
    ],
    bars([
      {label: "90-day rule", value: ratio(allocated90, whole.cancelled), text: pct(ratio(allocated90, whole.cancelled))},
      {label: "365-day rule", value: ratio(allocated365, whole.cancelled), text: pct(ratio(allocated365, whole.cancelled)), alt: true}
    ], 1),
    evidence(["linkage_coverage", "Coverage by evidence"], ["linkage_lag", "Linked lag"], ["linkage_value_sensitivity", "Large-event sensitivity"]))
];

document.getElementById("findings").replaceChildren(...findings);

const priorities = [
    [`Two UK sale and cancellation pairs account for ${money(largeCancellationValue)} of ${money(whole.cancelled)} recorded cancellation value.`,
      "High for the invoice amounts and chronology. Test whether the entries reflect order amendments, quantity entry or another process.",
      "Review both original orders and their credits. Order Operations with Finance.",
      "Original-order references, reason codes, order workflow timestamps and settlement records.",
      "Share of large credits with an auditable order reference and documented reason."],
    [`Full-window top-account shares are ${pct(concentrationRow("Netherlands").top1_share_identified)} in the Netherlands and ${pct(concentrationRow("Australia").top1_share_identified)} in Australia.`,
      "High for identified gross. Test whether one distributor relationship or irregular bulk ordering explains the dependence.",
      "Review account pipelines and order cadence with market leads. Commercial and Account Management.",
      "Parent-account mappings, channel, account agreements and forward order pipeline.",
      "Trailing-period top-account share and sales growth excluding a fixed top-account set."],
    [`${money(remaining)} of baseline cancellation value lacks allocated quantity under the 90-day rule.`,
      "Medium for linkage completeness under the stated rule. Test whether reference capture, missing history or price changes explain exceptions.",
      "Audit the largest unmatched and ambiguous records and reconcile to source order IDs. Order Systems with Finance.",
      "Stable original invoice and line IDs, older order history, reason codes and unit-price changes.",
      "Value-weighted share of credits with verified original line references."],
    [`UK 90-day repeat was ${pct(uk90[0].repeat_rate)} then ${pct(uk90[1].repeat_rate)} for the Jan–May cohorts.`,
      "Directional. Test whether channel, customer mix, earlier history or declining ID coverage accounts for the difference.",
      "Compare channel-matched cohorts before changing customer campaigns. CRM Analytics.",
      "Earlier order history, customer identity mapping, acquisition channels and campaign records.",
      "90-day second-invoice rate by channel with eligible cohort size and ID coverage."]
];
const fields = ["Evidence and explanation to test", "Action and likely owner", "Data to request", "Progress metric"];
document.getElementById("priorities").append(element("ol", {class: "priorities"},
  priorities.map(([issue, ...values]) => element("li", {}, element("h3", {}, issue),
    element("dl", {}, values.map((value, index) => element("div", {},
      element("dt", {}, fields[index]), element("dd", {}, value))))))));
