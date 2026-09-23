/* ============================================================
   causes.js — configurable cause lists
   ------------------------------------------------------------
   An admin sets up the reasons that appear in the dropdowns when
   somebody schedules work or logs a production loss.

   Three lists:
     downtime — why the machine stopped
     defect   — what kind of bad part it made
     failure  — cause of failure on a work order

   THREE SCOPES, which is the change here. A line can apply to:
     everything          scope 'all'
     an equipment TYPE   scope 'type'   — all welders
     NAMED equipment     scope 'assets' — these three machines
   Named equipment takes several at once, because a reason is
   usually specific to a handful of cells rather than to a whole
   category or to the entire plant.

   One record is one line in one list:
     { id, kind, scope, equipType, assetIds[], label, sort }

   OLDER RECORDS: before scopes existed a line had only equipType,
   with blank meaning plant-wide. scopeOf() infers the scope from
   whatever fields are present, so nothing already configured has
   to be re-entered.

   THE FALLBACK. If a machine ends up with no lines at all, the
   built-in list is used. Without that, clearing the lists — which
   an admin can now do deliberately — would leave every dropdown
   empty and nobody could log anything until the new list was
   finished. Setup stays optional and can be done a piece at a time.
   ============================================================ */

const Causes = (() => {

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

  const SCOPES = {
    all:    { label:'Every machine',      hint:'Appears everywhere, on top of anything more specific.' },
    type:   { label:'An equipment type',  hint:'Appears on every machine of that type.' },
    assets: { label:'Chosen machines',    hint:'Appears only on the machines you tick.' }
  };
  const SCOPE_ORDER = ['all','type','assets'];

  /* Work orders keep this as the "not yet known" option. Not
     configurable because closing a work order still on it is
     blocked, so the app has to know the exact string. */
  const TBD = 'To be determined';

  const all = () => DB.all('causes');

  const idsOf = c => {
    if (!c) return [];
    const raw = c.assetIds;
    const out = [];
    const push = v => { const s = String(v||'').trim(); if (s && !out.includes(s)) out.push(s); };
    if (Array.isArray(raw)) raw.forEach(push);
    else if (typeof raw === 'string') raw.split(/[;,|]/).forEach(push);
    return out;
  };

  /* Infer the scope so records written before scopes existed still
     resolve correctly. */
  function scopeOf(c){
    if (!c) return 'all';
    if (c.scope && SCOPES[c.scope]) return c.scope;
    if (idsOf(c).length) return 'assets';
    if (String(c.equipType||'').trim()) return 'type';
    return 'all';
  }

  function types(){
    const set = new Set();
    DB.all('assets').forEach(a => { if (a.type && String(a.type).trim()) set.add(String(a.type).trim()); });
    all().forEach(c => { if (c.equipType && String(c.equipType).trim()) set.add(String(c.equipType).trim()); });
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }

  const typeOf = assetId => {
    const a = DB.get('assets', assetId);
    return a && a.type ? String(a.type).trim() : '';
  };

  /* Does this line apply to this specific machine? */
  function applies(c, assetId){
    const scope = scopeOf(c);
    if (scope === 'all') return true;
    if (!assetId) return false;
    if (scope === 'assets') return idsOf(c).includes(assetId);
    const t = typeOf(assetId);
    return !!t && String(c.equipType||'').trim() === t;
  }

  function sortLines(list){
    return list.slice().sort((a,b)=>{
      const sa = DB.num(a.sort), sb = DB.num(b.sort);
      if (sa !== null && sb !== null && sa !== sb) return sa - sb;
      if (sa !== null && sb === null) return -1;
      if (sa === null && sb !== null) return 1;
      return String(a.label||'').localeCompare(String(b.label||''));
    });
  }

  const uniq = list => {
    const seen = new Set(), out = [];
    list.forEach(x => { const k = String(x).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  };

  /* Every configured line reaching one machine, most specific last
     so a machine-level reason sorts near its type-level ones. */
  function configuredFor(kind, assetId){
    const rows = all().filter(c => c.kind === kind && applies(c, assetId));
    const rank = { all:0, type:1, assets:2 };
    return uniq(sortLines(rows)
      .sort((a,b)=>rank[scopeOf(a)] - rank[scopeOf(b)])
      .map(c=>c.label).filter(Boolean));
  }

  /* The list to actually show. */
  function forEquipment(kind, assetId){
    const set = configuredFor(kind, assetId);
    return set.length ? set : (DEFAULTS[kind] || []).slice();
  }
  const isFallback = (kind, assetId) => configuredFor(kind, assetId).length === 0;

  /* Lines in one editing bucket — what the setup screen lists. */
  function linesIn(kind, scope, key){
    return sortLines(all().filter(c => {
      if (c.kind !== kind) return false;
      if (scopeOf(c) !== scope) return false;
      if (scope === 'type') return String(c.equipType||'').trim() === String(key||'').trim();
      if (scope === 'assets') return idsOf(c).includes(String(key||''));
      return true;
    }));
  }

  /* Options for a dropdown. An existing value no longer on the list
     is kept, so editing an old record never silently changes it. */
  function options(kind, assetId, currentValue, opts = {}){
    const list = forEquipment(kind, assetId);
    const out = [];
    if (opts.placeholder) out.push({ v:'', t: opts.placeholder });
    if (opts.tbd) out.push({ v: TBD, t: TBD });
    list.forEach(l => out.push({ v:l, t:l }));
    const cur = String(currentValue || '');
    if (cur && cur !== TBD && !out.some(o => o.v === cur))
      out.push({ v:cur, t: cur + ' (no longer on the list)' });
    return out;
  }

  /* ---------- editing ---------- */
  function add(opts = {}){
    const kind = KINDS.includes(opts.kind) ? opts.kind : 'downtime';
    const scope = SCOPES[opts.scope] ? opts.scope : 'all';
    const label = String(opts.label || '').trim();
    if (!label) return null;
    const equipType = scope === 'type' ? String(opts.equipType||'').trim() : '';
    const assetIds = scope === 'assets'
      ? (opts.assetIds||[]).map(x=>String(x||'').trim()).filter(Boolean)
                            .filter((v,i,a)=>a.indexOf(v)===i)
      : [];
    if (scope === 'type' && !equipType) return { needsType: true };
    if (scope === 'assets' && !assetIds.length) return { needsAssets: true };

    /* The same words twice in the same bucket helps nobody. */
    const dup = all().some(c => c.kind === kind && scopeOf(c) === scope &&
      String(c.label||'').trim().toLowerCase() === label.toLowerCase() &&
      (scope === 'type' ? String(c.equipType||'').trim() === equipType
       : scope === 'assets' ? idsOf(c).join(',') === assetIds.join(',')
       : true));
    if (dup) return { duplicate: true };

    return DB.upsert('causes', {
      id: DB.nextId('causes','CZ-',4),
      kind, scope, equipType, assetIds, label,
      sort: opts.sort === undefined || opts.sort === null || opts.sort === '' ? '' : String(opts.sort)
    });
  }

  function update(id, opts = {}){
    const c = DB.get('causes', id);
    if (!c) return null;
    const scope = SCOPES[opts.scope] ? opts.scope : scopeOf(c);
    const assetIds = scope === 'assets'
      ? (opts.assetIds||[]).map(x=>String(x||'').trim()).filter(Boolean)
                            .filter((v,i,a)=>a.indexOf(v)===i)
      : [];
    return DB.upsert('causes', {
      id,
      kind: KINDS.includes(opts.kind) ? opts.kind : c.kind,
      scope,
      equipType: scope === 'type' ? String(opts.equipType||'').trim() : '',
      assetIds,
      label: String(opts.label || c.label || '').trim(),
      sort: opts.sort === undefined ? (c.sort||'') : String(opts.sort||'')
    });
  }

  /* Copy the built-in list in as a starting point, skipping anything
     already in that bucket so it is safe to run twice. */
  function seedDefaults(kind, scope, key){
    const have = new Set(linesIn(kind, scope, key).map(c=>String(c.label||'').toLowerCase()));
    let n = 0;
    (DEFAULTS[kind] || []).forEach((label,i) => {
      if (have.has(label.toLowerCase())) return;
      DB.upsert('causes', {
        id: DB.nextId('causes','CZ-',4) + '-' + i,
        kind, scope,
        equipType: scope === 'type' ? String(key||'').trim() : '',
        assetIds: scope === 'assets' ? [String(key||'')] : [],
        label, sort: String((i+1)*10)
      });
      n++;
    });
    return n;
  }

  /* ---------- clearing ----------
     Deliberate, and always reported back so an admin can see what
     actually went. Records already written keep the words they were
     saved with — clearing a list changes what is OFFERED, never what
     is in the history. */
  function clearBucket(kind, scope, key){
    const rows = linesIn(kind, scope, key);
    rows.forEach(c => DB.remove('causes', c.id));
    return rows.length;
  }
  function clearKind(kind){
    const rows = all().filter(c => c.kind === kind);
    rows.forEach(c => DB.remove('causes', c.id));
    return rows.length;
  }
  function clearAll(){
    const rows = all();
    rows.forEach(c => DB.remove('causes', c.id));
    return rows.length;
  }

  /* How many records already use a line — shown before removing it. */
  function usage(kind, label){
    const l = String(label || '');
    if (!l) return 0;
    if (kind === 'failure') return DB.all('wos').filter(w => w.cause === l).length;
    return DB.all('stops').filter(s => s.kind === kind && s.reason === l).length;
  }

  /* What the setup screen shows at the bottom: every bucket that has
     lines, plus which machines are still on the built-in list. */
  function summary(){
    const rows = [];
    const t = types();
    KINDS.forEach(kind => {
      const allN = all().filter(c => c.kind===kind && scopeOf(c)==='all').length;
      if (allN) rows.push({ kind, scope:'all', key:'', label:'Every machine', count:allN });
      t.forEach(tp => {
        const n = linesIn(kind,'type',tp).length;
        if (n) rows.push({ kind, scope:'type', key:tp, label:tp, count:n });
      });
      const byAsset = new Map();
      all().filter(c=>c.kind===kind && scopeOf(c)==='assets').forEach(c=>{
        idsOf(c).forEach(id => byAsset.set(id,(byAsset.get(id)||0)+1));
      });
      byAsset.forEach((n,id)=>rows.push({
        kind, scope:'assets', key:id, label:DB.assetName(id), count:n }));
    });
    const assets = DB.all('assets');
    const onDefault = {};
    KINDS.forEach(k => {
      onDefault[k] = assets.filter(a => isFallback(k, a.id)).length;
    });
    return {
      rows, types: t, total: all().length,
      equipment: assets.length,
      untyped: assets.filter(a=>!a.type||!String(a.type).trim()).length,
      onDefault
    };
  }

  return {
    DEFAULTS, KINDS, KIND_LABEL, KIND_SHORT, SCOPES, SCOPE_ORDER, TBD,
    all, types, typeOf, idsOf, scopeOf, applies,
    configuredFor, forEquipment, isFallback, linesIn, options,
    add, update, seedDefaults, clearBucket, clearKind, clearAll,
    usage, summary
  };
})();

if (typeof module !== 'undefined') module.exports = Causes;
