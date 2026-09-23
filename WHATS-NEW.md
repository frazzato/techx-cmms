# Schedule Work, Production Loss, cause setup and shared parts

Five changes. **194 tests passing.**

---

## 1 · Wording

| Was | Now |
|---|---|
| Raise work | **Schedule work** |
| Report a problem | **Production Loss** |
| Work *(menu)* | **Schedule Work** |
| Problems *(menu)* | **Production Loss** |

Everywhere — buttons, menu, screen titles, dialogs, export filenames.

---

## 2 · The Schedule Work screen

The two big buttons are gone from this screen. It *is* the schedule-work screen, so a second button saying the same thing was noise.

**Each tab now has its own create button** — *+ New work order* on one, *+ New PM* on the other. One tap instead of two, since the choice is already made by which tab you're on.

Home keeps both big buttons. Production Loss keeps a **Log production loss** button, or there'd be no way to record one from that screen.

---

## 3 · Production Loss now counts parts

Every loss carries **two costs: time lost and parts lost**. A short stoppage that scraps a full bin was previously invisible in a report counting only minutes.

- **Parts lost** tile alongside time lost
- Parts column in the Pareto, the worst-equipment table and the event list
- The final count can be corrected at close — first estimates are usually wrong
- Downtime can carry parts too; a jam scraps parts as surely as a defect does

### High defect machines — 7 / 30 / 60 / 90 days side by side

| Equipment | 7 days | 30 days | 60 days | 90 days |
|---|---|---|---|---|
| Weld cell 2 | **45** | 45 | 45 | 45 |
| Top Roll | — | — | 10 | **85** |

Read across: the first machine **just started** going wrong. The second was bad and has been dealt with. A single window cannot tell those apart, and that's the whole question when deciding what to look at next.

The same table exists for downtime, ranked on time lost.

---

## 4 · Cause setup, per equipment type

New admin screen. A weld cell and an air compressor fail differently, so reason lists are held **per equipment type**.

Three lists per type: **machine stopped**, **defect types**, **cause of failure** on work orders. A plant-wide list applies on top of every machine, so "Waiting on parts" is entered once.

Equipment now has a **Type** field, which is what links a machine to its lists.

**The lists never go empty.** If a type has nothing configured, the built-in standard list is used. Setup is optional and can be done gradually — nothing breaks on day one, and the screen tells you which types are still on the standard list.

**Load the standard list** copies the built-in set in as a starting point to edit.

Deleting a reason does **not** rewrite history. Records keep the words they were saved with; the reason simply stops being offered on new ones.

Admin-only, enforced by the server — a technician logging a stoppage can't rewrite the list underneath it.

---

## 5 · One part, several machines

A sonotrode fitting three weld cells is now **one part record with one stock figure**, visible from every machine that uses it.

The parts form has a tick-list of equipment with a filter box. The BOM on each machine shows an **"also fits"** column so you can see at a glance that a part is shared before you take the last one.

**Existing parts need no re-entry.** The old single-machine field is still read, and still written alongside the new list, so anything else reading it keeps working. Verified explicitly against records saved by the previous version.

**Importing:** put several equipment numbers in one cell separated by semicolons — `3526;3527;3530` — and map it to `assetIds`. Export writes them back the same way.

---

## To deploy

Replace `assets/`, `index.html`, `api/` and `package.json`.

**`assets/causes.js` is a new file** — verify it uploads or Cause Setup won't load. `assets/` should show **10 files**; `api/` only `data.js`.

Nothing to change in Vercel. Existing data untouched — every record keeps working, with the new fields simply empty until used.

### Worth doing first

1. **Set the Type on your equipment** — that's what drives the cause lists.
2. Open **Cause Setup**, pick a type, and either add your own reasons or load the standard list and edit it.
3. Watch what your technicians actually pick. If everything lands in "Other", the words don't match how they talk — that's now a two-minute fix rather than a code change.
