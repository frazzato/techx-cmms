/* ============================================================
   compliance.js — PM completion history and compliance
   Every completion writes one immutable record. daysLate is
   frozen at write time because the schedule can change later.
   ============================================================ */
const Compliance = (() => {
  const GRACE_DAYS = 2;
  function daysBetween(fromIso,toIso){
    if(!fromIso||!toIso)return null;
    const a=new Date(fromIso+'T00:00:00'),b=new Date(toIso+'T00:00:00');
    if(isNaN(a)||isNaN(b))return null;
    return Math.round((b-a)/86400000);}
  function buildLog(pm,opts={}){
    const doneDate=opts.doneDate||new Date().toISOString().slice(0,10);
    const dueDate=pm.nextDue||'';
    const late=dueDate?daysBetween(dueDate,doneDate):null;
    return{id:opts.id,pmId:pm.id,assetId:pm.assetId||'',
      description:pm.description||'',frequency:pm.frequency||'',
      dueDate,doneDate,daysLate:late===null?null:late,
      by:opts.by||'',hours:opts.hours||'',notes:opts.notes||'',woId:opts.woId||''};}
  const onTime=log=>log.daysLate===null||log.daysLate<=GRACE_DAYS;
  const logsFor=pmId=>DB.all('pmlogs').filter(l=>l.pmId===pmId)
    .sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
  const logsForAsset=assetId=>DB.all('pmlogs').filter(l=>l.assetId===assetId)
    .sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
  function summary(opts={}){
    const {days=90,assetId='',pmId='',person=''}=opts;
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
    const cutIso=cutoff.toISOString().slice(0,10);
    let logs=DB.all('pmlogs').filter(l=>(l.doneDate||'')>=cutIso);
    if(assetId)logs=logs.filter(l=>l.assetId===assetId);
    if(pmId)logs=logs.filter(l=>l.pmId===pmId);
    if(person)logs=logs.filter(l=>(l.by||'')===person);
    const done=logs.length;
    const late=logs.filter(l=>!onTime(l)).length;
    const hours=logs.reduce((s,l)=>s+(DB.num(l.hours)||0),0);
    const documented=logs.filter(l=>l.notes&&l.notes.trim().length>=10).length;
    const overdueNow=DB.all('pms').filter(p=>{
      if(assetId&&p.assetId!==assetId)return false;
      if(pmId&&p.id!==pmId)return false;
      const d=DB.daysUntil(p.nextDue);
      return d!==null&&d<-GRACE_DAYS;});
    return{days,done,late,onTime:done-late,
      pct:done?Math.round(((done-late)/done)*100):null,
      hours,documented,docPct:done?Math.round((documented/done)*100):0,
      overdueNow:overdueNow.length,overdueList:overdueNow,
      logs:logs.sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''))};}
  function pmRecord(pmId){
    const pm=DB.get('pms',pmId);
    const logs=logsFor(pmId);
    const late=logs.filter(l=>!onTime(l)).length;
    const hours=logs.reduce((s,l)=>s+(DB.num(l.hours)||0),0);
    const dates=logs.map(l=>l.doneDate).filter(Boolean)
      .map(d=>new Date(d+'T00:00:00')).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
    let actualInterval=null;
    if(dates.length>=2){let total=0;
      for(let i=1;i<dates.length;i++)total+=(dates[i]-dates[i-1])/86400000;
      actualInterval=Math.round(total/(dates.length-1));}
    const scheduled=pm?(DB.FREQ_DAYS[(pm.frequency||'').toLowerCase()]||null):null;
    return{pm,logs,count:logs.length,late,onTime:logs.length-late,
      pct:logs.length?Math.round(((logs.length-late)/logs.length)*100):null,
      hours,actualInterval,scheduled,
      drifting:actualInterval&&scheduled?actualInterval>scheduled*1.4:false,
      first:dates.length?dates[0].toISOString().slice(0,10):'',
      last:dates.length?dates[dates.length-1].toISOString().slice(0,10):''};}
  function byPerson(days=90){
    const s=summary({days});
    const map=new Map();
    s.logs.forEach(l=>{
      const name=(l.by||'').trim()||'Unrecorded';
      if(!map.has(name))map.set(name,{name,done:0,late:0,hours:0});
      const e=map.get(name);
      e.done++;
      if(!onTime(l))e.late++;
      e.hours+=DB.num(l.hours)||0;});
    return Array.from(map.values())
      .map(e=>Object.assign(e,{pct:e.done?Math.round(((e.done-e.late)/e.done)*100):0}))
      .sort((a,b)=>b.done-a.done);}
  function neverDone(){
    const seen=new Set(DB.all('pmlogs').map(l=>l.pmId));
    return DB.all('pms').filter(p=>!seen.has(p.id));}
  function exportRows(opts={}){
    const s=summary(Object.assign({days:3650},opts));
    const v=x=>(x===null||x===undefined)?'':String(x);
    return s.logs.map(l=>({
      'PM Number':v(l.pmId),'Equipment ID':v(l.assetId),
      'Equipment':v(DB.assetName(l.assetId)),'Task':v(l.description),
      'Frequency':v(l.frequency),'Due Date':v(l.dueDate),
      'Completed Date':v(l.doneDate),
      'Days Late':l.daysLate===null||l.daysLate===undefined?'':String(l.daysLate),
      'On Time':onTime(l)?'Yes':'No','Completed By':v(l.by),
      'Hours':v(l.hours),'Work Order':v(l.woId),'Notes':v(l.notes)}));}
  const EXPORT_COLUMNS=['PM Number','Equipment ID','Equipment','Task','Frequency','Due Date',
    'Completed Date','Days Late','On Time','Completed By','Hours','Work Order','Notes'];
  return{GRACE_DAYS,buildLog,onTime,logsFor,logsForAsset,
    summary,pmRecord,byPerson,neverDone,exportRows,EXPORT_COLUMNS,daysBetween};
})();
if (typeof module !== 'undefined') module.exports = Compliance;
