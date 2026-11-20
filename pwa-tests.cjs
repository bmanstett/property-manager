/* Development-only offline and browser integration checks using synthetic records. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {assets,worker}=require('./build-static.cjs');
let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core'));}
catch{({chromium}=require(path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core')));}
const chrome=process.env.CHROME_PATH||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined);
const mime={'.js':'application/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json','.pdf':'application/pdf','.png':'image/png','.txt':'text/plain'};
test('installed rental workflows and release lifecycle',async t=>{
  const immutable=Object.fromEntries(assets.map(p=>[p,fs.readFileSync(path.join(__dirname,p))]));
  const createRelease=(overrides={})=>{
    const files={...immutable,...overrides},sw=worker(files);
    return {files:{...files,'sw.js':Buffer.from(sw.text)},id:sw.release};
  };
  let release=createRelease(),allowNetwork=true;
  const server=http.createServer((req,res)=>{
    if(!allowNetwork){req.socket.destroy();return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    const key=pathname.startsWith('/rental/')?(pathname.slice(8)||'index.html'):'';
    const data=release.files[key];
    if(!data||!Object.prototype.hasOwnProperty.call(release.files,key)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',mime[path.extname(key)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(data);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const url='http://127.0.0.1:'+server.address().port+'/rental/';
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rental-offline-profile-'));
  let ctx,page;
  const logs=[];
  const capture=process.env.PM_CAPTURE_DIR||path.join(__dirname,'private','qa');
  if(capture)fs.mkdirSync(capture,{recursive:true});
  const bind=p=>{p.setDefaultTimeout(7000);p.on('pageerror',e=>logs.push(e.message));};
  const launch=async offline=>{
    ctx=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chrome,offline,viewport:{width:1440,height:960},locale:'en-US'});
    page=ctx.pages()[0]||await ctx.newPage();bind(page);await page.goto(url+'index.html');
    await page.waitForFunction(()=>document.body.textContent.includes('Offline ready')||document.querySelector('#retry-open'),{timeout:10000});
    if(await page.locator('#retry-open').count())throw Error('App startup failed: '+await page.locator('#content').innerText());
  };
  t.after(async()=>{if(ctx)await ctx.close();fs.rmSync(profile,{recursive:true,force:true});});
  const action=async(name,id)=>page.evaluate(([name,id])=>PM.action(name,id),[name,id]);
  const dialogClose=async()=>{if(await page.locator('dialog[open]').count())await page.locator('#dialog-close').click();};
  const committed=async(type,key,value)=>page.waitForFunction(([type,key,value])=>PM.records(type).some(r=>r[key]===value),[type,key,value]);
  await launch(false);

  await t.test('first connected launch precaches every required asset, desktop and mobile pages fit',async()=>{
    const cache=await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.ready;
      return new Promise(resolve=>{
        const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);
        reg.active.postMessage('verify-cache',[c.port2]);
      });
    });
    assert.ok(cache.ready);assert.equal(cache.assets,assets.length);
    if(capture)await page.screenshot({path:path.join(capture,'home-desktop.png'),fullPage:true});
    for(const w of [375,390,430]){
      await page.setViewportSize({width:w,height:844});
      const actual=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);
      assert.ok(actual[0]<=actual[1],'Home overflow at '+w+': '+actual);
      if(capture&&w===390)await page.screenshot({path:path.join(capture,'home-mobile.png'),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:960});
    assert.equal(await page.locator('nav[aria-label="Primary navigation"] button').count(),5);
  });

  await t.test('restart browser offline with server unavailable, open every previously unvisited workspace and original',async()=>{
    await ctx.close();ctx=null;allowNetwork=false;await launch(true);
    assert.equal(await page.evaluate(()=>navigator.onLine),false);
    for(const workspace of ['Money','Leases','Documents','Tasks','Home']){
      await page.locator('.side-nav [data-nav="'+workspace+'"]').click();
      assert.ok((await page.locator('#content').innerText()).length>40);
    }
    await action('doc','sample-garden-estimate');
    await page.locator('#doc-download').waitFor();
    const verified=await page.evaluate(async()=>{
      const doc=PM.get('sample-garden-estimate');return (await PM.file(doc.hash)).slice(0,5).text();
    });
    assert.equal(verified,'%PDF-');await dialogClose();
  });

  await t.test('set up an owner tenancy offline, post two partial payments, retain original receipt triplet',async()=>{
    await action('setup');
    const form=page.locator('#setup-form');
    await form.locator('[name=name]').fill('Offline acceptance property');
    await form.locator('[name=household]').fill('Synthetic household');
    const today=await page.evaluate(()=>PM.today());
    await form.locator('[name=rent]').fill('3000');
    await form.locator('[name=start]').fill(today.slice(0,7)+'-01');
    await form.locator('[name=nextDue]').fill(today.slice(0,7)+'-01');
    await form.locator('[name=deposit]').fill('1500');
    await form.locator('[type=submit]').click();
    await page.waitForFunction(()=>PM.dataset()==='owner'&&PM.records('charge').length>0&&PM.records('deposit').length>0);
    assert.deepEqual(await page.evaluate(()=>[Money.home().received,Money.home().deposit,Money.home().outstanding]),[0,150000,300000]);
    for(const [value,outstanding] of [['1000',200000],['2000',0]]){
      await action('payment');
      const f=page.locator('#mf-form');
      await f.locator('[name=amount]').fill(value);
      await f.locator('[type=submit]').click();
      await page.waitForFunction(expected=>Money.home().outstanding===expected,outstanding);
    }
    assert.equal(await page.evaluate(()=>Money.home().received),300000);
    await action('receipt');
    const f=page.locator('#mf-form');
    await f.locator('[name=vendor]').fill('Offline receipt test');
    await f.locator('[name=amount]').fill('83.50');
    await f.locator('[name=catPick0][value=repairs]').check();
    await f.locator('#mf-files').setInputFiles([0,1,2].map(i=>({name:'image-'+i+'.png',mimeType:'image/png',buffer:Buffer.concat([immutable['assets/icon-192.png'],Buffer.from([i])])})));
    await page.waitForFunction(()=>PM.records('document').filter(r=>r.receiptInbox).length===3);
    await f.locator('[type=submit]').click();
    await committed('expense','vendor','Offline receipt test');
    assert.deepEqual(await page.evaluate(()=>[PM.records('expense').length,PM.records('expense')[0].attachments.length,Money.home().expenses]),[1,3,8350]);
  });

  await t.test('write and finalize a lease offline with its bundled booklets, queue correspondence, cancel mail handoff, finish inspection offline',async()=>{
    await action('create');
    await page.locator('.lb #lb-step-title').waitFor();
    assert.equal(await page.locator('.lb .lb-caption').textContent(),'Step 1 of 6 · Home');
    await page.locator('.lb .lb-back').click();await page.locator('.lh').waitFor();
    // Every answer at once (the builder itself is covered in lease-tests.cjs), then back in at the last step.
    const draft=await page.evaluate(async()=>{
      const d=PM.records('lease')[0],today=PM.today(),start=PM.addDays(today,20);
      const saved=await PM.save('lease',{...d,step:5,tenants:[{id:PM.uid(),name:'Synthetic Tenant',email:'',phone:''}],facts:{...d.facts,premises:'12 Offline Way',zip:'92101',inCity:'yes',unitType:'apartment',buildingUnits:'5-15',built:'1972',ownerKind:'people',landlord:'Synthetic Owner',noticeAddress:'410 Example Street, San Diego, CA 92103',noticePhone:'619-555-0100',termStart:start,start,end:PM.addDays(LeaseLaw.addYears(start,1),-1),rent:'3000',deposit:'1500',util_electric:'tenant',util_gas:'tenant',util_water:'landlord',util_sewer:'landlord',util_trash:'landlord',util_internet:'tenant',floodKnown:'no',leadKnown:'no',leadRecords:'no',rareReviewed:'yes'}});
      await Leases.open('lease',saved.id);return saved.id;
    });
    await page.waitForFunction(()=>document.querySelector('.lb .lb-caption')?.textContent==='Step 6 of 6 · Review & sign');
    assert.deepEqual(await page.locator('.lb .lb-needs li').allInnerTexts(),[]);
    await page.locator('.lb input[name="lease:reviewed"]').check();
    await page.locator('.lb [data-lease="finalize"]').click();
    await page.locator('.lp-page .lp-head').waitFor({timeout:20000});
    assert.equal(await page.locator('.lp-page .lp-head .ui-status').innerText(),'Ready to sign');
    const packet=await page.evaluate(()=>{const p=PM.records('leasePacket')[0];return [PM.records('leasePacket').length,p.mode,p.immutable,p.leaseId,PM.get(p.contractId).mime,PM.get(p.archiveId).mime,p.attachments.map(a=>a.path.split('/')[0]).join()];});
    assert.deepEqual(packet,[1,'final',true,draft,'application/pdf','application/zip','handouts,handouts,handouts']);await dialogClose();
    await action('compose');
    await page.locator('#mail-form [name=to]').fill('synthetic@example.invalid');
    await page.locator('#mail-form button[value=ready]').click();
    await page.locator('#recipient-ok').check();await page.locator('#mail-ready').click();
    await page.locator('#mail-open').waitFor();
    await page.locator('#recipient-ok').check();await page.locator('#mail-open').click();
    await page.locator('#mail-cancel').click();
    assert.equal(await page.evaluate(()=>PM.records('communication')[0].status),'Ready');await dialogClose();
    await action('inspect-new');
    await page.locator('#inspection-form [name=title]').fill('Offline inspection');
    await page.locator('#inspection-form [name=note0]').fill('Condition recorded offline.');
    await page.locator('#inspection-form button[value=complete]').click();
    await page.locator('#check-complete').click();
    await committed('inspection','title','Offline inspection');
    assert.ok(await page.evaluate(()=>PM.records('inspection')[0].immutable));
  });

  await t.test('produce local CPA export, reopen and preserve records across deliberate software update',async()=>{
    await action('cpa');
    const submit=page.locator('#mf-form [type=submit]');
    await submit.waitFor();
    const checkboxes=page.locator('#mf-form input[type=checkbox]');
    for(const checkbox of await checkboxes.all()){if(await checkbox.isVisible())await checkbox.check();}
    await submit.click();await page.waitForFunction(()=>PM.records('export').length>0);
    const archive=await page.evaluate(async()=>{
      const saved=await Store.makeBackup('owner','complete-workspace-passphrase');
      const copy=await Store.readBackup(saved.blob,'complete-workspace-passphrase','owner');
      const original=await Store.list('owner'),plan=await Store.planImport('owner',copy,'merge');
      const result=await Store.commitImport(plan);
      return {count:copy.body.records.length,live:original.length,originals:copy.blobs.length,replayed:result.imported};
    });
    assert.equal(archive.replayed,0);assert.equal(archive.count,archive.live);assert.ok(archive.originals>=6);
    const before=await page.evaluate(()=>({payments:PM.records('payment').map(p=>p.id).sort(),expense:PM.records('expense')[0].id,snapshot:PM.records('export')[0].id}));
    await ctx.close();ctx=null;await launch(true);
    const after=await page.evaluate(()=>({payments:PM.records('payment').map(p=>p.id).sort(),expense:PM.records('expense')[0].id,snapshot:PM.records('export')[0].id}));
    assert.deepEqual(after,before);
    allowNetwork=true;await ctx.setOffline(false);
    const other=await ctx.newPage();await other.goto(url+'index.html');
    release=createRelease({'app.js':Buffer.concat([immutable['app.js'],Buffer.from('\n/* Synthetic release upgrade test. */\n')])});
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;await r.update();});
    const blocked=await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.getRegistration();
      for(let i=0;!reg.waiting&&i<150;i++)await new Promise(r=>setTimeout(r,50));
      if(!reg.waiting)throw Error('Replacement worker failed to reach the waiting state: '+(reg.installing?.state||'none'));
      return new Promise(resolve=>{
        navigator.serviceWorker.addEventListener('message',e=>resolve(e.data?.type),{once:true});reg.waiting.postMessage('activate-update');
      });
    });
    assert.equal(blocked,'update-blocked');await other.close();
    await page.evaluate(async()=>{
      const r=await navigator.serviceWorker.getRegistration();
      await new Promise(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});r.waiting.postMessage('activate-update');});
    });
    await page.reload();await committed('expense','id',before.expense);
    assert.ok(await page.evaluate(id=>PM.records('export').some(x=>x.id===id),before.snapshot));
    const valid=await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.ready;const c=new MessageChannel();
      return new Promise(resolve=>{c.port1.onmessage=e=>resolve(e.data);reg.active.postMessage('verify-cache',[c.port2]);});
    });
    assert.equal(valid.release,release.id);assert.ok(valid.ready);
    const rejected=await page.evaluate(async()=>{
      const keys=await caches.keys(),cache=await caches.open(keys.find(k=>k.startsWith('property-manager-static-')));
      await cache.delete(new URL('pdf-font.js',location.href));
      return new Promise(resolve=>{
        const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data.ready);
        navigator.serviceWorker.controller.postMessage('verify-cache',[c.port2]);
      });
    });
    assert.equal(rejected,false);
    const repaired=await page.evaluate(()=>new Promise(resolve=>{
      const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data.ready);
      navigator.serviceWorker.controller.postMessage('repair-cache',[c.port2]);
    }));
    assert.ok(repaired);
    assert.deepEqual(logs,[]);
  });
});
