"use strict";

const definitions = {
  sales: {
    title: "Sales overview",
    intro: "Compare recorded merchandise sales, order activity and the drivers of change across customer markets.",
    filter: "Market and period apply to the KPIs and monthly trend. Growth uses the same Jan–Nov comparison throughout."
  },
  reconciliation: {
    title: "Sales reconciliation",
    intro: "Trace signed workbook value into recorded merchandise sales and see where cancellation value is concentrated.",
    filter: "Market and period apply to the bridge, cancellation exposure and sensitivity tests."
  },
  customers: {
    title: "Customer risk",
    intro: "Inspect dependence on large customers and compare repeat purchasing after equal observation time.",
    filter: "Period applies to concentration. Cohorts use first-purchase market and the selected follow-up age across the workbook."
  },
  linkage: {
    title: "Linkage & quality",
    intro: "Review plausible earlier-sale links, ambiguous candidates and source exceptions.",
    filter: "Filters apply to cancellation events. Mature sale cohorts use market and a fixed 90-day horizon. Quality counts cover the workbook."
  }
};
const periods = ["All dates", "Jan–Nov 2010", "Jan–Nov 2011", "Dec 2010", "Partial Dec 2011"];
const bounds = {
  "All dates": ["2009-12", "2011-12"],
  "Jan–Nov 2010": ["2010-01", "2010-11"],
  "Jan–Nov 2011": ["2011-01", "2011-11"],
  "Dec 2010": ["2010-12", "2010-12"],
  "Partial Dec 2011": ["2011-12", "2011-12"]
};
const scopes = ["All markets", "United Kingdom", "Outside UK", ...[...new Set(data.sales_totals.map(row => row.scope))]
  .filter(scope => !["All markets", "United Kingdom", "Outside UK"].includes(scope)).sort()];
const fields = Object.fromEntries(["scope", "period", "age", "lookback"].map(id => [id, document.getElementById(id)]));
const matched = (rows, scope, period) => rows.filter(row => row.scope === scope && row.period === period);

function options(select, choices, initial, suffix = "") {
  select.replaceChildren(...choices.map(choice => element("option", {value: choice}, choice + suffix)));
  select.value = initial;
}

options(fields.scope, scopes, "All markets");
options(fields.period, periods, "All dates");
options(fields.age, [30, 60, 90, 180], 90, " days");
options(fields.lookback, [90, 365], 90, " days");

function selectedGrowth(scope) {
  return data.market_growth.find(row => row.scope === scope);
}

function monthlyCalendar(scope, period) {
  const [start, end] = bounds[period];
  const calendar = data.monthly_sales.filter(row => row.scope === "All markets" &&
    row.month.slice(0, 7) >= start && row.month.slice(0, 7) <= end);
  const scoped = new Map(data.monthly_sales.filter(r => r.scope === scope).map(r => [r.month, r]));
  return calendar.map(row => ({
    ...row, ...(scoped.get(row.month) || {gross: "0", net: "0", cancelled: "0", sales_invoices: "0"}),
    label: monthName(row.month), ticks: monthName(row.month).replace(/ 20/, " ’"),
    partial: row.coverage === "Partial"
  }));
}

function sales({scope, period, total}) {
  const points = monthlyCalendar(scope, period);
  const baseline = selectedGrowth(scope);
  const material = data.market_growth.filter(row => row.material_international === "t");
  const marketPanels = ["All markets", "Outside UK", "United Kingdom"].map(selectedGrowth).concat(material);
  const mix = matched(data.growth_mix, scope, "Jan–Nov 2010")
    .concat(matched(data.growth_mix, scope, "Jan–Nov 2011"));
  const monthTable = table(["Month", "Coverage", "Positive sales", "Net recorded", "Sales invoices"],
    points.map(row => [row.label, row.coverage, money(row.gross), money(row.net), count(row.sales_invoices)]),
    "Monthly sales values", [2, 3, 4]);
  const chart = wide(panel("Monthly recorded sales", `${scope} · ${period} · sterling`,
    total ? trend(points, [{key: "gross", label: "Positive sales"}, {key: "net", label: "Net recorded sales"}], shortMoney,
      {label: `Monthly positive and net sales for ${scope}. Open monthly values for exact figures.`}) : empty(),
    total && points.some(row => row.partial) ? note("December 2011 ends on the 9th. An open marker and dashed segment denote the partial month.") : null,
    total ? detail("Monthly values", monthTable) : null));
  const growth = panel("What changed", `${scope} · Jan–Nov 2010 to Jan–Nov 2011`,
    baseline && baseline.volume_effect !== "" ?
      bars([
        {label: "Change in positive sales", value: Number(baseline.gross_change), text: money(baseline.gross_change)},
        {label: "Invoice-volume effect", value: Number(baseline.volume_effect), text: money(baseline.volume_effect)},
        {label: "Average invoice-value effect", value: Number(baseline.aiv_effect), text: money(baseline.aiv_effect)}
      ], undefined, true) : empty("This market has insufficient sales invoices for a two-period driver comparison."),
    baseline?.volume_effect ? note(`${count(baseline.invoices_2010)} to ${count(baseline.invoices_2011)} invoices. Average invoice value moved from ${money(baseline.aiv_2010)} to ${money(baseline.aiv_2011)}.`) : null);
  const mixPanel = panel("Customer mix", `${scope} · global first-observed customer history. Anonymous sales remain in totals.`,
    table(["Sales component", "Jan–Nov 2010", "Jan–Nov 2011"],
      mix.length === 2 ? [
        ["Previously observed customers", "prior_observed_gross"],
        ["First observed in the period", "first_observed_in_period_gross"],
        ["Anonymous sales", "anonymous_gross"],
        ["Sales excluding pooled top five", "gross_without_pooled_top5"]
      ].map(([label, field]) => [label, money(mix[0][field]), money(mix[1][field])]) : [],
      "Customer mix values", [1, 2]));
  return [
    total ? metrics(
      metric("Positive merchandise sales", shortMoney(total.gross), "Eligible signed-positive lines", money(total.gross)),
      metric("Net recorded sales", shortMoney(total.net), "After merchandise cancellations", money(total.net)),
      metric("Positive sales invoices", count(total.sales_invoices), "Unique IDs with eligible sales"),
      metric("Average invoice value", money(total.average_invoice), "Positive sales ÷ sales invoices")
    ) : empty(),
    grid(chart, growth, mixPanel, wide(panel("Comparable market performance",
      "Jan–Nov in each year. UK and Outside UK are shown separately. Named international markets have at least £100k in pooled sales and meet thresholds of 30 sales invoices and 80% identified sales value in both periods.",
      table(["Customer market", "2010 sales", "2011 sales", "Change", "Change %", "2011 invoices", "2011 ID share"],
        marketPanels.map(row => [row.scope, money(row.gross_2010), money(row.gross_2011), money(row.gross_change),
          pct(row.gross_change_rate), count(row.invoices_2011), pct(row.id_share_2011)]),
        "Comparable market performance", [1, 2, 3, 4, 5, 6]))))
  ];
}

function reconciliation({scope, period, total}) {
  if (!total) return empty();
  const bridge = matched(data.reconciliation, scope, period);
  const rank = matched(data.cancellation_rank, scope, period);
  const relevantMarkets = scopes.slice(3).concat("United Kingdom").filter(country =>
    scope === "All markets" || scope === "Outside UK" && country !== "United Kingdom" || country === scope);
  const countries = data.sales_totals.filter(row => row.period === period && relevantMarkets.includes(row.scope))
    .sort((a, b) => Number(b.cancelled) - Number(a.cancelled));
  const monthRows = monthlyCalendar(scope, period).sort((a, b) => Number(b.cancelled) - Number(a.cancelled));
  const sensitivity = matched(data.cancellation_sensitivity, scope, period);
  function exposure(name, rows) {
    return panel(name, "Ranked by cancellation value. Ratios divide by the positive sales shown.",
      table(["Label", "Positive sales", "Cancellation value", "Value ratio", "Share of scope"],
        rows.map(row => [row.label, money(row.gross), money(row.cancelled), pct(ratio(row.cancelled, row.gross)),
          pct(ratio(row.cancelled, total.cancelled))]), name, [1, 2, 3, 4]));
  }
  return [
    metrics(
      metric("Raw signed workbook value", shortMoney(total.raw_exact_value), `${count(total.raw_lines)} workbook lines`, money(total.raw_exact_value)),
      metric("Positive merchandise sales", shortMoney(total.gross), "Includes anonymous purchases", money(total.gross)),
      metric("Cancellation-coded merchandise", shortMoney(total.cancelled), `${pct(total.cancellation_value_ratio)} of positive sales`, money(total.cancelled)),
      metric("Net recorded merchandise", shortMoney(total.net), "Positive sales less cancellations plus other merchandise adjustments", money(total.net))
    ),
    grid(
      wide(panel("Every line accounted for", `${scope} · ${period} · signed sterling value by disposition`,
        bars([
          {label: "Positive merchandise", value: Number(total.gross), text: money(total.gross)},
          {label: "Less cancellation-coded merchandise", value: Number(total.cancelled), text: money(-total.cancelled), alt: true},
          {label: "Other merchandise adjustments", value: Number(total.other_merchandise), text: money(total.other_merchandise)},
          {label: "Net recorded merchandise", value: Number(total.net), text: money(total.net)}
        ]),
        detail("Raw-to-net disposition ledger", table(["Disposition", "Lines", "Raw signed value", "Normalized signed value"],
          bridge.map(row => [row.disposition, count(row.lines), money(row.raw_exact_value), money(row.normalized_signed_value)]),
          "Raw-to-net dispositions", [1, 2, 3])),
        note("The raw figure includes mirrored overlap and non-merchandise entries. Display rounds to pence; the CSV ledger preserves the exact Excel precision bridge."))),
      exposure("Largest cancellation months", monthRows.slice(0, 6).map(row => ({...row, label: row.label + (row.partial ? " (partial)" : "")}))),
      exposure("Largest cancellation countries", countries.slice(0, 6).map(row => ({...row, label: row.scope}))),
      exposure("Most exposed products", rank.filter(row => row.grain === "Product")),
      exposure("Most exposed customers", rank.filter(row => row.grain === "Customer")
        .map(row => ({...row, label: row.label === "Anonymous" ? "Anonymous" : `Customer ${row.label}` }))),
      wide(panel("Sensitivity to line treatment", `${scope} · ${period} · each variant changes one rule relative to baseline`,
        table(["Treatment", "Lines retained", "Positive sales", "Cancellation value", "Value ratio"],
          sensitivity.map(row => [row.variant, count(row.retained_lines), money(row.gross), money(row.cancelled),
            pct(ratio(row.cancelled, row.gross))]), "Sensitivity of cancellation value", [1, 2, 3, 4]),
        note("The value ratio uses sales and cancellation entries recorded in the same period. It measures exposure by value.")))
    )
  ];
}

function customers({scope, period, age}) {
  const concentration = matched(data.concentration, scope, period)[0];
  const cohorts = data.cohort_repeat.filter(row => row.scope === scope && row.days === age);
  const ready = cohorts.filter(row => row.cohort_size === row.eligible_customers);
  const byMonth = new Map(ready.map(row => [row.cohort, row]));
  const calendar = data.cohort_repeat.filter(row => row.scope === "All markets" && row.days === age &&
    row.cohort_size === row.eligible_customers);
  const points = calendar.map(({cohort}) => {
    const row = byMonth.get(cohort);
    return {label: monthName(cohort), ticks: monthName(cohort).replace(/ 20/, " ’"),
      rate: row ? ratio(row.repeaters, row.eligible_customers) : null};
  });
  const comparison = data.repeat_comparison.filter(row => row.scope === scope && row.days === age);
  const marketGroup = new Set(["All markets", "United Kingdom", "Outside UK", ...data.material_markets.map(row => row.scope)]);
  const benchmarks = data.concentration.filter(row => row.period === period && marketGroup.has(row.scope));
  return [
    concentration && Number(concentration.gross) > 0 ? metrics(
      metric("Identified gross share", pct(concentration.identified_share), `${shortMoney(concentration.identified_gross)} of ${shortMoney(concentration.gross)}`),
      metric("Identified customers", count(concentration.identified_customers), "Distinct positive-sales customer IDs"),
      metric("Largest customer", pct(concentration.top1_share_identified), "Share of identified positive sales"),
      metric("Top five customers", pct(concentration.top5_share_identified), "Share of identified positive sales")
    ) : empty("No eligible positive sales in the selected market and period."),
    grid(
      panel("Customer concentration", `${scope} · ${period} · shares of identified positive sales`,
        concentration && Number(concentration.identified_gross) > 0 ? bars([
          {label: "Top customer", value: Number(concentration.top1_share_identified), text: pct(concentration.top1_share_identified)},
          {label: "Top five customers", value: Number(concentration.top5_share_identified), text: pct(concentration.top5_share_identified)},
          {label: "Top ten customers", value: Number(concentration.top10_share_identified), text: pct(concentration.top10_share_identified)}
        ], 1) : empty("No identified positive sales to rank."),
        concentration && Number(concentration.identified_gross) > 0 ?
          note(`The top customer is ${pct(concentration.top1_share_all_sales)} of all positive sales, including anonymous purchases.`) : null),
      panel("Equal-age cohort comparison", `${scope} · Jan–May first-observed cohorts · ${age} days`,
        comparison.length ? table(["Cohort year", "Eligible", "Repeated", "Repeat rate"],
          comparison.map(row => [row.cohort_year, count(row.eligible_customers), count(row.repeaters), pct(row.repeat_rate)]),
          "Equal-age repeat comparison", [1, 2, 3]) : empty("No mature January to May cohorts for this market."),
        note("Membership uses a customer's first observed purchase country. A second eligible invoice can occur in any country.")),
      wide(panel("Repeat purchasing by first-observed month", `${scope} · ${age}-day repeat rate · cohorts with complete follow-up`,
        ready.length ? trend(points, [{key: "rate", label: "Repeat rate"}], pct) :
          empty("No cohorts have complete follow-up for this market and age."),
        cohorts.length ? detail("Cohort denominators and maturity", table(["First observed", "Cohort size", "Eligible", "Repeated", "Rate"],
          cohorts.map(row => [monthName(row.cohort), count(row.cohort_size), count(row.eligible_customers),
            count(row.repeaters), row.cohort_size === row.eligible_customers ? pct(ratio(row.repeaters, row.eligible_customers)) : "Still maturing"]),
          "Cohort denominator data", [1, 2, 3, 4])) : null)),
      wide(panel("Market benchmarks", `${period} · UK, outside UK and material international markets`,
        table(["Market", "Identified customers", "ID share", "Top one", "Top five", "Top ten"],
          benchmarks.map(row => [row.scope, count(row.identified_customers), pct(row.identified_share),
            pct(row.top1_share_identified), pct(row.top5_share_identified), pct(row.top10_share_identified)]),
          "Customer concentration benchmarks", [1, 2, 3, 4, 5])))
    )
  ];
}

function linkage({scope, period, lookback}) {
  const all = matched(data.linkage_coverage, scope, period);
  const rows = all.filter(row => row.lookback === lookback);
  const covered = rows.filter(row => row.completion !== "Unlinked");
  const value = sum(rows, "cancellation_value");
  const allocated = sum(covered, "matched_value");
  const events = sum(rows, "cancellation_lines");
  const lags = matched(data.linkage_lag, scope, period).filter(row => row.lookback === lookback)
    .sort((a, b) => ["Under 1 day", "1–7 days", "8–30 days", "31–90 days", "91+ days"].indexOf(a.lag_band) -
      ["Under 1 day", "1–7 days", "8–30 days", "31–90 days", "91+ days"].indexOf(b.lag_band));
  const saleMonths = data.linked_sale_cohort.filter(row => row.scope === scope);
  const comparisons = [90, 365].map(days => {
    const evidence = all.filter(row => Number(row.lookback) === days);
    return [`${days} days`, count(sum(evidence.filter(row => row.completion !== "Unlinked"), "cancellation_lines")),
      money(sum(evidence, "matched_value")), pct(ratio(sum(evidence, "matched_value"), value)),
      count(sum(evidence, "lines_with_pre_window_risk"))];
  });
  return [
    events ? metrics(
      metric("Cancellation-coded lines", count(events), money(value)),
      metric("Lines with some allocation", pct(ratio(sum(covered, "cancellation_lines"), events)),
        `${count(sum(covered, "cancellation_lines"))} of ${count(events)} cancellation lines`),
      metric("Value allocated", pct(ratio(allocated, value)), `${shortMoney(allocated)} of ${shortMoney(value)}`),
      metric("Value left unallocated", shortMoney(value - allocated), "Outstanding inferred quantity value", money(value - allocated))
    ) : empty("No eligible cancellation-coded merchandise for this market and period."),
    grid(
      wide(panel("Evidence at the point of cancellation", `${scope} · ${period} · ${lookback}-day lookback`,
        table(["Candidate evidence", "Completion", "Lines", "Cancellation value", "Allocated value"],
          rows.map(row => [row.evidence, row.completion, count(row.cancellation_lines),
            money(row.cancellation_value), money(row.matched_value)]), "Linkage coverage by evidence", [2, 3, 4]),
        note("One candidate invoice is still an inferred link. Partial allocations preserve the unmatched balance."))),
      panel("Lag for allocated value", "Elapsed time from the allocated sale line to the cancellation line.",
        bars(lags.map(row => ({label: row.lag_band, value: Number(row.linked_value),
          text: `${money(row.linked_value)} · ${pct(ratio(row.linked_value, allocated))}`})))),
      panel("Lookback sensitivity", "Both rules use the same observed cancellation population.",
        events ? table(["Lookback", "Lines with allocation", "Allocated value", "Value share", "Pre-window risk lines"],
          comparisons, "Lookback sensitivity", [1, 2, 3, 4]) : empty()),
      wide(panel("Mature sale cohorts", `${scope} · fixed 90-day linkage · identified sale lines in fully observed months`,
        detail("Mature sale-month denominators", table(["Sale month", "Mature sale lines", "Identified sales", "Allocated value", "Inferred value ratio"],
          saleMonths.map(row => [monthName(row.sale_month), count(row.mature_sale_lines), money(row.identified_gross),
            money(row.linked_90d_value), pct(ratio(row.linked_90d_value, row.identified_gross))]),
          "Mature linked sale cohorts", [1, 2, 3, 4])))),
      wide(panel("Workbook data quality", "All dates and markets · overlapping diagnostics at their stated grains.",
        table(["Diagnostic", "Grain", "Records", "Signed value"], data.quality_checks.map(row =>
          [row.issue, row.grain, count(row.records), money(row.signed_value)]), "Workbook data quality", [2, 3]),
        detail("Largest unusual lines", table(["Invoice", "Date", "Stock code", "Disposition", "Quantity", "Signed value"],
          data.extreme_lines.slice(0, 12).map(row => [row.invoice_key, row.invoice_at.slice(0, 10),
            row.product, row.disposition, count(row.quantity), money(row.line_value)]),
          "Largest unusual lines", [4, 5]))))
    )
  ];
}

const renderers = {sales, reconciliation, customers, linkage};
const view = document.getElementById("view");
function render() {
  const id = location.hash.slice(1);
  const active = Object.hasOwn(renderers, id) ? id : "sales";
  const current = definitions[active];
  const state = Object.fromEntries(Object.entries(fields).map(([key, el]) => [key, el.value]));
  state.total = matched(data.sales_totals, state.scope, state.period)[0];
  document.getElementById("view-title").textContent = current.title;
  document.getElementById("view-intro").textContent = current.intro;
  document.getElementById("filter-note").textContent = current.filter;
  document.getElementById("age-field").hidden = active !== "customers";
  document.getElementById("lookback-field").hidden = active !== "linkage";
  document.querySelectorAll(".nav-link").forEach(link => {
    if (link.hash === "#" + active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  clearCharts();
  view.replaceChildren(...[renderers[active](state)].flat(1));
  document.getElementById("filter-status").textContent = `Showing ${current.title} for ${state.scope}, ${state.period}.`;
}
document.getElementById("filters").addEventListener("change", render);
document.getElementById("filters").addEventListener("submit", event => event.preventDefault());
document.querySelector(".skip").addEventListener("click", event => {
  event.preventDefault();
  document.getElementById("main").focus();
});
window.addEventListener("hashchange", render);
render();
