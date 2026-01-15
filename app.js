const STORAGE_KEY = "arcade_pension_scenarios_v2";
const Y_STEP = 25;
const DEFAULT_SEGMENT_MODE = "step";

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
  taxEnabled: document.getElementById("tax-enabled"),
  taxApplyAllowance: document.getElementById("tax-apply-allowance"),
  taxIncludeSoli: document.getElementById("tax-include-soli"),
  taxIncludeChurch: document.getElementById("tax-include-church"),
  taxKestRate: document.getElementById("tax-kest-rate"),
  taxSoliRate: document.getElementById("tax-soli-rate"),
  taxChurchRate: document.getElementById("tax-church-rate"),
  taxAllowanceAnnual: document.getElementById("tax-allowance-annual"),
  taxEffectiveRate: document.getElementById("tax-effective-rate"),
  saveScenario: document.getElementById("save-scenario"),
  warnings: document.getElementById("warnings"),
  tabs: document.getElementById("scenario-tabs"),
  summaryBody: document.getElementById("summary-body"),
  kpiEndNominal: document.getElementById("kpi-end-nominal"),
  kpiEndReal: document.getElementById("kpi-end-real"),
  kpiGainsNominal: document.getElementById("kpi-gains-nominal"),
  kpiGainsReal: document.getElementById("kpi-gains-real"),
  kpiPayoutNominal: document.getElementById("kpi-payout-nominal"),
  kpiPayoutReal: document.getElementById("kpi-payout-real"),
  kpiGrossNominal: document.getElementById("kpi-gross-nominal"),
  kpiTaxNominal: document.getElementById("kpi-tax-nominal"),
};

const defaultParams = {
  startCapital: 100000,
  durationYears: 30,
  annualReturnSavings: 0.07,
  annualReturnWithdrawal: 0.05,
  annualInflation: 0.02,
  payoutMode: "perpetual",
  payoutYears: 25,
  tax: {
    taxEnabled: true,
    applyAllowance: true,
    includeSolidaritySurcharge: true,
    includeChurchTax: false,
    kapitalertragsteuerRate: 0.25,
    solidarityRate: 0.055,
    churchTaxRate: 0.0,
    allowanceAnnual: 1000,
  },
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

const computeEffectiveTaxRate = (tax) => {
  const base = Math.max(0, toNumber(tax?.kapitalertragsteuerRate, 0));
  const soli = tax?.includeSolidaritySurcharge
    ? Math.max(0, toNumber(tax?.solidarityRate, 0))
    : 0;
  const church = tax?.includeChurchTax
    ? Math.max(0, toNumber(tax?.churchTaxRate, 0))
    : 0;
  return base * (1 + soli + church);
};

const updateTaxDerivedDisplay = (tax) => {
  if (!elements.taxEffectiveRate) {
    return;
  }
  const eff = computeEffectiveTaxRate(tax);
  elements.taxEffectiveRate.textContent = Number.isFinite(eff)
    ? `${(eff * 100).toFixed(3)}%`
    : "—";
};

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
        monthlyRate: Math.max(0, toNumber(point.monthlyRate, 0)),
        modeAfter: point?.modeAfter === "linear" ? "linear" : DEFAULT_SEGMENT_MODE,
      });
    }
  });
  if (!deduped.has(0)) {
    deduped.set(0, {
      year: 0,
      monthlyRate: defaultParams.breakpoints[0].monthlyRate,
      modeAfter: DEFAULT_SEGMENT_MODE,
    });
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
  if (!sorted.length) {
    return 0;
  }

  let index = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].year <= year) {
      index = i;
    }
  }

  const current = sorted[index];
  const next = sorted[index + 1];
  const modeAfter = current?.modeAfter === "linear" ? "linear" : DEFAULT_SEGMENT_MODE;

  if (modeAfter !== "linear" || !next) {
    return current?.monthlyRate ?? 0;
  }

  const span = next.year - current.year;
  if (!Number.isFinite(span) || span <= 0) {
    return current?.monthlyRate ?? 0;
  }

  // Interpolate only within the segment [current.year, next.year).
  // For year values >= next.year, the loop above will already have advanced index.
  const t = clamp((year - current.year) / span, 0, 1);
  const a = toNumber(current.monthlyRate, 0);
  const b = toNumber(next.monthlyRate, 0);
  return a + (b - a) * t;
};

const buildParamsFromInputs = () => {
  const startCapital = Math.max(0, toNumber(elements.startCapital.value));
  const durationYears = clamp(Math.round(toNumber(elements.duration.value, 1)), 1, 80);
  const payoutMode = elements.payoutMode.value;
  const payoutYears = Math.round(toNumber(elements.payoutYears.value, 1));

  const tax = {
    taxEnabled: Boolean(elements.taxEnabled?.checked),
    applyAllowance: Boolean(elements.taxApplyAllowance?.checked),
    includeSolidaritySurcharge: Boolean(elements.taxIncludeSoli?.checked),
    includeChurchTax: Boolean(elements.taxIncludeChurch?.checked),
    kapitalertragsteuerRate: Math.max(0, toNumber(elements.taxKestRate?.value)),
    solidarityRate: Math.max(0, toNumber(elements.taxSoliRate?.value)),
    churchTaxRate: Math.max(0, toNumber(elements.taxChurchRate?.value)),
    allowanceAnnual: Math.max(0, toNumber(elements.taxAllowanceAnnual?.value)),
  };

  const params = {
    startCapital,
    durationYears,
    annualReturnSavings: toNumber(elements.returnSavings.value) / 100,
    annualReturnWithdrawal: toNumber(elements.returnWithdrawal.value) / 100,
    annualInflation: toNumber(elements.inflation.value) / 100,
    payoutMode,
    payoutYears: payoutMode === "fixed" ? Math.max(1, payoutYears) : null,
    tax,
    breakpoints: normalizeBreakpoints(breakpoints, durationYears),
  };

  breakpoints = params.breakpoints;
  updateTaxDerivedDisplay(params.tax);
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

  const tax = {
    ...defaultParams.tax,
    ...(params.tax || {}),
  };

  if (elements.taxEnabled) {
    elements.taxEnabled.checked = Boolean(tax.taxEnabled);
  }
  if (elements.taxApplyAllowance) {
    elements.taxApplyAllowance.checked = Boolean(tax.applyAllowance);
  }
  if (elements.taxIncludeSoli) {
    elements.taxIncludeSoli.checked = Boolean(tax.includeSolidaritySurcharge);
  }
  if (elements.taxIncludeChurch) {
    elements.taxIncludeChurch.checked = Boolean(tax.includeChurchTax);
  }
  if (elements.taxKestRate) {
    elements.taxKestRate.value = String(tax.kapitalertragsteuerRate);
  }
  if (elements.taxSoliRate) {
    elements.taxSoliRate.value = String(tax.solidarityRate);
  }
  if (elements.taxChurchRate) {
    elements.taxChurchRate.value = String(tax.churchTaxRate);
  }
  if (elements.taxAllowanceAnnual) {
    elements.taxAllowanceAnnual.value = String(tax.allowanceAnnual);
  }

  updateTaxDerivedDisplay(tax);

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
    elements.kpiGainsNominal.textContent = "—";
    elements.kpiGainsReal.textContent = "—";
    elements.kpiPayoutNominal.textContent = "—";
    elements.kpiPayoutReal.textContent = "—";
    elements.kpiGrossNominal.textContent = "—";
    elements.kpiTaxNominal.textContent = "—";
    return;
  }
  const { summary } = results;
  elements.kpiEndNominal.textContent = formatCurrency(summary.endCapitalNominal);
  elements.kpiEndReal.textContent = formatCurrency(summary.endCapitalReal);
  elements.kpiGainsNominal.textContent = formatCurrency(summary.capitalGainsNominal);
  elements.kpiGainsReal.textContent = formatCurrency(summary.capitalGainsReal);
  elements.kpiPayoutNominal.textContent =
    formatCurrency(summary.payoutMonthlyNominalAtRetirementStart);
  elements.kpiPayoutReal.textContent = formatCurrency(summary.payoutMonthlyRealToday);
  elements.kpiGrossNominal.textContent = formatCurrency(
    summary.grossWithdrawalNominalAvgYear1 ?? summary.grossWithdrawalNominalMonth1 ?? 0
  );
  elements.kpiTaxNominal.textContent = formatCurrency(
    summary.taxPaidNominalAvgYear1 ?? summary.taxPaidNominalPerMonth ?? 0
  );
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

const computeGainsRatio = (portfolioValue, costBasis) => {
  if (portfolioValue <= 0 || !Number.isFinite(portfolioValue)) {
    return 0;
  }
  return clamp((portfolioValue - costBasis) / portfolioValue, 0, 1);
};

const computeGrossForTargetNet = ({
  portfolioValue,
  costBasis,
  allowanceRemaining,
  allowanceEnabled,
  effectiveTaxRate,
  taxEnabled,
  targetNetNominal,
}) => {
  const pv = portfolioValue;
  if (pv <= 0 || !Number.isFinite(pv)) {
    return { ok: false, reason: "empty-portfolio" };
  }

  const netNom = Math.max(0, targetNetNominal);
  const g = computeGainsRatio(pv, costBasis);

  // Even if tax is disabled, we still track the principal vs gains split for cost-basis accounting.
  const realizedGainForGross = (gross) => gross * g;

  if (!taxEnabled || effectiveTaxRate <= 0 || g <= 0) {
    const gross = netNom;
    const realizedGain = realizedGainForGross(gross);
    return {
      ok: true,
      gross,
      tax: 0,
      realizedGain,
      gainCoveredByAllowance: 0,
      principalPart: Math.max(0, gross - realizedGain),
    };
  }

  const e = effectiveTaxRate;
  const allowRem = Math.max(0, allowanceRemaining);
  const denom = 1 - e * g;
  if (denom <= 0 || !Number.isFinite(denom)) {
    return { ok: false, reason: "tax-denominator" };
  }

  let gross = 0;

  if (allowanceEnabled) {
    if (netNom * g <= allowRem) {
      gross = netNom;
    } else {
      gross = (netNom - allowRem * e) / denom;
    }
  } else {
    gross = netNom / denom;
  }

  if (!Number.isFinite(gross) || gross < 0) {
    return { ok: false, reason: "tax-gross-invalid" };
  }

  if (gross > pv + 1e-9) {
    return { ok: false, reason: "insufficient-funds" };
  }

  const realizedGain = realizedGainForGross(gross);
  const gainCoveredByAllowance = allowanceEnabled ? Math.min(realizedGain, allowRem) : 0;
  const taxableGain = Math.max(0, realizedGain - gainCoveredByAllowance);
  const tax = taxableGain * e;
  const principalPart = Math.max(0, gross - realizedGain);

  return {
    ok: true,
    gross,
    tax,
    realizedGain,
    gainCoveredByAllowance,
    principalPart,
  };
};

const simulateRetirement = ({
  targetNetRealAtRetirementStart,
  months,
  portfolioValue0,
  costBasis0,
  monthlyReturnNominal,
  monthlyInflation,
  tax,
}) => {
  let pv = Math.max(0, portfolioValue0);
  let basis = Math.max(0, costBasis0);

  const taxEnabled = Boolean(tax?.taxEnabled);
  const allowanceEnabled = Boolean(tax?.applyAllowance);
  const allowanceAnnual = Math.max(0, toNumber(tax?.allowanceAnnual, 0));
  const effectiveTaxRate = computeEffectiveTaxRate(tax);

  let allowRem = allowanceEnabled ? allowanceAnnual : 0;
  let cpi = 1;

  for (let m = 0; m < months; m += 1) {
    if (!Number.isFinite(pv) || pv <= 0) {
      return { ok: false, reason: "depleted", pvEndNominal: 0, cpiEnd: cpi };
    }

    if (allowanceEnabled && (m % 12 === 0)) {
      allowRem = allowanceAnnual;
    }

    pv *= 1 + monthlyReturnNominal;

    const targetNetNominal = targetNetRealAtRetirementStart * cpi;
    const grossResult = computeGrossForTargetNet({
      portfolioValue: pv,
      costBasis: basis,
      allowanceRemaining: allowRem,
      allowanceEnabled,
      effectiveTaxRate,
      taxEnabled,
      targetNetNominal,
    });

    if (!grossResult.ok) {
      return { ok: false, reason: grossResult.reason, pvEndNominal: pv, cpiEnd: cpi };
    }

    pv -= grossResult.gross;
    basis = Math.max(0, basis - grossResult.principalPart);
    allowRem = Math.max(0, allowRem - grossResult.gainCoveredByAllowance);

    cpi *= 1 + monthlyInflation;
    if (!Number.isFinite(cpi) || cpi <= 0) {
      return { ok: false, reason: "inflation-overflow", pvEndNominal: pv, cpiEnd: cpi };
    }
  }

  return {
    ok: true,
    pvEndNominal: pv,
    cpiEnd: cpi,
  };
};

const solveNetPayoutFixed = ({
  months,
  portfolioValue0,
  costBasis0,
  monthlyReturnNominal,
  monthlyInflation,
  tax,
}) => {
  const objective = (netReal) => {
    const sim = simulateRetirement({
      targetNetRealAtRetirementStart: netReal,
      months,
      portfolioValue0,
      costBasis0,
      monthlyReturnNominal,
      monthlyInflation,
      tax,
    });
    if (!sim.ok) {
      return { ok: false, pvEndReal: -1 };
    }
    const pvEndReal = sim.pvEndNominal / sim.cpiEnd;
    return { ok: true, pvEndReal };
  };

  const pv0Real = portfolioValue0;

  let low = 0;
  let high = Math.max(1, pv0Real / Math.max(1, months));

  for (let i = 0; i < 50; i += 1) {
    const res = objective(high);
    if (!res.ok || res.pvEndReal <= 0) {
      break;
    }
    high *= 1.6;
    if (high > pv0Real * 10) {
      break;
    }
  }

  let best = 0;
  for (let iter = 0; iter < 60; iter += 1) {
    const mid = (low + high) / 2;
    const res = objective(mid);
    if (res.ok && res.pvEndReal > 0) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
};

const solveNetPayoutPerpetual = ({
  months,
  portfolioValue0,
  costBasis0,
  monthlyReturnNominal,
  monthlyInflation,
  tax,
  eps,
}) => {
  const pv0Real = portfolioValue0;
  const minEndReal = pv0Real * (1 - eps);

  const isSustainable = (netReal) => {
    const sim = simulateRetirement({
      targetNetRealAtRetirementStart: netReal,
      months,
      portfolioValue0,
      costBasis0,
      monthlyReturnNominal,
      monthlyInflation,
      tax,
    });
    if (!sim.ok) {
      return false;
    }
    const pvEndReal = sim.pvEndNominal / sim.cpiEnd;
    return pvEndReal >= minEndReal;
  };

  let low = 0;
  let high = Math.max(1, pv0Real * 0.01);
  if (isSustainable(high)) {
    for (let i = 0; i < 50; i += 1) {
      high *= 1.6;
      if (!isSustainable(high)) {
        break;
      }
      if (high > pv0Real * 2) {
        break;
      }
    }
  }

  let best = 0;
  for (let iter = 0; iter < 60; iter += 1) {
    const mid = (low + high) / 2;
    if (isSustainable(mid)) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
};

const computeYearOneAverages = ({
  netRealAtRetirementStart,
  portfolioValue0,
  costBasis0,
  monthlyReturnNominal,
  monthlyInflation,
  tax,
}) => {
  const months = 12;
  let pv = Math.max(0, portfolioValue0);
  let basis = Math.max(0, costBasis0);

  const taxEnabled = Boolean(tax?.taxEnabled);
  const allowanceEnabled = Boolean(tax?.applyAllowance);
  const allowanceAnnual = Math.max(0, toNumber(tax?.allowanceAnnual, 0));
  const effectiveTaxRate = computeEffectiveTaxRate(tax);

  let allowRem = allowanceEnabled ? allowanceAnnual : 0;
  let cpi = 1;

  let grossSum = 0;
  let taxSum = 0;
  let counted = 0;

  for (let m = 0; m < months; m += 1) {
    if (!Number.isFinite(pv) || pv <= 0) {
      break;
    }

    // Simplest year boundary: reset at the start of each simulation year.
    if (allowanceEnabled && (m % 12 === 0)) {
      allowRem = allowanceAnnual;
    }

    pv *= 1 + monthlyReturnNominal;

    const targetNetNominal = netRealAtRetirementStart * cpi;
    const grossResult = computeGrossForTargetNet({
      portfolioValue: pv,
      costBasis: basis,
      allowanceRemaining: allowRem,
      allowanceEnabled,
      effectiveTaxRate,
      taxEnabled,
      targetNetNominal,
    });

    if (!grossResult.ok) {
      break;
    }

    grossSum += grossResult.gross;
    taxSum += grossResult.tax;
    counted += 1;

    pv -= grossResult.gross;
    basis = Math.max(0, basis - grossResult.principalPart);
    allowRem = Math.max(0, allowRem - grossResult.gainCoveredByAllowance);

    cpi *= 1 + monthlyInflation;
    if (!Number.isFinite(cpi) || cpi <= 0) {
      break;
    }
  }

  if (counted === 0) {
    return { avgGrossNominal: 0, avgTaxNominal: 0, monthsCounted: 0 };
  }

  return {
    avgGrossNominal: grossSum / counted,
    avgTaxNominal: taxSum / counted,
    monthsCounted: counted,
  };
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

  const monthsSimulated = years.length;
  const inflationFactorEnd = Math.pow(1 + iMonthly, monthsSimulated);
  const endCapitalNominal = balance;
  const endCapitalReal = balance / inflationFactorEnd;

  // Retirement payout is NET after tax, constant in REAL terms (inflation-adjusted).
  // We interpret "real" here as purchasing power at retirement start; we convert to today's money via inflationFactorEnd.
  const basisAtRetirementStart = Math.max(0, params.startCapital + payNom);
  const basisRealToday = basisAtRetirementStart / inflationFactorEnd;
  const capitalGainsNominal = endCapitalNominal - basisAtRetirementStart;
  const capitalGainsReal = endCapitalReal - basisRealToday;

  const retirementMonths = params.payoutMode === "fixed" ? (params.payoutYears ?? 1) * 12 : 200 * 12;
  const rReal = (1 + rWithdrawal) / (1 + iMonthly) - 1;
  let payoutNetRealAtRetirementStart = 0;

  if (params.payoutMode === "perpetual" && rReal <= 0) {
    payoutNetRealAtRetirementStart = 0;
    warnings.push("Perpetual net payout is zero because real return is non-positive.");
  } else {
    if (params.payoutMode === "fixed") {
      payoutNetRealAtRetirementStart = solveNetPayoutFixed({
        months: retirementMonths,
        portfolioValue0: endCapitalNominal,
        costBasis0: basisAtRetirementStart,
        monthlyReturnNominal: rWithdrawal,
        monthlyInflation: iMonthly,
        tax: params.tax,
      });
    } else {
      payoutNetRealAtRetirementStart = solveNetPayoutPerpetual({
        months: retirementMonths,
        portfolioValue0: endCapitalNominal,
        costBasis0: basisAtRetirementStart,
        monthlyReturnNominal: rWithdrawal,
        monthlyInflation: iMonthly,
        tax: params.tax,
        eps: 0.005,
      });
    }
  }

  const payoutNominalNetAtRetirementStart = payoutNetRealAtRetirementStart;
  const payoutRealNetToday = payoutNetRealAtRetirementStart / inflationFactorEnd;

  const yearOne = computeYearOneAverages({
    netRealAtRetirementStart: payoutNetRealAtRetirementStart,
    portfolioValue0: endCapitalNominal,
    costBasis0: basisAtRetirementStart,
    monthlyReturnNominal: rWithdrawal,
    monthlyInflation: iMonthly,
    tax: params.tax,
  });

  const grossWithdrawalNominalAvgYear1 = yearOne.avgGrossNominal;
  const taxPaidNominalAvgYear1 = yearOne.avgTaxNominal;

  if (yearOne.monthsCounted < 12 && payoutNetRealAtRetirementStart > 0) {
    warnings.push("Year-1 average KPI is partial because the simulation depleted early.");
  }

  if (!Number.isFinite(payoutNominalNetAtRetirementStart) || !Number.isFinite(payoutRealNetToday)) {
    payoutNetRealAtRetirementStart = 0;
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
        capitalGainsNominal,
        capitalGainsReal,
        payoutMonthlyNominalAtRetirementStart: payoutNominalNetAtRetirementStart,
        payoutMonthlyRealToday: payoutRealNetToday,
        grossWithdrawalNominalAvgYear1,
        taxPaidNominalAvgYear1,
      },
    },
    warnings,
  };
};

let scheduleChart = null;
let scenarioChart = null;

let scheduleUiState = {
  isMenuOpen: false,
  activeBreakpointIndex: null,
};

let scheduleRenderMeta = {
  draggableByDataIndex: new Map(),
  breakpointByDataIndex: new Map(),
};

const buildScheduleRenderData = (points, durationYears) => {
  // Render schedule as a polyline with mixed segment styles.
  // - STEP segments are encoded by inserting a non-draggable connector at (nextYear, prevRate)
  //   and then the draggable level point at (nextYear, nextRate) to create the vertical jump.
  // - LINEAR segments are encoded by directly connecting the level points.

  const meta = {
    draggableByDataIndex: new Map(),
    breakpointByDataIndex: new Map(),
  };

  const data = [];
  const sorted = normalizeBreakpoints(points, durationYears);
  if (!sorted.length) {
    sorted.push({ year: 0, monthlyRate: 0, modeAfter: DEFAULT_SEGMENT_MODE });
  }

  // Start point
  data.push({ x: 0, y: sorted[0].monthlyRate });
  meta.draggableByDataIndex.set(0, true);
  meta.breakpointByDataIndex.set(0, 0);

  for (let i = 1; i < sorted.length; i += 1) {
    const year = sorted[i].year;
    const prevRate = sorted[i - 1].monthlyRate;
    const rate = sorted[i].monthlyRate;
    const prevMode = sorted[i - 1]?.modeAfter === "linear" ? "linear" : DEFAULT_SEGMENT_MODE;

    if (prevMode !== "linear") {
      // Connector (non-draggable)
      data.push({ x: year, y: prevRate });
      meta.draggableByDataIndex.set(data.length - 1, false);
    }

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

const getOrCreateScheduleContextMenu = () => {
  let el = document.getElementById("schedule-context-menu");
  if (el) {
    return el;
  }
  el = document.createElement("div");
  el.id = "schedule-context-menu";
  el.className = "schedule-context";
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
};

const getOrCreateScheduleValueEditor = () => {
  let el = document.getElementById("schedule-value-editor");
  if (el) {
    return el;
  }
  el = document.createElement("div");
  el.id = "schedule-value-editor";
  el.className = "schedule-editor";
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
};

const clampToViewport = (x, y, el, pad = 10) => {
  const maxX = window.innerWidth - el.offsetWidth - pad;
  const maxY = window.innerHeight - el.offsetHeight - pad;
  return {
    x: clamp(x, pad, Math.max(pad, maxX)),
    y: clamp(y, pad, Math.max(pad, maxY)),
  };
};

const findScheduleDataIndexForBreakpoint = (bpIndex) => {
  for (const [dataIndex, mappedBpIndex] of scheduleRenderMeta.breakpointByDataIndex.entries()) {
    if (mappedBpIndex === bpIndex) {
      return dataIndex;
    }
  }
  return null;
};

const getSchedulePointPagePosition = (dataIndex) => {
  if (!scheduleChart) {
    return null;
  }
  const meta = scheduleChart.getDatasetMeta(0);
  const el = meta?.data?.[dataIndex];
  if (!el) {
    return null;
  }
  const rect = scheduleChart.canvas.getBoundingClientRect();
  return {
    x: rect.left + el.x,
    y: rect.top + el.y,
  };
};

const hideScheduleOverlays = () => {
  const menu = getOrCreateScheduleContextMenu();
  const editor = getOrCreateScheduleValueEditor();
  menu.style.display = "none";
  editor.style.display = "none";
  scheduleUiState.isMenuOpen = false;
  scheduleUiState.activeBreakpointIndex = null;
};

const openScheduleValueEditor = ({ bpIndex }) => {
  const editor = getOrCreateScheduleValueEditor();
  const dataIndex = findScheduleDataIndexForBreakpoint(bpIndex);
  if (dataIndex === null) {
    return;
  }

  const pos = getSchedulePointPagePosition(dataIndex);
  if (!pos) {
    return;
  }

  const current = breakpoints[bpIndex];
  const currentValue = toNumber(current?.monthlyRate, 0);

  editor.innerHTML = `
    <div class="schedule-editor__title">SET POINT TO</div>
    <div class="schedule-editor__row">
      <input id="schedule-editor-input" type="number" min="0" step="${Y_STEP}" value="${currentValue}" />
      <button type="button" id="schedule-editor-apply">OK</button>
      <button type="button" id="schedule-editor-cancel">X</button>
    </div>
  `.trim();

  editor.style.display = "block";
  // Position slightly to the right of the dot.
  const desired = clampToViewport(pos.x + 12, pos.y - 12, editor);
  editor.style.left = `${desired.x}px`;
  editor.style.top = `${desired.y}px`;

  const input = editor.querySelector("#schedule-editor-input");
  const applyBtn = editor.querySelector("#schedule-editor-apply");
  const cancelBtn = editor.querySelector("#schedule-editor-cancel");

  const apply = () => {
    const raw = toNumber(input?.value, currentValue);
    const snapped = Math.max(0, roundToStep(raw, Y_STEP));
    breakpoints[bpIndex].monthlyRate = snapped;
    if (bpIndex === 0) {
      elements.startSavings.value = snapped;
    }
    editor.style.display = "none";
    renderScheduleChart();
    schedulePreviewRender();
  };

  const cancel = () => {
    editor.style.display = "none";
  };

  applyBtn?.addEventListener("click", apply);
  cancelBtn?.addEventListener("click", cancel);
  input?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      apply();
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });

  // Focus/select for quick knob-like entry.
  if (input) {
    input.focus();
    input.select();
  }
};

const openScheduleContextMenu = ({ bpIndex }) => {
  const menu = getOrCreateScheduleContextMenu();
  const dataIndex = findScheduleDataIndexForBreakpoint(bpIndex);
  if (dataIndex === null) {
    return;
  }

  const pos = getSchedulePointPagePosition(dataIndex);
  if (!pos) {
    return;
  }

  const bp = breakpoints[bpIndex];
  const isFirst = bpIndex === 0;
  const isLast = bpIndex === breakpoints.length - 1;
  const canDelete = bp?.year !== 0;
  const canToggleBefore = !isFirst;
  const canToggleAfter = !isLast;

  const linearBefore = canToggleBefore
    ? (breakpoints[bpIndex - 1]?.modeAfter === "linear")
    : false;
  const linearAfter = canToggleAfter ? (bp?.modeAfter === "linear") : false;

  const beforeLabel = linearBefore ? "STEP PATH BEFORE" : "LINEAR PATH BEFORE";
  const afterLabel = linearAfter ? "STEP PATH AFTER" : "LINEAR PATH AFTER";

  menu.innerHTML = `
    <div class="schedule-context__title">POINT ${bp?.year ?? 0}Y</div>
    <button type="button" class="schedule-context__item" data-action="set">SET POINT TO…</button>
    <button type="button" class="schedule-context__item" data-action="before" ${
      canToggleBefore ? "" : "disabled"
    }>${beforeLabel}</button>
    <button type="button" class="schedule-context__item" data-action="after" ${
      canToggleAfter ? "" : "disabled"
    }>${afterLabel}</button>
    <div class="schedule-context__sep"></div>
    <button type="button" class="schedule-context__item schedule-context__item--danger" data-action="delete" ${
      canDelete ? "" : "disabled"
    }>DELETE POINT</button>
  `.trim();

  menu.style.display = "block";
  const desired = clampToViewport(pos.x + 12, pos.y + 12, menu);
  menu.style.left = `${desired.x}px`;
  menu.style.top = `${desired.y}px`;

  scheduleUiState.isMenuOpen = true;
  scheduleUiState.activeBreakpointIndex = bpIndex;

  const onClick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    if (!action || target.hasAttribute("disabled")) {
      return;
    }

    if (action === "set") {
      openScheduleValueEditor({ bpIndex });
      return;
    }

    if (action === "before" && bpIndex > 0) {
      const prev = breakpoints[bpIndex - 1];
      prev.modeAfter = prev.modeAfter === "linear" ? DEFAULT_SEGMENT_MODE : "linear";
      renderScheduleChart();
      schedulePreviewRender();
      openScheduleContextMenu({ bpIndex });
      return;
    }

    if (action === "after" && bpIndex < breakpoints.length - 1) {
      const cur = breakpoints[bpIndex];
      cur.modeAfter = cur.modeAfter === "linear" ? DEFAULT_SEGMENT_MODE : "linear";
      renderScheduleChart();
      schedulePreviewRender();
      openScheduleContextMenu({ bpIndex });
      return;
    }

    if (action === "delete") {
      if (breakpoints[bpIndex]?.year === 0) {
        return;
      }
      breakpoints.splice(bpIndex, 1);
      hideScheduleOverlays();
      renderScheduleChart();
      schedulePreviewRender();
    }
  };

  // Replace any previous click handler by cloning (simple + safe).
  const fresh = menu.cloneNode(true);
  menu.parentNode.replaceChild(fresh, menu);
  const newMenu = getOrCreateScheduleContextMenu();
  newMenu.addEventListener("click", onClick);
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
          stepped: false,
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
    if (scheduleUiState.isMenuOpen) {
      hideScheduleOverlays();
    }
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
      [...breakpoints, { year, monthlyRate, modeAfter: DEFAULT_SEGMENT_MODE }],
      buildParamsFromInputs().durationYears
    );
    renderScheduleChart();
    schedulePreviewRender();
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const points = scheduleChart.getElementsAtEventForMode(
      event,
      "nearest",
      { intersect: true },
      true
    );

    if (!points.length) {
      hideScheduleOverlays();
      return;
    }

    const index = points[0].index;
    if (scheduleRenderMeta.draggableByDataIndex.get(index) !== true) {
      hideScheduleOverlays();
      return;
    }

    const bpIndex = scheduleRenderMeta.breakpointByDataIndex.get(index);
    if (bpIndex === undefined) {
      hideScheduleOverlays();
      return;
    }

    openScheduleContextMenu({ bpIndex });
  });

  canvas.addEventListener("dblclick", (event) => {
    if (scheduleUiState.isMenuOpen) {
      hideScheduleOverlays();
    }
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

  // Keep any open menu/editor anchored to the same breakpoint.
  if (scheduleUiState.isMenuOpen && scheduleUiState.activeBreakpointIndex !== null) {
    const bpIndex = scheduleUiState.activeBreakpointIndex;
    if (bpIndex < 0 || bpIndex >= breakpoints.length) {
      hideScheduleOverlays();
    } else {
      openScheduleContextMenu({ bpIndex });
    }
  }
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

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const menu = document.getElementById("schedule-context-menu");
    const editor = document.getElementById("schedule-value-editor");
    const target = event.target;
    if (menu && menu.style.display === "block" && menu.contains(target)) {
      return;
    }
    if (editor && editor.style.display === "block" && editor.contains(target)) {
      return;
    }
    if ((menu && menu.style.display === "block") || (editor && editor.style.display === "block")) {
      hideScheduleOverlays();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const menu = document.getElementById("schedule-context-menu");
      const editor = document.getElementById("schedule-value-editor");
      if ((menu && menu.style.display === "block") || (editor && editor.style.display === "block")) {
        hideScheduleOverlays();
      }
    }
  });

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

  elements.taxEnabled?.addEventListener("change", handleInputChange);
  elements.taxApplyAllowance?.addEventListener("change", handleInputChange);
  elements.taxIncludeSoli?.addEventListener("change", handleInputChange);
  elements.taxIncludeChurch?.addEventListener("change", handleInputChange);
  elements.taxKestRate?.addEventListener("input", handleInputChange);
  elements.taxSoliRate?.addEventListener("input", handleInputChange);
  elements.taxChurchRate?.addEventListener("input", handleInputChange);
  elements.taxAllowanceAnnual?.addEventListener("input", handleInputChange);
};

initialize();
