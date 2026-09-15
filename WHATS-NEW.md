# Smart Assist

A new section that answers the question *"has this happened before?"* by searching the work orders your own team has already closed.

**There is no AI model in this.** No outside service, no API key, no cost, nothing leaves the plant. It is a search engine over your own history — which for this job is genuinely better, because it can only ever show you a real work order with a real number you can open and read. It cannot invent a repair that never happened.

---

## What it does

### 1 · "Seen this before?"

Type a problem — *"bad welds on station 2"* — and it finds closed work orders that look like the same thing, showing **what was actually done** and **who did it**.

It matches on:
- **Words in common**, weighted so rare terms count more (sharing "sonotrode" means far more than sharing "replace")
- **Same machine** — a big boost
- **Same model** — a sister machine tends to fail the same way, so those count too, less strongly
- **Same cause code**
- **Recency** — a repair from last month beats one from three years ago
- **Whether notes were written** — an undocumented closure teaches nobody anything

Synonyms are bridged, so *"bad welds"*, *"weld quality drift"* and *"defective welds"* all find each other.

### 2 · Recurring problems

When the same cause hits the same machine **3+ times in a year**, it gets flagged with total hours, total cost, and roughly how often:

> **3× Air Compressor #1** — Seal failure
> 13.5h total · $1,450 · roughly every 83 days

That's a root-cause problem, not bad luck — the kind of pattern nobody spots reading work orders one at a time. It appears on Home, on the Dashboard, on the asset page, and in Smart Assist.

### 3 · Failure profile per machine

Each asset page now shows its most common causes, average time between repairs, total repair cost, and **who knows that machine best** — useful when you need to ask someone.

---

## Where it shows up

| Screen | What you get |
|---|---|
| **Smart Assist** (new nav item) | Search box, recurring problems, documentation health |
| **Work order form** | A "Seen before" panel that updates as you type the description |
| **Asset page** | Failure profile, recurring-problem warning, "Past repairs" button |
| **Home** | Smart Assist tile showing what it found |
| **Dashboard** | Recurring failures table |

Both roles can use it. A technician needs this more than an admin does.

---

## The part that decides whether this works

**It can only find what your team wrote down.**

A work order closed with *"fixed it"* and no cause is invisible to all of this. So the close dialog now asks for **"What you found and what you did"**, and warns — once — if you try to close with nothing written.

It's a nudge, not a hard block. A hard block just gets defeated by typing a full stop, and then you have worse data *and* an annoyed technician.

Smart Assist shows your documentation rate honestly:

> **8 of 12** closed work orders have both a cause and real notes — **67%**

Get that above 70% and the matches become genuinely useful. Below 40% and there isn't much to find.

---

## Honest limits

- It does not read your PDF manuals — only work orders.
- It does not suggest fixes it has not seen. If nothing similar exists, it says so plainly.
- Matching is on words, so wildly different phrasing for the same fault may not connect. Synonyms cover the common cases.
- **Needs about 4+ closed work orders** before word-rarity scoring means anything. Below that it falls back to plain overlap so a new plant still gets matches.

---

## What would change with a real LLM

An AI layer on top would understand phrasing the word matcher misses, and could summarise five past repairs into one troubleshooting sequence.

It would also mean plant data leaving your network, an IT and legal conversation, a per-query cost, and a genuine hallucination risk — an assistant that confidently invents "check the pressure regulator" when no such repair exists is worse than none.

If you go there, **Azure OpenAI** is the path of least resistance since it runs inside your Microsoft tenant. The rule I'd insist on: the model may only summarise work orders actually retrieved, and every claim must cite a WO number.

The history matching built here is the right foundation either way — an LLM would sit on top of it, not replace it.

---

## To deploy

Replace `api/` and `assets/`, plus `index.html` and `package.json`. Commit.

**`assets/insights.js` is a new file** — make sure it uploads, or Smart Assist will not load.

**`api/` must contain only `data.js`** — no `package.json` inside it.

Nothing to change in Vercel. No new environment variables. Existing data untouched.

Load sample data from Settings to see it working immediately — the sample now includes a deliberate recurring failure for it to find.
