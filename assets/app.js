/* ============================================================
   app.js — router + screens
   ============================================================ */
const FREQS = ['daily','weekly','biweekly','monthly','quarterly','semiannual','annually'];
const WO_TYPES = ['Repair','Preventive','Improvement','Troubleshoot','Inspection'];
const WO_STATUS = ['Open','In Progress','On Hold','Completed','Cancelled'];
const PRIORITIES = ['High','Medium','Low'];
const CAUSES = ['To be determined','Wear / end of life','Seal failure','Loose fastener',
  'Contamination','Operator damage','Electrical fault','Software / program','Unknown'];
const ROLE_LABEL = { admin:'Admin', maintenance:'Maintenance' };
const LINK_HINT = 'Paste a SharePoint or web address. Opens in a new tab — the file stays where it lives.';

let SEARCH='', WO_VIEW='list', WO_FILTER='all', PM_FILTER='all';
let CAL={y:new Date().getFullYear(),m:new Date().getMonth(),pms:true};
let USERS=[], SMART_Q='', SMART_ASSET='', COMP_DAYS=90, COMP_ASSET='';

const ROUTES={home:renderHome,dashboard:renderDashboard,assets:renderAssets,asset:renderAssetDetail,
  pm:renderPM,parts:renderParts,wo:renderWO,qr:renderQR,smart:renderSmart,compliance:renderCompliance,
  import:renderImport,users:renderUsers,settings:renderSettings,login:renderLogin};
const ADMIN_ROUTES=['import','users'];

function route(){
  const hash=(location.hash||'#/home').replace('#/','');
  const parts=hash.split('/');
  const name=parts[0];
  const param=parts[1]?decodeURIComponent(parts[1]):null;
  const st=DB.status();
  if(!st.signedIn&&name!=='login'){
    document.getElementById('view').innerHTML=renderLogin();updateChrome();return;}
  if(ADMIN_ROUTES.includes(name)&&!DB.isAdmin()){
    document.getElementById('view').innerHTML=renderNoAccess(name);updateChrome();return;}
  const fn=ROUTES[name]||renderHome;
  document.querySelectorAll('.rail .nav').forEach(a=>
    a.classList.toggle('active',a.dataset.s===name||(name==='asset'&&a.dataset.s==='assets')));
  document.getElementById('view').innerHTML=fn(param);
  updateChrome();window.scrollTo(0,0);}
window.addEventListener('hashchange',route);

document.getElementById('globalSearch').addEventListener('input',e=>{
  SEARCH=e.target.value.toLowerCase().trim();
  const h=(location.hash||'').replace('#/','').split('/')[0];
  if(SEARCH&&!['assets','parts','wo','pm'].includes(h)){location.hash='#/assets';return;}
  route();});

function matches(obj,fields){
  if(!SEARCH)return true;
  return fields.some(f=>String(obj[f]??'').toLowerCase().includes(SEARCH));}
function openAsset(id){location.hash='#/asset/'+encodeURIComponent(id);}

function renderNoAccess(name){
  return `<h1 class="page">Not available</h1>
    <p class="sub">The <b>${esc(name==='users'?'Users':'Import CSV')}</b> screen is for admins.</p>
    <div class="placeholder"><div style="font-size:30px">&#128274;</div>
      <b style="display:block;margin:10px 0 6px;color:var(--ink);font-size:16px">Admins only</b>
      <span>You are signed in as <b>${esc(DB.getWho())}</b> (Maintenance).</span>
      <div class="actions" style="justify-content:center"><a class="btn filled" href="#/home">Back to home</a></div>
    </div>`;}

function updateChrome(){
  const admin=DB.isAdmin();
  document.querySelectorAll('.rail .adminonly').forEach(el=>{el.style.display=admin?'':'none';});
  const el=document.getElementById('connBadge');
  if(!el)return;
  const s=DB.status();
  if(!s.signedIn){el.className='connchip off';el.textContent='Signed out';return;}
  const tag=s.role==='admin'?' · Admin':'';
  if(s.mode==='cloud'){el.className='connchip on';el.textContent='● '+(s.who||'Live')+tag;}
  else{el.className='connchip warn';
    el.textContent=s.pending?'⚠ Offline · '+s.pending+' queued':'⚠ Offline';}}

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
    msg.innerHTML=`<div class="note ${d.ok?'':'bad'}">
      ${row(d.hasDatabaseUrl,'DATABASE_URL is set')}
      ${row(d.driverLoads,'Database driver loads')}
      ${row(d.databaseReachable,'Database reachable')}
      ${row(d.tablesReady,'Tables ready')}
      ${row(d.hasAdminUsername,'ADMIN_USERNAME is set')}
      ${row(d.hasAdminPassword,'ADMIN_PASSWORD is set')}
      ${d.userCount!=null?row(d.userCount>0,d.userCount+' account(s) exist'):''}
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
   PM COMPLETION — the heart of the audit trail
   ------------------------------------------------------------
   Marking a PM done writes an immutable record, then rolls the
   schedule forward. The record is written FIRST: if that fails we
   must not advance the schedule, or the work looks done with
   nothing to prove it.
   ============================================================ */
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
  /* Write the evidence first. Only advance the schedule once it exists. */
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
          There is no record of this PM ever being done.
          <br><small>If it has been done and just was not logged, an admin can import the history.</small>
        </div>`}`,
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
      ${[{v:'',t:'All machines'}].concat(assets.map(a=>({v:a.id,t:a.id+' · '+a.name})))
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
    <div class="note bad">These PMs have no completion on record at all. If the work has been
    happening, it is not being logged — which for an audit is the same as not happening.</div>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b><br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Frequency',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.frequency||'—')}</span>`},
      {label:'Next due',render:r=>dueChip(r.nextDue)},
      {label:'Responsible',hideSm:true,render:r=>r.tech?esc(r.tech):'<span style="color:var(--muted)">Nobody</span>'}
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
      {label:'Hrs',num:true,hideSm:true,render:l=>l.hours||'—'},
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
      {label:'On-time rate',render:r=>`<span style="color:${pctColor(r.pct)};font-weight:600">${r.pct}%</span>`},
      {label:'Hours',num:true,hideSm:true,render:r=>r.hours.toFixed(1)}
    ],people)}
    <div class="note">Late is usually a scheduling or workload problem rather than a person problem —
    a technician cannot do a PM on a machine that is running production.</div>
  </div>`:''}`;}

function exportCompliance(){
  const rows=Compliance.exportRows({assetId:COMP_ASSET});
  if(!rows.length){toast('No completion records to export');return;}
  CSV.download('pm-compliance-'+today()+'.csv',CSV.build(Compliance.EXPORT_COLUMNS,rows));
  toast(rows.length+' completion records exported');}

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
    out.innerHTML=`<div class="empty">Describe the problem, or pick a machine, to search past repairs.</div>`;return;}
  out.innerHTML=renderHits(Insights.similarRepairs({assetId:a,description:q,limit:8}),q);}

function hitCard(h){
  const w=h.wo;
  const who=w.assignedTo||w.completedBy||'';
  const when=w.dateCompleted||w.dateRequested;
  return `<div class="hit" onclick="editWO('${jsq(w.id)}')">
    <div class="hit-hd"><b class="mono">${esc(w.id)}</b>
      <span class="hit-when">${esc(Insights.ago(h.ageDays))}</span>
      ${w.cause&&w.cause!=='To be determined'?`<span class="chip c-prog">${esc(w.cause)}</span>`:''}
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
      ${q?'No closed work order matches that description yet.':'No history for that machine yet.'}
      <br><small>Once this job is closed with good notes, it will show up here next time.</small></div>`;}
  return `<div class="hits">${hits.map(hitCard).join('')}</div>`;}

function renderSmart(){
  const q=Insights.dataQuality();
  const repeats=Insights.repeatFailures();
  return `
  <h1 class="page">Smart Assist</h1>
  <p class="sub">Patterns from work already closed in this plant. Every result is a real work order you can open.</p>
  <div class="card smartcard">
    <h3 class="sec">Seen this before?</h3>
    <div class="f2">
      <div><label for="smartQ">Describe the problem</label>
        <input id="smartQ" value="${esc(SMART_Q)}" placeholder="e.g. bad welds on station 2"
          onkeydown="if(event.key==='Enter')runSmartSearch()"/></div>
      <div>${F.select('smartAsset','On which machine (optional)',SMART_ASSET,assetOptions())}</div>
    </div>
    <div class="actions">
      <button class="btn filled" onclick="runSmartSearch()">&#128269; Search past repairs</button>
      <button class="btn out" onclick="document.getElementById('smartQ').value='';document.getElementById('f_smartAsset').value='';runSmartSearch()">Clear</button>
    </div>
    <div id="smartResults" style="margin-top:18px">
      <div class="empty">Describe the problem, or pick a machine, to search past repairs.</div></div>
  </div>
  <div class="card">
    <h3 class="sec">Recurring problems — same machine, same cause, 3+ times in a year</h3>
    ${repeats.length?`<div class="repeats">
      ${repeats.map(r=>`<div class="repeat" onclick="openAsset('${jsq(r.assetId)}')">
        <div class="repeat-hd"><span class="chip c-crit">${r.count}×</span>
          <b>${esc(DB.assetName(r.assetId))}</b>
          <span class="mono" style="color:var(--muted)">${esc(r.assetId)}</span></div>
        <div class="repeat-cause">${esc(r.cause)}</div>
        <div class="repeat-ft">
          ${r.hours?`<span><b>${r.hours.toFixed(1)}h</b> total</span>`:''}
          ${r.avgGap?`<span>· roughly every <b>${r.avgGap} days</b></span>`:''}
          <span>· last ${fmtDate(r.last)}</span></div>
        <div class="repeat-wos">${r.wos.map(w=>`<span class="mono">${esc(w.id)}</span>`).join(' ')}</div>
      </div>`).join('')}</div>
    <div class="note">Something failing this often is usually a root-cause problem, not bad luck.</div>`
    :`<div class="empty">No recurring pattern found.</div>`}
  </div>
  <div class="card">
    <h3 class="sec">How useful this can be</h3>
    <div class="bar"><i style="width:${q.pct}%;background:${q.pct>=70?'var(--ok)':q.pct>=40?'var(--warn)':'var(--bad)'}"></i></div>
    <div class="quality"><span><b>${q.usable}</b> of <b>${q.done}</b> closed work orders have both a cause and real notes — <b>${q.pct}%</b></span></div>
    ${q.done===0?`<div class="note">No completed work orders yet.</div>`
      :q.pct<60?`<div class="note bad"><b>${q.noNotes} closed work order${q.noNotes===1?'':'s'} have no real notes.</b></div>`
      :`<div class="note">Good documentation rate.</div>`}
  </div>`;}

function similarPanel(assetId,description,cause,excludeId){
  const hits=Insights.similarRepairs({assetId,description,cause,excludeId,limit:4});
  if(!hits.length)return '';
  return `<div class="seenbefore">
    <div class="seen-hd">&#128161; Seen before — ${hits.length} similar repair${hits.length===1?'':'s'}</div>
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
  const repeats=Insights.repeatFailures();
  const comp=Compliance.summary({days:90});

  if(!assets.length&&!wos.length){
    return `<h1 class="page">Welcome, ${esc(meName)}</h1>
      <p class="sub">The database is empty.</p>
      <div class="placeholder"><div style="font-size:34px">&#128736;</div>
        <b style="display:block;margin:10px 0 6px;color:var(--ink);font-size:16px">Start here</b>
        <span>${DB.isAdmin()?'Import your asset list, or load sample data to look around.':'Ask an admin to import the asset list.'}</span>
        <div class="actions" style="justify-content:center">
          ${DB.isAdmin()?`<a class="btn filled" href="#/import">Import CSV</a>
          <button class="btn out" onclick="seedSample()">Load sample data</button>`:''}
          <button class="btn out" onclick="editAsset()">Add first asset</button></div></div>`;}

  return `
  <h1 class="page">Home</h1>
  <p class="sub">${esc(DB.raw().meta.site||'Maintenance')} · signed in as <b>${esc(meName)}</b> (${esc(ROLE_LABEL[DB.role()]||DB.role())})</p>
  <div class="hub">
    <a class="tile" href="#/assets"><div class="ic">&#128451;</div><h2>Find an Asset</h2>
      <p>Search the plant, scan the QR tag, or open the machine manual.</p>
      <ul><li>Asset name / serial number</li><li>Manuals and drawings</li><li>Machine BOM and repair history</li></ul></a>
    <a class="tile" href="#/wo"><div class="ic">&#129534;</div><h2>Work Orders</h2>
      <p>Create or complete work, in a list or on the calendar.</p>
      <ul><li>${openWos.length} pending · ${progWos.length} in progress</li>
      <li>Assigned to a named person</li><li>Generate a WO from any PM</li></ul></a>
    <a class="tile smart" href="#/smart"><div class="ic">&#128161;</div><h2>Smart Assist</h2>
      <p>Has this happened before? Search what your team already fixed.</p>
      <ul><li>Similar past repairs, with notes</li>
      <li>${repeats.length?`<b>${repeats.length} recurring problem${repeats.length===1?'':'s'} found</b>`:'Recurring-failure detection'}</li>
      <li>Who fixed it last time</li></ul></a>
  </div>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat click" onclick="location.hash='#/assets'"><div class="n">${assets.length}</div><div class="l">Assets in plant</div></div>
    <div class="stat click" onclick="WO_FILTER='open';location.hash='#/wo'">
      <div class="n" style="color:${openWos.length?'var(--pri)':'inherit'}">${openWos.length}</div><div class="l">Pending work orders</div></div>
    <div class="stat click" onclick="location.hash='#/pm'">
      <div class="n" style="color:${duePms.length?'var(--bad)':'inherit'}">${duePms.length}</div><div class="l">PMs due within 7 days</div></div>
    <div class="stat click" onclick="location.hash='#/compliance'">
      <div class="n" style="color:${comp.pct===null?'inherit':comp.pct>=90?'var(--ok)':comp.pct>=70?'var(--warn)':'var(--bad)'}">${comp.pct===null?'—':comp.pct+'%'}</div>
      <div class="l">PM compliance (90d)</div><div class="d">${comp.done} completed</div></div>
  </div>
  ${repeats.length?`<div class="note bad">
    <b>${repeats.length} recurring failure${repeats.length===1?'':'s'} detected.</b>
    ${esc(DB.assetName(repeats[0].assetId))} has had <b>${esc(repeats[0].cause)}</b> ${repeats[0].count} times.
    <a href="#/smart">Look at the pattern</a>.</div>`:''}
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
  ${recent.length?`<div class="card"><h3 class="sec">Recently viewed assets</h3>
    ${recent.map(a=>`<a class="pill" href="#/asset/${encodeURIComponent(a.id)}"><b>${esc(a.id)}</b> <small>${esc(a.name)}</small></a>`).join('')}</div>`:''}
  <div class="card"><h3 class="sec">Quick actions</h3>
    <div class="actions" style="margin-top:0">
      <button class="btn filled" onclick="editWO()">&#43; New work order</button>
      <a class="btn out" href="#/compliance">PM compliance</a>
      <a class="btn out" href="#/smart">Search past repairs</a>
      <a class="btn out" href="#/qr">Print QR tags</a></div></div>`;}

function renderDashboard(){
  const assets=DB.all('assets'),pms=DB.all('pms'),parts=DB.all('parts'),wos=DB.all('wos');
  const openWos=wos.filter(DB.isActive);
  const duePms=pms.filter(p=>{const d=DB.daysUntil(p.nextDue);return d!==null&&d<=7;})
    .sort((a,b)=>(a.nextDue||'').localeCompare(b.nextDue||''));
  const lowParts=parts.filter(p=>DB.partStatus(p).label==='Low stock');
  const unassigned=openWos.filter(w=>!w.assignedTo);
  const repeats=Insights.repeatFailures();
  const comp=Compliance.summary({days:90});
  const stat=(ic,bg,col,n,l,d)=>`
    <div class="stat"><div class="ic" style="background:${bg};color:${col}">${ic}</div>
      <div class="n">${n}</div><div class="l">${esc(l)}</div>${d?`<div class="d">${esc(d)}</div>`:''}</div>`;
  return `
  <h1 class="page">Dashboard</h1>
  <p class="sub">${esc(DB.raw().meta.site||'Maintenance overview')}</p>
  <div class="grid g4" style="margin-bottom:20px">
    ${stat('&#128451;','var(--info-c)','var(--pri)',assets.length,'Assets registered')}
    ${stat('&#129534;','var(--bad-c)','var(--bad)',openWos.length,'Open work orders',
      openWos.filter(w=>w.priority==='High').length+' high priority')}
    ${stat('&#128197;','var(--warn-c)','var(--warn)',duePms.length,'PMs due within 7 days',pms.length+' scheduled total')}
    ${stat('&#9989;',comp.pct===null?'var(--surf-3)':comp.pct>=90?'var(--ok-c)':'var(--warn-c)',
      comp.pct===null?'var(--muted)':comp.pct>=90?'var(--ok)':'var(--warn)',
      comp.pct===null?'—':comp.pct+'%','PM compliance (90d)',comp.late+' late, '+comp.overdueNow+' overdue')}
  </div>
  ${comp.overdueNow?`<div class="note bad">
    <b>${comp.overdueNow} PM${comp.overdueNow===1?' is':'s are'} overdue right now.</b>
    <a href="#/compliance">See which</a>.</div>`:''}
  ${repeats.length?`<div class="card"><h3 class="sec">Recurring failures</h3>
    ${renderTable([
      {label:'Machine',render:r=>`<b>${esc(DB.assetName(r.assetId))}</b><br><small class="mono" style="color:var(--muted)">${esc(r.assetId)}</small>`},
      {label:'Cause',render:r=>`<span class="chip c-crit">${esc(r.cause)}</span>`},
      {label:'Times',num:true,render:r=>`<b>${r.count}</b>`},
      {label:'Hours',num:true,render:r=>r.hours.toFixed(1)},
      {label:'Every',hideSm:true,render:r=>r.avgGap?'~'+r.avgGap+' days':'—'}
    ],repeats,{onRow:'openAsset'})}
    <div class="actions"><a class="btn out sm" href="#/smart">Open Smart Assist</a></div></div>`:''}
  ${unassigned.length?`<div class="note bad">
    <b>${unassigned.length} open work order${unassigned.length===1?'':'s'} with nobody assigned.</b>
    <a href="#" onclick="WO_FILTER='unassigned';location.hash='#/wo';return false;">Show them</a>.</div>`:''}
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
   ASSETS
   ============================================================ */
function renderAssets(){
  const rows=DB.all('assets').filter(a=>
    matches(a,['id','name','manufacturer','model','serial','project','location','owner']));
  const withDocs=rows.filter(a=>safeUrl(a.manualUrl)||safeUrl(a.drawingUrl)).length;
  return `
  <h1 class="page">Assets</h1>
  <p class="sub">${rows.length} asset${rows.length===1?'':'s'}${SEARCH?` matching “${esc(SEARCH)}”`:' in the register'} · ${withDocs} with documents linked</p>
  <div class="chipset">
    <button class="btn filled" onclick="editAsset()">&#43; New asset</button>
    <a class="btn out" href="#/qr">QR tags</a>
    <button class="btn out" onclick="exportCSV('assets')">Export CSV</button>
    ${DB.isAdmin()?'<a class="btn out" href="#/import">Import CSV</a>':''}
  </div>
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">Asset register</h3>
    ${renderTable([
      {label:'Asset ID',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Equipment name',render:r=>`<b>${esc(r.name||'—')}</b>${r.location?`<br><small style="color:var(--muted)">${esc(r.location)}</small>`:''}`},
      {label:'Owner',hideSm:true,render:r=>r.owner?esc(r.owner):'<span style="color:var(--muted)">—</span>'},
      {label:'Docs',render:r=>{
        if(safeUrl(r.manualUrl))return docLink(r.manualUrl,'Manual',{cls:'btn out sm'});
        if(safeUrl(r.drawingUrl))return docLink(r.drawingUrl,'Drawing',{cls:'btn out sm'});
        return '<span style="color:var(--muted)">—</span>';}},
      {label:'Status',render:r=>`<span class="chip ${r.status==='Down'?'c-crit':r.status==='Retired'?'c-hold':'c-done'}">${esc(r.status||'Active')}</span>`},
      {label:'Open WOs',num:true,render:r=>{
        const n=DB.forAsset('wos',r.id).filter(DB.isActive).length;
        return n?`<b style="color:var(--bad)">${n}</b>`:'0';}},
      {label:'PMs',num:true,hideSm:true,render:r=>DB.forAsset('pms',r.id).length},
      {label:'',hideSm:true,render:r=>`<button class="btn out sm" onclick="event.stopPropagation();editAsset('${jsq(r.id)}')">Edit</button>`}
    ],rows,{empty:SEARCH?'No assets match that search.':'No assets yet.',onRow:'openAsset'})}
  </div>`;}

function renderAssetDetail(id){
  const a=DB.get('assets',id);
  if(!a)return `<h1 class="page">Asset not found</h1>
    <p class="sub">No asset with ID “${esc(id)}”.</p>
    <a class="btn filled" href="#/assets">Back to assets</a>`;
  DB.touchAsset(id);
  const wos=DB.forAsset('wos',id),pms=DB.forAsset('pms',id),parts=DB.forAsset('parts',id);
  const pending=wos.filter(DB.isOpen);
  const prog=wos.filter(w=>w.status==='In Progress');
  const done=wos.filter(DB.isDone);
  const recentRepairs=done.sort((x,y)=>(y.dateCompleted||'').localeCompare(x.dateCompleted||'')).slice(0,5);
  const lowParts=parts.filter(p=>DB.partStatus(p).label==='Low stock').length;
  const hasDocs=safeUrl(a.manualUrl)||safeUrl(a.drawingUrl);
  const health=Insights.assetHealth(id);
  const myRepeats=Insights.repeatFailures().filter(r=>r.assetId===id);
  const comp=Compliance.summary({days:365,assetId:id});
  const pmHistory=Compliance.logsForAsset(id).slice(0,8);
  return `
  <div class="crumb"><a href="#/home">Home</a> › <a href="#/assets">Assets</a> › ${esc(a.id)}</div>
  <div class="ahead"><div class="big">&#9881;</div>
    <div class="who"><h1>${esc(a.name||a.id)}</h1>
      <div class="meta">Asset <b class="mono">${esc(a.id)}</b>${a.serial?` · Serial <b class="mono">${esc(a.serial)}</b>`:''}<br>
        ${a.manufacturer?esc(a.manufacturer):'Manufacturer not set'}${a.model?' · '+esc(a.model):''}${a.location?' · '+esc(a.location):''}
        ${a.owner?`<br>Responsible: <b>${esc(a.owner)}</b>`:''}</div>
      ${a.notes?`<div class="note" style="margin-top:12px">${esc(a.notes)}</div>`:''}
      <div style="margin-top:12px"><span class="chip ${a.status==='Down'?'c-crit':a.status==='Retired'?'c-hold':'c-done'}" style="font-size:13px;padding:8px 14px">${esc(a.status||'Active')}</span></div></div>
    <div class="qrbox hide-print">${qrSvg(assetUrl(a.id),116)}<small>Scan to open</small>
      <button class="btn out sm" style="margin-top:8px" onclick="showQR('${jsq(a.id)}')">Tag</button></div>
  </div>
  ${myRepeats.length?`<div class="note bad"><b>Recurring problem on this machine.</b>
    ${myRepeats.map(r=>`<b>${esc(r.cause)}</b> ${r.count} times${r.avgGap?`, roughly every ${r.avgGap} days`:''}`).join('; ')}.
    <a href="#/smart">See the pattern</a>.</div>`:''}
  ${hasDocs?`<div class="card doccard"><h3 class="sec">Documentation</h3>
    <div class="actions" style="margin-top:0">
      ${docLink(a.manualUrl,'Machine manual',{cls:'btn filled',icon:'&#128214;'})}
      ${docLink(a.drawingUrl,'Drawings / schematics',{cls:'btn tonal',icon:'&#128208;'})}
    </div></div>`:''}
  <div class="chipset">
    <button class="btn filled" onclick="newWOFor('${jsq(a.id)}')">&#43; New work order</button>
    <button class="btn tonal" onclick="newPMFor('${jsq(a.id)}')">&#43; Add PM</button>
    <button class="btn out" onclick="newPartFor('${jsq(a.id)}')">&#43; Add part</button>
    <button class="btn out" onclick="editAsset('${jsq(a.id)}')">Edit asset</button>
    <button class="btn out" onclick="smartForAsset('${jsq(a.id)}')">&#128161; Past repairs</button>
  </div>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="ic" style="background:var(--info-c);color:var(--pri)">&#128203;</div>
      <div class="n">${pending.length}</div><div class="l">Pending work orders</div></div>
    <div class="stat"><div class="ic" style="background:var(--warn-c);color:var(--warn)">&#128295;</div>
      <div class="n">${prog.length}</div><div class="l">In progress</div></div>
    <div class="stat click" onclick="setCompAsset('${jsq(a.id)}');location.hash='#/compliance'">
      <div class="ic" style="background:var(--ok-c);color:var(--ok)">&#9989;</div>
      <div class="n" style="color:${comp.pct===null?'inherit':comp.pct>=90?'var(--ok)':comp.pct>=70?'var(--warn)':'var(--bad)'}">${comp.pct===null?'—':comp.pct+'%'}</div>
      <div class="l">PM compliance (1 yr)</div><div class="d">${comp.done} completed</div></div>
    <div class="stat"><div class="ic" style="background:var(--pur-c);color:var(--pur)">&#128736;</div>
      <div class="n">${done.length}</div><div class="l">Repairs completed</div>
      <div class="d">${health.hours.toFixed(1)}h logged</div></div>
  </div>
  ${health.total>=2?`<div class="card smartcard">
    <h3 class="sec">&#128161; Failure profile — from ${health.total} completed repairs</h3>
    <div class="grid g2" style="gap:14px">
      <div>${health.topCauses.length?`<div class="profile-label">Most common causes</div>
        ${health.topCauses.slice(0,4).map(c=>`<div class="profile-row"><span>${esc(c.cause)}</span><b>${c.count}×</b></div>`).join('')}`:''}</div>
      <div>${health.meanGap?`<div class="profile-row"><span>Average time between repairs</span><b>${health.meanGap} days</b></div>`:''}
        ${health.topPeople.length?`<div class="profile-row"><span>Knows this machine best</span><b>${esc(health.topPeople[0].name)}</b></div>`:''}</div>
    </div></div>`:''}
  <div class="card"><h3 class="sec">PM program — schedule, frequency and owner</h3>
    ${renderTable([
      {label:'PM',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Task',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.procedureUrl,'Procedure attached')}`},
      {label:'Frequency',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.frequency||'—')}</span>`},
      {label:'Next due',render:r=>dueChip(r.nextDue)},
      {label:'Done',num:true,render:r=>{
        const n=Compliance.logsFor(r.id).length;
        return n?`<b>${n}×</b>`:'<span class="chip c-crit">never</span>';}},
      {label:'Responsible',hideSm:true,render:r=>r.tech?esc(r.tech):'<span style="color:var(--muted)">Unassigned</span>'},
      {label:'',render:r=>`<button class="btn ok sm" onclick="event.stopPropagation();completePM('${jsq(r.id)}')">Mark done</button>
        <button class="btn out sm" onclick="event.stopPropagation();genWO('${jsq(r.id)}')">Generate WO</button>`}
    ],pms.sort((x,y)=>(x.nextDue||'9999').localeCompare(y.nextDue||'9999')),
      {empty:'No PM schedules on this asset.',onRow:'showPMHistory'})}
  </div>
  ${pmHistory.length?`<div class="card"><h3 class="sec">PM completion history — last ${pmHistory.length}</h3>
    ${renderTable([
      {label:'Completed',render:l=>`<b>${fmtDate(l.doneDate)}</b>`},
      {label:'PM',render:l=>`<span class="mono">${esc(l.pmId)}</span>`},
      {label:'Task',render:l=>esc(l.description||'—')},
      {label:'On time',render:l=>Compliance.onTime(l)?'<span class="chip c-done">Yes</span>'
        :`<span class="chip c-crit">${l.daysLate}d late</span>`},
      {label:'By',render:l=>esc(l.by||'—')},
      {label:'Findings',hideSm:true,render:l=>l.notes
        ?esc(l.notes.length>50?l.notes.slice(0,50)+'…':l.notes):'<span style="color:var(--muted)">—</span>'}
    ],pmHistory)}
    <div class="actions"><a class="btn out sm" href="#" onclick="setCompAsset('${jsq(a.id)}');location.hash='#/compliance';return false;">Full compliance record</a></div>
  </div>`:''}
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
      {label:'Mfr P/N',hideSm:true,render:r=>`<span class="mono">${esc(r.mfrPn||'—')}</span>`},
      {label:'Bin location',render:r=>`<span class="mono">${esc(r.location||'—')}</span>`},
      {label:'On hand',num:true,render:r=>r.qty??'—'},
      {label:'Status',render:r=>{const s=DB.partStatus(r);return `<span class="chip ${s.cls}">${s.label}</span>`;}}
    ],parts,{empty:'No parts linked yet.',onRow:'editPart'})}
  </div>`;}

function newWOFor(a){editWO(null,a);}
function newPMFor(a){editPM(null,a);}
function newPartFor(a){editPart(null,a);}

function renderQR(){
  const assets=DB.all('assets').filter(a=>matches(a,['id','name','location','manufacturer']));
  const base=appBaseUrl();
  const test=qrSelfTest();
  if(!base)return `<h1 class="page">QR Tags</h1>
    <div class="note bad">This page is open as a local file, so there is no web address to encode.</div>`;
  if(!test.ok)return `<h1 class="page">QR Tags</h1>
    <div class="note bad"><b>The QR engine is not running — ${esc(test.msg)}.</b><br><br>
    Almost always this means <span class="mono">assets/qr.js</span> is missing from the deployed site.
    Open <span class="mono">${esc(base)}assets/qr.js</span> in a new tab:
    <ul style="margin:8px 0 0 18px;line-height:1.9">
      <li>A <b>404</b> means the file never made it into the repo — upload it and commit.</li>
      <li>Code showing means it loaded but errored — hard-refresh with <b>Ctrl+Shift+R</b>.</li>
    </ul></div>`;
  if(!assets.length)return `<h1 class="page">QR Tags</h1><p class="sub">No assets to tag yet.</p>
    <div class="placeholder">Add an asset first.</div>`;
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

function editAsset(id){
  if(id&&!DB.get('assets',id)){toast('That asset no longer exists');route();return;}
  const a=id?DB.get('assets',id):{};
  const isNew=!id;
  Modal.open({title:isNew?'New asset':'Asset '+a.id,
    body:`${F.text('id','Asset ID',a.id||DB.nextId('assets','',4),{required:true,readonly:!isNew})}
      ${F.text('name','Equipment name',a.name,{required:true,placeholder:'e.g. Top Roll Assembly'})}
      <div class="f2">
        <div>${F.text('manufacturer','Manufacturer',a.manufacturer)}</div>
        <div>${F.text('model','Model',a.model,{hint:'Machines sharing a model are matched together in Smart Assist.'})}</div>
        <div>${F.text('serial','Serial number',a.serial)}</div>
        <div>${F.text('project','Project number',a.project)}</div>
        <div>${F.text('location','Location / line',a.location)}</div>
        <div>${F.select('status','Status',a.status||'Active',['Active','Standby','Down','Retired'])}</div>
      </div>
      ${F.person('owner','Responsible person',a.owner,{emptyLabel:'— nobody assigned —'})}
      <h3 class="sec" style="margin-top:24px">Documentation</h3>
      ${F.text('manualUrl','Machine manual link',a.manualUrl,{placeholder:'https://iacgroup.sharepoint.com/...',hint:LINK_HINT})}
      ${F.text('drawingUrl','Drawings / schematics link',a.drawingUrl,{placeholder:'https://iacgroup.sharepoint.com/...'})}
      ${F.area('notes','Notes',a.notes)}
      ${!isNew&&a.updatedBy?`<div class="note">Last changed by <b>${esc(a.updatedBy)}</b></div>`:''}`,
    footer:`<button class="btn filled" onclick="saveAsset(${isNew})">Save asset</button>
      ${!isNew?`<button class="btn out" onclick="showQR('${jsq(a.id)}')">QR tag</button>`:''}
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delAsset('${jsq(a.id)}')">Delete</button>`:''}`});}

function saveAsset(isNew){
  const d=F.read();
  if(!d.id||!d.name){toast('Asset ID and equipment name are required');return;}
  if(isNew&&DB.get('assets',d.id)){toast('That asset ID already exists');return;}
  if(d.manualUrl&&!safeUrl(d.manualUrl)){toast('The manual link is not a valid web address');return;}
  if(d.drawingUrl&&!safeUrl(d.drawingUrl)){toast('The drawings link is not a valid web address');return;}
  DB.upsert('assets',d);Modal.close();
  if(isNew)openAsset(d.id);else route();
  toast('Asset '+d.id+' saved');}

function delAsset(id){
  const pms=DB.forAsset('pms',id).length,wos=DB.forAsset('wos',id).length;
  confirmDelete(`Delete asset ${id}?\n\n${pms} PM(s) and ${wos} work order(s) will be unlinked but not deleted.`,()=>{
    DB.remove('assets',id);Modal.close();location.hash='#/assets';toast('Asset deleted');});}

/* ============================================================
   PM PLAN
   ============================================================ */
function setPMFilter(f){PM_FILTER=f;route();}

function renderPM(){
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
  const unassigned=all.filter(r=>!r.tech).length;
  const mine=all.filter(r=>(r.tech||'')===meName).length;
  const comp=Compliance.summary({days:90});
  return `
  <h1 class="page">PM Plan</h1>
  <p class="sub">${all.length} preventive maintenance schedule${all.length===1?'':'s'} ·
    <a href="#/compliance">${comp.pct===null?'no':comp.pct+'%'} on-time over 90 days</a></p>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat click" onclick="setPMFilter('all')"><div class="n">${all.length}</div><div class="l">Scheduled PMs</div></div>
    <div class="stat click" onclick="setPMFilter('overdue')"><div class="n" style="color:${overdue?'var(--bad)':'inherit'}">${overdue}</div><div class="l">Overdue</div></div>
    <div class="stat click" onclick="setPMFilter('mine')"><div class="n">${mine}</div><div class="l">Assigned to you</div></div>
    <div class="stat click" onclick="setPMFilter('never')"><div class="n" style="color:${never.size?'var(--bad)':'var(--ok)'}">${never.size}</div><div class="l">Never completed</div></div>
  </div>
  <div class="chipset">
    <button class="btn filled" onclick="editPM()">&#43; New PM</button>
    <a class="btn tonal" href="#/compliance">&#9989; Compliance record</a>
    <button class="fchip ${PM_FILTER==='all'?'on':''}" onclick="setPMFilter('all')">All</button>
    <button class="fchip ${PM_FILTER==='mine'?'on':''}" onclick="setPMFilter('mine')">Mine</button>
    <button class="fchip ${PM_FILTER==='overdue'?'on':''}" onclick="setPMFilter('overdue')">Overdue</button>
    <button class="fchip ${PM_FILTER==='never'?'on':''}" onclick="setPMFilter('never')">Never done</button>
    <button class="fchip ${PM_FILTER==='unassigned'?'on':''}" onclick="setPMFilter('unassigned')">Unassigned</button>
    <button class="btn out" onclick="exportCSV('pms')">Export CSV</button>
  </div>
  ${never.size&&PM_FILTER==='all'?`<div class="note bad">
    <b>${never.size} PM${never.size===1?' has':'s have'} never been marked complete.</b>
    If the work is happening but not being logged, it cannot be proven.
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

function editPM(id,presetAsset){
  if(id&&!DB.get('pms',id)){toast('That PM no longer exists');route();return;}
  const p=id?DB.get('pms',id):{};
  const isNew=!id;
  const asset=DB.get('assets',p.assetId||presetAsset||'');
  const defaultTech=p.tech||(isNew&&asset?(asset.owner||''):'');
  const logs=id?Compliance.logsFor(id):[];
  Modal.open({title:isNew?'New PM schedule':'PM '+p.id,
    body:`${F.text('id','PM number',p.id||DB.nextId('pms','PM-',3),{required:true,readonly:!isNew})}
      ${F.select('assetId','Asset',p.assetId||presetAsset||'',assetOptions(),{required:true})}
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
        Changing the frequency does not alter past records — they keep the schedule that applied at the time.`
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
  DB.upsert('pms',d);Modal.close();route();toast('PM '+d.id+' saved');}

function delPM(id){
  const logs=Compliance.logsFor(id).length;
  confirmDelete(`Delete PM ${id}?\n\n${logs?logs+' completion record(s) stay in the compliance history — deleting the schedule does not erase proof the work was done.':'No completion history.'}`,()=>{
    DB.remove('pms',id);Modal.close();route();toast('PM deleted');});}

function genWO(pmId){
  const p=DB.get('pms',pmId);
  if(!p){toast('That PM no longer exists');route();return;}
  const wo={id:DB.nextId('wos','WO-',4),assetId:p.assetId,
    description:p.description||('PM '+p.id),type:'Preventive',
    priority:(DB.daysUntil(p.nextDue)??99)<0?'High':'Medium',
    assignedTo:p.tech||'',docUrl:p.procedureUrl||'',
    requestedBy:DB.getWho(),dateRequested:today(),dateDue:p.nextDue||today(),
    status:'Open',pmId:p.id,cause:'To be determined'};
  DB.upsert('wos',wo);route();
  toast(wo.id+' created from '+p.id+(wo.assignedTo?' for '+wo.assignedTo:''));}

/* ============================================================
   SPARE PARTS
   ============================================================ */
function renderParts(){
  const rows=DB.all('parts').filter(p=>matches(p,['id','description','mfrPn','vendor','location','assetId']));
  const value=rows.reduce((s,p)=>{
    const q=DB.num(p.qty),c=DB.num(p.cost);
    return s+(q!==null&&c!==null?q*c:0);},0);
  const low=rows.filter(p=>DB.partStatus(p).label==='Low stock').length;
  return `
  <h1 class="page">Spare Parts</h1>
  <p class="sub">${rows.length} part${rows.length===1?'':'s'} in the crib</p>
  <div class="grid g4" style="margin-bottom:20px">
    <div class="stat"><div class="n">${rows.length}</div><div class="l">Parts tracked</div></div>
    <div class="stat"><div class="n" style="color:${low?'var(--bad)':'inherit'}">${low}</div><div class="l">At or below minimum</div></div>
    <div class="stat"><div class="n">${rows.filter(p=>DB.num(p.qty)===null).length}</div><div class="l">Not yet counted</div></div>
    <div class="stat"><div class="n">${value?'$'+value.toLocaleString(undefined,{maximumFractionDigits:0}):'—'}</div><div class="l">Inventory value</div></div>
  </div>
  <div class="chipset">
    <button class="btn filled" onclick="editPart()">&#43; New part</button>
    <button class="btn out" onclick="exportCSV('parts')">Export CSV</button>
  </div>
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">Parts list</h3>
    ${renderTable([
      {label:'Part number',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.docUrl,'Spec sheet')}<br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}</small>`},
      {label:'Mfr P/N',hideSm:true,render:r=>`<span class="mono">${esc(r.mfrPn||'—')}</span>`},
      {label:'Vendor',key:'vendor',hideSm:true},
      {label:'Location',render:r=>`<span class="mono">${esc(r.location||'—')}</span>`},
      {label:'On hand',num:true,render:r=>r.qty??'—'},
      {label:'Min',num:true,hideSm:true,render:r=>r.min??'—'},
      {label:'Status',render:r=>{const s=DB.partStatus(r);return `<span class="chip ${s.cls}">${s.label}</span>`;}},
      {label:'',render:r=>`<button class="btn tonal sm" onclick="event.stopPropagation();countPart('${jsq(r.id)}')">Count</button>`}
    ],rows,{empty:'No parts yet.',onRow:'editPart'})}
  </div>`;}

function editPart(id,presetAsset){
  if(id&&!DB.get('parts',id)){toast('That part no longer exists');route();return;}
  const p=id?DB.get('parts',id):{};
  const isNew=!id;
  Modal.open({title:isNew?'New part':'Part '+p.id,
    body:`${safeUrl(p.imageUrl)?`<div class="prev"><img src="${esc(safeUrl(p.imageUrl))}" alt="" onerror="this.parentNode.style.display='none'"/></div>`:''}
      ${F.text('id','Part number',p.id||DB.nextId('parts','P-',4),{required:true,readonly:!isNew})}
      ${F.text('description','Description',p.description,{required:true})}
      ${F.select('assetId','Used on asset',p.assetId||presetAsset||'',assetOptions())}
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
  DB.upsert('parts',d);Modal.close();route();toast('Part '+d.id+' saved');}
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
   WORK ORDERS
   ============================================================ */
function setWOView(v){WO_VIEW=v;route();}
function setWOFilter(f){WO_FILTER=f;route();}

function renderWO(){
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
  <h1 class="page">Work Orders</h1>
  <p class="sub">${all.length} work order${all.length===1?'':'s'} on record · ${hours.toFixed(1)}h logged</p>
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
  </div>
  ${WO_VIEW==='calendar'?renderWOCalendar():`
  <div class="card" style="padding:6px 20px 20px">
    <h3 class="sec" style="margin-top:16px">${esc(title)}</h3>
    ${renderTable([
      {label:'WO',render:r=>`<b class="mono">${esc(r.id)}</b>`},
      {label:'Description',render:r=>`<b>${esc(r.description||'—')}</b> ${docChip(r.docUrl,'Reference document')}<br><small style="color:var(--muted)">${esc(DB.assetName(r.assetId))}${r.pmId?' · from '+esc(r.pmId):''}</small>`},
      {label:'Type',hideSm:true,render:r=>`<span class="chip c-open">${esc(r.type||'—')}</span>`},
      {label:'Priority',render:r=>prioChip(r.priority)},
      {label:'Assigned to',render:r=>r.assignedTo
        ?(r.assignedTo===meName?`<b>${esc(r.assignedTo)}</b>`:esc(r.assignedTo))
        :'<span class="chip c-crit">Nobody</span>'},
      {label:'Scheduled',hideSm:true,render:r=>fmtDate(r.dateDue||r.dateRequested)},
      {label:'Status',render:r=>statusChip(r.status)}
    ],rows,{empty:'No work orders in this view.',onRow:'editWO'})}
  </div>`}`;}

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
    /* Past completions show as done, so the calendar becomes a record of
       what actually happened, not only what is planned. */
    DB.all('pmlogs').forEach(l=>{
      push(l.doneDate,`<div class="ev ev-pmdone" title="${esc(l.pmId+' completed by '+(l.by||''))}"
        onclick="showPMHistory('${jsq(l.pmId)}')">&#10003; ${esc(l.pmId)}</div>`);});}
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
    </div></div>`;}

function editWO(id,presetAsset){
  if(id&&!DB.get('wos',id)){toast('That work order no longer exists');route();return;}
  const w=id?DB.get('wos',id):{};
  const isNew=!id;
  const partOpts=[{v:'',t:'— none —'}].concat(
    DB.all('parts').filter(p=>!w.assetId||!p.assetId||p.assetId===w.assetId||p.assetId===presetAsset)
      .map(p=>({v:p.id,t:p.id+' · '+(p.description||'')})));
  const asset=DB.get('assets',w.assetId||presetAsset||'');
  const exclude=w.id||'';
  Modal.open({title:isNew?'New work order':'Work order '+w.id,
    body:`${F.text('id','Work order number',w.id||DB.nextId('wos','WO-',4),{required:true,readonly:!isNew})}
      ${F.select('assetId','Asset',w.assetId||presetAsset||'',assetOptions(),
        {required:true,onchange:`refreshSimilar('${jsq(exclude)}')`})}
      ${asset&&(safeUrl(asset.manualUrl)||safeUrl(asset.drawingUrl))?`<div class="actions" style="margin-top:10px">
        ${docLink(asset.manualUrl,'Machine manual',{cls:'btn tonal sm',icon:'&#128214;'})}
        ${docLink(asset.drawingUrl,'Drawings',{cls:'btn tonal sm',icon:'&#128208;'})}</div>`:''}
      ${F.area('description','Description of work',w.description,3,{oninput:`refreshSimilar('${jsq(exclude)}')`})}
      <div id="similarBox">${similarPanel(w.assetId||presetAsset||'',w.description||'',w.cause||'',exclude)}</div>
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
      ${F.select('cause','Cause of failure',w.cause||'To be determined',CAUSES,
        {onchange:`refreshSimilar('${jsq(exclude)}')`})}
      ${F.select('partsUsed','Parts used',w.partsUsed,partOpts)}
      ${F.area('notes','What you found and what you did',w.notes,4,
        {placeholder:'e.g. Sonotrode face was pitted. Swapped in CT_12672, retorqued stack to 45 Nm.',
         hint:'This is what the next person sees when the same thing happens again.'})}
      ${F.text('docUrl','Reference document link',w.docUrl,{placeholder:'https://...',hint:LINK_HINT})}
      ${w.pmId?`<div class="note">Generated from PM <b>${esc(w.pmId)}</b>.
        Completing this also records a PM completion.</div>`:''}
      ${!isNew&&w.updatedBy?`<div class="note">Last changed by <b>${esc(w.updatedBy)}</b></div>`:''}`,
    footer:`<button class="btn filled" onclick="saveWO(${isNew})">Save work order</button>
      ${!isNew&&w.status!=='Completed'?`<button class="btn ok" onclick="closeWO('${jsq(w.id)}')">Complete</button>`:''}
      <button class="btn out" onclick="Modal.close()">Cancel</button>
      ${!isNew&&DB.can('delete')?`<button class="btn bad" style="margin-left:auto" onclick="delWO('${jsq(w.id)}')">Delete</button>`:''}`});}

function saveWO(isNew){
  const d=F.read();
  if(!d.id){toast('Work order number is required');return;}
  if(!d.assetId){toast('Pick the asset this work order is for');return;}
  if(isNew&&DB.get('wos',d.id)){toast('That work order number already exists');return;}
  if(d.docUrl&&!safeUrl(d.docUrl)){toast('The document link is not a valid web address');return;}
  DB.upsert('wos',d);Modal.close();route();toast('Work order '+d.id+' saved');}

function closeWO(id){
  const d=F.read();
  if(!d.cause||d.cause==='To be determined'){toast('Record a cause of failure before completing');return;}
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
  /* A work order generated from a PM is how that PM gets done. Closing it
     must leave the same evidence as marking the PM complete directly —
     otherwise compliance quietly under-reports real work. */
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
   CSV IMPORT (admin)
   ============================================================ */
let IMPORT={entity:'assets',headers:[],records:[],map:{},filename:''};
const ENTITY_LABEL={assets:'Assets',pms:'PM Schedule',parts:'Spare Parts',
  wos:'Work Orders',pmlogs:'PM Completion History'};

function renderImport(){
  const fieldList=e=>Object.keys(CSV.ALIAS[e]).join(', ');
  return `
  <h1 class="page">Import CSV</h1>
  <p class="sub">Drop a spreadsheet export in and map the columns.</p>
  <div class="card"><h3 class="sec">1 · Choose what you are importing</h3>
    <div class="chipset">${Object.keys(ENTITY_LABEL).map(e=>
      `<button class="fchip ${IMPORT.entity===e?'on':''}" onclick="setImportEntity('${e}')">${ENTITY_LABEL[e]}</button>`).join('')}</div>
    <div class="note">Recognised fields for <b>${ENTITY_LABEL[IMPORT.entity]}</b>: <span class="mono">${fieldList(IMPORT.entity)}</span>.
      ${IMPORT.entity==='pmlogs'?`<br><br><b>Importing past PM completions</b> is how you get compliance
      history for work done before this system existed. Each row needs at least a PM number and a completed date.`:''}</div>
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
  const prefix={assets:'',pms:'PM-',parts:'P-',wos:'WO-',pmlogs:'PMC-'}[IMPORT.entity];
  const pad=IMPORT.entity==='pmlogs'?5:4;
  clean.forEach((r,i)=>{
    if(!r.id)r.id=DB.nextId(IMPORT.entity,prefix,pad)+(i?'-'+i:'');
    /* Imported completions need daysLate computed, since an old
       spreadsheet will not have it. */
    if(IMPORT.entity==='pmlogs'&&r.dueDate&&r.doneDate&&r.daysLate===undefined){
      r.daysLate=Compliance.daysBetween(r.dueDate,r.doneDate);}});
  const {added,updated}=DB.bulkUpsert(IMPORT.entity,clean);
  const ent=IMPORT.entity;
  cancelImport();
  toast(`Imported — ${added} added, ${updated} updated`);
  location.hash='#/'+({assets:'assets',pms:'pm',parts:'parts',wos:'wo',pmlogs:'compliance'}[ent]);}
function exportCSV(entity){
  const fields=Object.keys(CSV.ALIAS[entity]);
  const rows=DB.all(entity);
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
  <div class="card"><h3 class="sec">What each role can do</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Action</th><th>Maintenance</th><th>Admin</th></tr></thead>
      <tbody>
        <tr><td>View everything, including compliance</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Create and edit work orders</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Record PM completions</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td>Add and edit assets, PMs, parts</td><td>&#10003;</td><td>&#10003;</td></tr>
        <tr><td><b>Delete</b> anything</td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td><b>Import CSV</b></td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
        <tr><td><b>Manage users</b></td><td style="color:var(--muted)">—</td><td>&#10003;</td></tr>
      </tbody></table></div>
    <div class="note">Nobody can edit a completion record once written — not even an admin.
    That is what makes the compliance history worth something.</div>
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
        {v:'maintenance',t:'Maintenance — everyday work'},
        {v:'admin',t:'Admin — everything, including users'}])}
      ${F.text('password','Temporary password','',{required:true,type:'text',autocomplete:'off'})}
      <div id="userMsg"></div>
      <div class="note">The full name is what appears on completion records, so use the name
      people actually go by.</div>`,
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
        {v:'maintenance',t:'Maintenance — everyday work'},
        {v:'admin',t:'Admin — everything, including users'}])}
      ${isMe?'<div class="note">This is your own account. You cannot lock yourself out.</div>':''}
      ${openWos.length?`<div class="note"><b>${openWos.length} open work order${openWos.length===1?'':'s'}</b> assigned.</div>`:''}
      <div class="note">Renaming does not change completion records already written under the
      old name — history stays as it was recorded.</div>
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
  const counts={Assets:db.assets.length,PMs:db.pms.length,Parts:db.parts.length,
    'Work orders':db.wos.length,'PM completions':db.pmlogs.length};
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const admin=DB.isAdmin();
  const comp=Compliance.summary({days:90});
  return `
  <h1 class="page">Settings</h1>
  <p class="sub">Signed in as <b>${esc(s.who)}</b> · ${esc(ROLE_LABEL[s.role]||s.role)}</p>
  <div class="card"><h3 class="sec">Your account</h3>
    <div class="tablewrap"><table><tbody>
      <tr><td style="color:var(--muted)">Name</td><td><b>${esc(s.who)}</b></td></tr>
      <tr><td style="color:var(--muted)">Username</td><td><span class="mono">${esc(s.username)}</span></td></tr>
      <tr><td style="color:var(--muted)">Role</td><td><span class="chip ${s.role==='admin'?'c-pur':'c-open'}">${esc(ROLE_LABEL[s.role]||s.role)}</span></td></tr>
    </tbody></table></div>
    <div class="actions">
      <button class="btn filled" onclick="openChangePassword(false)">Change my password</button>
      <button class="btn out" onclick="signOut()">Sign out</button></div></div>
  <div class="card"><h3 class="sec">Connection</h3>
    ${s.mode==='cloud'
      ?`<div class="note"><b>Live — connected to the shared database.</b></div>`
      :`<div class="note bad"><b>Offline — working on this device only.</b><br>
         ${esc(s.error||'No connection.')}<br>
         ${s.pending?`<b>${s.pending} change${s.pending===1?'':'s'} waiting to be sent.</b>`:''}</div>`}
    <div class="actions">
      <button class="btn filled" onclick="reconnect()">${s.mode==='cloud'?'Refresh now':'Try to reconnect'}</button></div></div>
  <div class="card"><h3 class="sec">Site</h3>
    <label for="siteName">Site name</label>
    <input id="siteName" value="${esc(db.meta.site||'')}" ${admin?'onchange="saveSite(this.value)"':'readonly'}/></div>
  <div class="card"><h3 class="sec">Data in the database</h3>
    ${renderTable([{label:'Collection',key:'k'},{label:'Records',num:true,key:'v'}],
      Object.entries(counts).map(([k,v])=>({id:k,k,v})))}
    <div class="note">${total} record${total===1?'':'s'} total ·
      <a href="#/compliance">${comp.pct===null?'no':comp.pct+'%'} PM compliance over 90 days</a>.
      Completion records are permanent and cannot be edited.</div></div>
  ${admin?`<div class="card"><h3 class="sec">Backup and sample data</h3>
    <div class="actions">
      <button class="btn filled" onclick="Backup.export()">Download backup</button>
      <button class="btn out" onclick="exportCompliance()">Export PM compliance</button>
      <button class="btn out" onclick="migrateUp()" ${s.mode==='cloud'?'':'disabled'}>Upload this device's data</button>
      <button class="btn out" onclick="seedSample()">Load sample data</button></div></div>`
  :`<div class="card"><h3 class="sec">Backup</h3>
    <div class="actions"><button class="btn filled" onclick="Backup.export()">Download backup</button></div></div>`}`;}

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
  const n=db.assets.length+db.pms.length+db.parts.length+db.wos.length+db.pmlogs.length;
  if(!n){toast('Nothing on this device to upload');return;}
  confirmDelete(`Upload ${n} records into the shared database?`,()=>{
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
  DB.bulkUpsert('assets',[
    {id:'3526',name:'Top Roll Assembly',manufacturer:'3Con',model:'TR-900',project:'3527',
      location:'Ultrasonic weld cell',status:'Active',owner:me,
      manualUrl:'https://example.com/manuals/3526-top-roll.pdf'},
    {id:'3527',name:'Air Compressor #1',manufacturer:'Atlas Copco',model:'GA22',
      location:'Utilities room',status:'Active',owner:me}]);
  DB.bulkUpsert('pms',[
    {id:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',nextDue:plus(2),tech:me,lastDone:back(5)},
    {id:'PM-004',assetId:'3526',description:'Clean/replace main air supply filters',
      frequency:'monthly',nextDue:plus(9),tech:me,lastDone:back(21)},
    {id:'PM-005',assetId:'3526',description:'Lubricate sliding and rotating components',
      frequency:'monthly',nextDue:back(12),tech:me,lastDone:back(42)},
    {id:'PM-007',assetId:'3527',description:'Inspect compressor cooler and drain traps',
      frequency:'quarterly',nextDue:plus(30)},
    {id:'PM-009',assetId:'3526',description:'Back up PLC/servo programs',frequency:'annually',nextDue:plus(200)}]);
  DB.bulkUpsert('parts',[
    {id:'CT_12672',description:'Sonotrode',assetId:'3526',mfrPn:'6821000797',vendor:'3CON',location:'SP1-I2-B5'},
    {id:'CT_1710',description:'Ultrasonic generator',assetId:'3526',mfrPn:'88194',vendor:'HERRMANN',location:'SP1-E3-B22'},
    {id:'P-1001',description:'Compressor oil filter',assetId:'3527',mfrPn:'GRA-4471',vendor:'Grainger',
      location:'SP1-A1-B2',qty:'12',min:'5',cost:'38.50'}]);
  /* A realistic mix: mostly on time, one late, one PM never done —
     so the compliance screen shows something worth looking at. */
  DB.bulkUpsert('pmlogs',[
    {id:'PMC-00001',pmId:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',dueDate:back(5),doneDate:back(5),daysLate:0,by:me,hours:'0.5',
      notes:'Sonotrode faces clean, weld pull tests within spec.'},
    {id:'PMC-00002',pmId:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',dueDate:back(12),doneDate:back(11),daysLate:1,by:me,hours:'0.5',
      notes:'Minor buildup on anvil, cleaned. No action needed.'},
    {id:'PMC-00003',pmId:'PM-003',assetId:'3526',description:'Inspect and clean sonotrodes/anvils; check weld quality',
      frequency:'weekly',dueDate:back(19),doneDate:back(12),daysLate:7,by:me,hours:'0.75',
      notes:'Late — cell was running production all week. Found nothing abnormal.'},
    {id:'PMC-00004',pmId:'PM-004',assetId:'3526',description:'Clean/replace main air supply filters',
      frequency:'monthly',dueDate:back(21),doneDate:back(21),daysLate:0,by:me,hours:'1',
      notes:'Replaced both element filters, drained separator.'},
    {id:'PMC-00005',pmId:'PM-004',assetId:'3526',description:'Clean/replace main air supply filters',
      frequency:'monthly',dueDate:back(51),doneDate:back(50),daysLate:1,by:me,hours:'1',
      notes:'Filters still clean, blew out and reinstalled.'},
    {id:'PMC-00006',pmId:'PM-005',assetId:'3526',description:'Lubricate sliding and rotating components',
      frequency:'monthly',dueDate:back(42),doneDate:back(42),daysLate:0,by:me,hours:'0.5',
      notes:'All points greased.'}]);
  DB.bulkUpsert('wos',[
    {id:'WO-1002',assetId:'3526',description:'Replace worn sonotrode on station 2',type:'Repair',
      priority:'Medium',requestedBy:me,assignedTo:me,
      dateRequested:back(22),dateCompleted:back(21),hours:'2.5',cost:'1250',
      status:'Completed',cause:'Wear / end of life',partsUsed:'CT_12672',
      notes:'Sonotrode face pitted. Swapped in CT_12672, retorqued stack to 45 Nm.'},
    {id:'WO-1003',assetId:'3526',description:'Weld quality drift — investigate generator output',
      type:'Troubleshoot',priority:'High',requestedBy:'Quality',
      dateRequested:back(2),dateDue:plus(3),status:'Open',cause:'To be determined'}]);
  route();
  toast('Sample data loaded — including PM completion history');}

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
})();
