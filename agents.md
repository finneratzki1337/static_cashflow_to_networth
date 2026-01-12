# agentS.md — Frontend-only “Arcade Retirement Tool” (Scenario Simulator)

## 0) Mission (what you are building)
Build a **static, frontend-only** web app (no backend) that helps a user model a savings plan with a **piecewise-constant monthly savings rate** and then calculates a **retirement monthly payout** (either **perpetual** or **depleting to zero after N years**).  
The app must look and feel like an **oldschool arcade / terminal UI** and be deployable on **GitHub Pages via GitHub Actions**.

Reference style: https://finneratzki1337.github.io/static_time_oclock/  
(Design cue: ultra-minimal “terminal scoreboard” vibe, uppercase labels, hard borders, sparse layout, “toggle-like” controls.)

A hand-drawn layout sketch is provided by the user. Follow it closely:
- **Left panel:** inputs + interactive savings-schedule chart + “Save scenario” button.
- **Right panel:** scenario tabs + scenario chart (4 lines) + summary table (all scenarios).

---

## 1) UX Layout Requirements (match the sketch)
Use a two-column layout:

### 1.1 Left panel (Inputs + editable schedule)
**A. Standard parameters (stacked inputs):**
- Start capital (currency)
- Start savings rate per month (currency) *(initial level for the schedule chart)*
- Interest rate during savings phase (annual %, nominal)
- Interest rate during withdrawal phase (annual %, nominal; typically lower risk)
- Inflation (annual %, used to compute “real” values)
- Duration (years) = savings horizon
- Payout mode dropdown:
  - **Perpetual** (“eternal pension”)
  - **Deplete after X years** (enables numeric input: “payout years”)

**B. Interactive schedule chart (editable line):**
- Line chart with **x = years (0..Duration)** and **y = savings rate per month**.
- Clicking on the horizontal/step line adds a **breakpoint** (change point).
- A breakpoint is draggable **up/down** (adjusts the savings rate from that year onward).
- Breakpoints represent a **piecewise-constant** schedule:
  - Example: 0–3y: 1000; at 3y: 1200; at 5y: 800; etc.

**C. “Save scenario” button**
- Saves *all inputs + the full schedule* as a scenario.
- Saved scenarios appear on the **right** as tabs and as a row in the summary table.

> Important: The schedule chart is *an input control*, not just a display.

### 1.2 Right panel (Scenario comparison)
**A. Scenario tabs**
- Each saved scenario becomes a tab: `Scenario I`, `Scenario II`, ...
- Clicking a tab:
  - loads that scenario’s parameters back into the **left panel**
  - renders that scenario in the **chart** on the right
  - below the charts shows prominently the key result kpis of the scenario

**B. Scenario chart (tabbed area)**
For the active scenario: show a **single line chart with 4 lines**:
1) Total capital (nominal)
2) Total capital (real)
3) Total pay-ins (nominal, cumulative)
4) Total pay-ins (real, cumulative)

x-axis = years (0..Duration)  
y-axis = currency

**C. Summary table (below chart, outside tab area)**
One row per saved scenario, columns:
- Scenario name
- End capital **nominal**
- End capital **real** (today’s money)
- Monthly payout **nominal at retirement start**
- Monthly payout **real** (today’s money)

---

## 2) Tech Stack (simple + static)
**Must remain 100% client-side.**

Recommended stack:
- `index.html`, `styles.css`, `app.js` (ES modules OK)
- Charting: **Chart.js (CDN)** for both charts
- Drag support for schedule chart:
  - Use `chartjs-plugin-dragdata` (CDN) **or** implement pointer events manually.
- Storage:
  - Keep scenarios in memory
  - Persist to `localStorage` (optional but recommended so scenarios survive refresh)

No bundler required. Avoid frameworks unless absolutely necessary.

---

## 3) Data Model (define these plainly)
Use these conceptual structures (JS objects):

### 3.1 Breakpoint
A breakpoint defines the savings rate starting at a given year.
```js
// year must be integer, 0 <= year <= durationYears
// monthlyRate is currency per month
{ year: 0, monthlyRate: 1000 }
```

Rules:
- Always include `year = 0`.
- Disallow duplicates years (except internal rendering tricks).
- Sort breakpoints ascending by year.

### 3.2 Parameters
```js
{
  startCapital: number,              // currency
  durationYears: number,             // integer or allow .5? (default integer)
  annualReturnSavings: number,       // e.g. 0.06 for 6%
  annualReturnWithdrawal: number,    // e.g. 0.03
  annualInflation: number,           // e.g. 0.02
  payoutMode: "perpetual" | "fixed",
  payoutYears: number | null,        // only if payoutMode==="fixed"
  breakpoints: Breakpoint[]          // piecewise schedule
}
```

### 3.3 Scenario
```js
{
  id: string,
  name: string,              // Scenario I, II, ...
  params: Parameters,
  results: Results           // computed outputs + timeseries
}
```

### 3.4 Results
```js
{
  series: {
    years: number[],                 // x values
    capitalNominal: number[],
    capitalReal: number[],
    payinsNominal: number[],
    payinsReal: number[]
  },
  summary: {
    endCapitalNominal: number,
    endCapitalReal: number,
    payoutMonthlyNominalAtRetirementStart: number,
    payoutMonthlyRealToday: number
  }
}
```

---

## 4) Math Model (the engine)
All calculations are **nominal** with inflation used to compute **real** values.

### 4.1 Convert annual rates to monthly
Let annual rates be decimals (e.g. 0.06 for 6%):
- `r_s = (1 + annualReturnSavings)^(1/12) - 1`
- `r_w = (1 + annualReturnWithdrawal)^(1/12) - 1`
- `i   = (1 + annualInflation)^(1/12) - 1`

Inflation factor after `m` months:
- `F(m) = (1 + i)^m`

### 4.2 Savings phase simulation (month by month)
Let `N = durationYears * 12`.

Initialize:
- `B = startCapital`
- `pay_nom = 0`
- `pay_real = 0`

For each month `m = 1..N`:
1) Apply growth (savings return):
   - `B = B * (1 + r_s)`
2) Add contribution for that month:
   - `c = monthlyRateAtMonth(m)` from the breakpoint schedule
   - `B = B + c`
3) Track cumulative pay-ins:
   - `pay_nom += c`
   - `pay_real += c / F(m)`  *(discount each cashflow back to today’s money)*
4) Track series values at that month:
   - `capitalNom[m] = B`
   - `capitalReal[m] = B / F(m)`
   - `payinsNom[m] = pay_nom`
   - `payinsReal[m] = pay_real`

Plot series over `years = m/12`.

**monthlyRateAtMonth(m):**
- Determine `year = (m-1)/12`
- Find last breakpoint with `bp.year <= year`, use its `monthlyRate`.

### 4.3 End-of-savings values
At retirement start (after N months):
- `B_end_nom = B`
- `B_end_real = B / F(N)`

### 4.4 Retirement payout calculation (real annuity logic)
We compute the payout as a **constant REAL payment** (inflation-adjusted), because users usually care about purchasing power.

Real monthly return during withdrawal:
- `r_real = (1 + r_w) / (1 + i) - 1`

If `payoutMode = "perpetual"`:
- Sustainable real payout:
  - If `r_real <= 0`: payout = 0 (and show warning)
  - Else: `P_real = B_end_real * r_real`

If `payoutMode = "fixed"` with `n = payoutYears * 12`:
- If `abs(r_real) < 1e-12`: `P_real = B_end_real / n`
- Else: `P_real = B_end_real * r_real / (1 - (1 + r_real)^(-n))`

Convert payout to **nominal at retirement start**:
- `P_nom_at_ret = P_real * F(N)`

Store both:
- `payoutMonthlyRealToday = P_real`
- `payoutMonthlyNominalAtRetirementStart = P_nom_at_ret`

---

## 5) Edge Cases & Validation Rules (must implement)
### Inputs
- All currency inputs must be `>= 0`.
- Duration years: `>= 1` (cap to something sane e.g. 80).
- Rates: allow negatives, but display warning (especially for inflation <= -100% invalid).
- If payoutMode = fixed, payoutYears must be `>= 1`.

### Schedule chart
- Always keep breakpoint at year 0.
- Do not allow breakpoint at year > duration or < 0.
- If user clicks year already used, ignore or select that point.
- Provide a way to remove a breakpoint (recommended UX):
  - `double-click` a breakpoint to remove (except year 0).
- Snap x to integer years. (Drag should only adjust y; x fixed.)
- Snap y to a step (e.g. 10 or 50 currency units) for “arcade knob” feeling.

### Calculations
- If inflation factor or compounding overflows for huge horizons, clamp and warn.
- If payout becomes NaN or infinite, set to 0 and show warning.

---

## 6) Charts Implementation Notes (how to make the schedule editable)
### 6.1 Savings schedule chart (left)
Use Chart.js line chart:
- `stepped: 'after'` so value holds until next breakpoint.
- Dataset points: one point per breakpoint year.
- Force x-axis from 0..durationYears.

**Adding breakpoint by click:**
- On chart click, get x-value in years (Chart.js provides scales conversion).
- Round to nearest integer year.
- Insert breakpoint with:
  - `monthlyRate = currentRateAtThatYear`
- Re-render.

**Dragging a breakpoint:**
- Use drag plugin or pointer events to modify y only.
- After drag, update breakpoint.monthlyRate and re-render.

### 6.2 Scenario chart (right)
A second Chart.js chart with 4 datasets.
- Use distinct line styles (dash patterns) rather than colors alone (accessibility).
- Tooltips show year + value (nominal/real).

---

## 7) Scenario System (save, load, compare)
### 7.1 Save scenario
- Create scenario from current `params`.
- Compute results immediately.
- Append to scenario list and select it.
- Auto-name:
  - I, II, III, IV… (Roman numerals) or 1,2,3.

### 7.2 Clicking scenario tab
- Set it as active
- Load its params into input controls + schedule chart
- Render its result series on the right

### 7.3 localStorage (recommended)
- Persist scenarios array under a key e.g. `arcade_pension_scenarios_v1`.
- On load, restore scenarios + select last active.

---

## 8) Files & Folder Structure
Repository root:
```
/index.html
/styles.css
/app.js
/.github/workflows/pages.yml
```

No build step required.

---

## 9) Acceptance Checklist (definition of done)
- [ ] Two-column layout matches sketch (left inputs + schedule chart, right tabs + chart + table).
- [ ] Schedule chart supports: click to add breakpoint, drag to adjust y, double-click to remove.
- [ ] Save scenario adds tab + row in summary table.
- [ ] Clicking scenario tab loads parameters and updates both charts.
- [ ] Right chart has 4 lines: capital nominal/real, pay-ins nominal/real.
- [ ] Summary table includes: end capital nominal/real, payout nominal/real.
- [ ] Works as static site on GitHub Pages (Actions workflow).
- [ ] No backend calls, no server required.

---

## 10) Nice-to-haves (only after core works)
- Export/import scenarios as JSON.
- Reset button (clear scenarios + localStorage).
- Keyboard increments for active breakpoint (↑/↓).
- Mobile layout: stack panels vertically.
