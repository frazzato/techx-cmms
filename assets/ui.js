/* ============================================================
   ui.js — rendering helpers (no framework)
   ============================================================ */
function esc(s){
  return String(s===null||s===undefined?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Safe inside a single-quoted JS string within a double-quoted HTML
   attribute: onclick="fn('<here>')". JS-escape then HTML-escape. */
function jsq(s){
  return esc(String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
}
/* Only allow links that actually navigate. A pasted "javascript:" URL
   would otherwise run as soon as someone clicked it. */
function safeUrl(u){
  const s=String(u||'').trim();
  if(!s)return '';
  if(/^[a-z][a-z0-9+.-]*:/i.test(s))
    return /^(https?|ftp|mailto|file):/i.test(s)?s:'';
  return 'https://'+s;
}
function docLink(url,label,opts={}){
  const safe=safeUrl(url);
  if(!safe)return '';
  const cls=opts.cls||'btn out sm';
  const icon=opts.icon||'&#128196;';
  return `<a class="${cls}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer"
    onclick="event.stopPropagation()">${icon} ${esc(label||'Open document')} &#8599;</a>`;
}
let _toastT;
function toast(msg){
  const e=document.getElementById('toast');
  if(!e)return;
  e.textContent=msg;e.classList.add('show');
  clearTimeout(_toastT);
  _toastT=setTimeout(()=>e.classList.remove('show'),3400);
}
const Modal={
  open({title,body,footer}){
    document.getElementById('drawerTitle').textContent=title;
    document.getElementById('drawerBody').innerHTML=body;
    document.getElementById('drawerFoot').innerHTML=footer||'';
    document.getElementById('drawer').classList.add('show');
    document.getElementById('scrim').classList.add('show');
    const first=document.querySelector('#drawerBody input:not([readonly]),#drawerBody select,#drawerBody textarea');
    if(first)setTimeout(()=>first.focus(),180);
  },
  close(){
    document.getElementById('drawer').classList.remove('show');
    document.getElementById('scrim').classList.remove('show');
  }
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')Modal.close();});
const F={
  text(name,label,val,opts={}){
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <input id="f_${name}" name="${name}" type="${opts.type||'text'}" value="${esc(val??'')}"
        ${opts.readonly?'readonly':''} ${opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''}
        ${opts.autocomplete?`autocomplete="${opts.autocomplete}"`:''}
        ${opts.list?`list="${esc(opts.list)}"`:''}
        ${opts.oninput?`oninput="${opts.oninput}"`:''}/>
      ${opts.datalist?`<datalist id="${esc(opts.list)}">${
        opts.datalist.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`:''}
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  num(name,label,val,opts={}){
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <input id="f_${name}" name="${name}" type="number" step="${opts.step||'any'}" value="${esc(val??'')}"
        ${opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''}/>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  date(name,label,val,opts={}){
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <input id="f_${name}" name="${name}" type="date" value="${esc(val??'')}"/>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  datetime(name,label,val,opts={}){
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <input id="f_${name}" name="${name}" type="datetime-local" value="${esc(val??'')}"/>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  select(name,label,val,options,opts={}){
    const o=options.map(x=>{
      const v=typeof x==='string'?x:x.v,t=typeof x==='string'?x:x.t;
      return `<option value="${esc(v)}" ${String(val??'')===String(v)?'selected':''}>${esc(t)}</option>`;
    }).join('');
    return `${label?`<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>`:''}
      <select id="f_${name}" name="${name}" ${opts.onchange?`onchange="${opts.onchange}"`:''}>${o}</select>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  person(name,label,val,opts={}){
    const names=DB.peopleNames(val);
    if(!names.length){
      return `<label for="f_${name}">${esc(label)}</label>
        <input id="f_${name}" name="${name}" value="${esc(val??'')}" placeholder="Type a name"/>
        <div class="hint">No accounts loaded — type a name instead.</div>`;}
    const options=[{v:'',t:opts.emptyLabel||'— nobody assigned —'}].concat(names.map(n=>({v:n,t:n})));
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <select id="f_${name}" name="${name}">
        ${options.map(x=>`<option value="${esc(x.v)}" ${String(val??'')===String(x.v)?'selected':''}>${esc(x.t)}</option>`).join('')}
      </select>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  area(name,label,val,rows=3,opts={}){
    return `<label class="${opts.required?'req':''}" for="f_${name}">${esc(label)}</label>
      <textarea id="f_${name}" name="${name}" rows="${rows}"
        ${opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''}
        ${opts.oninput?`oninput="${opts.oninput}"`:''}>${esc(val??'')}</textarea>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  /* A checkbox list with a filter box. Used where one record can
     point at several others — a spare part fitting many machines.
     A native multi-select is close to unusable on a phone. */
  checks(name,label,selected,options,opts={}){
    const sel=new Set((selected||[]).map(String));
    const rows=options.map(o=>{
      const v=typeof o==='string'?o:o.v;
      const t=typeof o==='string'?o:o.t;
      const sub=typeof o==='object'&&o.sub?o.sub:'';
      return `<label class="chk" data-search="${esc((t+' '+sub).toLowerCase())}">
        <input type="checkbox" name="${name}" value="${esc(v)}" ${sel.has(String(v))?'checked':''}/>
        <span class="chk-txt"><b>${esc(t)}</b>${sub?`<small>${esc(sub)}</small>`:''}</span>
      </label>`;}).join('');
    return `<label class="${opts.required?'req':''}">${esc(label)}
        <span class="chk-count" id="cnt_${name}">${sel.size} selected</span></label>
      ${options.length>6?`<input class="chk-filter" placeholder="Filter…"
        oninput="filterChecks('${jsq(name)}',this.value)"/>`:''}
      <div class="chklist" id="chk_${name}" onchange="countChecks('${jsq(name)}')">
        ${rows||'<div class="empty" style="padding:16px">Nothing to choose from yet.</div>'}
      </div>
      ${opts.hint?`<div class="hint">${opts.hint}</div>`:''}`;},
  read(){
    const out={};
    /* Checkbox groups collapse to an array; everything else is a
       single value. Reading them the same way would silently keep
       only the last box ticked. */
    document.querySelectorAll('#drawerBody [name]').forEach(el=>{
      if(el.type==='checkbox'){
        if(!Array.isArray(out[el.name]))out[el.name]=[];
        if(el.checked)out[el.name].push(el.value);
      }else{out[el.name]=(el.value||'').trim();}});
    return out;}
};
function filterChecks(name,q){
  const box=document.getElementById('chk_'+name);
  if(!box)return;
  const needle=String(q||'').toLowerCase().trim();
  box.querySelectorAll('.chk').forEach(el=>{
    el.style.display=(!needle||(el.dataset.search||'').includes(needle))?'':'none';});}
function countChecks(name){
  const box=document.getElementById('chk_'+name);
  const out=document.getElementById('cnt_'+name);
  if(!box||!out)return;
  const n=box.querySelectorAll('input[type=checkbox]:checked').length;
  out.textContent=n+' selected';}

/* Label says Equipment; the stored collection is still "assets". */
function assetOptions(){
  return [{v:'',t:'— none —'}].concat(
    DB.all('assets').map(a=>({v:a.id,t:a.id+' · '+a.name})));
}
function assetChecklist(){
  return DB.all('assets').map(a=>({v:a.id,t:a.id+' · '+a.name,
    sub:[a.type,a.location].filter(Boolean).join(' · ')}));
}
function renderTable(cols,rows,opts={}){
  if(!rows.length)return `<div class="empty">${esc(opts.empty||'Nothing here yet.')}</div>`;
  const head=cols.map(c=>
    `<th${c.num?' style="text-align:right"':''}${c.hideSm?' data-sm="hide"':''}>${esc(c.label)}</th>`).join('');
  const body=rows.map((r,i)=>{
    const tds=cols.map(c=>{
      const v=c.render?c.render(r,i):esc(r[c.key]??'');
      return `<td class="${c.num?'num':''}"${c.hideSm?' data-sm="hide"':''}>${v}</td>`;}).join('');
    const click=opts.onRow?` class="clk" onclick="${opts.onRow}('${jsq(r.id)}')"`:'';
    return `<tr${click}>${tds}</tr>`;}).join('');
  return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function fmtDate(iso){
  if(!iso)return '—';
  const d=new Date(iso+(String(iso).length===10?'T00:00:00':''));
  if(isNaN(d))return esc(iso);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
/* Local "YYYY-MM-DDTHH:MM" shown as "Sep 15, 2:30 PM". */
function fmtLocal(local){
  if(!local)return '—';
  const m=String(local).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if(!m)return esc(local);
  const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
  if(isNaN(d))return esc(local);
  return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function money(v){const n=DB.num(v);return n===null?'—':'$'+n.toFixed(2);}
function money0(n){return '$'+Math.round(n).toLocaleString();}
function today(){return new Date().toISOString().slice(0,10);}
function confirmDelete(msg,fn){if(confirm(msg))fn();}

/* ---------- QR helpers ---------- */
function appBaseUrl(){
  const o=location.origin;
  if(!o||o==='null')return '';
  return o+location.pathname.replace(/index\.html$/,'');
}
function assetUrl(id){return appBaseUrl()+'#/asset/'+encodeURIComponent(id);}
function qrEngineReady(){return typeof QR!=='undefined'&&QR&&typeof QR.toSVG==='function';}
function qrSvg(text,px){
  if(!qrEngineReady())
    return `<div class="qrfail"><b>QR engine not loaded</b><span>assets/qr.js is missing or failed to load</span></div>`;
  if(!text)
    return `<div class="qrfail"><b>No address to encode</b><span>open the app over http, not as a file</span></div>`;
  try{return QR.toSVG(text,{size:px||150});}
  catch(e){return `<div class="qrfail"><b>Could not build code</b><span>${esc(e&&e.message?e.message:'unknown error')}</span></div>`;}
}
function qrSelfTest(){
  if(!qrEngineReady())return{ok:false,msg:'assets/qr.js not loaded'};
  try{
    const m=QR.encode('https://example.com/#/asset/TEST-1');
    if(!Array.isArray(m)||!m.length)return{ok:false,msg:'encoder returned nothing'};
    const n=m.length;
    if((n-17)%4!==0)return{ok:false,msg:'unexpected matrix size '+n};
    if(!m[0][0]||!m[0][n-1]||!m[n-1][0])return{ok:false,msg:'finder patterns wrong'};
    return{ok:true,msg:'encoder working ('+n+'×'+n+' test code)'};
  }catch(e){return{ok:false,msg:e&&e.message?e.message:'threw an error'};}
}
