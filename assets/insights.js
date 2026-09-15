/* ============================================================
   insights.js — Smart Assist
   Finds patterns in work orders already closed. No language
   model: every line shown is a real work order you can open.
   ============================================================ */
const Insights = (() => {
  const STOP = new Set([
    'the','a','an','and','or','but','if','of','at','by','for','with','about',
    'to','from','in','on','is','was','are','were','be','been','being','it','its',
    'this','that','these','those','as','so','then','than','there','here','when',
    'we','i','he','she','they','you','our','their','his','her','my','me',
    'not','no','yes','do','did','does','done','has','have','had','will','would',
    'can','could','should','may','might','must','again','also','very','just',
    'due','per','via','after','before','during','while','up','down','out','off'
  ]);
  const SYNONYM = {
    leaking:'leak',leaks:'leak',leaked:'leak',
    broken:'break',broke:'break',breaking:'break',breakage:'break',
    replaced:'replace',replacing:'replace',replacement:'replace',
    worn:'wear',wearing:'wear',wornout:'wear',
    noisy:'noise',noises:'noise',
    overheated:'overheat',overheating:'overheat',hot:'overheat',
    jammed:'jam',jamming:'jam',jams:'jam',
    misaligned:'align',alignment:'align',aligned:'align',aligning:'align',
    loosened:'loose',loosening:'loose',looseness:'loose',
    vibrating:'vibration',vibrations:'vibration',vibrate:'vibration',
    failing:'fail',failed:'fail',failure:'fail',failures:'fail',
    cleaned:'clean',cleaning:'clean',
    adjusted:'adjust',adjusting:'adjust',adjustment:'adjust',
    inspected:'inspect',inspection:'inspect',inspecting:'inspect',
    lubricated:'lube',lubrication:'lube',lubricate:'lube',greased:'lube',grease:'lube',
    sensors:'sensor',photoeye:'sensor',photoeyes:'sensor',eye:'sensor',
    motors:'motor',pumps:'pump',valves:'valve',cylinders:'cylinder',
    bearings:'bearing',seals:'seal',sealed:'seal',
    welds:'weld',welding:'weld',welded:'weld',
    sonotrodes:'sonotrode',anvils:'anvil',
    bad:'defect',defects:'defect',defective:'defect',
    scrap:'defect',reject:'defect',rejects:'defect',
    pneumatic:'air',
    electrical:'electric',wiring:'electric',wire:'electric',
    hydraulics:'hydraulic',
    drifting:'drift',drifted:'drift'
  };
  function tokenize(text){
    return String(text||'').toLowerCase()
      .replace(/[^a-z0-9\s-]/g,' ').split(/[\s-]+/)
      .filter(w=>w.length>2&&!STOP.has(w)).map(w=>SYNONYM[w]||w);}
  function tokenSet(text){return new Set(tokenize(text));}
  function buildIdf(wos){
    const docFreq=new Map();
    wos.forEach(w=>{
      const seen=tokenSet((w.description||'')+' '+(w.notes||''));
      seen.forEach(t=>docFreq.set(t,(docFreq.get(t)||0)+1));});
    const n=Math.max(wos.length,1);
    return t=>Math.log((n+1)/((docFreq.get(t)||0)+1))+1;}
  function weightedOverlap(aSet,bSet,idf){
    let shared=0,total=0,best=0;
    aSet.forEach(t=>{const w=idf(t);total+=w;
      if(bSet.has(t)){shared+=w;if(w>best)best=w;}});
    return{ratio:total>0?shared/total:0,best};}
  /* Below MIN_CORPUS there is not enough history for word-rarity to
     mean anything, so judge on overlap alone. */
  const DISTINCTIVE=1.5, MIN_CORPUS=4;

  function similarRepairs(opts={}){
    const {assetId='',description='',cause='',excludeId='',limit=5}=opts;
    const done=DB.all('wos').filter(w=>DB.isDone(w)&&w.id!==excludeId&&(w.description||w.notes));
    if(!done.length)return[];
    const idf=buildIdf(DB.all('wos'));
    const canDiscriminate=done.length>=MIN_CORPUS;
    const qSet=tokenSet(description);
    const asset=DB.get('assets',assetId);
    const sameModel=asset&&asset.model
      ? new Set(DB.all('assets').filter(a=>a.id!==assetId&&a.model&&a.model===asset.model&&
          a.manufacturer===asset.manufacturer).map(a=>a.id))
      : new Set();
    const today=new Date();
    const scored=done.map(w=>{
      const wSet=tokenSet((w.description||'')+' '+(w.notes||''));
      const ov=qSet.size?weightedOverlap(qSet,wSet,idf):{ratio:0,best:0};
      const overlap=ov.ratio;
      let score=overlap*100;
      const reasons=[];
      const distinct=!canDiscriminate||ov.best>=DISTINCTIVE;
      if(overlap>0.15&&distinct)reasons.push('similar wording');
      if(w.assetId&&w.assetId===assetId){score+=45;reasons.push('same machine');}
      else if(sameModel.has(w.assetId)){score+=22;reasons.push('same model');}
      if(cause&&cause!=='To be determined'&&w.cause===cause){score+=30;reasons.push('same cause');}
      const when=w.dateCompleted||w.dateRequested;
      let ageDays=null;
      if(when){
        const d=new Date(when+'T00:00:00');
        if(!isNaN(d)){
          ageDays=Math.round((today-d)/86400000);
          if(ageDays<=30)score+=8;else if(ageDays<=180)score+=4;else if(ageDays>730)score-=6;}}
      if(w.notes&&w.notes.trim().length>15){score+=10;reasons.push('has notes');}
      return{wo:w,score,reasons,ageDays,overlap,bestShared:ov.best};});
    const described=qSet.size>0;
    const MIN_OVERLAP=0.10;
    return scored.filter(s=>{
      if(s.score<25)return false;
      if(!described)return true;
      const wordMatch=s.overlap>=MIN_OVERLAP&&(!canDiscriminate||s.bestShared>=DISTINCTIVE);
      const causeMatch=cause&&cause!=='To be determined'&&s.wo.cause===cause;
      return wordMatch||causeMatch;
    }).sort((a,b)=>b.score-a.score).slice(0,limit);}

  function repeatFailures(opts={}){
    const {windowDays=365,minCount=3}=opts;
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-windowDays);
    const groups=new Map();
    DB.all('wos').filter(DB.isDone).forEach(w=>{
      const cause=(w.cause||'').trim();
      if(!cause||cause==='To be determined'||cause==='Unknown')return;
      if(!w.assetId)return;
      const when=w.dateCompleted||w.dateRequested;
      if(when){const d=new Date(when+'T00:00:00');if(!isNaN(d)&&d<cutoff)return;}
      const key=w.assetId+'\u0000'+cause;
      if(!groups.has(key))groups.set(key,{assetId:w.assetId,cause,wos:[]});
      groups.get(key).wos.push(w);});
    const out=[];
    groups.forEach(g=>{
      if(g.wos.length<minCount)return;
      g.wos.sort((a,b)=>(b.dateCompleted||'').localeCompare(a.dateCompleted||''));
      const hours=g.wos.reduce((s,w)=>s+(DB.num(w.hours)||0),0);
      const cost=g.wos.reduce((s,w)=>s+(DB.num(w.cost)||0),0);
      const dates=g.wos.map(w=>w.dateCompleted||w.dateRequested).filter(Boolean)
        .map(d=>new Date(d+'T00:00:00')).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
      let avgGap=null;
      if(dates.length>=2){let total=0;
        for(let i=1;i<dates.length;i++)total+=(dates[i]-dates[i-1])/86400000;
        avgGap=Math.round(total/(dates.length-1));}
      out.push({assetId:g.assetId,cause:g.cause,count:g.wos.length,hours,cost,avgGap,wos:g.wos,
        last:g.wos[0].dateCompleted||g.wos[0].dateRequested||''});});
    return out.sort((a,b)=>b.count-a.count||b.hours-a.hours);}

  function assetHealth(assetId){
    const wos=DB.forAsset('wos',assetId);
    const done=wos.filter(DB.isDone);
    const hours=done.reduce((s,w)=>s+(DB.num(w.hours)||0),0);
    const cost=done.reduce((s,w)=>s+(DB.num(w.cost)||0),0);
    const causeCount=new Map();
    done.forEach(w=>{const c=(w.cause||'').trim();
      if(!c||c==='To be determined')return;
      causeCount.set(c,(causeCount.get(c)||0)+1);});
    const topCauses=Array.from(causeCount.entries()).map(([cause,count])=>({cause,count}))
      .sort((a,b)=>b.count-a.count);
    const dates=done.map(w=>w.dateCompleted).filter(Boolean)
      .map(d=>new Date(d+'T00:00:00')).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
    let meanGap=null;
    if(dates.length>=2){let total=0;
      for(let i=1;i<dates.length;i++)total+=(dates[i]-dates[i-1])/86400000;
      meanGap=Math.round(total/(dates.length-1));}
    const people=new Map();
    done.forEach(w=>{const p=(w.assignedTo||w.completedBy||'').trim();
      if(p)people.set(p,(people.get(p)||0)+1);});
    const topPeople=Array.from(people.entries()).map(([name,count])=>({name,count}))
      .sort((a,b)=>b.count-a.count).slice(0,3);
    const undocumented=done.filter(w=>!w.notes||w.notes.trim().length<15).length;
    return{total:done.length,open:wos.filter(DB.isActive).length,hours,cost,topCauses,
      meanGap,topPeople,undocumented,
      lastRepair:dates.length?dates[dates.length-1].toISOString().slice(0,10):''};}

  function dataQuality(){
    const done=DB.all('wos').filter(DB.isDone);
    const noCause=done.filter(w=>!w.cause||w.cause==='To be determined').length;
    const noNotes=done.filter(w=>!w.notes||w.notes.trim().length<15).length;
    const usable=done.filter(w=>w.cause&&w.cause!=='To be determined'&&
      w.notes&&w.notes.trim().length>=15).length;
    return{done:done.length,noCause,noNotes,usable,
      pct:done.length?Math.round((usable/done.length)*100):0};}

  function ago(days){
    if(days===null||days===undefined)return '';
    if(days<0)return 'in the future';
    if(days===0)return 'today';
    if(days===1)return 'yesterday';
    if(days<14)return days+' days ago';
    if(days<60)return Math.round(days/7)+' weeks ago';
    if(days<730)return Math.round(days/30)+' months ago';
    return Math.round(days/365)+' years ago';}

  return{similarRepairs,repeatFailures,assetHealth,dataQuality,ago,tokenize};
})();
if (typeof module !== 'undefined') module.exports = Insights;
