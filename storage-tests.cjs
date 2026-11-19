/* Development-only tests. Run with node --test storage-tests.cjs.
   Set PLAYWRIGHT_CORE and CHROME_PATH when the local defaults are unavailable. */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const runtime=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies');
let chromium;
try { ({chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core')); }
catch { ({chromium}=require(path.join(runtime,'node','node_modules','playwright-core'))); }
const chrome=process.env.CHROME_PATH||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined);
const password='synthetic-test-password-2026';

test('local vault, authenticated transfer and file exports',async t=>{
  const server=http.createServer((req,res)=>{
    const permitted=['/storage.js','/pdf-font.js','/export.js'];
    if(permitted.includes(req.url)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,req.url.slice(1))));}
    else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Isolated test</title><script src="/storage.js"></script><script src="/pdf-font.js"></script><script src="/export.js"></script>');}
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const browser=await chromium.launch({headless:true,executablePath:chrome});
  t.after(()=>browser.close());
  const mainContext=await browser.newContext(),page=await mainContext.newPage(),url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);
  await t.test('upgrade a populated version 1 database, retain original bytes and property',async()=>{
    await page.evaluate(async()=>{
      const waiting=indexedDB.open('PropertyManagerLocal',1);
      waiting.onupgradeneeded=()=>{
        const d=waiting.result;
        for(const [name,id] of [['records','id'],['blobs','hash']]){
          const store=d.createObjectStore(name,{keyPath:['dataset',id]});
          store.createIndex('dataset','dataset');
        }
        d.createObjectStore('meta',{keyPath:'key'});
      };
      const d=await new Promise((resolve,reject)=>{waiting.onsuccess=()=>resolve(waiting.result);waiting.onerror=()=>reject(waiting.error);});
      const tx=d.transaction(['records'],'readwrite');
      tx.objectStore('records').put({dataset:'owner',id:'property',value:{type:'property',id:'property',name:'Original property',_device:'prior-device',_rev:'old-property',_ancestors:[],_parents:[]}});
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      d.close();await Store.init();
      const hash=await Store.storeBlob('owner',new Blob(['original receipt bytes'],{type:'text/plain'}));
      await Store.save('owner',[{type:'document',id:'receipt',hash,name:'Receipt.txt',propertyId:'property'}]);
      await Store.save('sample',[{type:'property',id:'demo',name:'Sample only'}]);
    });
    await page.reload();
    const info=await page.evaluate(async()=>{
      const records=await Store.list('owner');
      return [records.length,records.find(r=>r.id==='property').name,await (await Store.getBlob('owner',records.find(r=>r.type==='document').hash)).text(),(await Store.list('sample')).length];
    });
    assert.deepEqual(info,[2,'Original property','original receipt bytes',1]);
  });

  await t.test('encrypt, reject wrong password, tampering and archive truncation, restore atomically',async()=>{
    const result=await page.evaluate(async password=>{
      const ds='owner',before=await Store.list(ds);
      const saved=await Store.makeBackup(ds,password),bytes=await saved.blob.arrayBuffer();
      globalThis.testBackup=saved.blob;
      const damaged=new Uint8Array(bytes.slice(0));damaged[damaged.length-1]^=3;
      const attempts=[];
      for(const [file,key,scope] of [[saved.blob,'wrong-password','owner'],[new Blob([damaged]),password,'owner'],[saved.blob.slice(0,-8),password,'owner'],[saved.blob,password,'sample']]){
        try{await Store.readBackup(file,key,scope);attempts.push(false);}
        catch{attempts.push(true);}
      }
      const bundle=await Store.readBackup(saved.blob,password,ds),plan=await Store.planImport(ds,bundle,'restore');
      const ctrl=new AbortController();ctrl.abort();
      try{await Store.commitImport(plan,{},ctrl.signal);attempts.push(false);}catch{attempts.push(true);}
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(row){
        if(this.name==='blobs')throw new DOMException('Injected mid-restore interruption','QuotaExceededError');
        return put.apply(this,arguments);
      };
      try{await Store.commitImport(plan);attempts.push(false);}catch{attempts.push(true);}
      finally{IDBObjectStore.prototype.put=put;}
      const preserved=JSON.stringify(before)===JSON.stringify(await Store.list(ds));
      await Store.save(ds,[{type:'task',id:'later',propertyId:'property',title:'Added during review'}]);
      try{await Store.commitImport(plan);attempts.push(false);}catch{attempts.push(true);}
      const fresh=await Store.planImport(ds,bundle,'restore');
      await Store.commitImport(fresh);
      const after=await Store.list(ds),receipt=after.find(r=>r.id==='receipt');
      return {attempts,preserved,exact:JSON.stringify(before)===JSON.stringify(after),original:await(await Store.getBlob(ds,receipt.hash)).text(),changes:(await Store.status(ds)).changes,privateBytesAbsent:!new TextDecoder().decode(bytes).includes('Original property')};
    },password);
    assert.ok(result.attempts.every(Boolean));assert.ok(result.preserved);assert.ok(result.exact);
    assert.equal(result.original,'original receipt bytes');assert.equal(result.changes,0);assert.ok(result.privateBytesAbsent);
  });

  await t.test('multi-frame binary backup and cancellation during verification',async()=>{
    const result=await page.evaluate(async pwd=>{
      const bytes=new Uint8Array(2*1024*1024+133);
      for(let at=0;at<bytes.length;at+=65536)crypto.getRandomValues(bytes.subarray(at,Math.min(bytes.length,at+65536)));
      const hash=await Store.storeBlob('sample',new Blob([bytes],{type:'application/octet-stream'}));
      await Store.save('sample',[{type:'document',id:'multi-file',propertyId:'demo',hash}]);
      const saved=await Store.makeBackup('sample',pwd),ctrl=new AbortController();
      let canceled=false;
      try{await Store.readBackup(saved.blob,pwd,'sample',{signal:ctrl.signal,progress:(label,n)=>{if(label==='Checking originals'&&n>0)ctrl.abort();}});}
      catch(e){canceled=e.name==='AbortError';}
      const bundle=await Store.readBackup(saved.blob,pwd,'sample');
      const restored=bundle.blobs.find(x=>x.hash===hash);
      const recovered=new Uint8Array(await restored.blob.arrayBuffer());
      return {canceled,size:restored.blob.size,matches:recovered.every((byte,i)=>byte===bytes[i])};
    },password);
    assert.deepEqual(result,{canceled:true,size:2*1024*1024+133,matches:true});
  });

  await t.test('separate device edits, explicit conflicts, deterministic monthly charge and idempotent replay',async()=>{
    const other=await browser.newPage();await other.goto(url);
    const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await testBackup.arrayBuffer())));
    await other.evaluate(async ({bytes,password})=>{
      const bundle=await Store.readBackup(new Blob([new Uint8Array(bytes)]),password,'owner');
      await Store.commitImport(await Store.planImport('owner',bundle,'restore'));
    },{bytes,password});
    for(const [tab,name] of [[page,'Local review'],[other,'Other device']]){
      await tab.evaluate(async name=>{
        const property=(await Store.list('owner')).find(r=>r.type==='property');
        await Store.save('owner',[{...property,name},{type:'charge',id:'rent:tenancy:schedule:2026-11',propertyId:'property',amount:300000,date:'2026-11-01',createdAt:new Date().toISOString()}]);
      },name);
    }
    const transfer=await other.evaluate(async pwd=>Array.from(new Uint8Array(await(await Store.makeBackup('owner',pwd)).blob.arrayBuffer())),password);
    const result=await page.evaluate(async ({transfer,password})=>{
      const bundle=await Store.readBackup(new Blob([new Uint8Array(transfer)]),password,'owner');
      const plan=await Store.planImport('owner',bundle,'merge');
      let unresolved=false;try{await Store.commitImport(plan);}catch{unresolved=true;}
      await Store.commitImport(plan,{property:'local'});
      const replay=await Store.planImport('owner',bundle,'merge');
      const second=await Store.commitImport(replay);
      const records=await Store.list('owner');
      return {conflicts:plan.merge.conflicts.length,unresolved,count:records.filter(r=>r.type==='charge').length,name:records.find(r=>r.type==='property').name,replayCount:second.imported};
    },{transfer,password});
    await other.close();
    assert.deepEqual(result,{conflicts:1,unresolved:true,count:1,name:'Local review',replayCount:0});
  });

  await t.test('simulate quota failure, protect immutable versions, reject stale writes, preserve draft',async()=>{
    const result=await page.evaluate(async()=>{
      const ds='owner',record=(await Store.list(ds)).find(r=>r.type==='property');
      const unsaved={...record,name:'Unsaved entry'};
      const previous=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(){throw new DOMException('Injected quota error','QuotaExceededError');};
      let quota=false;
      try{await Store.save(ds,[unsaved]);}catch(e){quota=e.name==='QuotaExceededError';}
      finally{IDBObjectStore.prototype.put=previous;}
      const original=(await Store.list(ds)).find(r=>r.id===record.id);
      await Store.save(ds,[unsaved]);
      let stale=false;try{await Store.save(ds,[{...record,name:'Stale edit'}]);}catch{stale=true;}
      const [frozen]=await Store.save(ds,[{type:'leaseVersion',id:'frozen',immutable:true}]);
      let immutable=false;try{await Store.save(ds,[{...frozen,immutable:false}]);}catch{immutable=true;}
      return {quota,preserved:original.name===record.name,retained:unsaved.name,stale,immutable};
    });
    assert.deepEqual(result,{quota:true,preserved:true,retained:'Unsaved entry',stale:true,immutable:true});
  });

  await t.test('protect term changes against committed activity from another tab and retain charge tombstones',async()=>{
    const second=await page.context().newPage();await second.goto(url);
    const original=await page.evaluate(async()=>{
      const [r]=await Store.save('sample',[{type:'charge',id:'future',amount:300000}]);return r;
    });
    await second.evaluate(()=>Store.save('sample',[{type:'payment',id:'other-tab-payment',allocations:[{chargeId:'future',amount:10000}]}]));
    const report=await page.evaluate(async original=>{
      let denied=false,guardCalls=0;
      globalThis.Money={protectTermChanges(before,changes){
        guardCalls++;
        if(before.some(r=>r.type==='payment'&&r.allocations.some(a=>changes.some(c=>c.id===a.chargeId))))throw Error('A payment was allocated in another tab.');
      }};
      const adjust={type:'scheduleAdjustment',id:'revision-a'};
      try{await Store.save('sample',[adjust,{...original,_deleted:true}]);}catch(e){denied=e.message.includes('another tab');}
      const preserved=(await Store.list('sample')).some(r=>r.id===original.id);
      const noPartial=!(await Store.list('sample')).some(r=>r.id===adjust.id);
      const payment=(await Store.list('sample')).find(r=>r.id==='other-tab-payment');
      await Store.save('sample',[{...payment,_deleted:true}]);
      await Store.save('sample',[adjust,{...original,_deleted:true}]);
      const ordinary=(await Store.list('sample')).some(r=>r.id===original.id);
      const version=(await Store.list('sample',true)).find(r=>r.id===original.id);
      delete globalThis.Money;
      return {denied,guardCalls,preserved,noPartial,ordinary,tombstone:version?._deleted,ancestor:version?._ancestors.includes(original._rev)};
    },original);
    await second.close();
    assert.deepEqual(report,{denied:true,guardCalls:2,preserved:true,noPartial:true,ordinary:false,tombstone:true,ancestor:true});
  });

  await t.test('several years of synthetic entries and document metadata',async()=>{
    const timing=await page.evaluate(async()=>{
      const rows=Array.from({length:2500},(_,i)=>({id:'bulk-'+i,type:i%2?'task':'document',name:'Synthetic file '+i,propertyId:'property',date:(2020+Math.floor(i/365))+'-01-01'}));
      const start=performance.now();await Store.save('owner',rows);const committed=performance.now();
      const records=await Store.list('owner');return {count:records.length,commitMs:Math.round(committed-start),readMs:Math.round(performance.now()-committed)};
    });
    assert.ok(timing.count>=2500);
    t.diagnostic(JSON.stringify(timing));
  });

  await t.test('ZIP paths and CRC, PDF extraction, page boundaries and signature block',async()=>{
    const result=await page.evaluate(async()=>{
      const docs=Files.pdf('Annual summary – José',[
        {heading:'Monthly activity',lines:Array.from({length:95},(_,i)=>'Record '+String(i+1).padStart(3,'0')+' recorded for the property.')},
        {heading:'Signatures',keepTogether:true,lines:['Owner: ____________________','Tenant: ____________________']}
      ]);
      const bundle=await Files.zip([{name:'summary.pdf',data:docs},{name:'support/receipt.txt',data:'Sample file contents'}]);
      let unsafe=false;try{await Files.zip([{name:'../parent/file',data:'test'}]);}catch{unsafe=true;}
      return {unsafe,zip:Array.from(new Uint8Array(await bundle.arrayBuffer()))};
    });
    assert.ok(result.unsafe);
    const base=fs.mkdtempSync(path.join(os.tmpdir(),'pm-report-test-'));
    try{
      const file=path.join(base,'packet.zip');fs.writeFileSync(file,Buffer.from(result.zip));
      const python=process.env.PYTHON_PATH||path.join(runtime,'python','python.exe');
      const script=[
        'import io, sys, zipfile','from pypdf import PdfReader','from pypdfium2 import PdfDocument',
        'with zipfile.ZipFile(sys.argv[1]) as z:',
        ' assert z.testzip() is None',' assert z.read("support/receipt.txt") == b"Sample file contents"',
        ' data=z.read("summary.pdf")',' doc=PdfReader(io.BytesIO(data))',' pages=[p.extract_text() for p in doc.pages]',
        ' assert all(tuple(p.mediabox)==(0,0,612,792) for p in doc.pages)',
        ' assert len(pages)>1 and "José" in pages[0]',' assert all("Page "+str(i+1)+" of "+str(len(pages)) in text for i,text in enumerate(pages))',
        ' assert all("Record "+str(i).zfill(3) in " ".join(pages) for i in range(1,96))',
        ' assert "Owner:" in pages[-1] and "Tenant:" in pages[-1] and "Signatures" in pages[-1]',
        ' raster=PdfDocument(data)',' assert all(page.render(scale=.6).width>300 for page in raster)',
        ' print("Rendered and extracted "+str(len(pages))+" PDF pages; all ZIP CRCs matched.")'
      ].join('\n');
      t.diagnostic(execFileSync(python,['-c',script,file],{encoding:'utf8'}).trim());
    }finally{fs.rmSync(base,{recursive:true,force:true});}
  });
});
