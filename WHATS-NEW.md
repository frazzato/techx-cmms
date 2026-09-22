# Maintenance view

Technicians now see the five screens they need on the floor. Admins keep everything.

---

## What each role sees

| | Maintenance | Admin |
|---|---|---|
| Home | ✓ | ✓ |
| **Equipment** | ✓ | ✓ |
| **Work** (orders + PM) | ✓ | ✓ |
| **Problems** (downtime + defects) | ✓ | ✓ |
| **Spare Parts** | ✓ | ✓ |
| **Smart Assist** | ✓ | ✓ |
| Settings *(password only)* | ✓ | ✓ |
| Dashboard | — | ✓ |
| PM Compliance | — | ✓ |
| QR Tags | — | ✓ |
| Import CSV · Users | — | ✓ |

---

## Two calls I made, and why

**Home stays.** It is the launcher — the two big buttons live there, and it is where sign-in lands. Blocking it would leave a technician with nowhere to arrive.

**Settings stays, cut down** to their account, their password, and whether they are online. Without it a technician could never change the temporary password you gave them, which is worse than showing them a short page. No site name, no backups, no sample data, no upload.

Say the word and I will remove either.

---

## Enforced in the router, not the menu

Hiding a nav item is cosmetic — anyone can type `#/compliance` in the address bar. **Every route is checked on entry**, so a blocked screen shows a plain "not available" page regardless of how it was reached.

Both the menu and the gate read the same list, so they cannot drift apart. That list is at the top of `assets/app.js`:

```js
const VIEWS = {
  maintenance: ['home','assets','asset','work','wo','pm',
                'stops','parts','smart','settings','login'],
  admin: 'all'
};
```

Add or remove a screen there and the menu, the router and the landing page all follow.

---

## Screens hide what they cannot reach

No dead links. The compliance tile is gone from Home, the QR button is gone from Equipment, and the PM tab drops its compliance link — all only for maintenance.

---

## What did not change

**Maintenance still reads every record.** A technician standing at a machine needs its full history, including equipment they were not assigned. What is hidden is the reporting and setup screens.

**Writes are unchanged.** They can still raise and complete work orders, log and close downtime, record PM completions, and add equipment, PMs and parts. Delete, import and user management remain admin-only, enforced by the server.

Existing QR tags still scan — verified with a real decoder.

---

## One extra, given last week

The **Check server** button on the login screen now reports how many records are actually in the shared database:

> equipment: **24** · pms: **31** · parts: **60** · wos: **12**

That answers "is the data on the server or only in my browser" from a phone, without opening a SQL console. If it says the database is empty, the fix is **Settings → Upload this device's data** from whichever browser still has the records.

---

## To deploy

Replace `assets/`, `index.html` and `api/`. `assets/` should show **9 files**; `api/` only `data.js`.

Nothing to change in Vercel. Existing accounts keep their current role — anyone created as Maintenance gets the new view on next load. Hard-refresh with **Ctrl+Shift+R**.
