const STORAGE_KEY = "arcade_pension_scenarios_v1";
const Y_STEP = 50;

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
  startCapital: 50000,
  durationYears: 20,
  annualReturnSavings: 0.06,
  annualReturnWithdrawal: 0.03,
  annualInflation: 0.02,
  payoutMode: "perpetual",
  payoutYears: 25,
  breakpoints: [{ year: 0, monthlyRate: 1200 }],
};

let breakpoints = [...defaultParams.breakpoints];
let scenarios = [];
let activeScenarioId = null;

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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

const buildScheduleChart = () => {
  const ctx = document.getElementById("schedule-chart").getContext("2d");
  scheduleChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Monthly Savings",
          data: breakpoints.map((point) => ({ x: point.year, y: point.monthlyRate })),
          borderColor: "#2ef2a6",
          backgroundColor: "#2ef2a6",
          pointRadius: 5,
          pointHoverRadius: 7,
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
          onDragEnd: (_event, _datasetIndex, index, value) => {
            breakpoints[index].monthlyRate = Math.max(0, value.y);
            elements.startSavings.value = breakpoints[0].monthlyRate;
            renderScheduleChart();
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
          ticks: { color: "#e9f7ff" },
          grid: { color: "rgba(46, 242, 166, 0.15)" },
          title: { display: true, text: "$/MONTH", color: "#2ef2a6" },
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
    if (breakpoints[index].year === 0) {
      return;
    }
    breakpoints.splice(index, 1);
    renderScheduleChart();
  });
};

const renderScheduleChart = () => {
  const durationYears = buildParamsFromInputs().durationYears;
  breakpoints = normalizeBreakpoints(breakpoints, durationYears);
  scheduleChart.options.scales.x.max = durationYears;
  scheduleChart.data.datasets[0].data = breakpoints.map((point) => ({
    x: point.year,
    y: point.monthlyRate,
  }));
  scheduleChart.update();
};

const buildScenarioChart = () => {
  const ctx = document.getElementById("scenario-chart").getContext("2d");
  scenarioChart = new Chart(ctx, {
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
          labels: { color: "#e9f7ff" },
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

const updateScenarioChart = (scenario) => {
  if (!scenario) {
    scenarioChart.data.labels = [];
    scenarioChart.data.datasets.forEach((dataset) => {
      dataset.data = [];
    });
    scenarioChart.update();
    return;
  }

  const { series } = scenario.results;
  scenarioChart.data.labels = series.years.map((year) => year.toFixed(1));
  scenarioChart.data.datasets[0].data = series.capitalNominal;
  scenarioChart.data.datasets[1].data = series.capitalReal;
  scenarioChart.data.datasets[2].data = series.payinsNominal;
  scenarioChart.data.datasets[3].data = series.payinsReal;
  scenarioChart.update();
};

const updateKpis = (scenario) => {
  if (!scenario) {
    elements.kpiEndNominal.textContent = "—";
    elements.kpiEndReal.textContent = "—";
    elements.kpiPayoutNominal.textContent = "—";
    elements.kpiPayoutReal.textContent = "—";
    return;
  }
  const { summary } = scenario.results;
  elements.kpiEndNominal.textContent = formatCurrency(summary.endCapitalNominal);
  elements.kpiEndReal.textContent = formatCurrency(summary.endCapitalReal);
  elements.kpiPayoutNominal.textContent =
    formatCurrency(summary.payoutMonthlyNominalAtRetirementStart);
  elements.kpiPayoutReal.textContent = formatCurrency(summary.payoutMonthlyRealToday);
};

const renderTabs = () => {
  elements.tabs.innerHTML = "";
  scenarios.forEach((scenario) => {
    const button = document.createElement("button");
    button.className = "tab";
    button.textContent = scenario.name;
    if (scenario.id === activeScenarioId) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      setActiveScenario(scenario.id);
    });
    elements.tabs.appendChild(button);
  });
};

const renderSummaryTable = () => {
  elements.summaryBody.innerHTML = "";
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
  updateScenarioChart(scenario);
  updateKpis(scenario);
  renderTabs();
  persistScenarios();
};

const persistScenarios = () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ scenarios, activeScenarioId })
  );
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
  setWarnings([]);
  togglePayoutYears();
};

const updateStartSavings = () => {
  const value = Math.max(0, toNumber(elements.startSavings.value));
  breakpoints[0].monthlyRate = value;
  renderScheduleChart();
};

const initialize = () => {
  populateInputs(defaultParams);
  buildScheduleChart();
  buildScenarioChart();
  renderScheduleChart();

  loadScenarios();
  renderTabs();
  renderSummaryTable();
  if (activeScenarioId) {
    setActiveScenario(activeScenarioId);
  }

  elements.payoutMode.addEventListener("change", handleInputChange);
  elements.startCapital.addEventListener("change", handleInputChange);
  elements.returnSavings.addEventListener("change", handleInputChange);
  elements.returnWithdrawal.addEventListener("change", handleInputChange);
  elements.inflation.addEventListener("change", handleInputChange);
  elements.duration.addEventListener("change", handleInputChange);
  elements.payoutYears.addEventListener("change", handleInputChange);
  elements.startSavings.addEventListener("change", updateStartSavings);
  elements.saveScenario.addEventListener("click", saveScenario);
};

initialize();
