# Equipment, one-click work, and downtime tracking

Three changes. The third is the substantial one.

---

## 1 · "Assets" is now "Equipment"

Every label a technician sees: the sidebar, headings, buttons, forms, messages, import and export screens.

**The stored data did not change.** The collection is still `assets` internally and the QR route is still `#/asset/…`. Renaming those would have orphaned every existing record and broken every QR tag already printed and stuck on a machine. The word changed; nothing else did.

---

## 2 · One button for work

Home now has two large buttons instead of a scattered menu:

**Raise work** → asks *Work Order* or *Preventive Maintenance*, in plain language:

- **Work Order** — something broke, needs fixing, or needs looking at
- **Preventive Maintenance** — a scheduled job that repeats on a frequency

Then straight into the existing form. Same records, same behaviour — only the way in changed.

The direct **+ New PM** button on the PM screen stays direct. Adding a choice step where the decision is already made is a wasted tap.

---

## 3 · Downtime & Defects

**These are one record type, not two.** Both answer the same question — the machine was stopped, for how long, and why. The only difference is the category:

- **Downtime** — the machine itself failed
- **Defect** — the process produced bad parts

One form to learn, one set of duration maths, and totals that add up across both.

### Reporting is built for speed
Target is under fifteen seconds, because the machine is down while the technician is typing.

Equipment → tap **Just now / 15 min ago / 30 min ago / 1 hour ago** → reason → save. The time buttons exist because typing a timestamp on a phone at a stopped machine is the slowest part of the form.

While they type, **past fixes for the same thing appear underneath** — sometimes the answer arrives before the record is even saved.

### Closing is where this usually rots
A stoppage gets logged while the machine is still down, so there is no end time yet. If nobody closes it, open records pile up and every total becomes a lie. That is what kills downtime tracking in most plants.

So:

- A **loud permanent banner** — *"2 machines are down right now"* — with a one-tap **Running again** on every screen that matters
- Anything open past **24 hours** is flagged as probably-forgotten and **kept out of the totals** until closed, so the numbers stay honest
- Closing asks **"what got it running?"** — that single line is the whole point

### The numbers
- **Production lost**, split between downtime and defects
- **Estimated cost**, if you set an hourly rate on the equipment — optional, because a made-up rate is worse than no number
- **Pareto by reason**, ranked **by time lost, not by count**. Twelve two-minute jams matter less than one six-hour electrical fault, and counting events would hide that
- **Worst equipment**, and **recurring stoppages** — same machine, same reason, 3+ times

---

## Feeding Smart Assist

Downtime records now sit alongside work orders in Smart Assist. Searching *"bad welds"* finds past defects and stoppages as well as repairs.

Only closed records with a real *"what got it running"* are offered. An open stoppage has no lesson yet, and one closed with a blank fix note teaches nobody anything.

In practice the downtime notes are often the most useful thing in the system, because they were written by someone standing at the machine while it was still broken.

---

## Two decisions worth explaining

**Times are stored as plain local strings** — `2026-09-15T14:30`, exactly as the clock on the wall reads. No UTC conversion. One plant, one timezone, and every timezone bug in an app like this comes from converting between local input and UTC storage. A stoppage logged at 14:30 reads 14:30 forever, including across daylight saving.

**Open and stale records are reported separately, never folded into totals.** An open stoppage is still running so its duration is not final; a stale one is untrustworthy. Both are shown and counted on their own rather than quietly inflating a number somebody will quote in a meeting.

---

## Defect types

Starting list, easy to change — they live at the top of `assets/stops.js`:

*Weld quality · Dimensional / fit · Surface / cosmetic · Contamination · Missing component · Adhesion / bond · Colour or grain mismatch · Material defect · Operator error · Other*

Downtime reasons cover mechanical, electrical, hydraulic/pneumatic, control/PLC, sensor, jam, tooling change, waiting on parts, waiting on maintenance, setup, planned maintenance.

**Tell me what to add, cut or rename.** A list nobody recognises gets ignored, and then everything ends up as "Other".

---

## Importing old downtime logs

**Import CSV → Downtime & Defects**. Headers map automatically — `Machine`, `Downtime Reason`, `Start Time`, `End Time`, `What Fixed It`, `Operator`. Spreadsheet times like `2026-09-15 08:30` are normalised on import so durations compute. A row with no end time imports as still open.

This is how you get a baseline on day one instead of starting from zero.

---

## To deploy

Replace `api/` and `assets/`, plus `index.html` and `package.json`. Commit.

**`assets/stops.js` is a new file** — make sure it uploads or the downtime screens will not load. `assets/` should show **8 files**.

**`api/` must contain only `data.js`** — no `package.json` inside it.

Nothing to change in Vercel. No new environment variables. Existing data untouched.

Optionally, add a **downtime cost per hour** to your main machines (edit equipment). That turns "47 hours lost" into a dollar figure, which is the number that gets attention upstairs.

Load sample data from Settings to see it working — it includes a repeating electrical fault and one machine still down.
