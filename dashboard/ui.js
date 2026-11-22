"use strict";

const data = window.RETAIL_DATA;
const pounds = new Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP", maximumFractionDigits: 2, minimumFractionDigits: 2});
const compact = new Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 2});
const integers = new Intl.NumberFormat("en-GB");
const percent = new Intl.NumberFormat("en-GB", {style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1});

function number(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}
const format = (formatter, value) => number(value) === null ? "—" : formatter.format(number(value));
const money = value => format(pounds, value);
const shortMoney = value => format(compact, value);
const count = value => format(integers, value);
const pct = value => format(percent, value);
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field]), 0);
const monthName = stamp => new Intl.DateTimeFormat("en-GB", {month: "short", year: "numeric", timeZone: "UTC"}).format(new Date(stamp));

function element(tag, attributes, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, value);
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

function panel(title, subtitle, ...children) {
  return element("section", {class: "panel"}, element("h3", {}, title),
    subtitle ? element("p", {class: "panel-note"}, subtitle) : null, children);
}

function metric(label, value, detail, exactValue) {
  return element("div", {class: "metric"}, element("p", {class: "metric-label"}, label),
    element("strong", exactValue ? {title: exactValue} : {}, value), element("p", {}, detail));
}

const metrics = (...cards) => element("div", {class: "metrics"}, cards);
const grid = (...panels) => element("div", {class: "grid"}, panels);
const wide = node => { node.classList.add("wide"); return node; };
const empty = (message = "No records for the selected market and period.") => element("p", {class: "empty"}, message);
const note = message => element("p", {class: "note"}, message);

function table(headers, rows, label, numeric = []) {
  if (!rows.length) return empty();
  const attrs = index => numeric.includes(index) ? {class: "num"} : {};
  const wrapper = element("div", {class: "table-wrap", tabindex: "0", role: "region", "aria-label": label},
    element("table", {},
      element("thead", {}, element("tr", {}, headers.map((heading, index) =>
        element("th", {scope: "col", ...attrs(index)}, heading)))),
      element("tbody", {}, rows.map(row => element("tr", {}, row.map((value, index) =>
        element("td", attrs(index), value)))))));
  const hint = element("p", {class: "scroll-hint", hidden: ""}, "Scroll sideways for more columns");
  const observer = new ResizeObserver(() => { hint.hidden = wrapper.scrollWidth <= wrapper.clientWidth + 1; });
  observer.observe(wrapper);
  chartObservers.add(observer);
  return element("div", {}, wrapper, hint);
}

function detail(title, node) {
  return element("details", {}, element("summary", {}, title), node);
}

function bars(rows, maximum, signed = false) {
  if (!rows.length) return empty();
  const max = maximum ?? Math.max(...rows.map(row => Math.abs(row.value)));
  return element("div", {class: "chart-list"}, rows.map(row => {
    const scale = signed ? 50 : 100;
    const width = max > 0 ? scale * Math.abs(row.value) / max : 0;
    const start = signed ? 50 - (row.value < 0 ? width : 0) : 0;
    const tone = signed ? row.value < 0 : row.alt;
    return element("div", {class: "bar-row"},
      element("div", {class: "bar-label"}, element("span", {}, row.label), element("strong", {}, row.text)),
      element("span", {class: signed ? "track signed" : "track", "aria-hidden": "true"},
        element("span", {class: tone ? "fill alt" : "fill", style: `width:${width}%;margin-left:${start}%`})));
  }));
}

const chartObservers = new Set();
function clearCharts() {
  chartObservers.forEach(observer => observer.disconnect());
  chartObservers.clear();
}

function trend(points, series, formatY, options = {}) {
  if (!points.length) return empty();
  const chart = element("canvas", {role: "img", "aria-label": options.label || "Trend chart. Exact numbers are in the table below."});
  const wrap = element("div", {class: "chart"}, chart,
    element("div", {class: "legend"}, series.map((line, index) =>
      element("span", {class: index ? "comparison" : ""}, line.label))));
  function draw() {
    const width = chart.clientWidth;
    const height = chart.clientHeight;
    if (!width || !height) return;
    const pixelRatio = window.devicePixelRatio || 1;
    chart.width = width * pixelRatio;
    chart.height = height * pixelRatio;
    const ctx = chart.getContext("2d");
    const theme = getComputedStyle(chart);
    const colour = token => theme.getPropertyValue(token).trim();
    const palette = [colour("--accent"), colour("--comparison")];
    ctx.scale(pixelRatio, pixelRatio);
    ctx.font = `12px ${colour("--mono")}`;
    const maximum = Math.max(1, ...points.flatMap(point => series.map(line => Number(point[line.key]) || 0)));
    const minimum = Math.min(0, ...points.flatMap(point => series.map(line => Number(point[line.key]) || 0)));
    const ticks = Array.from({length: 5}, (_, step) => minimum + (maximum - minimum) * step / 4);
    const left = Math.ceil(Math.max(40, ...ticks.map(value => ctx.measureText(formatY(value)).width))) + 12;
    const right = width - 14;
    const top = 13;
    const bottom = height - 32;
    const x = index => points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
    const y = value => bottom - (value - minimum) * (bottom - top) / (maximum - minimum);
    // Shade the primary series in contiguous runs so missing cohorts stay gaps.
    ctx.fillStyle = colour("--plot-fill");
    const baselineY = y(0);
    let start = null;
    points.forEach((point, index) => {
      const value = number(point[series[0].key]);
      if (value !== null && !point.partial) {
        if (start === null) {
          start = index;
          ctx.beginPath();
          ctx.moveTo(x(index), baselineY);
        }
        ctx.lineTo(x(index), y(value));
      }
      const next = points[index + 1];
      if (start !== null && (!next || next.partial || number(next[series[0].key]) === null)) {
        ctx.lineTo(x(index), baselineY);
        ctx.closePath();
        ctx.fill();
        start = null;
      }
    });

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const value of ticks) {
      ctx.strokeStyle = colour(value === 0 ? "--plot-axis" : "--plot-grid");
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
      ctx.fillStyle = colour("--muted");
      ctx.fillText(formatY(value), left - 7, y(value));
    }
    const labelEvery = Math.ceil(points.length / (width < 540 ? 4 : 8));
    ctx.textAlign = "center";
    ctx.fillStyle = colour("--muted");
    points.forEach((point, index) => {
      const final = index === points.length - 1;
      if (final || (index % labelEvery === 0 &&
          (points.length - 1 - index) * (right - left) / points.length >= 48)) {
        ctx.textAlign = final && points.length > 1 ? "right" : "center";
        ctx.fillText(point.ticks || point.label, x(index), bottom + 18);
      }
    });
    series.forEach((line, lineIndex) => {
      ctx.strokeStyle = palette[lineIndex];
      ctx.fillStyle = palette[lineIndex];
      ctx.lineWidth = lineIndex === 0 ? 2.5 : 1.7;
      points.forEach((point, index) => {
        const value = number(point[line.key]);
        if (value === null) return;
        const previous = index > 0 ? number(points[index - 1][line.key]) : null;
        if (previous !== null) {
          ctx.setLineDash(point.partial ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(x(index - 1), y(previous));
          ctx.lineTo(x(index), y(value));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x(index), y(value), point.partial ? 4 : 2.7, 0, Math.PI * 2);
        if (point.partial) ctx.stroke();
        else ctx.fill();
      });
    });
  }
  const observer = new ResizeObserver(draw);
  observer.observe(wrap);
  chartObservers.add(observer);
  return wrap;
}
