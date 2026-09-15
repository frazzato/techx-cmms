/* ============================================================
   compliance.js — PM completion history and compliance
   ------------------------------------------------------------
   Every time a PM is marked done, one immutable record is written
   to the pmlogs collection. Nothing here ever rewrites one — that
   is what makes the history usable as evidence.

   Each record captures the facts as they were at the moment of
   completion:

     { id, pmId, assetId, description, frequency,
       dueDate,        what it was due       (as scheduled then)
       doneDate,       when it was done
       daysLate,       computed AT completion, then frozen
       by, hours, notes, woId }

   daysLate is stored rather than recalculated because the PM's
   schedule can change later. If someone switches a PM from weekly
   to monthly next year, last March's record must still show it was
   four days late against the weekly schedule that applied then.
   ============================================================ */

const Compliance = (() => {

  /* Tolerance before a completion counts as late. A PM due Friday
     and done Monday is normal shop reality, not a compliance
     failure — but two weeks out is. */
  const GRACE_DAYS = 2;

  function daysBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    const a = new Date(fromIso + 'T00:00:00'), b = new Date(toIso + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  /* Build the record to write. Called once, at completion. */
  function buildLog(pm, opts = {}) {
    const doneDate = opts.doneDate || new Date().toISOString().slice(0, 10);
    const dueDate = pm.nextDue || '';
    const late = dueDate ? daysBetween(dueDate, doneDate) : null;
    return {
      id: opts.id,
      pmId: pm.id,
      assetId: pm.assetId || '',
      description: pm.description || '',
      frequency: pm.frequency || '',
      dueDate,
      doneDate,
      daysLate: late === null ? null : late,
      by: opts.by || '',
      hours: opts.hours || '',
      notes: opts.notes || '',
      woId: opts.woId || ''
    };
  }

  const onTime = log => log.daysLate === null || log.daysLate <= GRACE_DAYS;

  function logsFor(pmId) {
    return DB.all('pmlogs')
      .filter(l => l.pmId === pmId)
      .sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''));
  }

  function logsForAsset(assetId) {
    return DB.all('pmlogs')
      .filter(l => l.assetId === assetId)
      .sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''));
  }

  /* ---------- compliance over a window ---------- */
  function summary(opts = {}) {
    const { days = 90, assetId = '', pmId = '', person = '' } = opts;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutIso = cutoff.toISOString().slice(0, 10);

    let logs = DB.all('pmlogs').filter(l => (l.doneDate || '') >= cutIso);
    if (assetId) logs = logs.filter(l => l.assetId === assetId);
    if (pmId) logs = logs.filter(l => l.pmId === pmId);
    if (person) logs = logs.filter(l => (l.by || '') === person);

    const done = logs.length;
    const late = logs.filter(l => !onTime(l)).length;
    const hours = logs.reduce((s, l) => s + (DB.num(l.hours) || 0), 0);
    const documented = logs.filter(l => l.notes && l.notes.trim().length >= 10).length;

    /* Currently overdue is a separate question from historical
       compliance — one is "are we behind right now", the other is
       "did we do them when we said". Both matter. */
    const overdueNow = DB.all('pms').filter(p => {
      if (assetId && p.assetId !== assetId) return false;
      if (pmId && p.id !== pmId) return false;
      const d = DB.daysUntil(p.nextDue);
      return d !== null && d < -GRACE_DAYS;
    });

    return {
      days, done, late, onTime: done - late,
      pct: done ? Math.round(((done - late) / done) * 100) : null,
      hours, documented,
      docPct: done ? Math.round((documented / done) * 100) : 0,
      overdueNow: overdueNow.length,
      overdueList: overdueNow,
      logs: logs.sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''))
    };
  }

  /* ---------- per-PM record ---------- */
  function pmRecord(pmId) {
    const pm = DB.get('pms', pmId);
    const logs = logsFor(pmId);
    const late = logs.filter(l => !onTime(l)).length;
    const hours = logs.reduce((s, l) => s + (DB.num(l.hours) || 0), 0);

    /* Average actual interval, which is often not the scheduled one —
       a "monthly" PM genuinely done every 45 days is worth knowing. */
    const dates = logs.map(l => l.doneDate).filter(Boolean)
      .map(d => new Date(d + 'T00:00:00')).filter(d => !isNaN(d)).sort((a, b) => a - b);
    let actualInterval = null;
    if (dates.length >= 2) {
      let total = 0;
      for (let i = 1; i < dates.length; i++) total += (dates[i] - dates[i - 1]) / 86400000;
      actualInterval = Math.round(total / (dates.length - 1));
    }

    const scheduled = pm ? (DB.FREQ_DAYS[(pm.frequency || '').toLowerCase()] || null) : null;

    return {
      pm, logs, count: logs.length, late, onTime: logs.length - late,
      pct: logs.length ? Math.round(((logs.length - late) / logs.length) * 100) : null,
      hours, actualInterval, scheduled,
      drifting: actualInterval && scheduled ? actualInterval > scheduled * 1.4 : false,
      first: dates.length ? dates[0].toISOString().slice(0, 10) : '',
      last: dates.length ? dates[dates.length - 1].toISOString().slice(0, 10) : ''
    };
  }

  /* ---------- by person ---------- */
  function byPerson(days = 90) {
    const s = summary({ days });
    const map = new Map();
    s.logs.forEach(l => {
      const name = (l.by || '').trim() || 'Unrecorded';
      if (!map.has(name)) map.set(name, { name, done: 0, late: 0, hours: 0 });
      const e = map.get(name);
      e.done++;
      if (!onTime(l)) e.late++;
      e.hours += DB.num(l.hours) || 0;
    });
    return Array.from(map.values())
      .map(e => Object.assign(e, { pct: e.done ? Math.round(((e.done - e.late) / e.done) * 100) : 0 }))
      .sort((a, b) => b.done - a.done);
  }

  /* ---------- PMs never completed ----------
     A schedule that has never once been done is the thing an auditor
     finds first, and the easiest to miss internally. */
  function neverDone() {
    const seen = new Set(DB.all('pmlogs').map(l => l.pmId));
    return DB.all('pms').filter(p => !seen.has(p.id));
  }

  /* ---------- export for an audit ---------- */
  function exportRows(opts = {}) {
    const s = summary(Object.assign({ days: 3650 }, opts));
    /* Every value is coerced: a missing field must come out as an empty
       cell, never the literal text "undefined" in an audit document. */
    const v = x => (x === null || x === undefined) ? '' : String(x);
    return s.logs.map(l => ({
      'PM Number': v(l.pmId),
      'Asset ID': v(l.assetId),
      'Asset Name': v(DB.assetName(l.assetId)),
      'Task': v(l.description),
      'Frequency': v(l.frequency),
      'Due Date': v(l.dueDate),
      'Completed Date': v(l.doneDate),
      'Days Late': l.daysLate === null || l.daysLate === undefined ? '' : String(l.daysLate),
      'On Time': onTime(l) ? 'Yes' : 'No',
      'Completed By': v(l.by),
      'Hours': v(l.hours),
      'Work Order': v(l.woId),
      'Notes': v(l.notes)
    }));
  }

  const EXPORT_COLUMNS = ['PM Number','Asset ID','Asset Name','Task','Frequency','Due Date',
    'Completed Date','Days Late','On Time','Completed By','Hours','Work Order','Notes'];

  return {
    GRACE_DAYS, buildLog, onTime, logsFor, logsForAsset,
    summary, pmRecord, byPerson, neverDone, exportRows, EXPORT_COLUMNS, daysBetween
  };
})();

if (typeof module !== 'undefined') module.exports = Compliance;
