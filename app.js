const STORAGE_KEY = "arcade_pension_scenarios_v1";
const Y_STEP = 25;

const ChartJS = window.Chart;
const ChartDragDataPlugin =
  window.ChartDragData || window.ChartDragDataPlugin || window.chartjsPluginDragData;

if (ChartJS?.register && ChartDragDataPlugin) {
  try {
    ChartJS.register(ChartDragDataPlugin);
  } catch {
    // Ignore double-registration.
  }
}

const elements = {
  startCapital: document.getElementById("start-capital"),
  startSavings: document.getElementById("start-savings"),
  returnSavings: document.getElementById("return-savings"),
  returnWithdrawal: document.getElementById("return-withdrawal"),
  inflation: document.getElementById("inflation"),
  duration: document.getElementById("duration"),
  payoutMode: document.getElementById("payout-mode"),
  payoutYears: document.getElementById("payout-years"),
  payoutYearsField: document.getElementById("payout-years-field"),
  saveScenario: document.getElementById("save-scenario"),
  warnings: document.getElementById("warnings"),
  tabs: document.getElementById("scenario-tabs"),
  summaryBody: document.getElementById("summary-body"),
  kpiEndNominal: document.getElementById("kpi-end-nominal"),
  kpiEndReal: document.getElementById("kpi-end-real"),
  kpiPayoutNominal: document.getElementById("kpi-payout-nominal"),
  kpiPayoutReal: document.getElementById("kpi-payout-real"),
};

const defaultParams = {
  startCapital: 100000,
  durationYears: 30,
  annualReturnSavings: 0.07,
  annualReturnWithdrawal: 0.05,
  annualInflation: 0.02,
  payoutMode: "perpetual",
  payoutYears: 25,
  breakpoints: [{ year: 0, monthlyRate: 1000 }],
};

let breakpoints = [...defaultParams.breakpoints];
let scenarios = [];
let activeScenarioId = null;

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const romanNumerals = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
];

const getScenarioName = (index) =>
  `Scenario ${romanNumerals[index] || index + 1}`;

const formatSchedule = (points) => {
  return points
    .map((bp) => `${bp.year}Y→${formatCurrency(bp.monthlyRate)}/MO`)
    .join(" | ");
};

const buildScenarioTooltipHtml = (scenario) => {
  const p = scenario.params;
  const payout =
    p.payoutMode === "fixed" ? `FIXED (${p.payoutYears}Y)` : "PERPETUAL";

  return `
    <div><strong>${scenario.name}</strong></div>
    <div>START CAPITAL: ${formatCurrency(p.startCapital)}</div>
    <div>DURATION: ${p.durationYears}Y</div>
    <div>RETURN SAVINGS: ${formatPercent(p.annualReturnSavings)}</div>
    <div>RETURN WITHDRAWAL: ${formatPercent(p.annualReturnWithdrawal)}</div>
    <div>INFLATION: ${formatPercent(p.annualInflation)}</div>
    <div>PAYOUT MODE: ${payout}</div>
    <div>SCHEDULE: ${formatSchedule(p.breakpoints)}</div>
  `.trim();
};

const getOrCreateScenarioTooltip = () => {
  let el = document.getElementById("scenario-tooltip");
  if (el) {
    return el;
  }
  el = document.createElement("div");
  el.id = "scenario-tooltip";
  el.className = "scenario-tooltip";
  document.body.appendChild(el);
  return el;
};

const normalizeBreakpoints = (points, durationYears) => {
  const deduped = new Map();
  points.forEach((point) => {
    const year = clamp(Math.round(point.year), 0, durationYears);
    if (!deduped.has(year)) {
      deduped.set(year, {
        year,
        monthlyRate: Math.max(0, point.monthlyRate),
      });
    }
  });
  if (!deduped.has(0)) {
    deduped.set(0, { year: 0, monthlyRate: defaultParams.breakpoints[0].monthlyRate });
  }
  return Array.from(deduped.values()).sort((a, b) => a.year - b.year);
};

const roundToStep = (value, step) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
};

const monthlyRateAtYear = (points, year) => {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  let current = sorted[0];
  sorted.forEach((point) => {
    if (point.year <= year) {
      current = point;
    }
  });
  return current?.monthlyRate ?? 0;
};

const buildParamsFromInputs = () => {
  const startCapital = Math.max(0, toNumber(elements.startCapital.value));
  const durationYears = clamp(Math.round(toNumber(elements.duration.value, 1)), 1, 80);
  const payoutMode = elements.payoutMode.value;
  const payoutYears = Math.round(toNumber(elements.payoutYears.value, 1));

  const params = {
    startCapital,
    durationYears,
    annualReturnSavings: toNumber(elements.returnSavings.value) / 100,
    annualReturnWithdrawal: toNumber(elements.returnWithdrawal.value) / 100,
    annualInflation: toNumber(elements.inflation.value) / 100,
    payoutMode,
    payoutYears: payoutMode === "fixed" ? Math.max(1, payoutYears) : null,
    breakpoints: normalizeBreakpoints(breakpoints, durationYears),
  };

  breakpoints = params.breakpoints;
  return params;
};

const populateInputs = (params) => {
  elements.startCapital.value = params.startCapital;
  elements.duration.value = params.durationYears;
  elements.returnSavings.value = (params.annualReturnSavings * 100).toFixed(2);
  elements.returnWithdrawal.value = (params.annualReturnWithdrawal * 100).toFixed(2);
  elements.inflation.value = (params.annualInflation * 100).toFixed(2);
  elements.payoutMode.value = params.payoutMode;
  elements.payoutYears.value = params.payoutYears ?? defaultParams.payoutYears;
  elements.startSavings.value = params.breakpoints[0]?.monthlyRate ?? 0;
  breakpoints = normalizeBreakpoints(params.breakpoints, params.durationYears);
  togglePayoutYears();
};

const togglePayoutYears = () => {
  const isFixed = elements.payoutMode.value === "fixed";
  elements.payoutYearsField.style.display = isFixed ? "flex" : "none";
};

let previewRaf = null;

const updateScenarioChartFromResults = (results) => {
  if (!scenarioChart) {
    return;
  }
  if (!results) {
    scenarioChart.data.labels = [];
    scenarioChart.data.datasets.forEach((dataset) => {
      dataset.data = [];
    });
    scenarioChart.update();
    return;
  }

  const { series } = results;
  scenarioChart.data.labels = series.years.map((year) => year.toFixed(1));
  scenarioChart.data.datasets[0].data = series.capitalNominal;
  scenarioChart.data.datasets[1].data = series.capitalReal;
  scenarioChart.data.datasets[2].data = series.payinsNominal;
  scenarioChart.data.datasets[3].data = series.payinsReal;
  scenarioChart.update();
};

const updateKpisFromResults = (results) => {
  if (!results) {
    elements.kpiEndNominal.textContent = "—";
    elements.kpiEndReal.textContent = "—";
    elements.kpiPayoutNominal.textContent = "—";
    elements.kpiPayoutReal.textContent = "—";
    return;
  }
  const { summary } = results;
  elements.kpiEndNominal.textContent = formatCurrency(summary.endCapitalNominal);
  elements.kpiEndReal.textContent = formatCurrency(summary.endCapitalReal);
  elements.kpiPayoutNominal.textContent =
    formatCurrency(summary.payoutMonthlyNominalAtRetirementStart);
  elements.kpiPayoutReal.textContent = formatCurrency(summary.payoutMonthlyRealToday);
};

const computeAndRenderPreview = () => {
  const params = buildParamsFromInputs();
  const { results, warnings } = computeResults(params);
  setWarnings(warnings);
  updateScenarioChartFromResults(results);
  updateKpisFromResults(results);
};

const schedulePreviewRender = () => {
  if (previewRaf !== null) {
    cancelAnimationFrame(previewRaf);
  }
  previewRaf = requestAnimationFrame(() => {
    previewRaf = null;
    computeAndRenderPreview();
  });
};

const computeResults = (params) => {
  const warnings = [];
  const durationMonths = params.durationYears * 12;

  if (params.annualInflation <= -1) {
    warnings.push("Inflation rate must be greater than -100%.");
  }

  const rSavings = Math.pow(1 + params.annualReturnSavings, 1 / 12) - 1;
  const rWithdrawal = Math.pow(1 + params.annualReturnWithdrawal, 1 / 12) - 1;
  const iMonthly = Math.pow(1 + params.annualInflation, 1 / 12) - 1;

  const years = [];
  const capitalNominal = [];
  const capitalReal = [];
  const payinsNominal = [];
  const payinsReal = [];

  let balance = params.startCapital;
  let payNom = 0;
  let payReal = 0;

  for (let m = 1; m <= durationMonths; m += 1) {
    balance *= 1 + rSavings;
    const year = (m - 1) / 12;
    const monthlyRate = monthlyRateAtYear(params.breakpoints, year);
    balance += monthlyRate;
    payNom += monthlyRate;
    const inflationFactor = Math.pow(1 + iMonthly, m);
    payReal += monthlyRate / inflationFactor;

    years.push(m / 12);
    capitalNominal.push(balance);
    capitalReal.push(balance / inflationFactor);
    payinsNominal.push(payNom);
    payinsReal.push(payReal);

    if (!Number.isFinite(inflationFactor) || inflationFactor === 0) {
      warnings.push("Inflation compounding overflow. Values are clamped.");
      break;
    }
  }

  const inflationFactorEnd = Math.pow(1 + iMonthly, durationMonths);
  const endCapitalNominal = balance;
  const endCapitalReal = balance / inflationFactorEnd;

  const rReal = (1 + rWithdrawal) / (1 + iMonthly) - 1;
  let payoutReal = 0;

  if (params.payoutMode === "perpetual") {
    payoutReal = rReal > 0 ? endCapitalReal * rReal : 0;
    if (rReal <= 0) {
      warnings.push("Perpetual payout is zero because real return is non-positive.");
    }
  } else {
    const n = (params.payoutYears ?? 1) * 12;
    if (Math.abs(rReal) < 1e-12) {
      payoutReal = endCapitalReal / n;
    } else {
      payoutReal = endCapitalReal * rReal / (1 - Math.pow(1 + rReal, -n));
    }
  }

  const payoutNominal = payoutReal * inflationFactorEnd;

  if (!Number.isFinite(payoutReal) || !Number.isFinite(payoutNominal)) {
    payoutReal = 0;
    warnings.push("Payout calculation overflow. Values are set to zero.");
  }

  return {
    results: {
      series: {
        years,
        capitalNominal,
        capitalReal,
        payinsNominal,
        payinsReal,
      },
      summary: {
        endCapitalNominal,
        endCapitalReal,
        payoutMonthlyNominalAtRetirementStart: payoutNominal,
        payoutMonthlyRealToday: payoutReal,
      },
    },
    warnings,
  };
};

let scheduleChart = null;
let scenarioChart = null;

let scheduleRenderMeta = {
  draggableByDataIndex: new Map(),
  breakpointByDataIndex: new Map(),
};

const buildScheduleRenderData = (points, durationYears) => {
  // Build an explicit staircase: at each breakpoint year, draw a vertical jump,
  // then a horizontal segment that applies to the RIGHT of the breakpoint.
  // We do this by adding a non-draggable "join" point at (year, prevRate)
  // followed by a draggable "level" point at (year, rate).

  const meta = {
    draggableByDataIndex: new Map(),
    breakpointByDataIndex: new Map(),
  };

  const data = [];
  const sorted = normalizeBreakpoints(points, durationYears);
  if (!sorted.length) {
    sorted.push({ year: 0, monthlyRate: 0 });
  }

  // Start point
  data.push({ x: 0, y: sorted[0].monthlyRate });
  meta.draggableByDataIndex.set(0, true);
  meta.breakpointByDataIndex.set(0, 0);

  for (let i = 1; i < sorted.length; i += 1) {
    const year = sorted[i].year;
    const prevRate = sorted[i - 1].monthlyRate;
    const rate = sorted[i].monthlyRate;

    // Connector (non-draggable)
    data.push({ x: year, y: prevRate });
    meta.draggableByDataIndex.set(data.length - 1, false);

    // Level (draggable)
    data.push({ x: year, y: rate });
    meta.draggableByDataIndex.set(data.length - 1, true);
    meta.breakpointByDataIndex.set(data.length - 1, i);
  }

  // Extend to chart end with a virtual point (non-draggable)
  const last = sorted[sorted.length - 1];
  if (last && last.year < durationYears) {
    data.push({ x: durationYears, y: last.monthlyRate });
    meta.draggableByDataIndex.set(data.length - 1, false);
  }

  return { data, meta, normalizedBreakpoints: sorted };
};

const buildScheduleChart = () => {
  const ctx = document.getElementById("schedule-chart").getContext("2d");
  if (!ChartJS) {
    throw new Error("Chart.js not loaded. Check CDN script tag.");
  }

  const initial = buildScheduleRenderData(breakpoints, defaultParams.durationYears);
  scheduleRenderMeta = initial.meta;

  scheduleChart = new ChartJS(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Monthly Savings",
          data: initial.data,
          borderColor: "#2ef2a6",
          backgroundColor: "#2ef2a6",
          pointRadius: (context) => (scheduleRenderMeta.draggableByDataIndex.get(context.dataIndex) ? 5 : 0),
          pointHoverRadius: (context) => (scheduleRenderMeta.draggableByDataIndex.get(context.dataIndex) ? 7 : 0),
          stepped: "after",
          dragData: true,
          dragX: false,
          dragDataRound: Y_STEP,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        dragData: {
          round: Y_STEP,
          showTooltip: true,
          onDragStart: (_event, _datasetIndex, index) => {
            return scheduleRenderMeta.draggableByDataIndex.get(index) === true;
          },
          onDragEnd: (_event, _datasetIndex, index, value) => {
            const bpIndex = scheduleRenderMeta.breakpointByDataIndex.get(index);
            if (bpIndex === undefined) {
              renderScheduleChart();
              return;
            }

            const snapped = Math.max(0, roundToStep(value.y, Y_STEP));
            breakpoints[bpIndex].monthlyRate = snapped;
            elements.startSavings.value = breakpoints[0]?.monthlyRate ?? 0;
            renderScheduleChart();
            schedulePreviewRender();
          },
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.parsed.x}y: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: defaultParams.durationYears,
          ticks: { stepSize: 1, color: "#e9f7ff" },
          grid: { color: "rgba(46, 242, 166, 0.2)" },
          title: { display: true, text: "YEARS", color: "#2ef2a6" },
        },
        y: {
          min: 0,
          ticks: { color: "#e9f7ff" },
          grid: { color: "rgba(46, 242, 166, 0.15)" },
          title: { display: true, text: "€/MONTH", color: "#2ef2a6" },
        },
      },
    },
  });

  const canvas = scheduleChart.canvas;
  canvas.addEventListener("click", (event) => {
    const chartArea = scheduleChart.chartArea;
    if (
      event.offsetX < chartArea.left ||
      event.offsetX > chartArea.right ||
      event.offsetY < chartArea.top ||
      event.offsetY > chartArea.bottom
    ) {
      return;
    }

    const rawYear = scheduleChart.scales.x.getValueForPixel(event.offsetX);
    const year = clamp(Math.round(rawYear), 0, buildParamsFromInputs().durationYears);

    if (breakpoints.some((point) => point.year === year)) {
      return;
    }

    const monthlyRate = monthlyRateAtYear(breakpoints, year);
    breakpoints = normalizeBreakpoints(
      [...breakpoints, { year, monthlyRate }],
      buildParamsFromInputs().durationYears
    );
    renderScheduleChart();
    schedulePreviewRender();
  });

  canvas.addEventListener("dblclick", (event) => {
    const points = scheduleChart.getElementsAtEventForMode(
      event,
      "nearest",
      { intersect: true },
      true
    );
    if (!points.length) {
      return;
    }
    const index = points[0].index;
    const bpIndex = scheduleRenderMeta.breakpointByDataIndex.get(index);
    if (bpIndex === undefined) {
      return;
    }
    if (breakpoints[bpIndex].year === 0) {
      return;
    }
    breakpoints.splice(bpIndex, 1);
    renderScheduleChart();
    schedulePreviewRender();
  });
};

const renderScheduleChart = () => {
  const durationYears = buildParamsFromInputs().durationYears;
  breakpoints = normalizeBreakpoints(breakpoints, durationYears);

  const maxBpRate = breakpoints.reduce(
    (maxValue, point) => Math.max(maxValue, point.monthlyRate),
    0
  );
  const baseRate = breakpoints[0]?.monthlyRate ?? 0;
  const targetMax = Math.max(maxBpRate, baseRate) * 1.5;
  const yMax = Math.max(Y_STEP * 4, roundToStep(targetMax, Y_STEP));
  scheduleChart.options.scales.y.max = yMax;

  scheduleChart.options.scales.x.max = durationYears;

  const render = buildScheduleRenderData(breakpoints, durationYears);
  // Keep canonical breakpoints normalized, but render uses expanded staircase points.
  breakpoints = render.normalizedBreakpoints;
  scheduleRenderMeta = render.meta;
  scheduleChart.data.datasets[0].data = render.data;
  scheduleChart.update();
};

const buildScenarioChart = () => {
  const ctx = document.getElementById("scenario-chart").getContext("2d");
  if (!ChartJS) {
    throw new Error("Chart.js not loaded. Check CDN script tag.");
  }

  scenarioChart = new ChartJS(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Total Capital (Nominal)",
          data: [],
          borderColor: "#2ef2a6",
          borderDash: [],
          pointRadius: 0,
        },
        {
          label: "Total Capital (Real)",
          data: [],
          borderColor: "#ffd166",
          borderDash: [6, 4],
          pointRadius: 0,
        },
        {
          label: "Total Pay-ins (Nominal)",
          data: [],
          borderColor: "#6ecbff",
          borderDash: [2, 4],
          pointRadius: 0,
        },
        {
          label: "Total Pay-ins (Real)",
          data: [],
          borderColor: "#ff6b6b",
          borderDash: [10, 4],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#e9f7ff",
            usePointStyle: true,
            pointStyle: "line",
            boxWidth: 34,
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => `Year ${items[0].label}`,
            label: (context) =>
              `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#e9f7ff" },
          grid: { color: "rgba(46, 242, 166, 0.2)" },
          title: { display: true, text: "YEARS", color: "#2ef2a6" },
        },
        y: {
          ticks: { color: "#e9f7ff" },
          grid: { color: "rgba(46, 242, 166, 0.15)" },
          title: { display: true, text: "CURRENCY", color: "#2ef2a6" },
        },
      },
    },
  });
};

const renderTabs = () => {
  elements.tabs.innerHTML = "";
  scenarios.forEach((scenario) => {
    const wrap = document.createElement("div");
    wrap.className = "tab-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.textContent = scenario.name;
    if (scenario.id === activeScenarioId) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      setActiveScenario(scenario.id);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tab-delete";
    del.textContent = "DEL";
    del.setAttribute("aria-label", `Delete ${scenario.name}`);
    del.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteScenario(scenario.id);
    });

    wrap.appendChild(button);
    wrap.appendChild(del);
    elements.tabs.appendChild(wrap);
  });
};

const renderSummaryTable = () => {
  elements.summaryBody.innerHTML = "";
  const tooltip = getOrCreateScenarioTooltip();

  const showTooltip = (scenario, event) => {
    tooltip.innerHTML = buildScenarioTooltipHtml(scenario);
    tooltip.style.display = "block";
    moveTooltip(event);
  };

  const hideTooltip = () => {
    tooltip.style.display = "none";
  };

  const moveTooltip = (event) => {
    if (tooltip.style.display !== "block") {
      return;
    }
    const pad = 12;
    const maxX = window.innerWidth - tooltip.offsetWidth - pad;
    const maxY = window.innerHeight - tooltip.offsetHeight - pad;
    const x = Math.min(event.clientX + pad, maxX);
    const y = Math.min(event.clientY + pad, maxY);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  scenarios.forEach((scenario) => {
    const row = document.createElement("tr");
    const { summary } = scenario.results;
    row.innerHTML = `
      <td>${scenario.name}</td>
      <td>${formatCurrency(summary.endCapitalNominal)}</td>
      <td>${formatCurrency(summary.endCapitalReal)}</td>
      <td>${formatCurrency(summary.payoutMonthlyNominalAtRetirementStart)}</td>
      <td>${formatCurrency(summary.payoutMonthlyRealToday)}</td>
    `;

    row.addEventListener("mouseenter", (event) => showTooltip(scenario, event));
    row.addEventListener("mousemove", moveTooltip);
    row.addEventListener("mouseleave", hideTooltip);

    elements.summaryBody.appendChild(row);
  });
};

const setWarnings = (warnings) => {
  elements.warnings.textContent = warnings.join(" ");
};

const setActiveScenario = (scenarioId) => {
  activeScenarioId = scenarioId;
  const scenario = scenarios.find((item) => item.id === scenarioId);
  if (scenario) {
    populateInputs(scenario.params);
    renderScheduleChart();
  }
  schedulePreviewRender();
  renderTabs();
  persistScenarios();
};

const persistScenarios = () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ scenarios, activeScenarioId })
  );
};

const deleteScenario = (scenarioId) => {
  const index = scenarios.findIndex((s) => s.id === scenarioId);
  if (index === -1) {
    return;
  }

  scenarios.splice(index, 1);

  if (activeScenarioId === scenarioId) {
    activeScenarioId = scenarios[index]?.id || scenarios[index - 1]?.id || null;
  }

  renderTabs();
  renderSummaryTable();
  persistScenarios();

  if (activeScenarioId) {
    setActiveScenario(activeScenarioId);
  } else {
    // No scenarios left: keep live preview from current inputs.
    schedulePreviewRender();
  }
};

const loadScenarios = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return;
  }
  try {
    const parsed = JSON.parse(stored);
    scenarios = parsed.scenarios || [];
    activeScenarioId = parsed.activeScenarioId || scenarios[0]?.id || null;
  } catch (error) {
    scenarios = [];
    activeScenarioId = null;
  }
};

const saveScenario = () => {
  const params = buildParamsFromInputs();
  const { results, warnings } = computeResults(params);
  setWarnings(warnings);

  const scenario = {
    id: crypto.randomUUID(),
    name: getScenarioName(scenarios.length),
    params,
    results,
  };
  scenarios.push(scenario);
  setActiveScenario(scenario.id);
  renderSummaryTable();
};

const handleInputChange = () => {
  buildParamsFromInputs();
  elements.startSavings.value = breakpoints[0]?.monthlyRate ?? 0;
  renderScheduleChart();
  togglePayoutYears();
  schedulePreviewRender();
};

const updateStartSavings = () => {
  const value = Math.max(0, toNumber(elements.startSavings.value));
  breakpoints[0].monthlyRate = value;
  renderScheduleChart();
  schedulePreviewRender();
};

const initialize = () => {
  populateInputs(defaultParams);
  buildScheduleChart();
  buildScenarioChart();
  renderScheduleChart();

  // Live preview for current working inputs (even before saving scenarios).
  schedulePreviewRender();

  loadScenarios();
  renderTabs();
  renderSummaryTable();
  if (activeScenarioId) {
    setActiveScenario(activeScenarioId);
  }

  elements.payoutMode.addEventListener("change", handleInputChange);
  elements.startCapital.addEventListener("input", handleInputChange);
  elements.returnSavings.addEventListener("input", handleInputChange);
  elements.returnWithdrawal.addEventListener("input", handleInputChange);
  elements.inflation.addEventListener("input", handleInputChange);
  elements.duration.addEventListener("input", handleInputChange);
  elements.payoutYears.addEventListener("input", handleInputChange);
  elements.startSavings.addEventListener("input", updateStartSavings);
  elements.saveScenario.addEventListener("click", saveScenario);
};

initialize();
