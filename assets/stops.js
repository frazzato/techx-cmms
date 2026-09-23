/* ============================================================
   stops.js — production loss (downtime and defects)
   ------------------------------------------------------------
   One record type, two categories. Both answer the same question:
   production was lost, for how long, and why.
     downtime — the machine itself stopped
     defect   — it ran but made bad parts

   A loss carries TWO costs: minutes and parts. Some defects cost
   little time but scrap a whole bin, and a report counting only
   minutes misses those entirely.

   Reasons come from Causes, which now scopes them plant-wide, by
   equipment type, or to named machines.

   TIME HANDLING: stored as plain local strings "YYYY-MM-DDTHH:MM",
   exactly as the clock on the wall reads. No UTC conversion — one
   plant, one timezone, and every timezone bug in an app like this
   comes from converting between local input and UTC storage.
   ============================================================ */
const Stops = (() => {
  const KINDS = {
    downtime:{label:'Downtime',sub:'The machine stopped',icon:'&#9888;'},
    defect:{label:'Defect',sub:'Bad parts produced',icon:'&#128683;'}};
  const WINDOWS = [7,30,60,90];
  /* Open records older than this are almost certainly forgotten
     rather than genuinely still running. Left uncounted they
     quietly destroy every total on the screen. */
  const STALE_HOURS = 24;

  function reasonsFor(kind,assetId){
    if(typeof Causes==='undefined')return[];
    return Causes.forEquipment(kind==='defect'?'defect':'downtime',assetId);}
  function reasonOptions(kind,assetId,current,opts){
    if(typeof Causes==='undefined')return[];
    return Causes.options(kind==='defect'?'defect':'downtime',assetId,current,opts||{});}

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

  /* assetIds accepts an array so a report can cover several chosen
     machines; assetId stays for the single-machine case. */
  function matchAssets(rows,opts){
    const one=String(opts.assetId||'').trim();
    const many=(opts.assetIds||[]).map(x=>String(x||'').trim()).filter(Boolean);
    if(many.length)return rows.filter(s=>many.includes(s.assetId));
    if(one)return rows.filter(s=>s.assetId===one);
    return rows;}

  function summary(opts={}){
    const {days=30,kind=''}=opts;
    /* Cut on the exact minute, not the calendar day — comparing only
       dates made "last 1 day" reach back as far as 48 hours. */
    const cutLocal=minutesAgo(days*24*60);
    let rows=all().filter(s=>(s.startedAt||'')>=cutLocal);
    rows=matchAssets(rows,opts);
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
    const parts=closed.reduce((s,r)=>s+partsOf(r),0);
    const defectParts=closed.filter(r=>r.kind==='defect').reduce((s,r)=>s+partsOf(r),0);
    const downParts=closed.filter(r=>r.kind!=='defect').reduce((s,r)=>s+partsOf(r),0);
    const defectEvents=closed.filter(r=>r.kind==='defect').length;
    const downEvents=closed.filter(r=>r.kind!=='defect').length;
    const documented=closed.filter(r=>r.fixedBy&&r.fixedBy.trim().length>=5).length;
    return{days,rows,closed,open:openRows,stale,
      count:rows.length,closedCount:closed.length,
      openCount:openRows.length,staleCount:stale.length,
      mins,downMins,defMins,hours:mins/60,
      cost:haveCost?money:null,
      parts,defectParts,downParts,defectEvents,downEvents,
      defectQty:defectParts,documented,
      docPct:closed.length?Math.round((documented/closed.length)*100):0};}

  /* Sorted by minutes, not count. Parts carried alongside so a
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

  /* Defect causes ranked by PARTS rather than minutes — for a defect
     the scrap count is the cost, and ranking by time would bury a
     five-minute fault that filled a bin. */
  function defectByReason(opts={}){
    const s=summary(Object.assign({},opts,{kind:'defect'}));
    const map=new Map();
    s.closed.forEach(r=>{
      const key=r.reason||'Not recorded';
      if(!map.has(key))map.set(key,{reason:key,count:0,parts:0,mins:0});
      const e=map.get(key);e.count++;e.parts+=partsOf(r);e.mins+=minutes(r)||0;});
    const out=Array.from(map.values()).sort((a,b)=>b.parts-a.parts||b.count-a.count);
    const total=out.reduce((t,e)=>t+e.parts,0);
    let run=0;
    out.forEach(e=>{
      e.pct=total?Math.round((e.parts/total)*100):0;
      run+=e.parts;
      e.cumPct=total?Math.round((run/total)*100):0;});
    return out;}

  function byAsset(opts={}){
    const s=summary(opts);
    const map=new Map();
    s.closed.forEach(r=>{
      if(!r.assetId)return;
      if(!map.has(r.assetId))map.set(r.assetId,
        {assetId:r.assetId,count:0,mins:0,down:0,defect:0,parts:0,
         defectParts:0,defectEvents:0,downEvents:0});
      const e=map.get(r.assetId);
      e.count++;
      const m=minutes(r)||0, q=partsOf(r);
      e.mins+=m;e.parts+=q;
      if(r.kind==='defect'){e.defect+=m;e.defectParts+=q;e.defectEvents++;}
      else{e.down+=m;e.downEvents++;}});
    return Array.from(map.values()).sort((a,b)=>b.mins-a.mins);}

  /* ---------- trend over time ----------
     One bucket per day, including days with nothing, so a gap in the
     chart reads as a quiet day rather than a missing bar. */
  function byDay(opts={}){
    const days=opts.days||30;
    const s=summary(opts);
    const buckets=new Map();
    const d=new Date();
    d.setHours(0,0,0,0);
    for(let i=days-1;i>=0;i--){
      const x=new Date(d);
      x.setDate(x.getDate()-i);
      const pad=n=>String(n).padStart(2,'0');
      const key=x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());
      buckets.set(key,{date:key,
        label:pad(x.getDate())+'/'+pad(x.getMonth()+1),
        mins:0,downMins:0,defMins:0,parts:0,events:0});}
    s.closed.forEach(r=>{
      const key=String(r.startedAt||'').slice(0,10);
      const b=buckets.get(key);
      if(!b)return;
      const m=minutes(r)||0;
      b.mins+=m;b.parts+=partsOf(r);b.events++;
      if(r.kind==='defect')b.defMins+=m;else b.downMins+=m;});
    return Array.from(buckets.values());}

  /* ---------- when it happens ----------
     Day of week × hour. A total tells you how much was lost; this
     tells you when, which is what exposes the start-up hour, the
     shift-handover gap, or the cell that only fails on nights.
     Rows are Monday-first because that is how a shift pattern reads. */
  function heatmap(opts={}){
    const metric=opts.metric||'mins';
    const s=summary(opts);
    const grid=[];
    for(let d=0;d<7;d++)grid.push(new Array(24).fill(0));
    s.closed.forEach(r=>{
      const dt=toDate(r.startedAt);
      if(!dt)return;
      /* getDay() is Sunday-first; shift so Monday is row 0. */
      const row=(dt.getDay()+6)%7;
      const hr=dt.getHours();
      const v=metric==='parts'?partsOf(r):metric==='events'?1:(minutes(r)||0);
      grid[row][hr]+=v;});
    return grid;}

  /* Which hour and which day hurt most — the words under the heatmap. */
  function peak(opts={}){
    const grid=heatmap(opts);
    const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    let best=null;
    const byHour=new Array(24).fill(0);
    const byDayTotal=new Array(7).fill(0);
    grid.forEach((row,d)=>row.forEach((v,h)=>{
      byHour[h]+=v;byDayTotal[d]+=v;
      if(v>0&&(!best||v>best.value))best={day:d,hour:h,value:v};}));
    const total=byHour.reduce((a,b)=>a+b,0);
    if(!total)return null;
    let topHour=0,topDay=0;
    byHour.forEach((v,i)=>{if(v>byHour[topHour])topHour=i;});
    byDayTotal.forEach((v,i)=>{if(v>byDayTotal[topDay])topDay=i;});
    return{cell:best,total,
      topHour,topHourValue:byHour[topHour],topHourPct:Math.round(byHour[topHour]/total*100),
      topDay,topDayName:DAYS[topDay],topDayValue:byDayTotal[topDay],
      topDayPct:Math.round(byDayTotal[topDay]/total*100),
      cellDayName:best?DAYS[best.day]:''};}

  function ranking(kindFilter,metric,opts={}){
    const windows=opts.windows||WINDOWS;
    const rank=new Map();
    windows.forEach(days=>{
      const s=summary(Object.assign({},opts,{days,kind:kindFilter}));
      s.closed.forEach(r=>{
        if(!r.assetId)return;
        if(!rank.has(r.assetId)){
          const row={assetId:r.assetId,w:{}};
          windows.forEach(d=>{row.w[d]={events:0,parts:0,mins:0};});
          rank.set(r.assetId,row);}
        const cell=rank.get(r.assetId).w[days];
        cell.events++;cell.parts+=partsOf(r);cell.mins+=minutes(r)||0;});});
    const longest=windows[windows.length-1];
    /* Ranked on the longest window so the order does not jump about
       when reading across the columns. */
    return Array.from(rank.values()).sort((a,b)=>
      (b.w[longest][metric]-a.w[longest][metric])||
      (b.w[longest].events-a.w[longest].events));}
  const defectRanking=opts=>ranking('defect','parts',opts);
  const downtimeRanking=opts=>ranking('downtime','mins',opts);

  function repeats(opts={}){
    const {days=365,minCount=3}=opts;
    const s=summary(Object.assign({},opts,{days}));
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
    summary,byReason,defectByReason,byAsset,byDay,heatmap,peak,
    defectRanking,downtimeRanking,repeats,lessons,exportRows,EXPORT_COLUMNS};
})();
if (typeof module !== 'undefined') module.exports = Stops;
