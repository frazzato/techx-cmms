/* ============================================================
   app.js — router + screens

   WORDING
   The plant calls these things:
     Schedule work   — work orders and PMs
     Production Loss — downtime and defects
   Those are the words on every button and menu item. The stored
   collections keep their old keys (wos, pms, stops) because
   renaming them would orphan every record already saved.

   ROLE-BASED VIEWS
   Maintenance sees the screens a technician needs on the floor;
   admin sees everything. The router enforces it, not the menu —
   hiding a nav item is cosmetic, anyone can type the address.
   ============================================================ */

const FREQS = ['daily','weekly','biweekly','monthly','quarterly','semiannual','annually'];
const WO_TYPES = ['Repair','Preventive','Improvement','Troubleshoot','Inspection'];
const WO_STATUS = ['Open','In Progress','On Hold','Completed','Cancelled'];
const PRIORITIES = ['High','Medium','Low'];
const ROLE_LABEL = { admin:'Admin', maintenance:'Maintenance' };
const LINK_HINT = 'Paste a SharePoint or web address. Opens in a new tab — the file stays where it lives.';

/* ---------- who sees what ---------- */
const VIEWS = {
  maintenance: [
    'home',        /* the launcher */
    'assets','asset',
    'work','wo','pm',   /* Schedule work — old routes still resolve */
    'stops',            /* Production Loss */
    'parts','smart','settings','login'
  ],
  admin: 'all'
};
function canView(name){
  const role=DB.role();
  if(!role)return name==='login';
  const allowed=VIEWS[role];
  if(allowed==='all'||!allowed)return true;
  return allowed.includes(name);}

let SEARCH='', WO_VIEW='list', WO_FILTER='all', PM_FILTER='all';
let CAL={y:new Date().getFullYear(),m:new Date().getMonth(),pms:true};
let USERS=[], SMART_Q='', SMART_ASSET='', COMP_DAYS=90, COMP_ASSET='';
let STOP_DAYS=30, STOP_KIND='', STOP_ASSET='';
let WORK_TAB='wo';
let CAUSE_KIND='downtime', CAUSE_TYPE='';

const ROUTES={home:renderHome,dashboard:renderDashboard,assets:renderAssets,asset:renderAssetDetail,
  work:renderWork,pm:renderWork,wo:renderWork,
  parts:renderParts,qr:renderQR,smart:renderSmart,compliance:renderCompliance,
  stops:renderStops,causes:renderCauses,
  import:renderImport,users:renderUsers,settings:renderSettings,login:renderLogin};

function route(){
  const hash=(location.hash||'#/home').replace('#/','');
  const parts=hash.split('/');
  const name=parts[0];
  const param=parts[1]?decodeURIComponent(parts[1]):null;
  const st=DB.status();
  if(name==='wo')WORK_TAB='wo';
  if(name==='pm')WORK_TAB='pm';
  if(!st.signedIn&&name!=='login'){
    document.getElementById('view').innerHTML=renderLogin();updateChrome();return;}
  /* The router is the gate. A hidden menu item is not security. */
  if(!canView(name)){
    document.getElementById('view').innerHTML=renderNoAccess(name);updateChrome();return;}
  const fn=ROUTES[name]||renderHome;
  const navFor=['work','wo','pm'].includes(name)?'work'
    :name==='asset'?'assets':name;
  document.querySelectorAll('.rail .nav').forEach(a=>
    a.classList.toggle('active',a.dataset.s===navFor));
  document.getElementById('view').innerHTML=fn(param);
  updateChrome();window.scrollTo(0,0);}
window.addEventListener('hashchange',route);

document.getElementById('globalSearch').addEventListener('input',e=>{
  SEARCH=e.target.value.toLowerCase().trim();
  const h=(location.hash||'').replace('#/','').split('/')[0];
  if(SEARCH&&!['assets','parts','work','wo','pm'].includes(h)){location.hash='#/assets';return;}
  route();});

function matches(obj,fields){
  if(!SEARCH)return true;
  return fields.some(f=>String(obj[f]??'').toLowerCase().includes(SEARCH));}
function openAsset(id){location.hash='#/asset/'+encodeURIComponent(id);}

function renderNoAccess(name){
  const label={users:'Users',import:'Import CSV',compliance:'PM Compliance',
    dashboard:'Dashboard',qr:'QR Tags',causes:'Cause Setup'}[name]||'That screen';
  return `<h1 class="page">Not available</h1>
    <p class="sub"><b>${esc(label)}</b> is not part of the maintenance view.</p>
    <div class="placeholder"><div style="font-size:30px">&#128274;</div>
      <b style="display:block;margin:10px 0 6px;color:var(--ink);font-size:16px">Admins only</b>
      <span>You are signed in as <b>${esc(DB.getWho())}</b> (${esc(ROLE_LABEL[DB.role()]||DB.role())}).<br>
      Ask an admin if you need this.</span>
      <div class="actions" style="justify-content:center"><a class="btn filled" href="#/home">Back to home</a></div>
    </div>`;}

function updateChrome(){
  document.querySelectorAll('.rail .nav').forEach(el=>{
    const s=el.dataset.s;
    el.style.display=(!s||canView(s))?'':'none';});
  const dot=document.getElementById('navStopDot');
  if(dot){
    const n=(typeof Stops!=='undefined')?Stops.open().length:0;
    dot.textContent=n?String(n):'';
    dot.style.display=n?'':'none';}
  const el=document.getElementById('connBadge');
  if(!el)return;
  const s=DB.status();
  if(!s.signedIn){el.className='connchip off';el.textContent='Signed out';return;}
  const tag=s.role==='admin'?' · Admin':'';
  if(s.mode==='cloud'){el.className='connchip on';el.textContent='● '+(s.who||'Live')+tag;}
  else{el.className='connchip warn';
    el.textContent=s.pending?'⚠ Offline · '+s.pending+' queued':'⚠ Offline';}}

/* ============================================================
   LOGIN
   ============================================================ */
function renderLogin(){
  return `<div class="loginwrap"><div class="card loginbox">
    <div class="mark big">TX</div>
    <h1>Tech X Maintenance</h1>
    <p class="sub">Sign in with your own account.</p>
    <label for="loginUser">Username</label>
    <input id="loginUser" autocomplete="username" placeholder="e.g. jdavis"
      onkeydown="if(event.key==='Enter')document.getElementById('loginPass').focus()"/>
    <label for="loginPass">Password</label>
    <input id="loginPass" type="password" autocomplete="current-password"
      onkeydown="if(event.key==='Enter')doLogin()"/>
    <div id="loginMsg"></div>
    <div class="actions">
      <button class="btn filled" onclick="doLogin()">Sign in</button>
      <button class="btn out" onclick="runDiagnostics()">Check server</button>
    </div>
    <div class="note">Every change you make is recorded under your name.</div>
  </div></div>`;}

function doLogin(){
  const u=(document.getElementById('loginUser')||{}).value||'';
  const p=(document.getElementById('loginPass')||{}).value||'';
  const msg=document.getElementById('loginMsg');
  if(!u.trim()||!p){
    if(msg)msg.innerHTML='<div class="note bad">Enter your username and password.</div>';return;}
  if(msg)msg.innerHTML='<div class="note">Signing in…</div>';
  DB.login(u.trim(),p).then(user=>
    DB.connect().then(r=>{
      if(r.mode==='cloud')DB.startPolling(15);
      location.hash='#/home';route();
      toast('Signed in as '+user.name);
      if(user.mustChange)setTimeout(()=>openChangePassword(true),400);})
  ).catch(e=>{
    if(!msg)return;
    if(e.serverDown||e.offline){
      msg.innerHTML=`<div class="note bad"><b>${esc(e.message)}</b><br><br>
        Click <b>Check server</b> below to see exactly what is missing.</div>`;
    }else{msg.innerHTML=`<div class="note bad">${esc(e.message||'Could not sign in')}</div>`;}});}

function runDiagnostics(){
  const msg=document.getElementById('loginMsg');
  if(msg)msg.innerHTML='<div class="note">Checking the server…</div>';
  DB.diagnose().then(d=>{
    if(!msg)return;
    const yes='<span style="color:var(--ok)">&#10003;</span>';
    const no='<span style="color:var(--bad)">&#10007;</span>';
    const row=(ok,label)=>`<div>${ok?yes:no} ${label}</div>`;
    let advice='';
    if(!d.hasDatabaseUrl)advice=`<b>DATABASE_URL is not set.</b> Add it in Vercel → Settings → Environment Variables, then <b>redeploy</b>.`;
    else if(d.driverLoads===false)advice=`<b>The database driver is missing.</b> Check the ROOT <span class="mono">package.json</span> lists <span class="mono">@neondatabase/serverless</span>, and that there is <b>no package.json inside api/</b>.`;
    else if(!d.databaseReachable)advice=`<b>The database refused the connection.</b>`;
    else if(!d.hasAdminPassword&&d.userCount===0)advice=`<b>No accounts exist yet.</b> Add the three <span class="mono">ADMIN_*</span> variables, then <b>redeploy</b>.`;
    else if(d.userCount===0)advice=`<b>Configured, but no account was created.</b> Redeploy once more.`;
    else if(d.ok)advice=`<b>Everything is working.</b> ${d.userCount} account${d.userCount===1?'':'s'} exist.`;
    const NAME={assets:'equipment',wos:'work orders',pms:'PMs',parts:'parts',
      stops:'production loss',pmlogs:'PM completions',causes:'cause lines'};
    let counts='';
    if(d.recordCounts){
      const keys=Object.keys(d.recordCounts);
      counts=keys.length
        ? `<div style="margin-top:10px"><b>Records in the shared database:</b><br>`+
          keys.map(k=>`${NAME[k]||k}: <b>${d.recordCounts[k]}</b>`).join(' · ')+`</div>`
        : `<div style="margin-top:10px"><b>The database is empty.</b> Nothing has been saved to the server yet.</div>`;}
    msg.innerHTML=`<div class="note ${d.ok?'':'bad'}">
      ${row(d.hasDatabaseUrl,'DATABASE_URL is set')}
      ${row(d.driverLoads,'Database driver loads')}
      ${row(d.databaseReachable,'Database reachable')}
      ${row(d.tablesReady,'Tables ready')}
      ${row(d.hasAdminUsername,'ADMIN_USERNAME is set')}
      ${row(d.hasAdminPassword,'ADMIN_PASSWORD is set')}
      ${d.userCount!=null?row(d.userCount>0,d.userCount+' account(s) exist'):''}
      ${counts}
      ${d.error?`<div style="margin-top:8px"><b>Error:</b> ${esc(d.error)}</div>`:''}
      ${advice?`<div style="margin-top:10px;line-height:1.7">${advice}</div>`:''}</div>`;
  }).catch(e=>{
    if(msg)msg.innerHTML=`<div class="note bad"><b>Could not reach the API at all.</b><br>
      ${esc(e.message)}</div>`;});}

function signOut(){
  confirmDelete('Sign out?',()=>{
    DB.logout().then(()=>{location.hash='#/login';route();toast('Signed out');});});}

function openChangePassword(forced){
  Modal.open({title:forced?'Set your own password':'Change password',
    body:`${forced?'<div class="note">Your account was created with a temporary password.</div>':''}
      ${F.text('current','Current password','',{type:'password',autocomplete:'current-password'})}
      ${F.text('next','New password','',{type:'password',autocomplete:'new-password'})}
      ${F.text('confirm','Repeat new password','',{type:'password',autocomplete:'new-password'})}
      <div id="pwMsg"></div>
      <div class="note">At least 6 characters. Changing this signs you out on other devices.</div>`,
    footer:`<button class="btn filled" onclick="doChangePassword()">Save password</button>
      <button class="btn out" onclick="Modal.close()">${forced?'Later':'Cancel'}</button>`});}

function doChangePassword(){
  const d=F.read();
  const msg=document.getElementById('pwMsg');
  const show=t=>{if(msg)msg.innerHTML=`<div class="note bad">${esc(t)}</div>`;};
  if(!d.current)return show('Enter your current password.');
  if((d.next||'').length<6)return show('New password must be at least 6 characters.');
  if(d.next!==d.confirm)return show('The two new passwords do not match.');
  DB.changePassword(d.current,d.next)
    .then(()=>{Modal.close();toast('Password changed');})
    .catch(e=>show(e.message||'Could not change password'));}

/* ============================================================
   THE TWO ENTRY POINTS
   ------------------------------------------------------------
   "Schedule work" and "Production Loss" — the same pair of words
   on the home buttons, the sidebar and these dialogs.
   ============================================================ */
function openWorkChooser(presetAsset){
  const a=presetAsset?`'${jsq(presetAsset)}'`:'';
  Modal.open({
    title:'What do you need to schedule?',
    body:`<div class="chooser">
      <button class="choice" onclick="Modal.close();editWO(null,${a})">
        <div class="choice-ic ic-wo">&#129534;</div>
        <div class="choice-txt"><b>Work Order</b>
          <span>Something broke, needs fixing, or needs looking at</span></div>
      </button>
      <button class="choice" onclick="Modal.close();editPM(null,${a})">
        <div class="choice-ic ic-pm">&#128197;</div>
        <div class="choice-txt"><b>Preventive Maintenance</b>
          <span>A scheduled job that repeats on a frequency</span></div>
      </button>
    </div>
    <div class="note">A work order happens once. A PM comes back every week,
    month or quarter and builds a compliance record.</div>`,
    footer:`<button class="btn out" onclick="Modal.close()">Cancel</button>`});}

function openStopChooser(presetAsset){
  const a=presetAsset?`'${jsq(presetAsset)}'`:'';
  Modal.open({
    title:'What was lost?',
    body:`<div class="chooser">
      <button class="choice" onclick="Modal.close();reportStop('downtime',${a})">
        <div class="choice-ic ic-down">&#9888;</div>
        <div class="choice-txt"><b>Downtime</b>
          <span>The machine stopped — a fault, a jam, waiting on something</span></div>
      </button>
      <button class="choice" onclick="Modal.close();reportStop('defect',${a})">
        <div class="choice-ic ic-def">&#128683;</div>
        <div class="choice-txt"><b>Defect</b>
          <span>The machine ran but produced bad parts</span></div>
      </button>
    </div>
    <div class="note">Both record time lost. A defect also records how many
    parts were scrapped — a short stoppage can still cost a full bin.</div>`,
    footer:`<button class="btn out" onclick="Modal.close()">Cancel</button>`});}

function bigActions(presetAsset){
  const a=presetAsset?`'${jsq(presetAsset)}'`:'';
  return `<div class="bigactions">
    <button class="bigaction" onclick="openWorkChooser(${a})">
      <div class="ba-ic">&#128736;</div>
      <div class="ba-txt"><b>Schedule work</b><span>Work order or PM</span></div>
    </button>
    <button class="bigaction bad" onclick="openStopChooser(${a})">
      <div class="ba-ic">&#9888;</div>
      <div class="ba-txt"><b>Production Loss</b><span>Downtime or defect</span></div>
    </button>
  </div>`;}

/* ============================================================
   SCHEDULE WORK — work orders and PM on one screen
   ------------------------------------------------------------
   No big buttons here. This screen IS the schedule-work screen,
   so a second button saying the same thing is noise. Each tab
   carries its own create button instead, which is one tap rather
   than two.
   ============================================================ */
function setWorkTab(tab){
  WORK_TAB=tab;
  const want='#/'+(tab==='pm'?'pm':'wo');
  if(location.hash!==want){location.hash=want;return;}
  route();}

function renderWork(){
  const wos=DB.all('wos');
  const pms=DB.all('pms');
  const openN=wos.filter(DB.isOpen).length;
  const overdueN=pms.filter(p=>(DB.daysUntil(p.nextDue)??99)<0).length;
  return `
  <h1 class="page">Schedule Work</h1>
  <p class="sub">Work orders and preventive maintenance.</p>
  <div class="worktabs">
    <button class="worktab ${WORK_TAB==='wo'?'on':''}" onclick="setWorkTab('wo')">
      <span class="wt-ic">&#129534;</span>
      <span class="wt-txt"><b>Work Orders</b><span>${openN} pending</span></span>
    </button>
    <button class="worktab ${WORK_TAB==='pm'?'on':''}" onclick="setWorkTab('pm')">
      <span class="wt-ic">&#128197;</span>
      <span class="wt-txt"><b>PM Plan</b><span>${pms.length} scheduled${overdueN?' · '+overdueN+' overdue':''}</span></span>
    </button>
  </div>
  ${WORK_TAB==='pm'?renderPMBody():renderWOBody()}`;}

function setWOView(v){WO_VIEW=v;route();}
function setWOFilter(f){WO_FILTER=f;WORK_TAB='wo';route();}

function renderWOBody(){
  let rows=DB.all('wos').filter(w=>matches(w,['id','description','assetId','assignedTo','requestedBy','status']));
  const all=rows.slice();
  const meName=DB.getWho();
  if(WO_FILTER==='open')rows=rows.filter(DB.isOpen);
  else if(WO_FILTER==='progress')rows=rows.filter(w=>w.status==='In Progress');
  else if(WO_FILTER==='done')rows=rows.filter(DB.isDone);
  else if(WO_FILTER==='mine')rows=rows.filter(w=>DB.isActive(w)&&(w.assignedTo||'')===meName);
  else if(WO_FILTER==='unassigned')rows=rows.filter(w=>DB.isActive(w)&&!w.assignedTo);
  rows.sort((a,b)=>(DB.woDate(b)||'').localeCompare(DB.woDate(a)||''));
  const openN=all.filter(DB.isOpen).length;
  const progN=all.filter(w=>w.status==='In Progress').length;
  const mineN=all.filter(w=>DB.isActive(w)&&(w.assignedTo||'')===meName).length;
  const unassignedN=all.filter(w=>DB.isActive(w)&&!w.assignedTo).length;
  const hours=all.filter(DB.isDone).reduce((s,w)=>s+(DB.num(w.hours)||0),0);
  const title={all:'All work orders',mine:'Assigned to you',open:'Pending',
    progress:'In progress',done:'Completed',unassigned:'Nobody assigned'}[WO_FILTER];
  return `
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat click" onclick="setWOFilter('mine')"><div class="n">${mineN}</div><div class="l">Assigned to you</div></div>
    <div class="stat click" onclick="setWOFilter('open')"><div class="n">${openN}</div><div class="l">Pending</div></div>
    <div class="stat click" onclick="setWOFilter('progress')"><div class="n">${progN}</div><div class="l">In progress</div></div>
    <div class="stat click" onclick="setWOFilter('unassigned')"><div class="n" style="color:${unassignedN?'var(--bad)':'inherit'}">${unassignedN}</div><div class="l">Nobody assigned</div></div>
  </div>
  <div class="chipset">
    <button class="btn filled" onclick="editWO()">&#43; New work order</button>
    <div class="vtog">
      <button class="${WO_VIEW==='list'?'on':''}" onclick="setWOView('list')">&#9776; List</button>
      <button class="${WO_VIEW==='calendar'?'on':''}" onclick="setWOView('calendar')">&#128197; Calendar</button>
    </div>
    ${WO_VIEW==='list'?`
      <button class="fchip ${WO_FILTER==='all'?'on':''}" onclick="setWOFilter('all')">All</button>
      <button class="fchip ${WO_FILTER==='mine'?'on':''}" onclick="setWOFilter('mine')">Mine</button>
      <button class="fchip ${WO_FILTER==='open'?'on':''}" onclick="setWOFilter('open')">Pending</button>
      <button class="fchip ${WO_FILTER==='unassigned'?'on':''}" onclick="setWOFilter('unassigned')">Unassigned</button>
      <button class="fchip ${WO_FILTER==='done'?'on':''}" onclick="setWOFilter('done')">Completed</button>`:''}
    <button class="btn out" onclick="exportCSV('wos')">Export CSV</button>
    <span style="color:var(--muted);font-size:12.5px;margin-left:auto">${all.length} on record · ${hours.toFixed(1)}h logged</span>
  </div>
  ${WO_VIEW==='calendar'?renderWOCalendar():`
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">${esc(title)}</h3>
    ${renderTable([
      {label:'WO',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.docUrl,'Reference document')}<br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}${r.pmId?' · from '+esc(r.pmId):''}${r.stopId?' · from '+esc(r.stopId):''}</small>`},
      {label:'Type',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.type||'—')}</span>`},
      {label:'Priority',render:r=>prioChip(r.priority)},
      {label:'Assigned to',render:r=>r.assignedTo
        ?(r.assignedTo===meName?`<b>${esc(r.assignedTo)}</b>`:esc(r.assignedTo))
        :'<span class="chip c-crit">Nobody</span>'},
      {label:'Scheduled',hideSm:true,render:r=>fmtDate(r.dateDue||r.dateRequested)},
      {label:'Status',render:r=>statusChip(r.status)}
    ],rows,{empty:'No work orders in this view.',onRow:'editWO'})}
  </div>`}`;}

function setPMFilter(f){PM_FILTER=f;WORK_TAB='pm';route();}

function renderPMBody(){
  let rows=DB.all('pms').filter(p=>matches(p,['id','description','assetId','frequency','tech']));
  const all=rows.slice();
  const meName=DB.getWho();
  const never=new Set(Compliance.neverDone().map(p=>p.id));
  if(PM_FILTER==='mine')rows=rows.filter(r=>(r.tech||'')===meName);
  else if(PM_FILTER==='unassigned')rows=rows.filter(r=>!r.tech);
  else if(PM_FILTER==='overdue')rows=rows.filter(r=>(DB.daysUntil(r.nextDue)??99)<0);
  else if(PM_FILTER==='never')rows=rows.filter(r=>never.has(r.id));
  rows.sort((a,b)=>(a.nextDue||'9999').localeCompare(b.nextDue||'9999'));
  const overdue=all.filter(r=>(DB.daysUntil(r.nextDue)??99)<0).length;
  const mine=all.filter(r=>(r.tech||'')===meName).length;
  const comp=Compliance.summary({days:90});
  const showComp=canView('compliance');
  return `
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat click" onclick="setPMFilter('all')"><div class="n">${all.length}</div><div class="l">Scheduled PMs</div></div>
    <div class="stat click" onclick="setPMFilter('overdue')"><div class="n" style="color:${overdue?'var(--bad)':'inherit'}">${overdue}</div><div class="l">Overdue</div></div>
    <div class="stat click" onclick="setPMFilter('mine')"><div class="n">${mine}</div><div class="l">Assigned to you</div></div>
    <div class="stat click" onclick="setPMFilter('never')"><div class="n" style="color:${never.size?'var(--bad)':'var(--ok)'}">${never.size}</div><div class="l">Never completed</div></div>
  </div>
  <div class="chipset">
    <button class="btn filled" onclick="editPM()">&#43; New PM</button>
    ${showComp?'<a class="btn tonal" href="#/compliance">&#9989; Compliance record</a>':''}
    <button class="fchip ${PM_FILTER==='all'?'on':''}" onclick="setPMFilter('all')">All</button>
    <button class="fchip ${PM_FILTER==='mine'?'on':''}" onclick="setPMFilter('mine')">Mine</button>
    <button class="fchip ${PM_FILTER==='overdue'?'on':''}" onclick="setPMFilter('overdue')">Overdue</button>
    <button class="fchip ${PM_FILTER==='never'?'on':''}" onclick="setPMFilter('never')">Never done</button>
    <button class="fchip ${PM_FILTER==='unassigned'?'on':''}" onclick="setPMFilter('unassigned')">Unassigned</button>
    <button class="btn out" onclick="exportCSV('pms')">Export CSV</button>
    ${showComp?`<span style="color:var(--muted);font-size:12.5px;margin-left:auto">
      <a href="#/compliance">${comp.pct===null?'no':comp.pct+'%'} on-time over 90 days</a></span>`:''}
  </div>
  ${never.size&&PM_FILTER==='all'?`<div class="note bad">
    <b>${never.size} PM${never.size===1?' has':'s have'} never been marked complete.</b>
    <a href="#" onclick="setPMFilter('never');return false;">Show them</a>.</div>`:''}
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">${PM_FILTER==='all'?'Schedule':PM_FILTER==='mine'?'Your PMs':PM_FILTER==='overdue'?'Overdue':PM_FILTER==='never'?'Never completed':'Nobody responsible'}</h3>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.procedureUrl,'Procedure attached')}<br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Frequency',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.frequency||'—')}</span>`},
      {label:'Next due',render:r=>dueChip(r.nextDue)},
      {label:'History',render:r=>{
        const logs=Compliance.logsFor(r.id);
        if(!logs.length)return '<span class="chip c-crit">never</span>';
        const late=logs.filter(l=>!Compliance.onTime(l)).length;
        const pct=Math.round(((logs.length-late)/logs.length)*100);
        return `<b>${logs.length}×</b> <span style="color:${pct>=90?'var(--ok)':pct>=70?'var(--warn)':'var(--bad)'};font-size:12px">${pct}%</span>`;}},
      {label:'Responsible',hideSm:true,render:r=>r.tech
        ?(r.tech===meName?`<b>${esc(r.tech)}</b>`:esc(r.tech))
        :'<span class="chip c-crit">Nobody</span>'},
      {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Mark done</button>
        <button class="btn out sm" onclick="event.stopPropagation();genWO('${jsq(r.id)}')">Generate WO</button>`}
    ],rows,{empty:'Nothing in this view.',onRow:'showPMHistory'})}
    <div class="note">Click any row to see its full completion history.</div>
  </div>`;}

/* ============================================================
   PRODUCTION LOSS — reporting and closing
   ============================================================ */
const STOP_QUICK = [
  { mins: 0,   label: 'Just now' },
  { mins: 15,  label: '15 min ago' },
  { mins: 30,  label: '30 min ago' },
  { mins: 60,  label: '1 hour ago' },
  { mins: 120, label: '2 hours ago' }
];

function stopQuickTime(mins){
  const el=document.getElementById('f_startedAt');
  if(el)el.value=mins===0?Stops.nowLocal():Stops.minutesAgo(mins);
  document.querySelectorAll('.quicktime .fchip').forEach(b=>b.classList.remove('on'));
  const btn=document.getElementById('qt'+mins);
  if(btn)btn.classList.add('on');
  refreshStopLessons();}

/* Reasons depend on which machine was picked, because they are
   configured per equipment type. Changing the machine has to
   rebuild the reason list or it would offer another type's. */
function refreshStopReasons(kind){
  const box=document.getElementById('reasonBox');
  if(!box)return;
  const d=F.read();
  const label=kind==='defect'?'What kind of defect?':'Why did it stop?';
  box.innerHTML=F.select('reason',label,d.reason||'',
    Stops.reasonOptions(kind,d.assetId||'','',{placeholder:'— choose —'}),
    {required:true,onchange:'refreshStopLessons()'});
  const a=DB.get('assets',d.assetId||'');
  const hint=document.getElementById('reasonHint');
  if(hint){
    if(!d.assetId)hint.innerHTML='';
    else if(!a||!a.type)hint.innerHTML=
      `<div class="hint">This equipment has no type set, so the standard list is showing.</div>`;
    else if(typeof Causes!=='undefined'&&Causes.isFallback(kind==='defect'?'defect':'downtime',a.type))
      hint.innerHTML=`<div class="hint">No list set up for <b>${esc(a.type)}</b> yet — showing the standard one.</div>`;
    else hint.innerHTML=`<div class="hint">List for <b>${esc(a.type)}</b>.</div>`;}
  refreshStopLessons();}

function refreshStopLessons(){
  const box=document.getElementById('stopLessons');
  if(!box)return;
  const d=F.read();
  const hits=Insights.similarStops({
    assetId:d.assetId||'', reason:d.reason||'', description:d.detail||'', limit:3});
  box.innerHTML=hits.length?`<div class="seenbefore">
    <div class="seen-hd">&#128161; Fixed before — ${hits.length} time${hits.length===1?'':'s'}</div>
    ${hits.map(stopCard).join('')}</div>`:'';}

function reportStop(kind,presetAsset){
  const k=Stops.KINDS[kind]||Stops.KINDS.downtime;
  const isDefect=kind==='defect';
  Modal.open({
    title:k.label+' — what happened?',
    body:`
      ${F.select('assetId','Equipment',presetAsset||'',assetOptions(),
        {required:true,onchange:`refreshStopReasons('${jsq(kind)}')`})}
      <label class="req">When did it start?</label>
      <div class="quicktime">
        ${STOP_QUICK.map(q=>`<button type="button" id="qt${q.mins}"
          class="fchip ${q.mins===0?'on':''}" onclick="stopQuickTime(${q.mins})">${q.label}</button>`).join('')}
      </div>
      ${F.datetime('startedAt','',Stops.nowLocal(),
        {hint:'Adjust if it actually started at another time.'})}
      <div id="reasonBox">${F.select('reason',
        isDefect?'What kind of defect?':'Why did it stop?','',
        Stops.reasonOptions(kind,presetAsset||'','',{placeholder:'— choose —'}),
        {required:true,onchange:'refreshStopLessons()'})}</div>
      <div id="reasonHint"></div>
      ${F.num('qty',isDefect?'How many parts scrapped':'Parts lost (if any)','',
        {step:'1',placeholder:'e.g. 12',
         hint:isDefect?'Parts lost is counted alongside time lost in every report.':''})}
      ${F.area('detail','What happened',"",2,
        {placeholder:isDefect
          ? 'e.g. Weld pull tests failing on station 2, parts going to scrap.'
          : 'e.g. Machine faulted and will not reset, drive shows an alarm.',
         oninput:'refreshStopLessons()'})}
      <div id="stopLessons"></div>
      ${F.person('by','Reported by',DB.getWho(),{emptyLabel:'— not recorded —'})}
      <div class="note">Save this now and get back to the machine. Close it
      with <b>Running again</b> when production restarts — that is when you
      record what fixed it.</div>`,
    footer:`<button class="btn bad" onclick="saveStop('${jsq(kind)}')">${k.icon} Log ${k.label.toLowerCase()}</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>`});
  setTimeout(()=>refreshStopReasons(kind),120);}

function saveStop(kind){
  const d=F.read();
  if(!d.assetId){toast('Pick which equipment stopped');return;}
  if(!d.reason){toast('Choose a reason — it is what makes the data worth collecting');return;}
  if(!d.startedAt){toast('Enter when it started');return;}
  /* A start time in the future is a typo, and it would produce a
     negative duration that quietly corrupts every total. */
  if(d.startedAt>Stops.nowLocal()){
    toast('That start time is in the future — check it');return;}
  const qty=DB.num(d.qty);
  if(d.qty&&(qty===null||qty<0)){toast('Parts lost must be a number');return;}
  const rec={
    id:DB.nextId('stops','EV-',5),
    kind:kind==='defect'?'defect':'downtime',
    assetId:d.assetId, reason:d.reason,
    startedAt:d.startedAt, endedAt:'',
    qty:d.qty||'', detail:d.detail||'',
    by:d.by||DB.getWho(), fixedBy:'', woId:''};
  DB.upsert('stops',rec);
  Modal.close();route();
  toast(rec.id+' logged — close it when the machine runs again');}

function closeStop(id){
  const s=DB.get('stops',id);
  if(!s){toast('That record no longer exists');route();return;}
  if(!Stops.isOpen(s)){toast('That one is already closed');return;}
  const k=Stops.KINDS[s.kind]||Stops.KINDS.downtime;
  const running=Stops.minutes(s);
  Modal.open({
    title:'Running again — '+s.id,
    body:`
      <div class="pmhead">
        <div class="pmhead-task">${esc(DB.assetName(s.assetId))} · ${esc(s.reason||'')}</div>
        <div class="pmhead-meta">${k.label} · started ${fmtLocal(s.startedAt)} ·
          <b>down ${Stops.fmtMins(running)}</b> so far</div>
      </div>
      ${s.detail?`<div class="note">${esc(s.detail)}</div>`:''}
      ${F.datetime('endedAt','When did it start running again?',Stops.nowLocal(),{required:true})}
      ${F.num('qty','Parts lost',s.qty,{step:'1',
        hint:'Update this if the final count is different from the first estimate.'})}
      ${F.area('fixedBy','What got it running?','',3,
        {required:true,
         placeholder:'e.g. Reset the drive and reseated the encoder plug. Ran fine after.',
         hint:'This single line is the whole point. Next time this happens, this is what the person standing at the machine will read.'})}
      ${F.person('closedBy','Closed by',DB.getWho(),{emptyLabel:'— not recorded —'})}
      <div class="note">Raise a work order too if this needs a proper repair
      rather than a reset.</div>`,
    footer:`<button class="btn ok" onclick="doCloseStop('${jsq(id)}')">&#10003; Running again</button>
      <button class="btn out" onclick="Modal.close();editWOFromStop('${jsq(id)}')">Raise work order</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>`});}

function doCloseStop(id){
  const s=DB.get('stops',id);
  if(!s){toast('That record no longer exists');return;}
  const d=F.read();
  const ended=d.endedAt||Stops.nowLocal();
  if(ended<s.startedAt){
    toast('That end time is before it started — check it');return;}
  /* A loss closed with no explanation is just a number. Nudge firmly,
     but let a determined person through — a hard block gets defeated
     with a full stop and then the data is worse AND the technician is
     annoyed. */
  if(!d.fixedBy||d.fixedBy.trim().length<5){
    if(!confirm('Nothing written in "what got it running".\n\nThat line is what the next person reads when this happens again. Right now they would get nothing.\n\nClose it anyway?')){
      const el=document.getElementById('f_fixedBy');
      if(el)el.focus();
      return;}}
  DB.upsert('stops',{id:s.id,endedAt:ended,
    qty:d.qty!==undefined?d.qty:s.qty,
    fixedBy:d.fixedBy||'',closedBy:d.closedBy||DB.getWho()});
  Modal.close();route();
  const mins=Stops.minutes(Object.assign({},s,{endedAt:ended}));
  const parts=DB.num(d.qty)||0;
  toast(s.id+' closed — '+Stops.fmtMins(mins)+' lost'+(parts?' · '+parts+' parts':''));}

function editWOFromStop(stopId){
  const s=DB.get('stops',stopId);
  if(!s)return;
  const wo={
    id:DB.nextId('wos','WO-',4), assetId:s.assetId,
    description:(s.reason||'')+(s.detail?' — '+s.detail:''),
    type:s.kind==='defect'?'Troubleshoot':'Repair',
    priority:'High', requestedBy:s.by||DB.getWho(),
    dateRequested:today(), status:'Open', cause:Causes.TBD,
    stopId:s.id};
  DB.upsert('wos',wo);
  DB.upsert('stops',{id:s.id,woId:wo.id});
  route();
  toast(wo.id+' raised from '+s.id);
  setTimeout(()=>editWO(wo.id),150);}

function deleteStop(id){
  confirmDelete('Delete '+id+'?\n\nThis removes it from every production loss total.',()=>{
    DB.remove('stops',id);Modal.close();route();toast('Record deleted');});}

function stopCard(h){
  const s=h.stop||h;
  const k=Stops.KINDS[s.kind]||Stops.KINDS.downtime;
  const mins=Stops.minutes(s);
  const parts=Stops.partsOf(s);
  return `<div class="hit" onclick="viewStop('${jsq(s.id)}')">
    <div class="hit-hd">
      <b class="mono">${esc(s.id)}</b>
      <span class="chip ${s.kind==='defect'?'c-pur':'c-prog'}">${k.label}</span>
      <span class="hit-when">${esc(fmtLocal(s.startedAt))} · ${esc(Stops.fmtMins(mins))}${parts?' · '+parts+' parts':''}</span>
      ${s.by?`<span class="hit-who">${esc(s.by)}</span>`:''}
    </div>
    <div class="hit-desc">${esc(s.reason||'')}${s.detail?' — '+esc(s.detail):''}</div>
    ${s.fixedBy?`<div class="hit-notes">${esc(s.fixedBy)}</div>`
      :`<div class="hit-notes empty-notes">${Stops.isOpen(s)?'Still open.':'No fix recorded.'}</div>`}
    <div class="hit-ft"><span>${esc(DB.assetName(s.assetId))}</span>
      ${s.woId?`<span>· ${esc(s.woId)}</span>`:''}
      ${h.reasons?`<span class="hit-why">${esc(h.reasons.join(' · '))}</span>`:''}
    </div></div>`;}

function viewStop(id){
  const s=DB.get('stops',id);
  if(!s){toast('That record no longer exists');route();return;}
  const k=Stops.KINDS[s.kind]||Stops.KINDS.downtime;
  const mins=Stops.minutes(s);
  const parts=Stops.partsOf(s);
  const c=Stops.cost(s);
  const open=Stops.isOpen(s);
  const lessons=Insights.similarStops({assetId:s.assetId,reason:s.reason,
    description:s.detail||'',excludeId:s.id,limit:3});
  Modal.open({
    title:k.label+' — '+s.id,
    body:`
      <div class="pmhead">
        <div class="pmhead-task">${esc(DB.assetName(s.assetId))} · ${esc(s.reason||'')}</div>
        <div class="pmhead-meta">
          ${esc(fmtLocal(s.startedAt))} → ${open?'<b>still down</b>':esc(fmtLocal(s.endedAt))}
        </div>
      </div>
      <div class="grid g4" style="gap:12px;margin:16px 0">
        <div class="statmini"><div class="n" style="color:${open?'var(--bad)':'inherit'}">${Stops.fmtMins(mins)}</div>
          <div class="l">${open?'down so far':'time lost'}</div></div>
        <div class="statmini"><div class="n" style="color:${parts?'var(--bad)':'inherit'}">${parts||'—'}</div>
          <div class="l">parts lost</div></div>
        <div class="statmini"><div class="n">${c===null?'—':money0(c)}</div>
          <div class="l">${c===null?'no hourly rate':'estimated cost'}</div></div>
      </div>
      ${Stops.isStale(s)?`<div class="note bad">
        <b>Open for more than ${Stops.STALE_HOURS} hours.</b> If the machine is
        running, close it with the real time — left open it keeps counting and
        distorts every total on the reports.</div>`:''}
      ${s.detail?`<div><div class="profile-label" style="margin-top:14px">What happened</div>
        <div class="pmlog-notes">${esc(s.detail)}</div></div>`:''}
      ${s.fixedBy?`<div><div class="profile-label" style="margin-top:14px">What got it running</div>
        <div class="pmlog-notes">${esc(s.fixedBy)}</div></div>`:''}
      <div class="profile-row" style="margin-top:14px"><span>Reported by</span><b>${esc(s.by||'—')}</b></div>
      ${s.closedBy?`<div class="profile-row"><span>Closed by</span><b>${esc(s.closedBy)}</b></div>`:''}
      ${s.woId?`<div class="profile-row"><span>Work order</span><b class="mono">${esc(s.woId)}</b></div>`:''}
      ${lessons.length?`<h3 class="sec" style="margin-top:22px">&#128161; Same thing, other times</h3>
        ${lessons.map(stopCard).join('')}`:''}`,
    footer:`${open?`<button class="btn ok" onclick="Modal.close();closeStop('${jsq(id)}')">&#10003; Running again</button>`:''}
      ${!s.woId?`<button class="btn out" onclick="Modal.close();editWOFromStop('${jsq(id)}')">Raise work order</button>`
        :`<button class="btn out" onclick="Modal.close();editWO('${jsq(s.woId)}')">Open ${esc(s.woId)}</button>`}
      <button class="btn out" onclick="Modal.close()">Close</button>
      ${DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="deleteStop('${jsq(id)}')">Delete</button>`:''}`});}

/* Deliberately loud and always visible. An open loss nobody closes
   is the single failure mode that makes this worthless. */
function openStopsBanner(){
  const open=Stops.open();
  if(!open.length)return '';
  const stale=open.filter(Stops.isStale);
  return `<div class="downbanner">
    <div class="downbanner-hd">
      <span class="pulse"></span>
      <b>${open.length} ${open.length===1?'machine is':'machines are'} down right now</b>
      ${stale.length?`<span class="chip c-crit">${stale.length} open over ${Stops.STALE_HOURS}h</span>`:''}
    </div>
    <div class="downlist">
      ${open.map(s=>`<div class="downrow ${Stops.isStale(s)?'stale':''}">
        <div class="downrow-txt" onclick="viewStop('${jsq(s.id)}')">
          <b>${esc(DB.assetName(s.assetId))}</b>
          <span>${esc(s.reason||'')} · down <b>${esc(Stops.fmtMins(Stops.minutes(s)))}</b>${s.by?' · '+esc(s.by):''}</span>
        </div>
        <button class="btn ok sm" onclick="closeStop('${jsq(s.id)}')">Running again</button>
      </div>`).join('')}
    </div>
  </div>`;}

/* ============================================================
   PRODUCTION LOSS — the report screen
   ============================================================ */
function setStopDays(d){STOP_DAYS=d;route();}
function setStopKind(k){STOP_KIND=k;route();}
function setStopAsset(a){STOP_ASSET=a;route();}

/* Machines ranked across every window at once. One window alone
   cannot tell a machine that has always been bad from one that
   went bad last week — and that is the whole question. */
function rankingTable(rows,metric){
  const W=Stops.WINDOWS;
  if(!rows.length)return '<div class="empty">Nothing recorded yet.</div>';
  const cell=(c)=>{
    if(metric==='parts')return c.parts?`<b>${c.parts}</b>`:'<span style="color:var(--muted)">—</span>';
    return c.mins?`<b>${Stops.fmtMins(c.mins)}</b>`:'<span style="color:var(--muted)">—</span>';};
  return `<div class="tablewrap"><table>
    <thead><tr><th>Equipment</th>
      ${W.map(d=>`<th style="text-align:right">${d} days</th>`).join('')}
      <th style="text-align:right">Events (${W[W.length-1]}d)</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="clk" onclick="openAsset('${jsq(r.assetId)}')">
      <td><b>${esc(DB.assetName(r.assetId))}</b><br>
        <small class="mono" style="color:var(--muted)">${esc(r.assetId)}</small></td>
      ${W.map(d=>`<td class="num">${cell(r.w[d])}</td>`).join('')}
      <td class="num">${r.w[W[W.length-1]].events}</td>
    </tr>`).join('')}</tbody></table></div>`;}

function renderStops(){
  const s=Stops.summary({days:STOP_DAYS,assetId:STOP_ASSET,kind:STOP_KIND});
  const pareto=Stops.byReason({days:STOP_DAYS,assetId:STOP_ASSET,kind:STOP_KIND});
  const worst=Stops.byAsset({days:STOP_DAYS,kind:STOP_KIND});
  const defects=Stops.defectRanking();
  const downs=Stops.downtimeRanking();
  const repeats=Stops.repeats();
  const assets=DB.all('assets');
  return `
  <h1 class="page">Production Loss</h1>
  <p class="sub">Time lost and parts lost — downtime and defects.</p>
  ${openStopsBanner()}
  <div class="chipset">
    <button class="btn bad" onclick="openStopChooser()">&#9888; Log production loss</button>
    ${Stops.WINDOWS.map(d=>`<button class="fchip ${STOP_DAYS===d?'on':''}"
      onclick="setStopDays(${d})">${d} days</button>`).join('')}
    <button class="fchip ${STOP_KIND===''?'on':''}" onclick="setStopKind('')">Both</button>
    <button class="fchip ${STOP_KIND==='downtime'?'on':''}" onclick="setStopKind('downtime')">Downtime</button>
    <button class="fchip ${STOP_KIND==='defect'?'on':''}" onclick="setStopKind('defect')">Defects</button>
    <select onchange="setStopAsset(this.value)" style="width:auto;min-width:180px">
      ${[{v:'',t:'All equipment'}].concat(assets.map(a=>({v:a.id,t:a.id+' · '+a.name})))
        .map(o=>`<option value="${esc(o.v)}" ${STOP_ASSET===o.v?'selected':''}>${esc(o.t)}</option>`).join('')}
    </select>
    <button class="btn out" onclick="exportStops()">&#128196; Export</button>
  </div>

  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="n" style="color:${s.mins?'var(--bad)':'var(--ok)'}">${Stops.fmtMins(s.mins)}</div>
      <div class="l">Time lost</div><div class="d">last ${STOP_DAYS} days</div></div>
    <div class="stat"><div class="n" style="color:${s.parts?'var(--bad)':'var(--ok)'}">${s.parts||0}</div>
      <div class="l">Parts lost</div><div class="d">${s.defectParts} from defects</div></div>
    <div class="stat"><div class="n">${s.closedCount}</div><div class="l">Events closed</div>
      <div class="d">${s.defectEvents} defects · ${s.openCount} still open</div></div>
    <div class="stat"><div class="n">${s.cost===null?'—':money0(s.cost)}</div>
      <div class="l">Estimated cost</div>
      <div class="d">${s.cost===null?'set an hourly rate on equipment':'time lost × hourly rate'}</div></div>
  </div>

  ${s.staleCount?`<div class="note bad">
    <b>${s.staleCount} record${s.staleCount===1?'':'s'} open for more than ${Stops.STALE_HOURS} hours.</b>
    Almost certainly forgotten rather than genuinely still down. They are kept
    out of the totals above until closed, so the numbers stay honest.</div>`:''}

  <div class="card">
    <h3 class="sec">High defect machines — parts lost</h3>
    ${rankingTable(defects,'parts')}
    <div class="note">Every window side by side. A machine heavy in the
    7-day column but light in the 90-day one has just started going wrong;
    the reverse is an old problem somebody has already dealt with.</div>
  </div>

  <div class="card">
    <h3 class="sec">Highest downtime machines — time lost</h3>
    ${rankingTable(downs,'mins')}
  </div>

  ${repeats.length?`<div class="card">
    <h3 class="sec">Same thing, again and again — 3+ times this year</h3>
    <div class="repeats">
      ${repeats.slice(0,6).map(r=>`<div class="repeat" onclick="openAsset('${jsq(r.assetId)}')">
        <div class="repeat-hd">
          <span class="chip c-crit">${r.count}×</span>
          <b>${esc(DB.assetName(r.assetId))}</b>
          <span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span>
        </div>
        <div class="repeat-cause">${esc(r.reason)}</div>
        <div class="repeat-ft">
          <span><b>${Stops.fmtMins(r.mins)}</b> lost</span>
          ${r.parts?`<span>· <b>${r.parts}</b> parts</span>`:''}
          ${r.cost!==null?`<span>· <b>${money0(r.cost)}</b></span>`:''}
          <span>· last ${esc(fmtLocal(r.last))}</span>
        </div>
      </div>`).join('')}
    </div>
    <div class="note">The same reason on the same machine three times is a
    root-cause problem, not bad luck.</div>
  </div>`:''}

  ${pareto.length?`<div class="card">
    <h3 class="sec">Where the loss actually comes from — last ${STOP_DAYS} days</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Reason</th><th>Type</th><th style="text-align:right">Times</th>
        <th style="text-align:right">Time lost</th><th style="text-align:right">Parts</th>
        <th>Share of time</th></tr></thead>
      <tbody>${pareto.map(r=>`<tr>
        <td><b>${esc(r.reason)}</b></td>
        <td><span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span></td>
        <td class="num">${r.count}</td>
        <td class="num"><b>${Stops.fmtMins(r.mins)}</b></td>
        <td class="num">${r.parts?`<b>${r.parts}</b>`:'<span style="color:var(--muted)">—</span>'}</td>
        <td style="min-width:130px">
          <div class="bar" style="margin:0"><i style="width:${r.pct}%;background:var(--bad)"></i></div>
          <small style="color:var(--muted)">${r.pct}% · running ${r.cumPct}%</small>
        </td></tr>`).join('')}</tbody>
    </table></div>
    <div class="note">Ranked by time lost. Watch the parts column too — a
    reason costing minutes but scrapping hundreds is easy to miss here.</div>
  </div>`:''}

  ${worst.length?`<div class="card">
    <h3 class="sec">Worst equipment — last ${STOP_DAYS} days</h3>
    ${renderTable([
      {label:'Equipment',render:r=>`<b>${esc(DB.assetName(r.assetId))}</b><br><small class="mono" style="color:var(--muted)">${esc(r.assetId)}</small>`},
      {label:'Events',num:true,render:r=>r.count},
      {label:'Downtime',num:true,render:r=>Stops.fmtMins(r.down)},
      {label:'Defects',num:true,hideSm:true,render:r=>Stops.fmtMins(r.defect)},
      {label:'Parts lost',num:true,render:r=>r.parts||'—'},
      {label:'Total time',num:true,render:r=>`<b>${Stops.fmtMins(r.mins)}</b>`}
    ],worst,{onRow:'openAsset'})}
  </div>`:''}

  <div class="card">
    <h3 class="sec">Recent events</h3>
    ${renderTable([
      {label:'Record',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Type',render:r=>`<span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span>`},
      {label:'Equipment',render:r=>`<b>${esc(DB.assetName(r.assetId))}</b>`},
      {label:'Reason',render:r=>esc(r.reason||'—')},
      {label:'Started',hideSm:true,render:r=>esc(fmtLocal(r.startedAt))},
      {label:'Time lost',num:true,render:r=>Stops.isOpen(r)
        ? `<b style="color:var(--bad)">${Stops.fmtMins(Stops.minutes(r))}</b>`
        : Stops.fmtMins(Stops.minutes(r))},
      {label:'Parts',num:true,render:r=>Stops.partsOf(r)||'—'},
      {label:'Status',render:r=>Stops.isOpen(r)
        ? (Stops.isStale(r)?'<span class="chip c-crit">open, stale</span>':'<span class="chip c-crit">still down</span>')
        : '<span class="chip c-done">closed</span>'},
      {label:'Fix recorded',hideSm:true,render:r=>r.fixedBy
        ? esc(r.fixedBy.length>44?r.fixedBy.slice(0,44)+'…':r.fixedBy)
        : '<span style="color:var(--muted)">—</span>'}
    ],Stops.recent(40),{empty:'Nothing logged yet.',onRow:'viewStop'})}
    ${s.closedCount?`<div class="note">${s.documented} of ${s.closedCount} closed
      events (${s.docPct}%) recorded what got the machine running.</div>`:''}
  </div>`;}

function exportStops(){
  const rows=Stops.exportRows({assetId:STOP_ASSET,kind:STOP_KIND});
  if(!rows.length){toast('Nothing to export');return;}
  CSV.download('production-loss-'+today()+'.csv',CSV.build(Stops.EXPORT_COLUMNS,rows));
  toast(rows.length+' records exported');}

/* ============================================================
   CAUSE SETUP (admin)
   ------------------------------------------------------------
   The reason lists that appear when somebody schedules work or
   logs a production loss, held per equipment type.
   ============================================================ */
function setCauseKind(k){CAUSE_KIND=k;route();}
function setCauseType(t){CAUSE_TYPE=t;route();}

function renderCauses(){
  const sum=Causes.summary();
  const types=Causes.types();
  const kind=CAUSE_KIND;
  const type=CAUSE_TYPE;
  const lines=Causes.all()
    .filter(c=>c.kind===kind)
    .filter(c=>String(c.equipType||'').trim()===String(type||'').trim())
    .sort((a,b)=>{
      const sa=DB.num(a.sort),sb=DB.num(b.sort);
      if(sa!==null&&sb!==null&&sa!==sb)return sa-sb;
      if(sa!==null&&sb===null)return -1;
      if(sa===null&&sb!==null)return 1;
      return String(a.label||'').localeCompare(String(b.label||''));});
  const effective=Causes.forType(kind,type);
  const usingDefault=Causes.isFallback(kind,type);

  return `
  <h1 class="page">Cause Setup</h1>
  <p class="sub">The reasons your technicians pick from, set per equipment type.</p>

  ${sum.untyped?`<div class="note bad">
    <b>${sum.untyped} piece${sum.untyped===1?'':'s'} of equipment ${sum.untyped===1?'has':'have'} no type set.</b>
    A machine with no type always gets the standard list. Set the type on the
    equipment record to give it its own reasons.
    <a href="#/assets">Open equipment</a>.</div>`:''}

  <div class="card">
    <h3 class="sec">Which list are you editing?</h3>
    <div class="chipset" style="margin-bottom:10px">
      ${Causes.KINDS.map(k=>`<button class="fchip ${kind===k?'on':''}"
        onclick="setCauseKind('${k}')">${esc(Causes.KIND_LABEL[k])}</button>`).join('')}
    </div>
    <div class="chipset" style="margin-bottom:0">
      <button class="fchip ${type===''?'on':''}" onclick="setCauseType('')">
        Every equipment type</button>
      ${types.map(t=>`<button class="fchip ${type===t?'on':''}"
        onclick="setCauseType('${jsq(t)}')">${esc(t)}</button>`).join('')}
    </div>
    <div class="note">${type===''
      ? 'Lines here appear on <b>every</b> machine, on top of whatever its own type has.'
      : `Lines here appear only on equipment of type <b>${esc(type)}</b>, alongside the plant-wide ones.`}</div>
  </div>

  <div class="card">
    <h3 class="sec">${esc(Causes.KIND_LABEL[kind])}${type?' · '+esc(type):' · every type'}</h3>
    <div class="chipset">
      <button class="btn filled" onclick="addCauseLine()">&#43; Add a reason</button>
      <button class="btn out" onclick="seedCauseList()">Load the standard list</button>
      ${lines.length?`<button class="btn out" onclick="renumberCauses()">Tidy the order</button>`:''}
    </div>
    ${renderTable([
      {label:'Order',num:true,render:r=>r.sort||'<span style="color:var(--muted)">—</span>'},
      {label:'Reason',render:r=>`<b>${esc(r.label)}</b>`},
      {label:'In use',num:true,render:r=>{
        const n=Causes.usage(r.kind,r.label);
        return n?`<b>${n}</b>`:'<span style="color:var(--muted)">0</span>';}},
      {label:'',render:r=>`<button class="btn out sm" onclick="event.stopPropagation();editCauseLine('${jsq(r.id)}')">Edit</button>`}
    ],lines,{empty:'Nothing set up here yet — the standard list is being used.'})}
    ${usingDefault?`<div class="note">
      <b>Nothing configured, so the standard list is showing to technicians:</b><br>
      ${effective.map(x=>esc(x)).join(' · ')}<br><br>
      That is fine — setup is optional. Add your own lines whenever you are ready
      and they replace the standard ones for this type.</div>`
    :`<div class="note">Technicians on this type see: ${effective.map(x=>esc(x)).join(' · ')}</div>`}
  </div>

  <div class="card">
    <h3 class="sec">Setup so far</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Equipment type</th><th style="text-align:right">Equipment</th>
        ${Causes.KINDS.map(k=>`<th style="text-align:right">${esc(Causes.KIND_SHORT[k])}</th>`).join('')}
      </tr></thead>
      <tbody>${sum.rows.map(r=>`<tr>
        <td><b>${r.equipType?esc(r.equipType):'Every type (plant-wide)'}</b></td>
        <td class="num">${r.equipment===null?'—':r.equipment}</td>
        ${Causes.KINDS.map(k=>`<td class="num">${
          r.counts[k]?`<b>${r.counts[k]}</b>`
          :'<span class="chip c-hold">standard</span>'}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="note">"standard" means nothing is configured and the built-in
    list is used. Nothing breaks either way.</div>
  </div>`;}

function causeTypeOptions(current){
  const types=Causes.types();
  const out=[{v:'',t:'Every equipment type (plant-wide)'}];
  types.forEach(t=>out.push({v:t,t:t}));
  const cur=String(current||'');
  if(cur&&!types.includes(cur))out.push({v:cur,t:cur});
  return out;}

function addCauseLine(){
  Modal.open({title:'Add a reason',
    body:`${F.select('kind','Which list',CAUSE_KIND,
        Causes.KINDS.map(k=>({v:k,t:Causes.KIND_LABEL[k]})),{required:true})}
      ${F.text('equipType','Equipment type',CAUSE_TYPE,
        {list:'dl_types',datalist:Causes.types(),
         placeholder:'leave blank for every type',
         hint:'Must match the type on the equipment record exactly. Leave blank to apply plant-wide.'})}
      ${F.text('label','The reason',' ',{required:true,
        placeholder:'e.g. Sonotrode cracked',
        hint:'Use the words your technicians actually say. A list nobody recognises gets ignored and everything ends up as "Other".'})}
      ${F.num('sort','Order',null,{step:'1',placeholder:'e.g. 10',
        hint:'Optional. Lower numbers come first; blank ones sort last by name.'})}
      <div id="causeMsg"></div>`,
    footer:`<button class="btn filled" onclick="doAddCause()">Add</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>`});
  setTimeout(()=>{const el=document.getElementById('f_label');if(el)el.value='';},60);}

function doAddCause(){
  const d=F.read();
  const msg=document.getElementById('causeMsg');
  const show=t=>{if(msg)msg.innerHTML=`<div class="note bad">${esc(t)}</div>`;};
  if(!d.label)return show('Type the reason.');
  const r=Causes.add(d.kind,d.equipType,d.label,d.sort);
  if(!r)return show('Type the reason.');
  if(r.duplicate)return show('That reason is already on this list.');
  CAUSE_KIND=d.kind;CAUSE_TYPE=(d.equipType||'').trim();
  Modal.close();route();toast('Added — technicians see it straight away');}

function editCauseLine(id){
  const c=DB.get('causes',id);
  if(!c){toast('That line no longer exists');route();return;}
  const used=Causes.usage(c.kind,c.label);
  Modal.open({title:'Edit reason',
    body:`${F.select('kind','Which list',c.kind,
        Causes.KINDS.map(k=>({v:k,t:Causes.KIND_LABEL[k]})),{required:true})}
      ${F.text('equipType','Equipment type',c.equipType||'',
        {list:'dl_types2',datalist:Causes.types(),placeholder:'leave blank for every type'})}
      ${F.text('label','The reason',c.label,{required:true})}
      ${F.num('sort','Order',c.sort,{step:'1'})}
      ${used?`<div class="note"><b>${used} record${used===1?'':'s'} already use this reason.</b>
        Renaming it here does not rewrite them — they keep the words they were
        saved with, which is what you want for history. The new name applies
        from now on.</div>`:''}
      <div id="causeMsg"></div>`,
    footer:`<button class="btn filled" onclick="doUpdateCause('${jsq(id)}')">Save</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="deleteCause('${jsq(id)}')">Delete</button>`:''}`});}

function doUpdateCause(id){
  const d=F.read();
  const msg=document.getElementById('causeMsg');
  if(!d.label){if(msg)msg.innerHTML='<div class="note bad">Type the reason.</div>';return;}
  DB.upsert('causes',{id,kind:d.kind,equipType:(d.equipType||'').trim(),
    label:d.label,sort:d.sort||''});
  CAUSE_KIND=d.kind;CAUSE_TYPE=(d.equipType||'').trim();
  Modal.close();route();toast('Saved');}

function deleteCause(id){
  const c=DB.get('causes',id);
  if(!c)return;
  const used=Causes.usage(c.kind,c.label);
  confirmDelete(`Remove "${c.label}" from the list?\n\n`+
    (used?`${used} record(s) already use it. They keep it — history is not rewritten. It simply stops being offered on new ones.`
         :'Nothing uses it yet.'),()=>{
    DB.remove('causes',id);Modal.close();route();toast('Removed from the list');});}

function seedCauseList(){
  const kindLabel=Causes.KIND_LABEL[CAUSE_KIND];
  const where=CAUSE_TYPE?`"${CAUSE_TYPE}"`:'every equipment type';
  confirmDelete(`Copy the standard ${kindLabel.toLowerCase()} into ${where}?\n\n`+
    'Anything already there is left alone. You can then edit or remove lines.',()=>{
    const n=Causes.seedDefaults(CAUSE_KIND,CAUSE_TYPE);
    route();
    toast(n?n+' reasons added':'Everything was already there');});}

/* Renumber 10, 20, 30 … so a line can be dropped in between two
   others later without redoing the whole list. */
function renumberCauses(){
  const lines=Causes.all()
    .filter(c=>c.kind===CAUSE_KIND&&String(c.equipType||'').trim()===String(CAUSE_TYPE||'').trim())
    .sort((a,b)=>{
      const sa=DB.num(a.sort),sb=DB.num(b.sort);
      if(sa!==null&&sb!==null&&sa!==sb)return sa-sb;
      if(sa!==null&&sb===null)return -1;
      if(sa===null&&sb!==null)return 1;
      return String(a.label||'').localeCompare(String(b.label||''));});
  lines.forEach((c,i)=>DB.upsert('causes',{id:c.id,sort:String((i+1)*10)}));
  route();toast('Order tidied — 10, 20, 30…');}

/* ============================================================
   SMART ASSIST
   ============================================================ */
function runSmartSearch(){
  const q=(document.getElementById('smartQ')||{}).value||'';
  const a=(document.getElementById('f_smartAsset')||{}).value||'';
  SMART_Q=q;SMART_ASSET=a;
  const out=document.getElementById('smartResults');
  if(!out)return;
  if(!q.trim()&&!a){
    out.innerHTML=`<div class="empty">Describe the problem, or pick a machine, to search what has been fixed before.</div>`;return;}
  out.innerHTML=renderHits(Insights.findLessons({assetId:a,description:q,limit:10}),q);}

function hitCard(h){
  if(h.source==='stop')return stopCard(h);
  const w=h.wo;
  const who=w.assignedTo||w.completedBy||'';
  const when=w.dateCompleted||w.dateRequested;
  return `<div class="hit" onclick="editWO('${jsq(w.id)}')">
    <div class="hit-hd"><b class="mono">${esc(w.id)}</b>
      <span class="chip c-open">Work order</span>
      <span class="hit-when">${esc(Insights.ago(h.ageDays))}</span>
      ${w.cause&&w.cause!==Causes.TBD?`<span class="chip c-prog">${esc(w.cause)}</span>`:''}
      ${who?`<span class="hit-who">${esc(who)}</span>`:''}</div>
    <div class="hit-desc">${esc(w.description||'')}</div>
    ${w.notes&&w.notes.trim()?`<div class="hit-notes">${esc(w.notes)}</div>`
      :`<div class="hit-notes empty-notes">No notes were written on this one.</div>`}
    <div class="hit-ft"><span>${esc(DB.assetName(w.assetId))}</span>
      ${w.hours?`<span>· ${esc(w.hours)}h</span>`:''}
      ${when?`<span>· ${fmtDate(when)}</span>`:''}
      <span class="hit-why">${esc(h.reasons.join(' · '))}</span></div>
  </div>`;}

function renderHits(hits,q){
  if(!hits.length){
    return `<div class="empty">
      <b style="display:block;color:var(--ink);margin-bottom:6px">Nothing similar on record</b>
      ${q?'No closed work order or production loss record matches that yet.':'No history for that machine yet.'}
      <br><small>Once this job is closed with good notes, it will show up here next time.</small></div>`;}
  return `<div class="hits">${hits.map(hitCard).join('')}</div>`;}

function renderSmart(){
  const q=Insights.dataQuality();
  const repeats=Insights.repeatFailures();
  const stopRepeats=Stops.repeats();
  return `
  <h1 class="page">Smart Assist</h1>
  <p class="sub">What this plant has already fixed — from work orders and production loss records.</p>
  <div class="card smartcard">
    <h3 class="sec">Seen this before?</h3>
    <div class="f2">
      <div><label for="smartQ">Describe the problem</label>
        <input id="smartQ" value="${esc(SMART_Q)}" placeholder="e.g. bad welds on station 2"
          onkeydown="if(event.key==='Enter')runSmartSearch()"/></div>
      <div>${F.select('smartAsset','On which equipment (optional)',SMART_ASSET,assetOptions())}</div>
    </div>
    <div class="actions">
      <button class="btn filled" onclick="runSmartSearch()">&#128269; Search</button>
      <button class="btn out" onclick="document.getElementById('smartQ').value='';document.getElementById('f_smartAsset').value='';runSmartSearch()">Clear</button>
    </div>
    <div id="smartResults" style="margin-top:18px">
      <div class="empty">Describe the problem, or pick a machine, to search what has been fixed before.</div></div>
  </div>
  ${(repeats.length||stopRepeats.length)?`<div class="card">
    <h3 class="sec">Recurring problems</h3>
    <div class="repeats">
      ${repeats.map(r=>`<div class="repeat" onclick="openAsset('${jsq(r.assetId)}')">
        <div class="repeat-hd"><span class="chip c-crit">${r.count}×</span>
          <b>${esc(DB.assetName(r.assetId))}</b>
          <span class="chip c-open">Repairs</span></div>
        <div class="repeat-cause">${esc(r.cause)}</div>
        <div class="repeat-ft">
          ${r.hours?`<span><b>${r.hours.toFixed(1)}h</b> of work</span>`:''}
          ${r.avgGap?`<span>· roughly every <b>${r.avgGap} days</b></span>`:''}
        </div></div>`).join('')}
      ${stopRepeats.slice(0,6).map(r=>`<div class="repeat" onclick="openAsset('${jsq(r.assetId)}')">
        <div class="repeat-hd"><span class="chip c-crit">${r.count}×</span>
          <b>${esc(DB.assetName(r.assetId))}</b>
          <span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span></div>
        <div class="repeat-cause">${esc(r.reason)}</div>
        <div class="repeat-ft"><span><b>${Stops.fmtMins(r.mins)}</b> lost</span>
          ${r.parts?`<span>· <b>${r.parts}</b> parts</span>`:''}</div>
      </div>`).join('')}
    </div>
  </div>`:''}
  <div class="card">
    <h3 class="sec">How much this can find</h3>
    <div class="bar"><i style="width:${q.pct}%;background:${q.pct>=70?'var(--ok)':q.pct>=40?'var(--warn)':'var(--bad)'}"></i></div>
    <div class="quality">
      <span><b>${q.usable}</b> of <b>${q.total}</b> closed records explain what was actually done — <b>${q.pct}%</b><br>
      <small>${q.done} work orders · ${q.stops} production loss records (${q.stopsDocumented} with a fix noted)</small></span>
    </div>
    ${q.total===0?`<div class="note">Nothing closed yet.</div>`
      :q.pct<60?`<div class="note bad"><b>Most records do not say what was done.</b>
        One honest line at close is what turns this from a counter into something worth reading.</div>`
      :`<div class="note">Good documentation rate.</div>`}
  </div>
  <div class="card">
    <h3 class="sec">What this is, and is not</h3>
    <div class="tablewrap"><table><tbody>
      <tr><td>&#10003; Searches your own closed work orders and production loss records</td></tr>
      <tr><td>&#10003; Every result links to a real record you can open</td></tr>
      <tr><td>&#10003; Runs on this device — nothing leaves the plant</td></tr>
      <tr><td>&#10003; Works offline</td></tr>
      <tr><td style="color:var(--muted)">— It does not invent fixes it has not seen</td></tr>
      <tr><td style="color:var(--muted)">— It cannot read your PDF manuals (yet)</td></tr>
    </tbody></table></div>
  </div>`;}

function similarPanel(assetId,description,cause,excludeId){
  const hits=Insights.findLessons({assetId,description,cause,excludeId,limit:4});
  if(!hits.length)return '';
  return `<div class="seenbefore">
    <div class="seen-hd">&#128161; Seen before — ${hits.length} similar</div>
    ${hits.map(hitCard).join('')}</div>`;}

function refreshSimilar(excludeId){
  const box=document.getElementById('similarBox');
  if(!box)return;
  const d=F.read();
  box.innerHTML=similarPanel(d.assetId||'',d.description||'',d.cause||'',excludeId||'');}

function smartForAsset(id){
  SMART_ASSET=id;SMART_Q='';
  location.hash='#/smart';
  setTimeout(()=>{
    const sel=document.getElementById('f_smartAsset');
    if(sel)sel.value=id;
    runSmartSearch();},60);}

/* ============================================================
   HOME
   ============================================================ */
function renderHome(){
  const assets=DB.all('assets'),wos=DB.all('wos'),pms=DB.all('pms');
  const openWos=wos.filter(DB.isOpen);
  const progWos=wos.filter(w=>w.status==='In Progress');
  const duePms=pms.filter(p=>{const d=DB.daysUntil(p.nextDue);return d!==null&&d<=7;});
  const recent=(DB.raw().meta.recentAssets||[]).map(id=>DB.get('assets',id)).filter(Boolean);
  const meName=DB.getWho();
  const myWos=wos.filter(w=>DB.isActive(w)&&(w.assignedTo||'')===meName);
  const myPms=pms.filter(p=>(p.tech||'')===meName&&(DB.daysUntil(p.nextDue)??99)<=14);
  const comp=Compliance.summary({days:90});
  const st=Stops.summary({days:30});
  const showComp=canView('compliance');

  if(!assets.length&&!wos.length){
    return `<h1 class="page">Welcome, ${esc(meName)}</h1>
      <p class="sub">The database is empty.</p>
      <div class="placeholder"><div style="font-size:34px">&#128736;</div>
        <b style="display:block;margin:10px 0 6px;color:var(--ink);font-size:16px">Start here</b>
        <span>${DB.isAdmin()?'Import your equipment list, or load sample data to look around.':'Ask an admin to import the equipment list.'}</span>
        <div class="actions" style="justify-content:center">
          ${DB.isAdmin()?`<a class="btn filled" href="#/import">Import CSV</a>
          <button class="btn out" onclick="seedSample()">Load sample data</button>`:''}
          ${DB.can('createAsset')?`<button class="btn out" onclick="editAsset()">Add first equipment</button>`:''}</div></div>`;}

  return `
  <h1 class="page">Home</h1>
  <p class="sub">${esc(DB.raw().meta.site||'Maintenance')} · signed in as <b>${esc(meName)}</b> (${esc(ROLE_LABEL[DB.role()]||DB.role())})</p>
  ${openStopsBanner()}
  ${bigActions()}
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat click" onclick="location.hash='#/assets'"><div class="n">${assets.length}</div><div class="l">Equipment in plant</div></div>
    <div class="stat click" onclick="WO_FILTER='open';WORK_TAB='wo';location.hash='#/wo'">
      <div class="n" style="color:${openWos.length?'var(--pri)':'inherit'}">${openWos.length}</div>
      <div class="l">Pending work orders</div><div class="d">${progWos.length} in progress</div></div>
    <div class="stat click" onclick="location.hash='#/stops'">
      <div class="n" style="color:${st.mins?'var(--bad)':'var(--ok)'}">${Stops.fmtMins(st.mins)}</div>
      <div class="l">Lost in 30 days</div>
      <div class="d">${st.parts?st.parts+' parts · ':''}${st.closedCount} events</div></div>
    ${showComp?`<div class="stat click" onclick="location.hash='#/compliance'">
      <div class="n" style="color:${comp.pct===null?'inherit':comp.pct>=90?'var(--ok)':comp.pct>=70?'var(--warn)':'var(--bad)'}">${comp.pct===null?'—':comp.pct+'%'}</div>
      <div class="l">PM compliance (90d)</div><div class="d">${duePms.length} due this week</div></div>`
    :`<div class="stat click" onclick="WORK_TAB='pm';location.hash='#/pm'">
      <div class="n" style="color:${duePms.length?'var(--bad)':'inherit'}">${duePms.length}</div>
      <div class="l">PMs due this week</div></div>`}
  </div>
  ${(myWos.length||myPms.length)?`<div class="card"><h3 class="sec">Your work</h3>
    ${myWos.length?renderTable([
      {label:'WO',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Work',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Priority',render:r=>prioChip(r.priority)},
      {label:'Status',render:r=>statusChip(r.status)}
    ],myWos,{onRow:'editWO'}):'<div class="empty">No work orders assigned to you.</div>'}
    ${myPms.length?`<h3 class="sec" style="margin-top:22px">Your PMs due soon</h3>
      ${renderTable([
        {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
        {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
        {label:'Due',render:r=>dueChip(r.nextDue)},
        {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Mark done</button>`}
      ],myPms,{onRow:'showPMHistory'})}`:''}
  </div>`:''}
  ${recent.length?`<div class="card"><h3 class="sec">Recently viewed equipment</h3>
    ${recent.map(a=>`<a class="pill" href="#/asset/${encodeURIComponent(a.id)}"><b>${esc(a.id)}</b> <small>${esc(a.name)}</small></a>`).join('')}</div>`:''}`;}

function renderDashboard(){
  const assets=DB.all('assets'),pms=DB.all('pms'),parts=DB.all('parts'),wos=DB.all('wos');
  const openWos=wos.filter(DB.isActive);
  const duePms=pms.filter(p=>{const d=DB.daysUntil(p.nextDue);return d!==null&&d<=7;})
    .sort((a,b)=>(a.nextDue||'').localeCompare(b.nextDue||''));
  const lowParts=parts.filter(p=>DB.partStatus(p).label==='Low stock');
  const unassigned=openWos.filter(w=>!w.assignedTo);
  const repeats=Insights.repeatFailures();
  const comp=Compliance.summary({days:90});
  const st=Stops.summary({days:30});
  const pareto=Stops.byReason({days:30});
  const stat=(ic,bg,col,n,l,d)=>`
    <div class="stat"><div class="ic" style="background:${bg};color:${col}">${ic}</div>
      <div class="n">${n}</div><div class="l">${esc(l)}</div>${d?`<div class="d">${esc(d)}</div>`:''}</div>`;
  return `
  <h1 class="page">Dashboard</h1>
  <p class="sub">${esc(DB.raw().meta.site||'Maintenance overview')}</p>
  ${openStopsBanner()}
  <div class="grid g4" style="margin-bottom:20px">
    ${stat('&#128451;','var(--info-c)','var(--pri)',assets.length,'Equipment registered')}
    ${stat('&#129534;','var(--bad-c)','var(--bad)',openWos.length,'Open work orders',
      openWos.filter(w=>w.priority==='High').length+' high priority')}
    ${stat('&#9888;',st.mins?'var(--bad-c)':'var(--ok-c)',st.mins?'var(--bad)':'var(--ok)',
      Stops.fmtMins(st.mins),'Time lost (30d)',
      (st.parts?st.parts+' parts lost':st.closedCount+' events'))}
    ${stat('&#9989;',comp.pct===null?'var(--surf-3)':comp.pct>=90?'var(--ok-c)':'var(--warn-c)',
      comp.pct===null?'var(--muted)':comp.pct>=90?'var(--ok)':'var(--warn)',
      comp.pct===null?'—':comp.pct+'%','PM compliance (90d)',comp.overdueNow+' overdue now')}
  </div>
  ${pareto.length?`<div class="card">
    <h3 class="sec">Biggest causes of production loss — 30 days</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Reason</th><th>Type</th><th style="text-align:right">Times</th>
        <th style="text-align:right">Time lost</th><th style="text-align:right">Parts</th>
        <th>Share</th></tr></thead>
      <tbody>${pareto.slice(0,6).map(r=>`<tr>
        <td><b>${esc(r.reason)}</b></td>
        <td><span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span></td>
        <td class="num">${r.count}</td>
        <td class="num"><b>${Stops.fmtMins(r.mins)}</b></td>
        <td class="num">${r.parts||'—'}</td>
        <td style="min-width:110px"><div class="bar" style="margin:0"><i style="width:${r.pct}%;background:var(--bad)"></i></div></td>
      </tr>`).join('')}</tbody></table></div>
    <div class="actions"><a class="btn out sm" href="#/stops">Open Production Loss</a></div>
  </div>`:''}
  ${comp.overdueNow?`<div class="note bad">
    <b>${comp.overdueNow} PM${comp.overdueNow===1?' is':'s are'} overdue right now.</b>
    <a href="#/compliance">See which</a>.</div>`:''}
  ${repeats.length?`<div class="card">
    <h3 class="sec">Recurring failures</h3>
    ${renderTable([
      {label:'Equipment',render:r=>`<b>${esc(DB.assetName(r.assetId))}</b><br><small class="mono" style="color:var(--muted)">${esc(r.assetId)}</small>`},
      {label:'Cause',render:r=>`<span class="chip c-crit">${esc(r.cause)}</span>`},
      {label:'Times',num:true,render:r=>`<b>${r.count}</b>`},
      {label:'Hours',num:true,render:r=>r.hours.toFixed(1)},
      {label:'Every',hideSm:true,render:r=>r.avgGap?'~'+r.avgGap+' days':'—'}
    ],repeats,{onRow:'openAsset'})}
    <div class="actions"><a class="btn out sm" href="#/smart">Open Smart Assist</a></div>
  </div>`:''}
  ${unassigned.length?`<div class="note bad">
    <b>${unassigned.length} open work order${unassigned.length===1?'':'s'} with nobody assigned.</b>
    <a href="#" onclick="WO_FILTER='unassigned';WORK_TAB='wo';location.hash='#/wo';return false;">Show them</a>.</div>`:''}
  <div class="grid g2">
    <div class="card"><h3 class="sec">PMs due next</h3>
      ${renderTable([
        {label:'PM',key:'id'},
        {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
        {label:'Due',render:r=>dueChip(r.nextDue)},
        {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Mark done</button>`}
      ],duePms.slice(0,6),{empty:'Nothing due in the next 7 days.',onRow:'showPMHistory'})}
      <div class="actions"><a class="btn out sm" href="#/pm">Open PM plan</a></div></div>
    <div class="card"><h3 class="sec">Open work orders</h3>
      ${renderTable([
        {label:'WO',key:'id'},
        {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
        {label:'Assigned',hideSm:true,render:r=>r.assignedTo?esc(r.assignedTo):'<span class="chip c-crit">Nobody</span>'},
        {label:'Status',render:r=>statusChip(r.status)}
      ],openWos.slice(0,6),{empty:'No open work orders.',onRow:'editWO'})}
      <div class="actions"><a class="btn out sm" href="#/wo">Open work orders</a></div></div>
  </div>
  ${lowParts.length?`<div class="card"><h3 class="sec">Low stock — reorder</h3>
    ${renderTable([
      {label:'Part',key:'id'},{label:'Description',key:'description'},
      {label:'Location',render:r=>`<span class="mono">${esc(r.location||'—')}</span>`},
      {label:'On hand',num:true,render:r=>esc(r.qty)},
      {label:'Min',num:true,render:r=>esc(r.min)}
    ],lowParts,{onRow:'editPart'})}</div>`:''}`;}

function dueChip(iso){
  const d=DB.daysUntil(iso);
  if(d===null)return '<span class="chip c-hold">No date</span>';
  if(d<0)return `<span class="chip c-crit">${Math.abs(d)}d overdue</span>`;
  if(d===0)return '<span class="chip c-crit">Due today</span>';
  if(d<=7)return `<span class="chip c-prog">In ${d}d</span>`;
  return `<span class="chip c-hold">${fmtDate(iso)}</span>`;}
function prioChip(p){
  const c=p==='High'?'c-crit':p==='Medium'?'c-prog':'c-hold';
  return `<span class="chip ${c}">${esc(p||'—')}</span>`;}
function statusChip(s){
  const c=s==='Completed'?'c-done':s==='In Progress'?'c-prog':s==='Open'?'c-open':'c-hold';
  return `<span class="chip ${c}">${esc(s||'Open')}</span>`;}
function docChip(url,label){
  return safeUrl(url)?`<span class="chip c-open" title="${esc(label||'Document attached')}">&#128196;</span>`:'';}

/* ============================================================
   EQUIPMENT  (stored as "assets"; the word on screen is Equipment)
   ============================================================ */
function renderAssets(){
  const rows=DB.all('assets').filter(a=>
    matches(a,['id','name','type','manufacturer','model','serial','project','location','owner']));
  const noType=rows.filter(a=>!a.type||!String(a.type).trim()).length;
  return `
  <h1 class="page">Equipment</h1>
  <p class="sub">${rows.length} item${rows.length===1?'':'s'}${SEARCH?` matching “${esc(SEARCH)}”`:' in the register'}</p>
  <div class="chipset">
    ${DB.can('createAsset')?'<button class="btn filled" onclick="editAsset()">&#43; New equipment</button>':''}
    ${canView('qr')?'<a class="btn out" href="#/qr">QR tags</a>':''}
    <button class="btn out" onclick="exportCSV('assets')">Export CSV</button>
    ${canView('import')?'<a class="btn out" href="#/import">Import CSV</a>':''}
  </div>
  ${noType&&canView('causes')?`<div class="note">
    <b>${noType} item${noType===1?'':'s'} ${noType===1?'has':'have'} no equipment type.</b>
    Type is what decides which reasons a technician sees when they log work or
    a production loss. Without it they get the standard list.
    <a href="#/causes">Cause setup</a>.</div>`:''}
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">Equipment register</h3>
    ${renderTable([
      {label:'Equipment ID',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Name',render:r=>`<b>${esc(r.name||'—')}</b>${r.location?`<br><small style="color:var(--muted)">${esc(r.location)}</small>`:''}`},
      {label:'Type',hideSm:true,render:r=>r.type
        ?`<span class="chip c-open">${esc(r.type)}</span>`
        :'<span style="color:var(--muted)">not set</span>'},
      {label:'Docs',render:r=>{
        if(safeUrl(r.manualUrl))return docLink(r.manualUrl,'Manual',{cls:'btn out sm'});
        if(safeUrl(r.drawingUrl))return docLink(r.drawingUrl,'Drawing',{cls:'btn out sm'});
        return '<span style="color:var(--muted)">—</span>';}},
      {label:'Status',render:r=>{
        const down=Stops.open().some(s=>s.assetId===r.id);
        if(down)return '<span class="chip c-crit">DOWN NOW</span>';
        return `<span class="chip ${r.status==='Down'?'c-crit':r.status==='Retired'?'c-hold':'c-done'}">${esc(r.status||'Active')}</span>`;}},
      {label:'Lost 30d',num:true,hideSm:true,render:r=>{
        const s=Stops.summary({days:30,assetId:r.id});
        if(!s.mins&&!s.parts)return '—';
        return `<b style="color:var(--bad)">${Stops.fmtMins(s.mins)}</b>${s.parts?`<br><small>${s.parts} parts</small>`:''}`;}},
      {label:'Open WOs',num:true,render:r=>{
        const n=DB.forAsset('wos',r.id).filter(DB.isActive).length;
        return n?`<b style="color:var(--bad)">${n}</b>`:'0';}},
      {label:'',hideSm:true,render:r=>DB.can('editAsset')
        ?`<button class="btn out sm" onclick="event.stopPropagation();editAsset('${jsq(r.id)}')">Edit</button>`:''}
    ],rows,{empty:SEARCH?'No equipment matches that search.':'No equipment yet.',onRow:'openAsset'})}
  </div>`;}

function renderAssetDetail(id){
  const a=DB.get('assets',id);
  if(!a)return `<h1 class="page">Equipment not found</h1>
    <p class="sub">Nothing with ID “${esc(id)}”.</p>
    <a class="btn filled" href="#/assets">Back to equipment</a>`;
  DB.touchAsset(id);
  const wos=DB.forAsset('wos',id),pms=DB.forAsset('pms',id);
  const parts=DB.partsForAsset(id);
  const pending=wos.filter(DB.isOpen);
  const done=wos.filter(DB.isDone);
  const recentRepairs=done.sort((x,y)=>(y.dateCompleted||'').localeCompare(x.dateCompleted||'')).slice(0,5);
  const lowParts=parts.filter(p=>DB.partStatus(p).label==='Low stock').length;
  const hasDocs=safeUrl(a.manualUrl)||safeUrl(a.drawingUrl);
  const health=Insights.assetHealth(id);
  const myRepeats=Insights.repeatFailures().filter(r=>r.assetId===id);
  const comp=Compliance.summary({days:365,assetId:id});
  const pmHistory=Compliance.logsForAsset(id).slice(0,6);
  const st=Stops.summary({days:90,assetId:id});
  const stopRepeats=Stops.repeats().filter(r=>r.assetId===id);
  const myStops=Stops.forAsset(id).slice(0,8);
  const isDown=Stops.open().some(s=>s.assetId===id);
  const showComp=canView('compliance');
  return `
  <div class="crumb"><a href="#/home">Home</a> › <a href="#/assets">Equipment</a> › ${esc(a.id)}</div>
  <div class="ahead"><div class="big">&#9881;</div>
    <div class="who"><h1>${esc(a.name||a.id)}</h1>
      <div class="meta">Equipment <b class="mono">${esc(a.id)}</b>${a.serial?` · Serial <b class="mono">${esc(a.serial)}</b>`:''}<br>
        ${a.type?`Type: <b>${esc(a.type)}</b><br>`:''}
        ${a.manufacturer?esc(a.manufacturer):'Manufacturer not set'}${a.model?' · '+esc(a.model):''}${a.location?' · '+esc(a.location):''}
        ${a.owner?`<br>Responsible: <b>${esc(a.owner)}</b>`:''}
        ${a.hourlyCost?`<br>Downtime rate: <b>$${esc(a.hourlyCost)}/hour</b>`:''}</div>
      ${a.notes?`<div class="note" style="margin-top:12px">${esc(a.notes)}</div>`:''}
      <div style="margin-top:12px">
        ${isDown?'<span class="chip c-crit" style="font-size:13px;padding:8px 14px">DOWN RIGHT NOW</span>'
          :`<span class="chip ${a.status==='Down'?'c-crit':a.status==='Retired'?'c-hold':'c-done'}" style="font-size:13px;padding:8px 14px">${esc(a.status||'Active')}</span>`}
      </div></div>
    <div class="qrbox hide-print">${qrSvg(assetUrl(a.id),116)}<small>Scan to open</small>
      ${canView('qr')?`<button class="btn out sm" style="margin-top:8px" onclick="showQR('${jsq(a.id)}')">Tag</button>`:''}</div>
  </div>
  ${(myRepeats.length||stopRepeats.length)?`<div class="note bad">
    <b>Recurring problem on this machine.</b>
    ${myRepeats.map(r=>`<b>${esc(r.cause)}</b> ${r.count} times`).join('; ')}
    ${myRepeats.length&&stopRepeats.length?'; ':''}
    ${stopRepeats.map(r=>`<b>${esc(r.reason)}</b> ${r.count} times (${Stops.fmtMins(r.mins)}${r.parts?', '+r.parts+' parts':''} lost)`).join('; ')}.
    </div>`:''}
  ${bigActions(a.id)}
  ${hasDocs?`<div class="card doccard"><h3 class="sec">Documentation</h3>
    <div class="actions" style="margin-top:0">
      ${docLink(a.manualUrl,'Machine manual',{cls:'btn filled',icon:'&#128214;'})}
      ${docLink(a.drawingUrl,'Drawings / schematics',{cls:'btn tonal',icon:'&#128208;'})}
    </div></div>`:''}
  <div class="chipset">
    ${DB.can('createPart')?`<button class="btn out" onclick="newPartFor('${jsq(a.id)}')">&#43; Add part</button>`:''}
    ${DB.can('editAsset')?`<button class="btn out" onclick="editAsset('${jsq(a.id)}')">Edit</button>`:''}
    <button class="btn out" onclick="smartForAsset('${jsq(a.id)}')">&#128161; Past fixes</button>
  </div>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="ic" style="background:var(--info-c);color:var(--pri)">&#128203;</div>
      <div class="n">${pending.length}</div><div class="l">Pending work orders</div></div>
    <div class="stat click" onclick="setStopAsset('${jsq(a.id)}');location.hash='#/stops'">
      <div class="ic" style="background:var(--bad-c);color:var(--bad)">&#9888;</div>
      <div class="n" style="color:${st.mins?'var(--bad)':'inherit'}">${Stops.fmtMins(st.mins)}</div>
      <div class="l">Time lost (90d)</div>
      <div class="d">${st.parts?st.parts+' parts lost':st.closedCount+' events'}</div></div>
    ${showComp?`<div class="stat click" onclick="setCompAsset('${jsq(a.id)}');location.hash='#/compliance'">
      <div class="ic" style="background:var(--ok-c);color:var(--ok)">&#9989;</div>
      <div class="n" style="color:${comp.pct===null?'inherit':comp.pct>=90?'var(--ok)':comp.pct>=70?'var(--warn)':'var(--bad)'}">${comp.pct===null?'—':comp.pct+'%'}</div>
      <div class="l">PM compliance (1 yr)</div></div>`
    :`<div class="stat"><div class="ic" style="background:var(--ok-c);color:var(--ok)">&#128197;</div>
      <div class="n">${pms.length}</div><div class="l">PM schedules</div></div>`}
    <div class="stat"><div class="ic" style="background:var(--pur-c);color:var(--pur)">&#128736;</div>
      <div class="n">${done.length}</div><div class="l">Repairs completed</div>
      <div class="d">${health.hours.toFixed(1)}h logged</div></div>
  </div>
  ${myStops.length?`<div class="card">
    <h3 class="sec">Production loss — last ${myStops.length}</h3>
    ${renderTable([
      {label:'When',render:r=>esc(fmtLocal(r.startedAt))},
      {label:'Type',render:r=>`<span class="chip ${r.kind==='defect'?'c-pur':'c-prog'}">${r.kind==='defect'?'Defect':'Downtime'}</span>`},
      {label:'Reason',render:r=>`<b>${esc(r.reason||'—')}</b>`},
      {label:'Time lost',num:true,render:r=>Stops.isOpen(r)
        ?`<b style="color:var(--bad)">${Stops.fmtMins(Stops.minutes(r))}</b>`
        :Stops.fmtMins(Stops.minutes(r))},
      {label:'Parts',num:true,render:r=>Stops.partsOf(r)||'—'},
      {label:'What fixed it',hideSm:true,render:r=>r.fixedBy
        ?esc(r.fixedBy.length>40?r.fixedBy.slice(0,40)+'…':r.fixedBy)
        :'<span style="color:var(--muted)">—</span>'}
    ],myStops,{onRow:'viewStop'})}
  </div>`:''}
  ${health.total>=2?`<div class="card smartcard">
    <h3 class="sec">&#128161; Failure profile — from ${health.total} completed repairs</h3>
    <div class="grid g2" style="gap:14px">
      <div>${health.topCauses.length?`<div class="profile-label">Most common causes</div>
        ${health.topCauses.slice(0,4).map(c=>`<div class="profile-row"><span>${esc(c.cause)}</span><b>${c.count}×</b></div>`).join('')}`:''}</div>
      <div>${health.meanGap?`<div class="profile-row"><span>Average time between repairs</span><b>${health.meanGap} days</b></div>`:''}
        ${health.topPeople.length?`<div class="profile-row"><span>Knows this machine best</span><b>${esc(health.topPeople[0].name)}</b></div>`:''}</div>
    </div></div>`:''}
  <div class="card"><h3 class="sec">PM program</h3>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.procedureUrl,'Procedure attached')}`},
      {label:'Frequency',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.frequency||'—')}</span>`},
      {label:'Next due',render:r=>dueChip(r.nextDue)},
      {label:'Done',num:true,render:r=>{
        const n=Compliance.logsFor(r.id).length;
        return n?`<b>${n}×</b>`:'<span class="chip c-crit">never</span>';}},
      {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Mark done</button>`}
    ],pms.sort((x,y)=>(x.nextDue||'9999').localeCompare(y.nextDue||'9999')),
      {empty:'No PM schedules on this equipment.',onRow:'showPMHistory'})}
  </div>
  ${pmHistory.length?`<div class="card"><h3 class="sec">PM completion history</h3>
    ${renderTable([
      {label:'Completed',render:l=>`<b>${fmtDate(l.doneDate)}</b>`},
      {label:'PM',render:l=>`<span class="mono">${esc(l.pmId)}</span>`},
      {label:'On time',render:l=>Compliance.onTime(l)?'<span class="chip c-done">Yes</span>'
        :`<span class="chip c-crit">${l.daysLate}d late</span>`},
      {label:'By',render:l=>esc(l.by||'—')},
      {label:'Findings',hideSm:true,render:l=>l.notes
        ?esc(l.notes.length>44?l.notes.slice(0,44)+'…':l.notes):'<span style="color:var(--muted)">—</span>'}
    ],pmHistory)}</div>`:''}
  <div class="grid g2">
    <div class="card"><h3 class="sec">Recent repairs</h3>
      ${renderTable([
        {label:'WO',render:r=>`<b class="mono">${esc(r.id)}</b>`},
        {label:'Work done',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(r.cause||'No cause recorded')}</small>`},
        {label:'Completed',render:r=>fmtDate(r.dateCompleted)}
      ],recentRepairs,{empty:'No completed repairs yet.',onRow:'editWO'})}</div>
    <div class="card"><h3 class="sec">Open work orders</h3>
      ${renderTable([
        {label:'WO',render:r=>`<b class="mono">${esc(r.id)}</b>`},
        {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b>`},
        {label:'Assigned',render:r=>r.assignedTo?esc(r.assignedTo):'<span class="chip c-crit">Nobody</span>'}
      ],wos.filter(DB.isActive),{empty:'Nothing open.',onRow:'editWO'})}</div>
  </div>
  <div class="card"><h3 class="sec">Machine BOM${lowParts?` · ${lowParts} low`:''}</h3>
    ${renderTable([
      {label:'Part number',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Description',render:r=>`${esc(r.description||'')} ${docChip(r.docUrl,'Spec sheet')}`},
      {label:'Also fits',hideSm:true,render:r=>{
        const others=DB.partAssets(r).filter(x=>x!==id);
        if(!others.length)return '<span style="color:var(--muted)">this machine only</span>';
        return others.map(x=>`<span class="chip c-hold">${esc(DB.assetName(x))}</span>`).join(' ');}},
      {label:'Bin location',render:r=>`<span class="mono">${esc(r.location||'—')}</span>`},
      {label:'On hand',num:true,render:r=>r.qty??'—'},
      {label:'Status',render:r=>{const s=DB.partStatus(r);return `<span class="chip ${s.cls}">${s.label}</span>`;}}
    ],parts,{empty:'No parts linked yet.',onRow:'editPart'})}
    ${parts.some(p=>DB.partAssets(p).length>1)?`<div class="note">
      Parts marked "also fits" are shared with other machines — one stock
      figure, counted once, visible from every machine that uses them.</div>`:''}
  </div>`;}

function newWOFor(a){editWO(null,a);}
function newPMFor(a){editPM(null,a);}
function newPartFor(a){editPart(null,a);}

/* ============================================================
   QR TAGS
   ============================================================ */
function renderQR(){
  const assets=DB.all('assets').filter(a=>matches(a,['id','name','location','manufacturer','type']));
  const base=appBaseUrl();
  const test=qrSelfTest();
  if(!base)return `<h1 class="page">QR Tags</h1>
    <div class="note bad">This page is open as a local file, so there is no web address to encode.</div>`;
  if(!test.ok)return `<h1 class="page">QR Tags</h1>
    <div class="note bad"><b>The QR engine is not running — ${esc(test.msg)}.</b><br><br>
    Almost always this means <span class="mono">assets/qr.js</span> is missing from the deployed site.</div>`;
  if(!assets.length)return `<h1 class="page">QR Tags</h1><p class="sub">No equipment to tag yet.</p>
    <div class="placeholder">Add equipment first.</div>`;
  const site=DB.raw().meta.site||'';
  return `
  <h1 class="page">QR Tags</h1>
  <p class="sub">${assets.length} tag${assets.length===1?'':'s'} — print, cut, and stick one on each machine.</p>
  <div class="chipset hide-print">
    <button class="btn filled" onclick="window.print()">&#128424; Print these tags</button>
    <span class="chip c-done">&#10003; ${esc(test.msg)}</span></div>
  <div class="note hide-print" style="margin-top:0">
    Codes point at <span class="mono">${esc(base)}</span> —
    <b>scan one on screen before printing</b>. Print at 100% scale.</div>
  <div class="card"><div class="tagsheet">
    ${assets.map(a=>`<div class="tag">${qrSvg(assetUrl(a.id),132)}
      <div class="aid">${esc(a.id)}</div>
      <div class="anm">${esc(a.name||'')}</div>
      ${a.location?`<div class="aloc">${esc(a.location)}</div>`:''}
      <div class="brand">Tech X${site?' · '+esc(site):''}</div></div>`).join('')}
  </div></div>`;}

function showQR(id){
  const a=DB.get('assets',id);
  if(!a)return;
  const url=assetUrl(id);
  Modal.open({title:'QR tag — '+a.id,
    body:`<div class="qrbig">${qrSvg(url,240)}</div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700;font-family:'Roboto Mono',monospace">${esc(a.id)}</div>
        <div style="color:var(--muted);margin-top:4px">${esc(a.name||'')}</div></div>
      <div class="qrurl">${esc(url)}</div>`,
    footer:`<button class="btn filled" onclick="downloadTag('${jsq(id)}')">Download SVG</button>
      <button class="btn out" onclick="Modal.close()">Close</button>`});}

function downloadTag(id){
  if(!qrEngineReady()){toast('QR engine not loaded');return;}
  const svg=QR.toSVG(assetUrl(id),{size:600});
  const blob=new Blob([svg],{type:'image/svg+xml'});
  const el=document.createElement('a');
  el.href=URL.createObjectURL(blob);
  el.download='qr-'+String(id).replace(/[^a-z0-9_-]/gi,'_')+'.svg';
  el.click();URL.revokeObjectURL(el.href);
  toast('QR downloaded');}

/* ============================================================
   EQUIPMENT form
   ============================================================ */
function editAsset(id){
  if(id&&!DB.get('assets',id)){toast('That equipment no longer exists');route();return;}
  const a=id?DB.get('assets',id):{};
  const isNew=!id;
  Modal.open({title:isNew?'New equipment':'Equipment '+a.id,
    body:`${F.text('id','Equipment ID',a.id||DB.nextId('assets','',4),{required:true,readonly:!isNew})}
      ${F.text('name','Name',a.name,{required:true,placeholder:'e.g. Top Roll Assembly'})}
      ${F.text('type','Equipment type',a.type,
        {list:'dl_equiptypes',datalist:Causes.types(),
         placeholder:'e.g. Ultrasonic welder',
         hint:'Decides which reasons a technician sees when logging work or a production loss. Machines of the same type share one list.'})}
      <div class="f2">
        <div>${F.text('manufacturer','Manufacturer',a.manufacturer)}</div>
        <div>${F.text('model','Model',a.model)}</div>
        <div>${F.text('serial','Serial number',a.serial)}</div>
        <div>${F.text('project','Project number',a.project)}</div>
        <div>${F.text('location','Location / line',a.location)}</div>
        <div>${F.select('status','Status',a.status||'Active',['Active','Standby','Down','Retired'])}</div>
      </div>
      ${F.person('owner','Responsible person',a.owner,{emptyLabel:'— nobody assigned —'})}
      ${F.num('hourlyCost','Downtime cost per hour',a.hourlyCost,{step:'1',placeholder:'e.g. 500',
        hint:'Optional. Set this and every production loss on this machine gets a dollar figure. Leave blank rather than guessing.'})}
      <h3 class="sec" style="margin-top:24px">Documentation</h3>
      ${F.text('manualUrl','Machine manual link',a.manualUrl,{placeholder:'https://iacgroup.sharepoint.com/...',hint:LINK_HINT})}
      ${F.text('drawingUrl','Drawings / schematics link',a.drawingUrl,{placeholder:'https://iacgroup.sharepoint.com/...'})}
      ${F.area('notes','Notes',a.notes)}
      ${!isNew&&a.updatedBy?`<div class="note">Last changed by <b>${esc(a.updatedBy)}</b></div>`:''}`,
    footer:`<button class="btn filled" onclick="saveAsset(${isNew})">Save equipment</button>
      ${!isNew&&canView('qr')?`<button class="btn out" onclick="showQR('${jsq(a.id)}')">QR tag</button>`:''}
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delAsset('${jsq(a.id)}')">Delete</button>`:''}`});}

function saveAsset(isNew){
  const d=F.read();
  if(!d.id||!d.name){toast('Equipment ID and name are required');return;}
  if(isNew&&DB.get('assets',d.id)){toast('That equipment ID already exists');return;}
  if(d.manualUrl&&!safeUrl(d.manualUrl)){toast('The manual link is not a valid web address');return;}
  if(d.drawingUrl&&!safeUrl(d.drawingUrl)){toast('The drawings link is not a valid web address');return;}
  DB.upsert('assets',d);Modal.close();
  if(isNew)openAsset(d.id);else route();
  toast('Equipment '+d.id+' saved');}

function delAsset(id){
  const pms=DB.forAsset('pms',id).length,wos=DB.forAsset('wos',id).length;
  const stops=Stops.forAsset(id).length;
  confirmDelete(`Delete equipment ${id}?\n\n${pms} PM(s), ${wos} work order(s) and ${stops} production loss record(s) will be unlinked but not deleted.`,()=>{
    DB.remove('assets',id);Modal.close();location.hash='#/assets';toast('Equipment deleted');});}

/* ============================================================
   PM forms, completion and compliance
   ============================================================ */
function editPM(id,presetAsset){
  if(id&&!DB.get('pms',id)){toast('That PM no longer exists');route();return;}
  const p=id?DB.get('pms',id):{};
  const isNew=!id;
  const asset=DB.get('assets',p.assetId||presetAsset||'');
  const defaultTech=p.tech||(isNew&&asset?(asset.owner||''):'');
  const logs=id?Compliance.logsFor(id):[];
  Modal.open({title:isNew?'New PM schedule':'PM '+p.id,
    body:`${F.text('id','PM number',p.id||DB.nextId('pms','PM-',3),{required:true,readonly:!isNew})}
      ${F.select('assetId','Equipment',p.assetId||presetAsset||'',assetOptions(),{required:true})}
      ${F.area('description','PM description',p.description,3)}
      <div class="f2">
        <div>${F.select('frequency','Frequency',p.frequency||'monthly',FREQS)}</div>
        <div>${F.date('nextDue','Next due',p.nextDue||today())}</div>
      </div>
      ${F.person('tech','Responsible technician',defaultTech,
        {emptyLabel:'— nobody assigned —',hint:'This person sees the PM under “Your work” on Home.'})}
      ${F.text('procedureUrl','Procedure / checklist link',p.procedureUrl,
        {placeholder:'https://iacgroup.sharepoint.com/...',hint:LINK_HINT})}
      ${!isNew?`<div class="note">${logs.length?`<b>${logs.length} completion${logs.length===1?'':'s'} on record.</b>
        Changing the frequency does not alter past records.`
        :'No completions recorded yet.'}</div>`:''}`,
    footer:`<button class="btn filled" onclick="savePM(${isNew})">Save PM</button>
      ${!isNew?`<button class="btn out" onclick="Modal.close();showPMHistory('${jsq(p.id)}')">History</button>`:''}
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delPM('${jsq(p.id)}')">Delete</button>`:''}`});}

function savePM(isNew){
  const d=F.read();
  if(!d.id){toast('PM number is required');return;}
  if(isNew&&DB.get('pms',d.id)){toast('That PM number already exists');return;}
  if(d.procedureUrl&&!safeUrl(d.procedureUrl)){toast('The procedure link is not a valid web address');return;}
  DB.upsert('pms',d);Modal.close();
  WORK_TAB='pm';route();toast('PM '+d.id+' saved');}

function delPM(id){
  const logs=Compliance.logsFor(id).length;
  confirmDelete(`Delete PM ${id}?\n\n${logs?logs+' completion record(s) stay in the compliance history.':'No completion history.'}`,()=>{
    DB.remove('pms',id);Modal.close();route();toast('PM deleted');});}

function genWO(pmId){
  const p=DB.get('pms',pmId);
  if(!p){toast('That PM no longer exists');route();return;}
  const wo={id:DB.nextId('wos','WO-',4),assetId:p.assetId,
    description:p.description||('PM '+p.id),type:'Preventive',
    priority:(DB.daysUntil(p.nextDue)??99)<0?'High':'Medium',
    assignedTo:p.tech||'',docUrl:p.procedureUrl||'',
    requestedBy:DB.getWho(),dateRequested:today(),dateDue:p.nextDue||today(),
    status:'Open',pmId:p.id,cause:Causes.TBD};
  DB.upsert('wos',wo);
  WORK_TAB='wo';route();
  toast(wo.id+' created from '+p.id+(wo.assignedTo?' for '+wo.assignedTo:''));}

/* Marking a PM done writes an immutable record, THEN rolls the
   schedule forward. Order matters: if the write fails we must not
   advance the schedule, or the work looks done with nothing to
   prove it. */
function completePM(id){
  const p=DB.get('pms',id);
  if(!p){toast('That PM no longer exists');route();return;}
  const due=p.nextDue||'';
  const lateBy=due?Compliance.daysBetween(due,today()):null;
  const next=DB.bumpDue(p);
  Modal.open({title:'Complete '+p.id,
    body:`<div class="pmhead">
        <div class="pmhead-task">${esc(p.description||'PM '+p.id)}</div>
        <div class="pmhead-meta">${esc(DB.assetName(p.assetId))} ·
          ${esc(p.frequency||'')} ${due?'· was due '+fmtDate(due):''}</div></div>
      ${lateBy!==null&&lateBy>Compliance.GRACE_DAYS?`<div class="note bad">
        This is <b>${lateBy} days past due</b>. That is recorded as-is — the history is
        only worth anything if it is honest.</div>`:''}
      ${F.date('doneDate','Date completed',today(),{required:true,
        hint:'Change this if the work was actually done on a different day.'})}
      ${F.person('by','Completed by',DB.getWho(),{required:true,emptyLabel:'— select —'})}
      ${F.num('hours','Hours taken','',{step:'0.25',placeholder:'e.g. 0.5'})}
      ${F.area('notes','What you found','',3,{
        placeholder:'e.g. Sonotrode faces clean, weld quality within spec, no action needed.',
        hint:'Findings matter even when nothing was wrong — "checked, all normal" is a valid record.'})}
      <div class="note">Saving writes a permanent completion record and moves the next due date to
        <b>${fmtDate(next)}</b>. Completion records cannot be edited afterwards.</div>`,
    footer:`<button class="btn ok" onclick="doCompletePM('${jsq(id)}')">Record completion</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>`});}

function doCompletePM(id,opts={}){
  const p=DB.get('pms',id);
  if(!p){toast('That PM no longer exists');return;}
  const d=opts.silent?opts:F.read();
  const doneDate=d.doneDate||today();
  const by=(d.by||'').trim()||DB.getWho();
  if(!by){toast('Record who completed it');return;}
  const log=Compliance.buildLog(p,{
    id:DB.nextId('pmlogs','PMC-',5),
    doneDate,by,hours:d.hours||'',notes:d.notes||'',woId:opts.woId||''});
  DB.upsert('pmlogs',log);
  const next=DB.bumpDue(Object.assign({},p,{nextDue:p.nextDue||doneDate}));
  DB.upsert('pms',{id:p.id,lastDone:doneDate,nextDue:next,lastDoneBy:by});
  if(!opts.silent)Modal.close();
  route();
  const lateNote=log.daysLate!==null&&log.daysLate>Compliance.GRACE_DAYS
    ?' ('+log.daysLate+' days late)':'';
  toast(p.id+' recorded'+lateNote+' — next due '+fmtDate(next));}

function showPMHistory(id){
  const r=Compliance.pmRecord(id);
  if(!r.pm){toast('That PM no longer exists');return;}
  Modal.open({title:'History — '+id,
    body:`<div class="pmhead">
        <div class="pmhead-task">${esc(r.pm.description||'')}</div>
        <div class="pmhead-meta">${esc(DB.assetName(r.pm.assetId))} · ${esc(r.pm.frequency||'')}</div></div>
      ${r.count?`<div class="grid g2" style="gap:12px;margin:16px 0">
        <div class="statmini"><div class="n">${r.count}</div><div class="l">completions on record</div></div>
        <div class="statmini"><div class="n" style="color:${r.pct>=90?'var(--ok)':r.pct>=70?'var(--warn)':'var(--bad)'}">${r.pct}%</div><div class="l">done on time</div></div>
      </div>
      ${r.drifting?`<div class="note bad">
        <b>Scheduled every ${r.scheduled} days, actually done every ${r.actualInterval}.</b>
        Either the schedule is tighter than it needs to be, or this PM keeps slipping.</div>`
      :r.actualInterval?`<div class="note">Scheduled every ${r.scheduled||'—'} days,
        actually done every ${r.actualInterval} on average.</div>`:''}
      <h3 class="sec" style="margin-top:20px">Every completion</h3>
      <div class="pmlogs">
        ${r.logs.map(l=>`<div class="pmlog ${Compliance.onTime(l)?'':'late'}">
          <div class="pmlog-hd"><b>${fmtDate(l.doneDate)}</b>
            ${Compliance.onTime(l)?'<span class="chip c-done">On time</span>'
              :`<span class="chip c-crit">${l.daysLate} days late</span>`}
            <span class="pmlog-by">${esc(l.by||'unrecorded')}</span></div>
          <div class="pmlog-meta">was due ${fmtDate(l.dueDate)}${l.hours?' · '+esc(l.hours)+'h':''}${l.woId?' · '+esc(l.woId):''}</div>
          ${l.notes?`<div class="pmlog-notes">${esc(l.notes)}</div>`
            :'<div class="pmlog-notes empty-notes">No findings recorded.</div>'}
        </div>`).join('')}</div>`
      :`<div class="empty"><b style="display:block;color:var(--ink);margin-bottom:6px">Never completed</b>
          There is no record of this PM ever being done.</div>`}`,
    footer:`<button class="btn ok" onclick="Modal.close();completePM('${jsq(id)}')">Record a completion</button>
      <button class="btn out" onclick="Modal.close();editPM('${jsq(id)}')">Edit PM</button>
      <button class="btn out" onclick="Modal.close()">Close</button>`});}

function setCompDays(d){COMP_DAYS=d;route();}
function setCompAsset(a){COMP_ASSET=a;route();}

function renderCompliance(){
  const s=Compliance.summary({days:COMP_DAYS,assetId:COMP_ASSET});
  const people=Compliance.byPerson(COMP_DAYS);
  const never=Compliance.neverDone();
  const assets=DB.all('assets');
  const pctColor=p=>p===null?'var(--muted)':p>=90?'var(--ok)':p>=70?'var(--warn)':'var(--bad)';
  return `
  <h1 class="page">PM Compliance</h1>
  <p class="sub">Evidence of preventive maintenance actually performed — every line is a permanent record.</p>
  <div class="chipset">
    <button class="fchip ${COMP_DAYS===30?'on':''}" onclick="setCompDays(30)">30 days</button>
    <button class="fchip ${COMP_DAYS===90?'on':''}" onclick="setCompDays(90)">90 days</button>
    <button class="fchip ${COMP_DAYS===365?'on':''}" onclick="setCompDays(365)">12 months</button>
    <select onchange="setCompAsset(this.value)" style="width:auto;min-width:200px">
      ${[{v:'',t:'All equipment'}].concat(assets.map(a=>({v:a.id,t:a.id+' · '+a.name})))
        .map(o=>`<option value="${esc(o.v)}" ${COMP_ASSET===o.v?'selected':''}>${esc(o.t)}</option>`).join('')}
    </select>
    <button class="btn out" onclick="exportCompliance()">&#128196; Export for audit</button>
  </div>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="n" style="color:${pctColor(s.pct)}">${s.pct===null?'—':s.pct+'%'}</div>
      <div class="l">Completed on time</div><div class="d">${s.onTime} of ${s.done}</div></div>
    <div class="stat"><div class="n">${s.done}</div><div class="l">PMs completed</div>
      <div class="d">last ${COMP_DAYS} days</div></div>
    <div class="stat"><div class="n" style="color:${s.late?'var(--bad)':'inherit'}">${s.late}</div>
      <div class="l">Completed late</div><div class="d">more than ${Compliance.GRACE_DAYS} days past due</div></div>
    <div class="stat"><div class="n" style="color:${s.overdueNow?'var(--bad)':'var(--ok)'}">${s.overdueNow}</div>
      <div class="l">Overdue right now</div></div>
  </div>
  ${s.overdueNow?`<div class="card"><h3 class="sec">Overdue today — fix these first</h3>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Was due',render:r=>dueChip(r.nextDue)},
      {label:'Responsible',render:r=>r.tech?esc(r.tech):'<span class="chip c-crit">Nobody</span>'},
      {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Record done</button>`}
    ],s.overdueList,{onRow:'showPMHistory'})}</div>`:''}
  ${never.length?`<div class="card"><h3 class="sec">Never completed — ${never.length} schedule${never.length===1?'':'s'}</h3>
    <div class="note bad">These PMs have no completion on record at all.</div>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Frequency',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.frequency||'—')}</span>`},
      {label:'Next due',render:r=>dueChip(r.nextDue)}
    ],never,{onRow:'showPMHistory'})}</div>`:''}
  <div class="card"><h3 class="sec">Completion log — last ${COMP_DAYS} days</h3>
    ${renderTable([
      {label:'Completed',render:l=>`<b>${fmtDate(l.doneDate)}</b>`},
      {label:'PM',render:l=>`<span class="mono">${esc(l.pmId)}</span>`},
      {label:'Task',render:l=>`${esc(l.description||'—')}<br><small style="color:var(--muted)">${esc(DB.assetName(l.assetId))}</small>`},
      {label:'Was due',hideSm:true,render:l=>fmtDate(l.dueDate)},
      {label:'On time',render:l=>Compliance.onTime(l)?'<span class="chip c-done">Yes</span>'
        :`<span class="chip c-crit">${l.daysLate}d late</span>`},
      {label:'By',render:l=>esc(l.by||'—')},
      {label:'Findings',hideSm:true,render:l=>l.notes
        ?esc(l.notes.length>60?l.notes.slice(0,60)+'…':l.notes)
        :'<span style="color:var(--muted)">—</span>'}
    ],s.logs,{empty:'No PM completions recorded in this period.'})}
    ${s.done?`<div class="note">${s.documented} of ${s.done} (${s.docPct}%) recorded what was found.</div>`:''}
  </div>
  ${people.length?`<div class="card"><h3 class="sec">By technician — last ${COMP_DAYS} days</h3>
    ${renderTable([
      {label:'Technician',render:r=>`<b>${esc(r.name)}</b>`},
      {label:'Completed',num:true,render:r=>r.done},
      {label:'On time',num:true,render:r=>r.done-r.late},
      {label:'Late',num:true,render:r=>r.late?`<b style="color:var(--bad)">${r.late}</b>`:'0'},
      {label:'On-time rate',render:r=>`<span style="color:${pctColor(r.pct)};font-weight:600">${r.pct}%</span>`}
    ],people)}
    <div class="note">Late is usually a scheduling or workload problem rather than a person problem.</div>
  </div>`:''}`;}

function exportCompliance(){
  const rows=Compliance.exportRows({assetId:COMP_ASSET});
  if(!rows.length){toast('No completion records to export');return;}
  CSV.download('pm-compliance-'+today()+'.csv',CSV.build(Compliance.EXPORT_COLUMNS,rows));
  toast(rows.length+' completion records exported');}

/* ============================================================
   WORK ORDER form + calendar
   ============================================================ */
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function calShift(n){
  let m=CAL.m+n,y=CAL.y;
  while(m<0){m+=12;y--;}
  while(m>11){m-=12;y++;}
  CAL.y=y;CAL.m=m;route();}
function calToday(){const d=new Date();CAL.y=d.getFullYear();CAL.m=d.getMonth();route();}
function calTogglePMs(){CAL.pms=!CAL.pms;route();}

function renderWOCalendar(){
  const startPad=new Date(CAL.y,CAL.m,1).getDay();
  const daysInMonth=new Date(CAL.y,CAL.m+1,0).getDate();
  const todayIso=today();
  const byDay={};
  const push=(iso,html)=>{if(!iso)return;(byDay[iso]=byDay[iso]||[]).push(html);};
  DB.all('wos').filter(w=>matches(w,['id','description','assetId','assignedTo','status'])).forEach(w=>{
    const cls=DB.isDone(w)?'ev-done':w.status==='In Progress'?'ev-prog'
      :(w.status==='On Hold'||w.status==='Cancelled')?'ev-hold':'ev-open';
    const who=w.assignedTo?' · '+w.assignedTo:'';
    push(DB.woDate(w),`<div class="ev ${cls}" title="${esc(w.id+' · '+(w.description||'')+who)}"
      onclick="editWO('${jsq(w.id)}')">${esc(w.id)} ${esc((w.description||'').slice(0,20))}</div>`);});
  if(CAL.pms){
    DB.all('pms').forEach(p=>{
      const who=p.tech?' · '+p.tech:'';
      push(p.nextDue,`<div class="ev ev-pm" title="${esc(p.id+' · '+(p.description||'')+who)}"
        onclick="showPMHistory('${jsq(p.id)}')">${esc(p.id)} ${esc((p.description||'').slice(0,18))}</div>`);});
    DB.all('pmlogs').forEach(l=>{
      push(l.doneDate,`<div class="ev ev-pmdone" title="${esc(l.pmId+' completed by '+(l.by||''))}"
        onclick="showPMHistory('${jsq(l.pmId)}')">&#10003; ${esc(l.pmId)}</div>`);});}
  DB.all('stops').forEach(s=>{
    const day=String(s.startedAt||'').slice(0,10);
    if(!day)return;
    const parts=Stops.partsOf(s);
    push(day,`<div class="ev ev-stop" title="${esc((s.reason||'')+' · '+DB.assetName(s.assetId))}"
      onclick="viewStop('${jsq(s.id)}')">&#9888; ${esc(Stops.fmtMins(Stops.minutes(s)))}${parts?' · '+parts+'p':''}</div>`);});
  let cells='';
  for(let i=0;i<startPad;i++)cells+='<div class="day pad"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const iso=`${CAL.y}-${String(CAL.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells+=`<div class="day ${iso===todayIso?'today':''}"><div class="dnum">${d}</div>${(byDay[iso]||[]).join('')}</div>`;}
  const prefix=`${CAL.y}-${String(CAL.m+1).padStart(2,'0')}`;
  const monthCount=Object.keys(byDay).filter(k=>k.startsWith(prefix)).reduce((s,k)=>s+byDay[k].length,0);
  return `<div class="card">
    <div class="calbar">
      <button class="btn out sm" onclick="calShift(-1)">&#8249; Prev</button>
      <div class="mo">${MONTHS[CAL.m]} ${CAL.y}</div>
      <button class="btn out sm" onclick="calShift(1)">Next &#8250;</button>
      <button class="btn tonal sm" onclick="calToday()">Today</button>
      <button class="fchip ${CAL.pms?'on':''}" onclick="calTogglePMs()">Show PMs</button>
      <span style="color:var(--muted);font-size:12.5px;margin-left:auto">${monthCount} item${monthCount===1?'':'s'} this month</span>
    </div>
    <div class="cal">${DOW.map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="legend">
      <span><i style="background:var(--info-c)"></i>Open</span>
      <span><i style="background:var(--warn-c)"></i>In progress</span>
      <span><i style="background:var(--ok-c)"></i>Completed</span>
      ${CAL.pms?'<span><i style="background:var(--pur-c)"></i>PM due</span><span><i style="background:#d7f0dd"></i>PM done</span>':''}
      <span><i style="background:#ffd9d6"></i>Production loss</span>
    </div></div>`;}

/* The cause list depends on which machine is picked, so changing
   the machine rebuilds it. */
function refreshWOCause(excludeId){
  const box=document.getElementById('woCauseBox');
  if(!box)return;
  const d=F.read();
  const a=DB.get('assets',d.assetId||'');
  box.innerHTML=F.select('cause','Cause of failure',d.cause||Causes.TBD,
    Causes.options('failure',a&&a.type?a.type:'',d.cause||'',{tbd:true}),
    {onchange:`refreshSimilar('${jsq(excludeId||'')}')`})+
    (a&&a.type?`<div class="hint">List for <b>${esc(a.type)}</b>.</div>`:'');
  refreshSimilar(excludeId);}

function editWO(id,presetAsset){
  if(id&&!DB.get('wos',id)){toast('That work order no longer exists');route();return;}
  const w=id?DB.get('wos',id):{};
  const isNew=!id;
  const assetId=w.assetId||presetAsset||'';
  const asset=DB.get('assets',assetId);
  const exclude=w.id||'';
  /* Parts that fit this machine, plus whatever was already chosen. */
  const partOpts=[{v:'',t:'— none —'}].concat(
    DB.all('parts').filter(p=>!assetId||!DB.partAssets(p).length||DB.partFits(p,assetId)||p.id===w.partsUsed)
      .map(p=>({v:p.id,t:p.id+' · '+(p.description||'')})));
  Modal.open({title:isNew?'New work order':'Work order '+w.id,
    body:`${F.text('id','Work order number',w.id||DB.nextId('wos','WO-',4),{required:true,readonly:!isNew})}
      ${F.select('assetId','Equipment',assetId,assetOptions(),
        {required:true,onchange:`refreshWOCause('${jsq(exclude)}')`})}
      ${asset&&(safeUrl(asset.manualUrl)||safeUrl(asset.drawingUrl))?`<div class="actions" style="margin-top:10px">
        ${docLink(asset.manualUrl,'Machine manual',{cls:'btn tonal sm',icon:'&#128214;'})}
        ${docLink(asset.drawingUrl,'Drawings',{cls:'btn tonal sm',icon:'&#128208;'})}</div>`:''}
      ${F.area('description','Description of work',w.description,3,{oninput:`refreshSimilar('${jsq(exclude)}')`})}
      <div id="similarBox">${similarPanel(assetId,w.description||'',w.cause||'',exclude)}</div>
      <div class="f2">
        <div>${F.select('type','Work type',w.type||'Repair',WO_TYPES)}</div>
        <div>${F.select('priority','Priority',w.priority||'Medium',PRIORITIES)}</div>
      </div>
      ${F.person('assignedTo','Assigned to',w.assignedTo,{emptyLabel:'— nobody assigned —'})}
      <div class="f2">
        <div>${F.person('requestedBy','Requested by',w.requestedBy||(isNew?DB.getWho():''),{emptyLabel:'— not recorded —'})}</div>
        <div>${F.select('status','Status',w.status||'Open',WO_STATUS)}</div>
        <div>${F.date('dateRequested','Date requested',w.dateRequested||today())}</div>
        <div>${F.date('dateDue','Scheduled date (calendar)',w.dateDue)}</div>
        <div>${F.date('dateStarted','Date started',w.dateStarted)}</div>
        <div>${F.date('dateCompleted','Date completed',w.dateCompleted)}</div>
        <div>${F.num('hours','Labour hours',w.hours,{step:'0.5'})}</div>
        <div>${F.num('cost','Cost',w.cost,{step:'0.01'})}</div>
      </div>
      <div id="woCauseBox">${F.select('cause','Cause of failure',w.cause||Causes.TBD,
        Causes.options('failure',asset&&asset.type?asset.type:'',w.cause||'',{tbd:true}),
        {onchange:`refreshSimilar('${jsq(exclude)}')`})}</div>
      ${F.select('partsUsed','Parts used',w.partsUsed,partOpts)}
      ${F.area('notes','What you found and what you did',w.notes,4,
        {placeholder:'e.g. Sonotrode face was pitted. Swapped in CT_12672, retorqued stack to 45 Nm.',
         hint:'This is what the next person sees when the same thing happens again.'})}
      ${F.text('docUrl','Reference document link',w.docUrl,{placeholder:'https://...',hint:LINK_HINT})}
      ${w.pmId?`<div class="note">Generated from PM <b>${esc(w.pmId)}</b>.
        Completing this also records a PM completion.</div>`:''}
      ${w.stopId?`<div class="note">Raised from production loss <b>${esc(w.stopId)}</b>.
        <a href="#" onclick="Modal.close();viewStop('${jsq(w.stopId)}');return false;">Open it</a>.</div>`:''}
      ${!isNew&&w.updatedBy?`<div class="note">Last changed by <b>${esc(w.updatedBy)}</b></div>`:''}`,
    footer:`<button class="btn filled" onclick="saveWO(${isNew})">Save work order</button>
      ${!isNew&&w.status!=='Completed'?`<button class="btn ok" onclick="closeWO('${jsq(w.id)}')">Complete</button>`:''}
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delWO('${jsq(w.id)}')">Delete</button>`:''}`});}

function saveWO(isNew){
  const d=F.read();
  if(!d.id){toast('Work order number is required');return;}
  if(!d.assetId){toast('Pick the equipment this work order is for');return;}
  if(isNew&&DB.get('wos',d.id)){toast('That work order number already exists');return;}
  if(d.docUrl&&!safeUrl(d.docUrl)){toast('The document link is not a valid web address');return;}
  DB.upsert('wos',d);Modal.close();
  WORK_TAB='wo';route();toast('Work order '+d.id+' saved');}

function closeWO(id){
  const d=F.read();
  if(!d.cause||d.cause===Causes.TBD){toast('Record a cause of failure before completing');return;}
  if(!d.notes||d.notes.trim().length<10){
    if(!confirm('No notes written.\n\nWhat you found and what you did is what the next person sees when this happens again.\n\nClose it anyway?')){
      const el=document.getElementById('f_notes');
      if(el)el.focus();
      return;}}
  d.status='Completed';
  if(!d.dateCompleted)d.dateCompleted=today();
  if(!d.assignedTo)d.assignedTo=DB.getWho();
  d.completedBy=DB.getWho();
  DB.upsert('wos',d);
  /* A work order generated from a PM is how that PM gets done. */
  const w=DB.get('wos',id);
  if(w&&w.pmId){
    const p=DB.get('pms',w.pmId);
    if(p){
      doCompletePM(p.id,{silent:true,woId:w.id,
        doneDate:d.dateCompleted,by:d.assignedTo||DB.getWho(),
        hours:d.hours||'',notes:d.notes||''});
      Modal.close();route();
      toast(id+' completed — '+p.id+' logged as done');
      return;}}
  Modal.close();route();toast(id+' completed');}

function delWO(id){
  confirmDelete('Delete work order '+id+'?',()=>{
    DB.remove('wos',id);Modal.close();route();toast('Work order deleted');});}

/* ============================================================
   SPARE PARTS — one part can fit several machines
   ============================================================ */
function renderParts(){
  const rows=DB.all('parts').filter(p=>matches(p,['id','description','mfrPn','vendor','location','assetId']));
  const value=rows.reduce((s,p)=>{
    const q=DB.num(p.qty),c=DB.num(p.cost);
    return s+(q!==null&&c!==null?q*c:0);},0);
  const low=rows.filter(p=>DB.partStatus(p).label==='Low stock').length;
  const shared=rows.filter(p=>DB.partAssets(p).length>1).length;
  return `
  <h1 class="page">Spare Parts</h1>
  <p class="sub">${rows.length} part${rows.length===1?'':'s'} in the crib${shared?` · ${shared} shared across machines`:''}</p>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="n">${rows.length}</div><div class="l">Parts tracked</div></div>
    <div class="stat"><div class="n" style="color:${low?'var(--bad)':'inherit'}">${low}</div><div class="l">At or below minimum</div></div>
    <div class="stat"><div class="n">${shared}</div><div class="l">Fit more than one machine</div></div>
    <div class="stat"><div class="n">${value?'$'+value.toLocaleString(undefined,{maximumFractionDigits:0}):'—'}</div><div class="l">Inventory value</div></div>
  </div>
  <div class="chipset">
    ${DB.can('createPart')?'<button class="btn filled" onclick="editPart()">&#43; New part</button>':''}
    <button class="btn out" onclick="exportCSV('parts')">Export CSV</button>
  </div>
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">Parts list</h3>
    ${renderTable([
      {label:'Part number',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.docUrl,'Spec sheet')}`},
      {label:'Fits',render:r=>{
        const ids=DB.partAssets(r);
        if(!ids.length)return '<span style="color:var(--muted)">not linked</span>';
        if(ids.length===1)return esc(DB.assetName(ids[0]));
        /* Naming every machine makes the column unreadable once a part
           fits five of them; the count plus the first is enough to
           recognise it, and the full list is one tap away. */
        return `<b>${ids.length} machines</b><br><small style="color:var(--muted)">${
          esc(DB.assetName(ids[0]))} +${ids.length-1} more</small>`;}},
      {label:'Mfr P/N',hideSm:true,render:r=>`<span class="mono">${esc(r.mfrPn||'—')}</span>`},
      {label:'Location',render:r=>`<span class="mono">${esc(r.location||'—')}</span>`},
      {label:'On hand',num:true,render:r=>r.qty??'—'},
      {label:'Min',num:true,hideSm:true,render:r=>r.min??'—'},
      {label:'Status',render:r=>{const s=DB.partStatus(r);return `<span class="chip ${s.cls}">${s.label}</span>`;}},
      {label:'',render:r=>DB.can('countPart')
        ?`<button class="btn tonal sm" onclick="event.stopPropagation();countPart('${jsq(r.id)}')">Count</button>`:''}
    ],rows,{empty:'No parts yet.',onRow:'editPart'})}
  </div>`;}

function editPart(id,presetAsset){
  if(id&&!DB.get('parts',id)){toast('That part no longer exists');route();return;}
  const p=id?DB.get('parts',id):{};
  const isNew=!id;
  /* Pre-tick whichever machine we came from. */
  const selected=isNew?(presetAsset?[presetAsset]:[]):DB.partAssets(p);
  Modal.open({title:isNew?'New part':'Part '+p.id,
    body:`${safeUrl(p.imageUrl)?`<div class="prev"><img src="${esc(safeUrl(p.imageUrl))}" alt="" onerror="this.parentNode.style.display='none'"/></div>`:''}
      ${F.text('id','Part number',p.id||DB.nextId('parts','P-',4),{required:true,readonly:!isNew})}
      ${F.text('description','Description',p.description,{required:true})}
      ${F.checks('assetIds','Fits which equipment',selected,assetChecklist(),
        {hint:'Tick every machine this part fits. One stock figure, counted once, visible from each of them.'})}
      <div class="f2">
        <div>${F.text('mfrPn','Manufacturer part number',p.mfrPn)}</div>
        <div>${F.text('vendor','Vendor',p.vendor)}</div>
        <div>${F.text('location','Storage location',p.location,{placeholder:'e.g. SP1-E3-A5'})}</div>
        <div>${F.num('cost','Unit cost',p.cost,{step:'0.01'})}</div>
        <div>${F.num('qty','Quantity on hand',p.qty,{step:'1'})}</div>
        <div>${F.num('min','Minimum quantity',p.min,{step:'1'})}</div>
      </div>
      ${F.text('imageUrl','Picture link',p.imageUrl,{placeholder:'https://…'})}
      ${F.text('docUrl','Spec sheet / manual link',p.docUrl,{placeholder:'https://…',hint:LINK_HINT})}`,
    footer:`<button class="btn filled" onclick="savePart(${isNew})">Save part</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delPart('${jsq(p.id)}')">Delete</button>`:''}`});}

function savePart(isNew){
  const d=F.read();
  if(!d.id||!d.description){toast('Part number and description are required');return;}
  if(isNew&&DB.get('parts',d.id)){toast('That part number already exists');return;}
  if(d.docUrl&&!safeUrl(d.docUrl)){toast('The document link is not a valid web address');return;}
  /* Writes assetIds AND assetId so anything still reading the old
     single field — CSV export, an older cached client — keeps working. */
  const rec=Object.assign({},d,DB.partAssetFields(d.assetIds));
  DB.upsert('parts',rec);Modal.close();route();
  const n=rec.assetIds.length;
  toast('Part '+rec.id+' saved'+(n>1?' — fits '+n+' machines':''));}

function delPart(id){
  confirmDelete('Delete part '+id+'?',()=>{DB.remove('parts',id);Modal.close();route();toast('Part deleted');});}
function countPart(id){
  const p=DB.get('parts',id);
  if(!p){toast('That part no longer exists');route();return;}
  const v=prompt('Quantity on hand for '+id+' ('+(p.description||'')+'):',p.qty??'');
  if(v===null)return;
  DB.upsert('parts',{id,qty:v.trim(),countedBy:DB.getWho(),countedOn:today()});
  route();toast(id+' counted — '+v+' on hand');}

/* ============================================================
   CSV IMPORT (admin)
   ============================================================ */
let IMPORT={entity:'assets',headers:[],records:[],map:{},filename:''};
const ENTITY_LABEL={assets:'Equipment',pms:'PM Schedule',parts:'Spare Parts',
  wos:'Work Orders',pmlogs:'PM Completion History',stops:'Production Loss',
  causes:'Cause Lists'};

function renderImport(){
  const fieldList=e=>Object.keys(CSV.ALIAS[e]).join(', ');
  return `
  <h1 class="page">Import CSV</h1>
  <p class="sub">Drop a spreadsheet export in and map the columns.</p>
  <div class="card"><h3 class="sec">1 · Choose what you are importing</h3>
    <div class="chipset">${Object.keys(ENTITY_LABEL).map(e=>
      `<button class="fchip ${IMPORT.entity===e?'on':''}" onclick="setImportEntity('${e}')">${ENTITY_LABEL[e]}</button>`).join('')}</div>
    <div class="note">Recognised fields for <b>${ENTITY_LABEL[IMPORT.entity]}</b>: <span class="mono">${fieldList(IMPORT.entity)}</span>.
      ${IMPORT.entity==='parts'?`<br><br><b>A part that fits several machines:</b> put every
      equipment number in one cell separated by semicolons — <span class="mono">3526;3527;3530</span>
      — and map that column to <span class="mono">assetIds</span>.`:''}
      ${IMPORT.entity==='stops'?`<br><br>Times can be <span class="mono">YYYY-MM-DD HH:MM</span>.
      A row with no end time imports as still open. Map your scrap count to
      <span class="mono">qty</span> so parts lost is counted.`:''}
      ${IMPORT.entity==='causes'?`<br><br>Bulk-load your reason lists. <span class="mono">kind</span>
      must be <span class="mono">downtime</span>, <span class="mono">defect</span> or
      <span class="mono">failure</span>; <span class="mono">equipType</span> must match the type
      on the equipment record, or be blank for plant-wide.`:''}</div>
  </div>
  <div class="card"><h3 class="sec">2 · Load the file</h3>
    <div class="drop" id="drop" ondragover="event.preventDefault();this.classList.add('over')"
      ondragleave="this.classList.remove('over')" ondrop="dropFile(event)"
      onclick="document.getElementById('fileIn').click()">
      <span class="big">&#128193;</span><b>Drop a .csv file here</b><br>
      <small style="color:var(--muted)">or tap to browse${IMPORT.filename?' — loaded: <b>'+esc(IMPORT.filename)+'</b>':''}</small>
    </div>
    <input type="file" id="fileIn" accept=".csv,text/csv" style="display:none" onchange="pickFile(event)"/>
  </div>
  ${IMPORT.records.length?renderMapStep():''}`;}

function renderMapStep(){
  const fields=['— ignore —'].concat(Object.keys(CSV.ALIAS[IMPORT.entity]));
  const mapped=Object.values(IMPORT.map).filter(Boolean).length;
  const rowsHtml=IMPORT.headers.map(h=>`<tr>
      <td><b class="mono">${esc(h)}</b></td>
      <td><small style="color:var(--muted)">${esc((IMPORT.records[0]||{})[h]||'')}</small></td>
      <td><select onchange="setMap('${jsq(h)}',this.value)">
        ${fields.map(f=>{
          const val=f==='— ignore —'?'':f;
          return `<option value="${esc(val)}" ${IMPORT.map[h]===val||(!IMPORT.map[h]&&!val)?'selected':''}>${esc(f)}</option>`;
        }).join('')}</select></td></tr>`).join('');
  const preview=CSV.applyMap(IMPORT.records.slice(0,5),IMPORT.map);
  const cols=Object.keys(CSV.ALIAS[IMPORT.entity]);
  return `<div class="card">
    <h3 class="sec">3 · Map the columns — ${mapped} of ${IMPORT.headers.length} mapped</h3>
    <div class="tablewrap"><table><thead><tr><th>Column in your file</th><th>First value</th><th>Import as</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div></div>
  <div class="card">
    <h3 class="sec">4 · Preview — first ${preview.length} of ${IMPORT.records.length} rows</h3>
    <div class="tablewrap"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${preview.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${!Object.values(IMPORT.map).includes('id')
      ?`<div class="note bad">No column is mapped to <b>id</b>. Every row will be imported as a new record.</div>`
      :`<div class="note">Rows are matched on <b>id</b>.</div>`}
    <div class="actions">
      <button class="btn filled" onclick="runImport()">Import ${IMPORT.records.length} rows</button>
      <button class="btn out" onclick="cancelImport()">Cancel</button></div></div>`;}

function setImportEntity(e){
  IMPORT.entity=e;
  if(IMPORT.headers.length)IMPORT.map=CSV.mapHeaders(e,IMPORT.headers);
  route();}
function setMap(h,f){IMPORT.map[h]=f||null;route();}
function cancelImport(){IMPORT={entity:IMPORT.entity,headers:[],records:[],map:{},filename:''};route();}
function pickFile(ev){const f=ev.target.files[0];if(f)readCSVFile(f);}
function dropFile(ev){
  ev.preventDefault();
  const el=document.getElementById('drop');if(el)el.classList.remove('over');
  const f=ev.dataTransfer.files[0];if(f)readCSVFile(f);}
function readCSVFile(file){
  const r=new FileReader();
  r.onload=()=>{
    const {headers,records}=CSV.toObjects(r.result);
    if(!records.length){toast('That file has no data rows');return;}
    IMPORT.filename=file.name;IMPORT.headers=headers;IMPORT.records=records;
    IMPORT.map=CSV.mapHeaders(IMPORT.entity,headers);
    route();toast(records.length+' rows read from '+file.name);};
  r.readAsText(file);}

function runImport(){
  const clean=CSV.applyMap(IMPORT.records,IMPORT.map);
  const prefix={assets:'',pms:'PM-',parts:'P-',wos:'WO-',pmlogs:'PMC-',stops:'EV-',causes:'CZ-'}[IMPORT.entity];
  const pad=(IMPORT.entity==='pmlogs'||IMPORT.entity==='stops')?5:4;
  clean.forEach((r,i)=>{
    if(!r.id)r.id=DB.nextId(IMPORT.entity,prefix,pad)+(i?'-'+i:'');
    if(IMPORT.entity==='pmlogs'&&r.dueDate&&r.doneDate&&r.daysLate===undefined){
      r.daysLate=Compliance.daysBetween(r.dueDate,r.doneDate);}
    if(IMPORT.entity==='stops'){
      /* A spreadsheet writes "2026-09-15 08:30"; the app stores
         "2026-09-15T08:30". Normalise so durations compute. */
      ['startedAt','endedAt'].forEach(k=>{
        if(r[k])r[k]=String(r[k]).trim().replace(' ','T').slice(0,16);});
      const k=String(r.kind||'').toLowerCase();
      r.kind=k.includes('defect')||k.includes('quality')||k.includes('scrap')?'defect':'downtime';}
    if(IMPORT.entity==='parts'){
      /* "3526;3527" in one cell becomes a proper list, and the legacy
         single field is filled so nothing reading it breaks. */
      const ids=[];
      const push=v=>String(v||'').split(/[;,|]/).forEach(x=>{
        const s=x.trim();if(s&&!ids.includes(s))ids.push(s);});
      push(r.assetIds);push(r.assetId);
      Object.assign(r,DB.partAssetFields(ids));}
    if(IMPORT.entity==='causes'){
      const k=String(r.kind||'').toLowerCase();
      r.kind=k.includes('defect')?'defect':k.includes('fail')?'failure':'downtime';
      r.equipType=String(r.equipType||'').trim();}});
  const {added,updated}=DB.bulkUpsert(IMPORT.entity,clean);
  const ent=IMPORT.entity;
  cancelImport();
  toast(`Imported — ${added} added, ${updated} updated`);
  if(ent==='wos')WORK_TAB='wo';
  if(ent==='pms')WORK_TAB='pm';
  location.hash='#/'+({assets:'assets',pms:'pm',parts:'parts',wos:'wo',
    pmlogs:'compliance',stops:'stops',causes:'causes'}[ent]);}

function exportCSV(entity){
  const fields=Object.keys(CSV.ALIAS[entity]);
  const rows=DB.all(entity).map(r=>{
    if(entity!=='parts')return r;
    /* Export the full list in one cell so a round trip keeps every
       machine, not just the first. */
    return Object.assign({},r,{assetIds:DB.partAssets(r).join(';')});});
  if(!rows.length){toast('Nothing to export');return;}
  CSV.download(entity+'-'+today()+'.csv',CSV.build(fields,rows));
  toast(rows.length+' rows exported');}

/* ============================================================
   USERS (admin)
   ============================================================ */
function renderUsers(){
  if(!USERS.length)refreshUsers();
  const meU=DB.status().username;
  const wos=DB.all('wos'),pms=DB.all('pms');
  const pmPerf=Compliance.byPerson(90);
  const load=name=>({
    open:wos.filter(w=>DB.isActive(w)&&(w.assignedTo||'')===name).length,
    pms:pms.filter(p=>(p.tech||'')===name).length,
    perf:pmPerf.find(x=>x.name===name)});
  return `
  <h1 class="page">Users</h1>
  <p class="sub">${USERS.length?USERS.length+' account'+(USERS.length===1?'':'s'):'Loading…'}</p>
  <div class="chipset">
    <button class="btn filled" onclick="openAddUser()">&#43; Add person</button>
    <button class="btn out" onclick="refreshUsers()">Refresh</button></div>
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">Accounts and workload</h3>
    ${renderTable([
      {label:'Name',render:r=>`<b>${esc(r.full_name)}</b>${r.username===meU?' <span class="chip c-open">you</span>':''}`},
      {label:'Role',render:r=>`<span class="chip ${r.role==='admin'?'c-pur':'c-open'}">${esc(ROLE_LABEL[r.role]||r.role)}</span>`},
      {label:'Open WOs',num:true,render:r=>{const n=load(r.full_name).open;return n?`<b>${n}</b>`:'0';}},
      {label:'PMs owned',num:true,render:r=>load(r.full_name).pms},
      {label:'PMs done (90d)',num:true,hideSm:true,render:r=>{
        const p=load(r.full_name).perf;
        return p?`${p.done} <span style="color:${p.pct>=90?'var(--ok)':p.pct>=70?'var(--warn)':'var(--bad)'};font-size:12px">${p.pct}%</span>`:'—';}},
      {label:'Status',render:r=>r.active?'<span class="chip c-done">Active</span>':'<span class="chip c-hold">Disabled</span>'},
      {label:'',render:r=>`<button class="btn out sm" onclick="event.stopPropagation();openEditUser('${jsq(r.username)}')">Manage</button>`}
    ],USERS,{empty:'No accounts loaded yet.'})}
  </div>
  <div class="card"><h3 class="sec">What each role sees and can do</h3>
    <div class="tablewrap"><table>
      <thead><tr><th></th><th>Maintenance</th><th>Admin</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="background:var(--surf-1);font-weight:600;font-size:11px;
          text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Screens</td></tr>
        <tr><td>Home</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Equipment</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Schedule Work</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Production Loss</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Spare Parts</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Smart Assist</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Settings <small style="color:var(--muted)">(password only)</small></td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Dashboard</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td>PM Compliance</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td>Cause Setup</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td>QR Tags</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td>Import CSV · Users</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td colspan="3" style="background:var(--surf-1);font-weight:600;font-size:11px;
          text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Actions</td></tr>
        <tr><td>Schedule and complete work orders</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Log and close production loss</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Record PM completions</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Add and edit equipment, PMs, parts</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td><b>Edit the cause lists</b></td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td><b>Delete</b> anything</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
      </tbody></table></div>
    <div class="note">Maintenance still <b>reads</b> every record — a technician at a machine
    needs its full history. What is hidden is the reporting and setup screens.</div>
  </div>`;}

function refreshUsers(){
  DB.listUsers().then(r=>{
    USERS=r.users||[];
    DB.fetchPeople().catch(()=>{});
    if((location.hash||'').startsWith('#/users'))route();
  }).catch(e=>toast(e.message||'Could not load users'));}

function openAddUser(){
  Modal.open({title:'Add person',
    body:`${F.text('name','Full name','',{required:true,placeholder:'e.g. John Davis'})}
      ${F.text('username','Username','',{required:true,placeholder:'e.g. jdavis',autocomplete:'off'})}
      ${F.select('role','Role','maintenance',[
        {v:'maintenance',t:'Maintenance — the floor screens'},
        {v:'admin',t:'Admin — everything, including setup and reports'}])}
      ${F.text('password','Temporary password','',{required:true,type:'text',autocomplete:'off'})}
      <div id="userMsg"></div>
      <div class="note"><b>Maintenance</b> sees Equipment, Schedule Work, Production Loss,
      Spare Parts and Smart Assist. <b>Admin</b> also gets Dashboard, PM Compliance,
      Cause Setup, QR Tags, Import and Users.</div>`,
    footer:`<button class="btn filled" onclick="doAddUser()">Create account</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>`});}

function doAddUser(){
  const d=F.read();
  const msg=document.getElementById('userMsg');
  const show=t=>{if(msg)msg.innerHTML=`<div class="note bad">${esc(t)}</div>`;};
  if(!d.name)return show('Enter their full name.');
  if(!/^[a-z0-9._-]{3,32}$/.test((d.username||'').toLowerCase()))
    return show('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  if((d.password||'').length<6)return show('Temporary password must be at least 6 characters.');
  DB.addUser({name:d.name,username:d.username.toLowerCase(),role:d.role,password:d.password})
    .then(()=>{Modal.close();refreshUsers();toast(d.name+' can now sign in');})
    .catch(e=>show(e.message||'Could not create the account'));}

function openEditUser(username){
  const u=USERS.find(x=>x.username===username);
  if(!u)return;
  const isMe=DB.status().username===username;
  const openWos=DB.all('wos').filter(w=>DB.isActive(w)&&(w.assignedTo||'')===u.full_name);
  Modal.open({title:'Manage '+u.full_name,
    body:`${F.text('name','Full name',u.full_name)}
      ${F.text('username','Username',u.username,{readonly:true})}
      ${F.select('role','Role',u.role,[
        {v:'maintenance',t:'Maintenance — the floor screens'},
        {v:'admin',t:'Admin — everything, including setup and reports'}])}
      <div class="note">Changing the role changes which screens they see next time they load the app.</div>
      ${isMe?'<div class="note">This is your own account. You cannot lock yourself out.</div>':''}
      ${openWos.length?`<div class="note"><b>${openWos.length} open work order${openWos.length===1?'':'s'}</b> assigned.</div>`:''}
      <div id="userMsg"></div>
      <h3 class="sec" style="margin-top:22px">Reset password</h3>
      ${F.text('password','New temporary password','',{type:'text',autocomplete:'off',placeholder:'leave blank to keep current'})}`,
    footer:`<button class="btn filled" onclick="doUpdateUser('${jsq(username)}')">Save changes</button>
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isMe?(u.active
        ?`<button class="btn bad" style="margin-left:auto" onclick="setUserActive('${jsq(username)}',false)">Disable</button>`
        :`<button class="btn ok" style="margin-left:auto" onclick="setUserActive('${jsq(username)}',true)">Re-enable</button>`):''}`});}

function doUpdateUser(username){
  const d=F.read();
  const msg=document.getElementById('userMsg');
  const show=t=>{if(msg)msg.innerHTML=`<div class="note bad">${esc(t)}</div>`;};
  const payload={username,name:d.name,role:d.role};
  if(d.password){
    if(d.password.length<6)return show('Password must be at least 6 characters.');
    payload.password=d.password;}
  DB.updateUser(payload)
    .then(()=>{Modal.close();refreshUsers();toast('Account updated');})
    .catch(e=>show(e.message||'Could not update the account'));}

function setUserActive(username,active){
  const u=USERS.find(x=>x.username===username);
  const msg=active?`Re-enable ${u?u.full_name:username}?`
    :`Disable ${u?u.full_name:username}?\n\nThey will be signed out immediately. Their history stays.`;
  confirmDelete(msg,()=>{
    DB.updateUser({username,active})
      .then(()=>{Modal.close();refreshUsers();toast(active?'Account re-enabled':'Account disabled');})
      .catch(e=>toast(e.message||'Could not change the account'));});}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings(){
  const db=DB.raw();
  const s=DB.status();
  const admin=DB.isAdmin();
  const account=`
  <div class="card"><h3 class="sec">Your account</h3>
    <div class="tablewrap"><table><tbody>
      <tr><td style="color:var(--muted)">Name</td><td><b>${esc(s.who)}</b></td></tr>
      <tr><td style="color:var(--muted)">Username</td><td><span class="mono">${esc(s.username)}</span></td></tr>
      <tr><td style="color:var(--muted)">Role</td><td><span class="chip ${s.role==='admin'?'c-pur':'c-open'}">${esc(ROLE_LABEL[s.role]||s.role)}</span></td></tr>
    </tbody></table></div>
    <div class="actions">
      <button class="btn filled" onclick="openChangePassword(false)">Change my password</button>
      <button class="btn out" onclick="signOut()">Sign out</button></div></div>`;
  const connection=`
  <div class="card"><h3 class="sec">Connection</h3>
    ${s.mode==='cloud'
      ?`<div class="note"><b>Live — connected to the shared database.</b><br>
         Everything you save is visible to everyone else within about 15 seconds.</div>`
      :`<div class="note bad"><b>Offline — working on this device only.</b><br>
         ${esc(s.error||'No connection.')}<br>
         ${s.pending?`<b>${s.pending} change${s.pending===1?'':'s'} waiting to be sent.</b><br>`:''}
         Your work is saved here and sent automatically when the connection returns.</div>`}
    <div class="actions">
      <button class="btn filled" onclick="reconnect()">${s.mode==='cloud'?'Refresh now':'Try to reconnect'}</button></div></div>`;
  if(!admin){
    return `
    <h1 class="page">Settings</h1>
    <p class="sub">Signed in as <b>${esc(s.who)}</b> · ${esc(ROLE_LABEL[s.role]||s.role)}</p>
    ${account}
    ${connection}`;}
  const counts={Equipment:db.assets.length,PMs:db.pms.length,Parts:db.parts.length,
    'Work orders':db.wos.length,'PM completions':db.pmlogs.length,
    'Production loss':db.stops.length,'Cause lines':db.causes.length};
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const comp=Compliance.summary({days:90});
  const noRate=db.assets.filter(a=>DB.num(a.hourlyCost)===null).length;
  const noType=db.assets.filter(a=>!a.type||!String(a.type).trim()).length;
  return `
  <h1 class="page">Settings</h1>
  <p class="sub">Signed in as <b>${esc(s.who)}</b> · ${esc(ROLE_LABEL[s.role]||s.role)}</p>
  ${account}
  ${connection}
  <div class="card"><h3 class="sec">Site</h3>
    <label for="siteName">Site name</label>
    <input id="siteName" value="${esc(db.meta.site||'')}" onchange="saveSite(this.value)"/></div>
  <div class="card"><h3 class="sec">Data in the database</h3>
    ${renderTable([{label:'Collection',key:'k'},{label:'Records',num:true,key:'v'}],
      Object.entries(counts).map(([k,v])=>({id:k,k,v})))}
    <div class="note">${total} record${total===1?'':'s'} total ·
      <a href="#/compliance">${comp.pct===null?'no':comp.pct+'%'} PM compliance over 90 days</a>.
      ${noType?`<br>${noType} item${noType===1?'':'s'} of equipment have no type, so they use the
      standard cause lists. <a href="#/causes">Cause setup</a>.`:''}
      ${noRate?`<br>${noRate} item${noRate===1?'':'s'} have no hourly downtime cost set.`:''}</div></div>
  <div class="card"><h3 class="sec">Backup and sample data</h3>
    <div class="actions">
      <button class="btn filled" onclick="Backup.export()">Download backup</button>
      <button class="btn out" onclick="exportCompliance()">Export PM compliance</button>
      <button class="btn out" onclick="exportStops()">Export production loss</button>
      <button class="btn out" onclick="migrateUp()" ${s.mode==='cloud'?'':'disabled'}>Upload this device's data</button>
      <button class="btn out" onclick="seedSample()">Load sample data</button></div>
    <div class="note"><b>Upload this device's data</b> pushes anything saved only in this
    browser into the shared database — the fix when one person can see records nobody else can.</div>
  </div>`;}

function saveSite(v){const db=DB.raw();db.meta.site=v;DB.save();toast('Site name saved');}

function reconnect(){
  toast('Connecting…');
  DB.connect().then(r=>{
    route();
    if(r.mode==='cloud'){
      DB.startPolling(15);
      toast(r.flushed?`Connected — sent ${r.flushed} queued change${r.flushed===1?'':'s'}`:'Connected — up to date');
    }else if(r.auth){location.hash='#/login';route();toast('Please sign in again');}
    else{toast('Still offline — '+(r.reason||'no connection'));}});}

function migrateUp(){
  const db=DB.raw();
  const n=DB.LISTS.reduce((t,k)=>t+(db[k]||[]).length,0);
  if(!n){toast('Nothing on this device to upload');return;}
  confirmDelete(`Upload ${n} records into the shared database?\n\nRecords with the same ID are merged, not duplicated.`,()=>{
    toast('Uploading…');
    DB.seedServer().then(r=>{route();toast(`Uploaded ${r.count} records`);})
      .catch(e=>toast('Upload failed — '+e.message));});}

/* ============================================================
   SAMPLE DATA
   ============================================================ */
function seedSample(){
  if(!DB.isAdmin()){toast('Only an admin can load sample data');return;}
  const d=today();
  const plus=n=>DB.addDays(d,n);
  const back=n=>DB.addDays(d,-n);
  const me=DB.getWho();
  const ago=n=>Stops.minutesAgo(n);
  DB.bulkUpsert('assets',[
    {id:'3526',name:'Top Roll Assembly',type:'Ultrasonic welder',
      manufacturer:'3Con',model:'TR-900',project:'3527',
      location:'Ultrasonic weld cell',status:'Active',owner:me,hourlyCost:'850',
      manualUrl:'https://example.com/manuals/3526-top-roll.pdf'},
    {id:'3530',name:'Top Roll Assembly #2',type:'Ultrasonic welder',
      manufacturer:'3Con',model:'TR-900',location:'Weld cell 2',
      status:'Active',owner:me,hourlyCost:'850'},
    {id:'3527',name:'Air Compressor #1',type:'Air compressor',
      manufacturer:'Atlas Copco',model:'GA22',
      location:'Utilities room',status:'Active',owner:me,hourlyCost:'400'}]);
  /* A couple of configured reasons so the setup screen is not empty,
     while other types still show the fallback. */
  DB.bulkUpsert('causes',[
    {id:'CZ-1001',kind:'downtime',equipType:'Ultrasonic welder',label:'Sonotrode cracked',sort:'10'},
    {id:'CZ-1002',kind:'downtime',equipType:'Ultrasonic welder',label:'Horn out of tune',sort:'20'},
    {id:'CZ-1003',kind:'downtime',equipType:'Ultrasonic welder',label:'Anvil buildup',sort:'30'},
    {id:'CZ-1004',kind:'downtime',equipType:'',label:'Waiting on parts',sort:'90'},
    {id:'CZ-1005',kind:'defect',equipType:'Ultrasonic welder',label:'Weld pull test failed',sort:'10'},
    {id:'CZ-1006',kind:'defect',equipType:'Ultrasonic welder',label:'Burn-through',sort:'20'},
    {id:'CZ-1007',kind:'failure',equipType:'Ultrasonic welder',label:'Sonotrode wear',sort:'10'}]);
  DB.bulkUpsert('pms',[
    {id:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',nextDue:plus(2),tech:me,lastDone:back(5)},
    {id:'PM-004',assetId:'3526',description:'Clean/replace main air supply filters',
      frequency:'monthly',nextDue:plus(9),tech:me,lastDone:back(21)},
    {id:'PM-005',assetId:'3526',description:'Lubricate sliding and rotating components',
      frequency:'monthly',nextDue:back(12),tech:me,lastDone:back(42)},
    {id:'PM-007',assetId:'3527',description:'Inspect compressor cooler and drain traps',
      frequency:'quarterly',nextDue:plus(30)}]);
  /* The sonotrode fits both weld cells — one stock figure, two machines. */
  DB.bulkUpsert('parts',[
    Object.assign({id:'CT_12672',description:'Sonotrode',mfrPn:'6821000797',vendor:'3CON',
      location:'SP1-I2-B5',qty:'4',min:'2',cost:'420'},DB.partAssetFields(['3526','3530'])),
    Object.assign({id:'CT_1710',description:'Ultrasonic generator',mfrPn:'88194',vendor:'HERRMANN',
      location:'SP1-E3-B22',qty:'1',min:'1',cost:'2800'},DB.partAssetFields(['3526','3530'])),
    Object.assign({id:'P-1001',description:'Compressor oil filter',mfrPn:'GRA-4471',vendor:'Grainger',
      location:'SP1-A1-B2',qty:'12',min:'5',cost:'38.50'},DB.partAssetFields(['3527']))]);
  DB.bulkUpsert('pmlogs',[
    {id:'PMC-00001',pmId:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',dueDate:back(5),doneDate:back(5),daysLate:0,by:me,hours:'0.5',
      notes:'Sonotrode faces clean, weld pull tests within spec.'},
    {id:'PMC-00002',pmId:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',dueDate:back(12),doneDate:back(11),daysLate:1,by:me,hours:'0.5',
      notes:'Minor buildup on anvil, cleaned. No action needed.'},
    {id:'PMC-00003',pmId:'PM-004',assetId:'3526',description:'Clean/replace main air supply filters',
      frequency:'monthly',dueDate:back(21),doneDate:back(21),daysLate:0,by:me,hours:'1',
      notes:'Replaced both element filters, drained separator.'}]);
  /* A spread across the windows so the high-defect ranking has
     something to show: 3530 bad recently, 3526 bad earlier. */
  DB.bulkUpsert('stops',[
    {id:'EV-00001',kind:'downtime',assetId:'3526',reason:'Sonotrode cracked',
      startedAt:ago(300),endedAt:ago(180),by:me,closedBy:me,
      detail:'Machine faulted mid-cycle, drive showed an overcurrent alarm.',
      fixedBy:'Reset the drive and reseated the encoder plug — it was backed out. Ran clean after.'},
    {id:'EV-00002',kind:'defect',assetId:'3530',reason:'Weld pull test failed',qty:'26',
      startedAt:ago(60*24*2),endedAt:ago(60*24*2-45),by:me,closedBy:me,
      detail:'Pull tests failing on station 2, parts going to scrap.',
      fixedBy:'Anvil had material buildup. Cleaned both faces and reset trigger pressure to 3.2 bar.'},
    {id:'EV-00003',kind:'defect',assetId:'3530',reason:'Burn-through',qty:'14',
      startedAt:ago(60*24*5),endedAt:ago(60*24*5-30),by:me,closedBy:me,
      detail:'Scorching on the B-side trim.',
      fixedBy:'Weld time down 0.1s, amplitude down 5%. Ran a sample of 20, all good.'},
    {id:'EV-00004',kind:'defect',assetId:'3526',reason:'Weld pull test failed',qty:'40',
      startedAt:ago(60*24*70),endedAt:ago(60*24*70-90),by:me,closedBy:me,
      detail:'Whole shift of suspect welds.',
      fixedBy:'Generator drifting. Swapped CT_1710 and re-tuned the stack.'},
    {id:'EV-00005',kind:'downtime',assetId:'3526',reason:'Sonotrode cracked',
      startedAt:ago(60*24*40),endedAt:ago(60*24*40-120),by:me,closedBy:me,
      detail:'Third time this quarter.',
      fixedBy:'Replaced sonotrode from CT_12672 stock. Needs a root-cause look.'},
    {id:'EV-00006',kind:'downtime',assetId:'3526',reason:'Sonotrode cracked',
      startedAt:ago(60*24*80),endedAt:ago(60*24*80-100),by:me,closedBy:me,
      detail:'Cracked face again.',
      fixedBy:'Replaced sonotrode. Torque on the stack was low — retorqued to 45 Nm.'},
    {id:'EV-00007',kind:'downtime',assetId:'3527',reason:'Waiting on parts',
      startedAt:ago(45),endedAt:'',by:me,
      detail:'Oil filter split, no spare in the crib.'}]);
  DB.bulkUpsert('wos',[
    {id:'WO-1002',assetId:'3526',description:'Replace worn sonotrode on station 2',type:'Repair',
      priority:'Medium',requestedBy:me,assignedTo:me,
      dateRequested:back(22),dateCompleted:back(21),hours:'2.5',cost:'1250',
      status:'Completed',cause:'Sonotrode wear',partsUsed:'CT_12672',
      notes:'Sonotrode face pitted. Swapped in CT_12672, retorqued stack to 45 Nm.'},
    {id:'WO-1003',assetId:'3526',description:'Root-cause the repeat sonotrode cracking',
      type:'Improvement',priority:'High',requestedBy:me,
      dateRequested:back(2),dateDue:plus(3),status:'Open',cause:Causes.TBD}]);
  route();
  toast('Sample data loaded');}

/* ============================================================
   BOOT
   ============================================================ */
(function boot(){
  if(!location.hash)location.hash='#/home';
  DB.loadQueue();
  DB.setOnChange(fromPoll=>{
    route();
    if(fromPoll)toast('Updated — someone else made a change');});
  DB.connect().then(r=>{
    route();
    if(r.mode==='cloud'){
      DB.startPolling(15);
      if(r.flushed)toast(`Connected — sent ${r.flushed} queued change${r.flushed===1?'':'s'}`);}
  }).catch(()=>route());
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&DB.status().mode==='cloud'){
      DB.refresh().then(()=>route()).catch(()=>{});}});
  window.addEventListener('online',()=>{
    if(DB.status().mode!=='cloud')reconnect();});
  /* Open losses count up live. */
  setInterval(()=>{
    if(document.hidden)return;
    if(typeof Stops==='undefined'||!Stops.open().length)return;
    const h=(location.hash||'').replace('#/','').split('/')[0];
    if(['home','dashboard','stops','asset','assets'].includes(h))route();
  },60000);
})();
