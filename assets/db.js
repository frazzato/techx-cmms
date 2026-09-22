/* ============================================================
   db.js — storage layer (cloud database + offline fallback)
   ------------------------------------------------------------
   NOTE ON NAMING: the user-facing word is "Equipment", but the
   stored collection is still "assets". Renaming the key would
   orphan every record already in the database, so the label
   changed and the storage did not.
   ============================================================ */
const DB = (() => {
  const KEY='techx.cmms.v1', TOKEN_KEY='techx.token', USER_KEY='techx.user',
        QUEUE_KEY='techx.queue', PEOPLE_KEY='techx.people', API='/api/data';
  const EMPTY={assets:[],pms:[],parts:[],wos:[],pmlogs:[],stops:[],
    meta:{site:'IAC Cottondale, AL',recentAssets:[]}};
  let cache=null,mode='local',lastRev=null,queue=[],onChange=null,lastError='',me=null,people=[];

  function loadLocal(){
    try{
      const raw=localStorage.getItem(KEY);
      cache=Object.assign({},structuredClone(EMPTY),raw?JSON.parse(raw):{});
      if(!cache.meta)cache.meta=structuredClone(EMPTY.meta);
      if(!Array.isArray(cache.meta.recentAssets))cache.meta.recentAssets=[];
      ['pmlogs','stops'].forEach(k=>{if(!Array.isArray(cache[k]))cache[k]=[];});
    }catch(e){cache=structuredClone(EMPTY);}
    return cache;}
  function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(cache));}catch(e){}}
  function load(){return cache||loadLocal();}

  const getToken=()=>{try{return localStorage.getItem(TOKEN_KEY)||'';}catch(e){return '';}};
  const setToken=t=>{try{localStorage.setItem(TOKEN_KEY,t);}catch(e){}};
  const clearToken=()=>{try{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);}catch(e){}};
  function setUser(u){me=u;try{localStorage.setItem(USER_KEY,JSON.stringify(u||null));}catch(e){}}
  function loadUser(){
    if(me)return me;
    try{me=JSON.parse(localStorage.getItem(USER_KEY)||'null');}catch(e){me=null;}
    return me;}
  const user=()=>loadUser();
  const getWho=()=>{const u=loadUser();return u?u.name:'';};
  const role=()=>{const u=loadUser();return u?u.role:'';};
  const isAdmin=()=>role()==='admin';
  function can(action){
    const r=role();
    if(!r)return false;
    if(r==='admin')return true;
    return ['view','createWO','editWO','completeWO','createPM','editPM','completePM',
      'createPart','editPart','countPart','createAsset','editAsset',
      'createStop','editStop','closeStop'].includes(action);}

  function loadPeople(){
    if(people.length)return people;
    try{people=JSON.parse(localStorage.getItem(PEOPLE_KEY)||'[]');}catch(e){people=[];}
    return people;}
  function setPeople(list){
    people=Array.isArray(list)?list:[];
    try{localStorage.setItem(PEOPLE_KEY,JSON.stringify(people));}catch(e){}}
  async function fetchPeople(){
    const r=await api('GET',null,'?people=1');
    setPeople(r.people||[]);
    return people;}
  function peopleNames(includeValue){
    const names=loadPeople().map(p=>p.full_name||p.name).filter(Boolean);
    if(includeValue&&!names.includes(includeValue))names.unshift(includeValue);
    return names;}

  function loadQueue(){try{queue=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');}catch(e){queue=[];}return queue;}
  function saveQueue(){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(queue));}catch(e){}}

  async function api(method,body,qs){
    let res;
    try{
      res=await fetch(API+(qs||''),{method,
        headers:{'Content-Type':'application/json','x-session':getToken()},
        body:body?JSON.stringify(body):undefined,cache:'no-store'});
    }catch(e){const err=new Error('No network connection to the server');err.offline=true;throw err;}
    /* Read as text first: a crashed function returns an HTML error page. */
    const text=await res.text();
    let payload=null;
    try{payload=text?JSON.parse(text):null;}catch(e){}
    if(res.status===401){const e=new Error((payload&&payload.error)||'Please sign in');e.auth=true;throw e;}
    if(res.status===403){const e=new Error((payload&&payload.error)||'Not allowed');e.forbidden=true;throw e;}
    if(res.status===409){const e=new Error((payload&&payload.error)||'Conflict');e.conflict=true;throw e;}
    if(!res.ok){
      if(payload&&payload.error)throw new Error(payload.error);
      const e=new Error('The server did not respond properly (HTTP '+res.status+
        '). Open /api/data?diag=1 to see what is wrong.');
      e.serverDown=true;throw e;}
    if(payload===null)throw new Error('The server sent an empty response');
    return payload;}

  async function diagnose(){
    const res=await fetch(API+'?diag=1',{cache:'no-store'});
    const text=await res.text();
    try{return JSON.parse(text);}
    catch(e){return{ok:false,error:'The API did not return JSON (HTTP '+res.status+
      '). The api/ folder is probably missing from the deployment.'};}}

  async function login(username,password){
    const r=await api('POST',{op:'login',username,password});
    setToken(r.token);setUser(r.user);return r.user;}
  async function logout(){
    try{await api('POST',{op:'logout'});}catch(e){}
    stopPolling();clearToken();me=null;mode='local';}
  const changePassword=(current,next)=>api('POST',{op:'changePassword',current,next});

  async function push(op){
    if(mode!=='cloud'){queue.push(op);saveQueue();return;}
    try{
      const r=await api('POST',op);
      if(r&&r.rev)lastRev=r.rev;
      lastError='';
    }catch(e){
      if(e.auth){mode='local';lastError='Signed out';}
      else if(e.forbidden||e.conflict){
        /* Refused on rules — never queue, it would fail forever. */
        lastError=e.message;
        try{await refresh();}catch(err){}
        if(typeof toast==='function')toast(e.message);
      }else{queue.push(op);saveQueue();mode='local';lastError=e.message;}
      if(onChange)onChange();}}

  async function flushQueue(){
    if(!queue.length)return{sent:0};
    const pending=queue.slice();queue=[];saveQueue();
    let sent=0;
    for(const op of pending){
      try{await api('POST',op);sent++;}
      catch(e){if(e.forbidden||e.conflict)continue;queue.push(op);saveQueue();throw e;}}
    return{sent};}

  async function connect(){
    if(!getToken()){mode='local';loadLocal();return{mode,reason:'not signed in'};}
    try{
      const data=await api('GET');
      if(data.user)setUser(data.user);
      applyServer(data);mode='cloud';lastError='';
      fetchPeople().catch(()=>{});
      const f=await flushQueue().catch(()=>({sent:0}));
      if(f.sent){const d2=await api('GET');applyServer(d2);}
      return{mode,flushed:f.sent};
    }catch(e){
      mode='local';lastError=e.message;loadLocal();
      return{mode,reason:e.message,auth:!!e.auth};}}

  function applyServer(data){
    const localMeta=(cache&&cache.meta)||{};
    cache={assets:data.assets||[],pms:data.pms||[],parts:data.parts||[],wos:data.wos||[],
      pmlogs:data.pmlogs||[],stops:data.stops||[],
      meta:Object.assign({},data.meta||{},{recentAssets:localMeta.recentAssets||[]})};
    lastRev=data.rev||lastRev;saveLocal();}

  async function refresh(){
    if(mode!=='cloud')return false;
    applyServer(await api('GET'));return true;}

  let pollTimer=null;
  function startPolling(seconds=15){
    stopPolling();
    pollTimer=setInterval(async()=>{
      if(mode!=='cloud'||document.hidden)return;
      try{
        const r=await api('GET',null,'?rev=1');
        if(r.rev&&r.rev!==lastRev){await refresh();if(onChange)onChange(true);}
      }catch(e){}},seconds*1000);}
  function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=null;}

  const listUsers=()=>api('GET',null,'?users=1');
  const addUser=u=>api('POST',Object.assign({op:'addUser'},u));
  const updateUser=u=>api('POST',Object.assign({op:'updateUser'},u));

  function nextId(collection,prefix,pad=4){
    const nums=(load()[collection]||[]).map(r=>String(r.id||''))
      .map(s=>parseInt(String(s).replace(/\D/g,''),10)).filter(n=>!isNaN(n));
    return prefix+String((nums.length?Math.max(...nums):1000)+1).padStart(pad,'0');}

  function all(c){return (load()[c]||[]).slice();}
  function get(c,id){return (load()[c]||[]).find(r=>r.id===id)||null;}

  function upsert(c,rec){
    const db=load();
    if(!db[c])db[c]=[];
    const i=db[c].findIndex(r=>r.id===rec.id);
    rec.updatedAt=new Date().toISOString();
    if(i>=0)db[c][i]=Object.assign({},db[c][i],rec);
    else{rec.createdAt=rec.updatedAt;db[c].push(rec);}
    saveLocal();
    const merged=db[c].find(r=>r.id===rec.id);
    push({op:'upsert',collection:c,record:merged});
    return merged;}

  function remove(c,id){
    const db=load();
    db[c]=(db[c]||[]).filter(r=>r.id!==id);
    saveLocal();
    push({op:'remove',collection:c,id});}

  function bulkUpsert(c,rows,keyField='id'){
    const db=load();
    if(!db[c])db[c]=[];
    let added=0,updated=0;const merged=[];
    rows.forEach(r=>{
      const i=db[c].findIndex(x=>x[keyField]&&x[keyField]===r[keyField]);
      if(i>=0){db[c][i]=Object.assign({},db[c][i],r);updated++;merged.push(db[c][i]);}
      else{db[c].push(r);added++;merged.push(r);}});
    saveLocal();
    push({op:'bulk',collection:c,records:merged});
    return{added,updated};}

  function replaceAll(obj){
    cache=Object.assign(structuredClone(EMPTY),obj);
    if(!Array.isArray(cache.meta.recentAssets))cache.meta.recentAssets=[];
    ['pmlogs','stops'].forEach(k=>{if(!Array.isArray(cache[k]))cache[k]=[];});
    saveLocal();}
  function reset(){cache=structuredClone(EMPTY);saveLocal();}
  function raw(){return load();}

  function saveMeta(){
    saveLocal();
    const m=Object.assign({},load().meta);
    delete m.recentAssets;
    push({op:'meta',meta:m});}

  async function seedServer(){
    const db=load();
    const meta=Object.assign({},db.meta);
    delete meta.recentAssets;
    const r=await api('POST',{op:'seed',
      payload:{assets:db.assets,pms:db.pms,parts:db.parts,wos:db.wos,
        pmlogs:db.pmlogs,stops:db.stops,meta}});
    await refresh();return r;}

  function touchAsset(id){
    const db=load();
    db.meta.recentAssets=[id].concat((db.meta.recentAssets||[]).filter(x=>x!==id)).slice(0,6);
    saveLocal();}

  const FREQ_DAYS={daily:1,weekly:7,biweekly:14,monthly:30,quarterly:91,semiannual:182,annually:365};
  function addDays(iso,days){
    const d=iso?new Date(iso+'T00:00:00'):new Date();
    d.setDate(d.getDate()+days);
    return d.toISOString().slice(0,10);}
  const bumpDue=pm=>addDays(pm.nextDue,FREQ_DAYS[(pm.frequency||'').toLowerCase()]||30);
  function daysUntil(iso){
    if(!iso)return null;
    const t=new Date();t.setHours(0,0,0,0);
    const d=new Date(iso+'T00:00:00');
    if(isNaN(d))return null;
    return Math.round((d-t)/86400000);}
  const assetName=id=>{const a=get('assets',id);return a?a.name:(id||'—');};
  function num(v){
    if(v===''||v===null||v===undefined)return null;
    const n=Number(v);return isNaN(n)?null:n;}
  function partStatus(p){
    const qty=num(p.qty),min=num(p.min);
    if(qty===null)return{label:'Not counted',cls:'c-prog'};
    if(min!==null&&qty<=min)return{label:'Low stock',cls:'c-crit'};
    return{label:'In stock',cls:'c-done'};}
  const isOpen=w=>['Open','On Hold'].includes(w.status||'Open');
  const isActive=w=>!['Completed','Cancelled'].includes(w.status||'Open');
  const isDone=w=>(w.status||'')==='Completed';
  const woDate=w=>w.dateDue||w.dateCompleted||w.dateRequested||'';
  const forAsset=(c,assetId)=>all(c).filter(r=>r.assetId===assetId);

  function status(){
    const u=loadUser();
    return{mode,lastRev,pending:queue.length,who:u?u.name:'',role:u?u.role:'',
      username:u?u.username:'',signedIn:!!getToken(),error:lastError,peopleCount:loadPeople().length};}

  return{all,get,upsert,remove,bulkUpsert,replaceAll,reset,raw,save:saveMeta,saveLocal,
    nextId,bumpDue,daysUntil,assetName,partStatus,num,addDays,
    touchAsset,forAsset,isOpen,isActive,isDone,woDate,FREQ_DAYS,
    connect,refresh,startPolling,stopPolling,seedServer,flushQueue,
    login,logout,changePassword,listUsers,addUser,updateUser,diagnose,
    fetchPeople,peopleNames,loadPeople,setPeople,
    status,user,getWho,role,isAdmin,can,loadQueue,setUser,clearToken,
    setOnChange(fn){onChange=fn;},api};
})();

const Backup={
  export(){
    const blob=new Blob([JSON.stringify(DB.raw(),null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='techx-cmms-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();URL.revokeObjectURL(a.href);
    if(typeof toast==='function')toast('Backup downloaded');},
  import(file,done){
    const r=new FileReader();
    r.onload=()=>{try{DB.replaceAll(JSON.parse(r.result));done(null);}catch(e){done(e);}};
    r.readAsText(file);}
};
