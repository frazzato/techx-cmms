/* ============================================================
   csv.js — CSV parse / build + column mapping for imports
   ============================================================ */
const CSV = (() => {
  function parse(text){
    text=String(text).replace(/^\uFEFF/,'');
    const rows=[];let row=[],field='',q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(q){if(c==='"'&&n==='"'){field+='"';i++;}else if(c==='"')q=false;else field+=c;}
      else{if(c==='"')q=true;
        else if(c===','){row.push(field);field='';}
        else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
        else if(c==='\r'){}
        else field+=c;}}
    if(field.length||row.length){row.push(field);rows.push(row);}
    return rows.filter(r=>r.some(c=>String(c).trim()!==''));}
  function toObjects(text){
    const rows=parse(text);
    if(!rows.length)return{headers:[],records:[]};
    const headers=rows[0].map(h=>h.trim());
    const records=rows.slice(1).map(r=>{const o={};headers.forEach((h,i)=>{o[h]=(r[i]||'').trim();});return o;});
    return{headers,records};}
  /* Excel and Sheets execute a cell that begins with = + - or @, so a
     technician's note reading "=cmd|..." would run when someone opens
     the export. These exports go to people outside maintenance. */
  function neutralise(s){return /^[=+\-@\t\r]/.test(s)?"'"+s:s;}
  function esc(v){
    const s=neutralise(v===null||v===undefined?'':String(v));
    return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
  function build(headers,rows){
    return headers.map(h=>esc(h)).join(',')+'\n'+
      rows.map(r=>headers.map(h=>esc(r[h])).join(',')).join('\n');}
  function download(filename,text){
    const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=filename;a.click();
    URL.revokeObjectURL(a.href);}
  const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const ALIAS={
    assets:{id:['assetid','asset','assetnumber','assetno','id','equipmentid','equipmentno','equipmentnumber'],
      name:['equipmentname','assetname','name','description','equipment'],
      manufacturer:['manufacturer','mfr','make','oem'],
      model:['model','modelnumber','modelno'],
      serial:['serialnumber','serialno','serial','serialnum','sn'],
      project:['projectnumber','project','projectno','projno','proj','projectnum'],
      location:['location','area','line','cell','plant'],
      status:['status','state'],
      owner:['owner','responsible','assetowner','equipmentowner','responsibleperson','assignedto'],
      hourlyCost:['hourlycost','downtimecost','costperhour','ratehour','hourlyrate','downtimerate'],
      manualUrl:['manual','manualurl','manuallink','documentlink','documenturl','doclink','docurl',
        'sharepoint','sharepointlink','manualsharepoint','operatingmanual','servicemanual'],
      drawingUrl:['drawing','drawingurl','drawinglink','electricaldrawing','schematic','schematicurl','cad','cadlink'],
      imageUrl:['imageurl','image','picture','photo','assetimage','equipmentimage'],
      notes:['notes','comment','comments','remarks']},
    pms:{id:['pmnumber','pmid','pmno','id','pm'],
      assetId:['assetid','asset','assetnumber','equipmentid','equipment'],
      description:['pmdescription','description','task','work','details'],
      frequency:['frequency','freq','interval','cadence'],
      nextDue:['nextdue','nextduedate','duedate','due','nextdate'],
      lastDone:['lastcompleted','lastdone','lastcompleteddate','lastdate'],
      tech:['assignedtechnician','technician','assignedto','owner','tech','responsible'],
      procedureUrl:['procedure','procedureurl','procedurelink','instruction','instructionurl','worksheet','checklist','checklisturl'],
      completed:['completed','done','iscompleted']},
    parts:{id:['partnumber','partno','partid','id','part'],
      description:['description','partdescription','name'],
      assetId:['assetid','asset','assetnumber','equipmentid','equipment','usedon'],
      mfrPn:['manufacturerpartnumber','mfrpn','mfgpartnumber','oempartnumber','mfrpartnumber'],
      vendor:['vendor','supplier','manufacturer','mfr'],
      location:['storagelocation','location','bin','binlocation','shelf'],
      qty:['quantityonhand','qtyonhand','qty','quantity','onhand','stock'],
      min:['minimumquantity','min','minqty','reorderpoint','minimum'],
      max:['maximumquantity','max','maxqty','maximum'],
      cost:['unitcost','cost','price','unitprice'],
      imageUrl:['imageurl','image','picture','photo','partimage'],
      docUrl:['specsheet','manual','manualurl','datasheet','docurl','document','specsheeturl']},
    wos:{id:['workordernumber','wonumber','workorder','wono','id','wo'],
      assetId:['assetid','asset','assetnumber','equipmentid','equipment'],
      description:['description','problem','issue','workdescription','task'],
      type:['worktype','type','category'],priority:['priority','urgency'],
      requestedBy:['requestedby','requester','reportedby'],
      assignedTo:['assignedto','technician','assignee','tech','responsible'],
      dateRequested:['requestdate','daterequested','datereported','created'],
      dateDue:['scheduleddate','duedate','datedue','scheduled','targetdate'],
      dateStarted:['datestarted','startdate','started'],
      dateCompleted:['datecompleted','completiondate','completed','dateclosed'],
      hours:['laborhours','hours','timeofrepair','downtimehours'],
      cost:['cost','totalcost','repaircost'],
      cause:['causeoffailure','cause','rootcause','failurecause'],
      partsUsed:['partsneeded','partsused','parts'],
      docUrl:['document','documenturl','documentlink','reference','referencelink','attachment','attachmenturl'],
      status:['status','state'],notes:['notes','technotes','remarks','comments','workperformed','repairdetails']},
    pmlogs:{id:['id','recordid','logid'],
      pmId:['pmnumber','pmid','pm','pmno'],
      assetId:['assetid','asset','assetnumber','equipmentid','equipment'],
      description:['task','description','pmdescription','work'],
      frequency:['frequency','freq','interval'],
      dueDate:['duedate','due','scheduleddate','datedue'],
      doneDate:['completeddate','datecompleted','completed','donedate','date'],
      by:['completedby','by','technician','who','performedby'],
      hours:['hours','laborhours','time'],
      notes:['notes','comments','remarks','findings'],
      woId:['workorder','workordernumber','wo','wonumber']},
    stops:{id:['id','recordid','eventid','stopid'],
      kind:['type','kind','category','eventtype'],
      assetId:['assetid','asset','assetnumber','equipmentid','equipment','machine'],
      reason:['reason','cause','downtimereason','defecttype','failuremode'],
      startedAt:['started','startedat','starttime','downtime','stoptime','from','begin'],
      endedAt:['ended','endedat','endtime','uptime','resumed','to','finish'],
      qty:['quantity','qty','parts','partsaffected','piecesaffected','scrapqty'],
      detail:['detail','details','whathappened','description','problem','notes'],
      fixedBy:['fix','fixedby','whatfixedit','resolution','correctiveaction','action','solution'],
      by:['reportedby','by','operator','who','loggedby'],
      closedBy:['closedby','resolvedby'],
      woId:['workorder','workordernumber','wo','wonumber']}};
  function mapHeaders(entity,headers){
    const alias=ALIAS[entity];const map={};
    headers.forEach(h=>{const n=norm(h);
      for(const field in alias){if(alias[field].includes(n)){map[h]=field;return;}}
      map[h]=null;});
    return map;}
  function applyMap(records,map){
    return records.map(rec=>{const out={};
      for(const h in map)if(map[h]&&rec[h]!==undefined&&rec[h]!=='')out[map[h]]=rec[h];
      return out;}).filter(o=>Object.keys(o).length);}
  return { parse, toObjects, build, download, mapHeaders, applyMap, ALIAS, norm };
})();
