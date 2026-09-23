/* ============================================================
   causes.js — configurable cause lists, per equipment type
   ------------------------------------------------------------
   An admin sets up the reasons that appear in the dropdowns when
   somebody schedules work or logs a production loss. A weld cell
   and an air compressor fail in different ways, so the lists are
   held per EQUIPMENT TYPE rather than one global list.

   Three kinds of list:
     downtime — why the machine stopped
     defect   — what kind of bad part it made
     failure  — cause of failure on a work order

   Each record is one line in one list:
     { id, kind, equipType, label, sort }

   equipType '' means "every type" — a line that applies plant-wide
   without having to repeat it under each machine type.

   THE FALLBACK MATTERS.
   If nothing is configured for a type, the built-in list is used.
   Without that, the day this deploys every dropdown would be empty
   and nobody could log anything until an admin had finished typing
   in their lists. The fallback means setup is optional and can be
   done gradually, one equipment type at a time.
   ============================================================ */

const Causes = (() => {

  /* ---------- built-in defaults ----------
     Used when a type has nothing configured. Also what the "Load
     the standard list" button copies in as a starting point. */
  const DEFAULTS = {
    downtime: [
      'Mechanical failure','Electrical fault','Hydraulic / pneumatic',
      'Control / PLC fault','Sensor / photo-eye','Jam or blockage',
      'Tooling change','Waiting on parts','Waiting on maintenance',
      'Setup / changeover','Planned maintenance','Other'],
    defect: [
      'Weld quality','Dimensional / fit','Surface / cosmetic','Contamination',
      'Missing component','Adhesion / bond','Colour or grain mismatch',
      'Material defect','Operator error','Other'],
    failure: [
      'Wear / end of life','Seal failure','Loose fastener','Contamination',
      'Operator damage','Electrical fault','Software / program','Unknown']
  };

  const KIND_LABEL = {
    downtime: 'Machine stopped — reasons',
    defect:   'Defect types',
    failure:  'Cause of failure (work orders)'
  };
  const KIND_SHORT = { downtime:'Downtime', defect:'Defect', failure:'Failure' };
  const KINDS = ['downtime','defect','failure'];

  /* Work orders keep this as the "not yet known" option. It is not
     configurable because closing a work order still on it is blocked,
     so the app has to know the exact string. */
  const TBD = 'To be determined';

  const all = () => DB.all('causes');

  /* Every equipment type currently in use, from the equipment
     register and from whatever has already been configured. */
  function types(){
    const set = new Set();
    DB.all('assets').forEach(a => { if (a.type && a.type.trim()) set.add(a.type.trim()); });
    all().forEach(c => { if (c.equipType && c.equipType.trim()) set.add(c.equipType.trim()); });
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }

  const typeOf = assetId => {
    const a = DB.get('assets', assetId);
    return a && a.type ? String(a.type).trim() : '';
  };

  /* Configured lines for one kind and one type, plus the plant-wide
     ones. Returns [] when nothing is set up — the caller decides
     whether to fall back. */
  function configured(kind, equipType){
    const t = String(equipType || '').trim();
    return all()
      .filter(c => c.kind === kind)
      .filter(c => {
        const ct = String(c.equipType || '').trim();
        return ct === '' || (t && ct === t);
      })
      .sort((a,b) => {
        const sa = DB.num(a.sort), sb = DB.num(b.sort);
        if (sa !== null && sb !== null && sa !== sb) return sa - sb;
        if (sa !== null && sb === null) return -1;
        if (sa === null && sb !== null) return 1;
        return String(a.label||'').localeCompare(String(b.label||''));
      })
      .map(c => c.label)
      .filter(Boolean);
  }

  /* De-duplicate while keeping order — a plant-wide line and a
     type-specific line can easily say the same thing. */
  const uniq = list => {
    const seen = new Set(), out = [];
    list.forEach(x => { const k = String(x).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  };

  /* The list to actually show in a dropdown. */
  function forType(kind, equipType){
    const set = configured(kind, equipType);
    return uniq(set.length ? set : (DEFAULTS[kind] || []));
  }
  function forEquipment(kind, assetId){
    return forType(kind, typeOf(assetId));
  }
  /* True when these came from the built-in list rather than setup —
     used to tell an admin the type still needs configuring. */
  function isFallback(kind, equipType){
    return configured(kind, equipType).length === 0;
  }

  /* Options for a <select>. An existing value that is no longer in
     the list is kept, so editing an old record never silently
     changes its reason to something else. */
  function options(kind, equipType, currentValue, opts = {}){
    const list = forType(kind, equipType);
    const out = [];
    if (opts.placeholder) out.push({ v:'', t: opts.placeholder });
    if (opts.tbd) out.push({ v: TBD, t: TBD });
    list.forEach(l => out.push({ v:l, t:l }));
    const cur = String(currentValue || '');
    if (cur && !out.some(o => o.v === cur)) out.push({ v:cur, t: cur + ' (no longer on the list)' });
    return out;
  }

  /* ---------- admin editing ---------- */
  function add(kind, equipType, label, sort){
    const clean = String(label || '').trim();
    if (!clean) return null;
    const t = String(equipType || '').trim();
    /* Same words twice in the same list helps nobody. */
    const dup = all().some(c => c.kind === kind &&
      String(c.equipType||'').trim() === t &&
      String(c.label||'').trim().toLowerCase() === clean.toLowerCase());
    if (dup) return { duplicate: true };
    return DB.upsert('causes', {
      id: DB.nextId('causes','CZ-',4),
      kind, equipType: t, label: clean,
      sort: sort === undefined || sort === null || sort === '' ? '' : String(sort)
    });
  }

  /* Copy the built-in list in as a starting point, skipping anything
     already there so it can be run twice safely. */
  function seedDefaults(kind, equipType){
    const t = String(equipType || '').trim();
    const have = new Set(configured(kind, t).map(x => x.toLowerCase()));
    let n = 0;
    (DEFAULTS[kind] || []).forEach((label, i) => {
      if (have.has(label.toLowerCase())) return;
      DB.upsert('causes', {
        id: DB.nextId('causes','CZ-',4) + '-' + i,
        kind, equipType: t, label, sort: String((i + 1) * 10)
      });
      n++;
    });
    return n;
  }

  /* How many records still use a line — shown before deleting, since
     removing a reason does not rewrite the history that used it. */
  function usage(kind, label){
    const l = String(label || '');
    if (!l) return 0;
    if (kind === 'failure') return DB.all('wos').filter(w => w.cause === l).length;
    return DB.all('stops').filter(s => s.kind === kind && s.reason === l).length;
  }

  function summary(){
    const t = types();
    const rows = [];
    /* Plant-wide first, then each type. */
    [''].concat(t).forEach(et => {
      const row = { equipType: et, counts: {}, usingDefault: {} };
      KINDS.forEach(k => {
        row.counts[k] = configured(k, et).filter(Boolean).length;
        row.usingDefault[k] = isFallback(k, et);
      });
      /* Only count equipment for a real type, not the plant-wide row. */
      row.equipment = et ? DB.all('assets').filter(a => String(a.type||'').trim() === et).length : null;
      rows.push(row);
    });
    const untyped = DB.all('assets').filter(a => !a.type || !String(a.type).trim()).length;
    return { rows, types: t, untyped, total: all().length };
  }

  return {
    DEFAULTS, KINDS, KIND_LABEL, KIND_SHORT, TBD,
    all, types, typeOf, configured, forType, forEquipment,
    isFallback, options, add, seedDefaults, usage, summary
  };
})();

if (typeof module !== 'undefined') module.exports = Causes;
