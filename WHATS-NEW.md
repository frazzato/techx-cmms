# Cause scopes, and a charts dashboard

**294 tests passing.**

---

## 1 · Cause Setup — now scoped three ways

Same three lists as before — **machine stopped**, **defect types**, **cause of failure**. What changed is who a reason applies to:

| Scope | Appears on |
|---|---|
| **Every machine** | everything, plant-wide |
| **An equipment type** | every machine of that type |
| **Chosen machines** | only the ones you tick — **several at once** |

Ticking three weld cells creates **one line**, not three. Edit it once and all three change.

The three stack: a welder can see a plant-wide reason, its type's reasons, and its own — ordered general to specific so the machine-specific ones sit nearest the technician's thumb.

### Clearing

Three buttons, each saying exactly how many lines will go:

- **Clear these 12** — just the bucket on screen
- **Clear the Downtime list everywhere** — one list, every scope
- **Clear all 47 reasons** — the lot

**History is never rewritten.** Records keep the words they were saved with. Clearing changes only what is *offered* from now on.

**Nothing ever goes empty.** Clear everything and machines fall back to the built-in lists, so a technician mid-shift can still log a stoppage. That was the one thing that couldn't be allowed to break.

---

## 2 · Dashboard — charts

Filter bar at the top: **what kind of loss · which machines (tick several) · how far back**. Every chart below responds, and a line under the filters says in words what you are looking at.

**Seven charts:**

- **Production loss over time** — stacked columns, downtime vs defect per day
- **Time lost by machine** and **parts lost by machine** — side by side, because they rank differently
- **Defect causes** — Pareto ranked by **parts scrapped**, not minutes. A five-minute fault that fills a bin belongs at the top, and a time-ranked chart buries it
- **Downtime causes** — Pareto by time lost
- **Downtime vs defect** — donut
- **Events by machine**

Plus the numbers table underneath, and an **export that matches the filters exactly** — so a chart on screen and the spreadsheet in an email always agree.

### The surprise: a day × hour heatmap

Seven rows, twenty-four columns, coloured by how much was lost.

A total tells you *how much*. This tells you **when** — and that is what exposes the 06:00 start-up hour, the shift-handover gap, or the cell that only misbehaves on nights. Underneath, it says it in words: *"Tuesday at 6:00 is the single worst hour. Across the week 6:00 accounts for 40% of all minutes lost."*

Switch the measure between minutes, parts and event count.

---

## Why the charts are hand-built

No charting library. Three reasons that matter here:

- a CDN chart renders as an **empty box** on a plant network that blocks outside scripts
- **SVG prints** cleanly; canvas does not
- it works **offline**, like the rest of the app

They are also tested against the three things that break chart code — no data, a single data point, and every value zero — and rendered to PNG in the test suite to prove the markup is valid, not just that it contains the right strings.

---

## To deploy

Replace `assets/`, `index.html`, `api/` and `package.json`.

**`assets/charts.js` is a new file** — verify it uploads or the Dashboard will be blank. `assets/` should show **10 files**; `api/` only `data.js`.

Existing cause lines keep working — records written before scopes existed are read as type-scoped or plant-wide automatically, so nothing needs re-entering.

### Worth doing first

1. Open **Cause Setup** and clear whatever no longer fits. It falls back safely.
2. Rebuild with the scopes — put genuinely plant-wide reasons at **Every machine**, and machine-specific ones on **Chosen machines**.
3. Load sample data on a test account and open the **Dashboard** to see the charts with a realistic shape before your own data fills in.


## Microsoft 365 Copilot link
The launcher now uses `https://m365.cloud.microsoft/chat`.
