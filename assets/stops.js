/* ============================================================
   stops.js — production loss (downtime and defects)
   ------------------------------------------------------------
   One record type, two categories. Both answer the same question:
   production was lost, for how long, and why.
     downtime — the machine itself stopped
     defect   — it ran but made bad parts

   A defect also carries a PARTS count, so a loss has two costs:
   time lost and parts lost. Some defects cost little time but
   scrap a whole bin, and a report that only counts minutes misses
   those entirely.

   The reason lists come from Causes, configured per equipment
   type by an admin, falling back to a built-in list.

   TIME HANDLING: stored as plain local strings "YYYY-MM-DDTHH:MM",
   exactly as the clock on the wall reads. No UTC conversion — one
   plant, one timezone, and every timezone bug in an app like this
   comes from converting between local input and UTC storage.
   ============================================================ */
const Stops = (() => {
  const KINDS = {
    downtime:{label:'Downtime',sub:'The machine stopped',icon:'&#9888;'},
    defect:{label:'Defect',sub:'Bad parts produced',icon:'&#128683;'}};

  /* The windows the reports offer. */
  const WINDOWS = [7,30,60,90];

  /* Open records older than this are almost certainly forgotten
     rather than genuinely still running. Left uncounted they
     quietly destroy every total on the screen. */
  const STALE_HOURS = 24;

  /* Reasons now live in Causes. These wrappers keep the rest of the
     app from caring where they came from. */
  function reasonsFor(kind,assetId){
    if(typeof Causes==='undefined')return[];
    return Causes.forEquipment(kind==='defect'?'defect':'downtime',assetId);}
  function reasonOptions(kind,assetId,current,opts){
    if(typeof Causes==='undefined')return[];
    const a=DB.get('assets',assetId);
    return Causes.options(kind==='defect'?'defect':'downtime',
      a&&a.type?a.type:'',current,opts||{});}

  function nowLocal(){
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+
      'T'+pad(d.getHours())+':'+pad(d.getMinutes());}
  function minutesAgo(n){
    const d=new Date(Date.now()-n*60000);
    const pad=x=>String(x).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+
      'T'+pad(d.getHours())+':'+pad(d.getMinutes());}
  function toDate(local){
    if(!local)return null;
    const m=String(local).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if(!m)return null;
    const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
    return isNaN(d)?null:d;}
  function minutes(stop){
    const a=toDate(stop.startedAt);
    if(!a)return null;
    const b=stop.endedAt?toDate(stop.endedAt):new Date();
    if(!b)return null;
    const mins=Math.round((b-a)/60000);
    return mins<0?0:mins;}
  const isOpen=s=>!s.endedAt;
  function isStale(s){
    if(!isOpen(s))return false;
    const m=minutes(s);
    return m!==null&&m>STALE_HOURS*60;}
  function fmtMins(mins){
    if(mins===null||mins===undefined)return '—';
    if(mins<1)return 'under a minute';
    if(mins<60)return mins+'m';
    const h=Math.floor(mins/60),m=mins%60;
    if(h<24)return m?h+'h '+m+'m':h+'h';
    const d=Math.floor(h/24),rh=h%24;
    return rh?d+'d '+rh+'h':d+'d';}
  const partsOf=s=>DB.num(s.qty)||0;
  /* Only computed when the equipment carries an hourly cost. A
     made-up rate is worse than no number. */
  function cost(stop){
    const a=DB.get('assets',stop.assetId);
    const rate=a?DB.num(a.hourlyCost):null;
    if(rate===null)return null;
    const m=minutes(stop);
    if(m===null)return null;
    return (m/60)*rate;}

  const all=()=>DB.all('stops');
  function open(){
    return all().filter(isOpen)
      .sort((a,b)=>(a.startedAt||'').localeCompare(b.startedAt||''));}
  function recent(limit=50){
    return all().slice()
      .sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))
      .slice(0,limit);}
  function forAsset(assetId){
    return all().filter(s=>s.assetId===assetId)
      .sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''));}

  function summary(opts={}){
    const {days=30,assetId='',kind=''}=opts;
    /* Cut on the exact minute, not the calendar day — comparing only
       dates made "last 1 day" reach back as far as 48 hours. */
    const cutLocal=minutesAgo(days*24*60);
    let rows=all().filter(s=>(s.startedAt||'')>=cutLocal);
    if(assetId)rows=rows.filter(s=>s.assetId===assetId);
    if(kind)rows=rows.filter(s=>s.kind===kind);
    /* Closed records only for totals. Open ones are still running and
       stale ones are untrustworthy — both reported separately. */
    const closed=rows.filter(s=>!isOpen(s));
    const openRows=rows.filter(isOpen);
    const stale=rows.filter(isStale);
    const mins=closed.reduce((s,r)=>s+(minutes(r)||0),0);
    const downMins=closed.filter(r=>r.kind==='downtime').reduce((s,r)=>s+(minutes(r)||0),0);
    const defMins=closed.filter(r=>r.kind==='defect').reduce((s,r)=>s+(minutes(r)||0),0);
    let money=0,haveCost=false;
    closed.forEach(r=>{const c=cost(r);if(c!==null){money+=c;haveCost=true;}});
    /* Parts lost is the other half of the cost. Counted on every
       record that carries a quantity, not only defects, because a
       jam can scrap parts too. */
    const parts=closed.reduce((s,r)=>s+partsOf(r),0);
    const defectParts=closed.filter(r=>r.kind==='defect').reduce((s,r)=>s+partsOf(r),0);
    const defectEvents=closed.filter(r=>r.kind==='defect').length;
    const documented=closed.filter(r=>r.fixedBy&&r.fixedBy.trim().length>=5).length;
    return{days,rows,closed,open:openRows,stale,
      count:rows.length,closedCount:closed.length,
      openCount:openRows.length,staleCount:stale.length,
      mins,downMins,defMins,hours:mins/60,
      cost:haveCost?money:null,
      parts,defectParts,defectEvents,defectQty:defectParts,documented,
      docPct:closed.length?Math.round((documented/closed.length)*100):0};}

  /* Sorted by minutes, not count. Twelve two-minute jams matter less
     than one six-hour electrical fault. Parts carried alongside so a
     high-scrap reason is visible even when it costs little time. */
  function byReason(opts={}){
    const s=summary(opts);
    const map=new Map();
    s.closed.forEach(r=>{
      const key=(r.kind||'downtime')+'\u0000'+(r.reason||'Not recorded');
      if(!map.has(key))map.set(key,{kind:r.kind,reason:r.reason||'Not recorded',count:0,mins:0,parts:0});
      const e=map.get(key);e.count++;e.mins+=minutes(r)||0;e.parts+=partsOf(r);});
    const out=Array.from(map.values()).sort((a,b)=>b.mins-a.mins);
    const total=out.reduce((t,e)=>t+e.mins,0);
    let running=0;
    out.forEach(e=>{
      e.pct=total?Math.round((e.mins/total)*100):0;
      running+=e.mins;
      e.cumPct=total?Math.round((running/total)*100):0;});
    return out;}

  function byAsset(opts={}){
    const s=summary(opts);
    const map=new Map();
    s.closed.forEach(r=>{
      if(!r.assetId)return;
      if(!map.has(r.assetId))map.set(r.assetId,
        {assetId:r.assetId,count:0,mins:0,down:0,defect:0,parts:0,defectEvents:0});
      const e=map.get(r.assetId);
      e.count++;
      const m=minutes(r)||0;
      e.mins+=m;
      e.parts+=partsOf(r);
      if(r.kind==='defect'){e.defect+=m;e.defectEvents++;}else e.down+=m;});
    return Array.from(map.values()).sort((a,b)=>b.mins-a.mins);}

  /* ---------- high defect machines ----------
     Every window at once — 7, 30, 60 and 90 days side by side. One
     window on its own cannot tell a machine that has always been bad
     from one that went bad last week, and that is the whole question
     when deciding what to look at next. */
  function defectRanking(opts={}){
    const windows=opts.windows||WINDOWS;
    const rank=new Map();
    windows.forEach(days=>{
      const s=summary({days,kind:'defect'});
      s.closed.forEach(r=>{
        if(!r.assetId)return;
        if(!rank.has(r.assetId)){
          const row={assetId:r.assetId,w:{}};
          windows.forEach(d=>{row.w[d]={events:0,parts:0,mins:0};});
          rank.set(r.assetId,row);}
        const cell=rank.get(r.assetId).w[days];
        cell.events++;
        cell.parts+=partsOf(r);
        cell.mins+=minutes(r)||0;});});
    const longest=windows[windows.length-1];
    return Array.from(rank.values())
      /* Ranked on the longest window so the order does not jump about
         when reading across; parts break the tie because scrap is the
         point of a defect report. */
      .sort((a,b)=>(b.w[longest].parts-a.w[longest].parts)||
                   (b.w[longest].events-a.w[longest].events)||
                   (b.w[longest].mins-a.w[longest].mins));}

  /* Same for downtime, so both halves of production loss can be
     read the same way. */
  function downtimeRanking(opts={}){
    const windows=opts.windows||WINDOWS;
    const rank=new Map();
    windows.forEach(days=>{
      const s=summary({days,kind:'downtime'});
      s.closed.forEach(r=>{
        if(!r.assetId)return;
        if(!rank.has(r.assetId)){
          const row={assetId:r.assetId,w:{}};
          windows.forEach(d=>{row.w[d]={events:0,parts:0,mins:0};});
          rank.set(r.assetId,row);}
        const cell=rank.get(r.assetId).w[days];
        cell.events++;
        cell.parts+=partsOf(r);
        cell.mins+=minutes(r)||0;});});
    const longest=windows[windows.length-1];
    return Array.from(rank.values())
      .sort((a,b)=>(b.w[longest].mins-a.w[longest].mins)||
                   (b.w[longest].events-a.w[longest].events));}

  function repeats(opts={}){
    const {days=365,minCount=3}=opts;
    const s=summary({days});
    const map=new Map();
    s.closed.forEach(r=>{
      if(!r.assetId||!r.reason)return;
      const key=r.assetId+'\u0000'+r.kind+'\u0000'+r.reason;
      if(!map.has(key))map.set(key,{assetId:r.assetId,kind:r.kind,reason:r.reason,stops:[]});
      map.get(key).stops.push(r);});
    const out=[];
    map.forEach(g=>{
      if(g.stops.length<minCount)return;
      g.stops.sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''));
      const mins=g.stops.reduce((t,r)=>t+(minutes(r)||0),0);
      const parts=g.stops.reduce((t,r)=>t+partsOf(r),0);
      let money=0,haveCost=false;
      g.stops.forEach(r=>{const c=cost(r);if(c!==null){money+=c;haveCost=true;}});
      out.push({assetId:g.assetId,kind:g.kind,reason:g.reason,
        count:g.stops.length,mins,parts,cost:haveCost?money:null,
        stops:g.stops,last:g.stops[0].startedAt||''});});
    return out.sort((a,b)=>b.mins-a.mins);}

  function lessons(opts={}){
    const {assetId='',kind='',reason='',limit=5}=opts;
    let rows=all().filter(s=>!isOpen(s)&&s.fixedBy&&s.fixedBy.trim().length>=5);
    if(assetId)rows=rows.filter(s=>s.assetId===assetId);
    if(kind)rows=rows.filter(s=>s.kind===kind);
    if(reason)rows=rows.filter(s=>s.reason===reason);
    return rows.sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||'')).slice(0,limit);}

  function exportRows(opts={}){
    const s=summary(Object.assign({days:3650},opts));
    const v=x=>(x===null||x===undefined)?'':String(x);
    return s.rows.sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))
      .map(r=>{
        const m=minutes(r);const c=cost(r);
        return{'Record':v(r.id),'Type':r.kind==='defect'?'Defect':'Downtime',
          'Equipment ID':v(r.assetId),'Equipment':v(DB.assetName(r.assetId)),
          'Equipment type':v((DB.get('assets',r.assetId)||{}).type),
          'Reason':v(r.reason),'Started':v(r.startedAt).replace('T',' '),
          'Ended':r.endedAt?v(r.endedAt).replace('T',' '):'',
          'Still open':isOpen(r)?'Yes':'No',
          'Minutes lost':m===null?'':String(m),'Duration':fmtMins(m),
          'Parts lost':r.qty===''||r.qty===undefined?'':String(partsOf(r)),
          'Cost':c===null?'':c.toFixed(2),
          'What happened':v(r.detail),'What fixed it':v(r.fixedBy),
          'Reported by':v(r.by),'Closed by':v(r.closedBy),'Work order':v(r.woId)};});}

  const EXPORT_COLUMNS=['Record','Type','Equipment ID','Equipment','Equipment type','Reason',
    'Started','Ended','Still open','Minutes lost','Duration','Parts lost','Cost',
    'What happened','What fixed it','Reported by','Closed by','Work order'];

  return{KINDS,WINDOWS,STALE_HOURS,reasonsFor,reasonOptions,
    nowLocal,minutesAgo,toDate,minutes,fmtMins,cost,partsOf,
    isOpen,isStale,all,open,recent,forAsset,
    summary,byReason,byAsset,defectRanking,downtimeRanking,
    repeats,lessons,exportRows,EXPORT_COLUMNS};
})();
if (typeof module !== 'undefined') module.exports = Stops;
