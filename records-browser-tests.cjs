'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const base = 'http://127.0.0.1:8143/';
const allowed = new Set([...require('./build-static.cjs').assets, 'sw.js']);
let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')); }
catch { ({chromium} = require(path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core'))); }

// A disposable browser on the sample rental. Only compiled public assets are served. All writes use real IndexedDB.
async function open(t) {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || (process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined)});
  t.after(()=>browser.close());
  const page = await browser.newPage({serviceWorkers:'block'});
  await page.route(base+'**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if(!allowed.has(name)&&!/^assets\/[\w.-]+$/.test(name))return route.fulfill({status:404,body:''});
    const contentType=({js:'application/javascript',html:'text/html',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'})[path.extname(name).slice(1)]||'application/octet-stream';
    await route.fulfill({contentType,body:fs.readFileSync(path.join(__dirname,name))});
  });
  await page.goto(base);await page.waitForFunction(()=>window.PM?.prop()&&PM.records('tenancy').length);
  return page;
}
const photo = (name,n) => ({name,mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217,n])});
const closed = page => page.waitForFunction(()=>!document.querySelector('#dialog').open);
// The share of a screenshot that is not blank paper. A preview that failed to draw has none.
function ink(png) {
  let at=8,width,height,type;const parts=[];
  while(at<png.length){
    const size=png.readUInt32BE(at),name=png.toString('latin1',at+4,at+8),data=png.subarray(at+8,at+8+size);
    if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];}
    if(name==='IDAT')parts.push(data);
    at+=size+12;
  }
  const px=type===6?4:3,row=width*px,raw=zlib.inflateSync(Buffer.concat(parts)),out=Buffer.alloc(height*row);
  for(let y=0;y<height;y++){
    const filter=raw[y*(row+1)];
    for(let x=0;x<row;x++){
      const a=x>=px?out[y*row+x-px]:0,b=y?out[(y-1)*row+x]:0,c=x>=px&&y?out[(y-1)*row+x-px]:0;
      let guess=0;
      if(filter===1)guess=a;else if(filter===2)guess=b;else if(filter===3)guess=(a+b)>>1;
      else if(filter===4){const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);guess=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      out[y*row+x]=(raw[y*(row+1)+1+x]+guess)&255;
    }
  }
  let dark=0;
  for(let i=0;i<out.length;i+=px)if(out[i]<200||out[i+1]<200||out[i+2]<200)dark++;
  return dark/(width*height);
}

test('Work dialog lifetime, scoped writes and safe retries', async t => {
  const page = await open(t);
  await page.evaluate(async()=>{
    await Store.save('owner',[{id:'owner-test',type:'property',name:'Test owner rental',state:'CA'}]);
    window.delayAfter = name => {
      let release,seen;
      const original=PM[name],gate=new Promise(r=>release=r);
      window.started=new Promise(r=>seen=r);window.calls=0;
      PM[name]=async (...args)=>{
        window.calls++;
        const result=await original(...args);
        seen();await gate;return result;
      };
      window.release=()=>{PM[name]=original;release();};
    };
    window.doubleSubmit = selector => {
      const f=document.querySelector(selector);
      for(let i=0;i<2;i++)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    };
  });
  await t.test('an import interrupted after storing a file cannot write a different dataset or replace its dialog',async()=>{
    await page.evaluate(()=>Work.open('import'));
    await page.locator('#import-files').setInputFiles([{name:'scope-first.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic first')},{name:'scope-second.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic second')}]);
    await page.waitForSelector('#commit-docs');
    await page.evaluate(()=>{delayAfter('blob');doubleSubmit('#commit-docs');});
    await page.evaluate(()=>window.started);
    await page.evaluate(async()=>{await PM.action('owner-property','owner-test');Work.open('task-new');document.querySelector('#task-form [name=title]').value='Keep this draft';window.release();});
    await page.waitForTimeout(60);
    const summary=await page.evaluate(async()=>({count:window.calls,title:document.querySelector('#task-form [name=title]')?.value,owner:(await Store.list('owner')).filter(x=>x.type==='document').length,stored:(await Store.list('sample')).filter(x=>x.name?.startsWith('scope-')).length}));
    assert.deepEqual(summary,{count:1,title:'Keep this draft',owner:0,stored:0});
  });
  await t.test('double submission saves one task and a dismissed save cannot close a later task dialog',async()=>{
    await page.evaluate(()=>{delayAfter('save');doubleSubmit('#task-form');});await page.evaluate(()=>window.started);
    await page.evaluate(()=>{PM.close();Work.open('task-new');document.querySelector('#task-form [name=title]').value='Second task';window.release();});
    await page.waitForTimeout(60);
    const state=await page.evaluate(()=>[window.calls,PM.records('task').filter(x=>x.title==='Keep this draft').length,document.querySelector('#task-form [name=title]').value]);
    assert.deepEqual(state,[1,1,'Second task']);
  });
  await t.test('a failed save preserves input and permits a single successful retry',async()=>{
    await page.evaluate(()=>{const old=PM.save;PM.save=async()=>{PM.save=old;throw Error('Synthetic quota failure');};doubleSubmit('#task-form');});
    await page.getByText('Synthetic quota failure',{exact:true}).waitFor();
    assert.equal(await page.locator('#task-form [name=title]').inputValue(),'Second task');
    await page.evaluate(()=>doubleSubmit('#task-form'));
    await page.waitForFunction(()=>PM.records('task').filter(x=>x.title==='Second task').length===1&&!document.querySelector('#dialog').open);
  });
  await t.test('closing and reopening a checklist invalidates the prior photo upload in the same rental',async()=>{
    await page.evaluate(()=>Work.open('inspect-new'));await page.locator('#inspection-form [name=title]').fill('Canceled inspection');
    await page.locator('#inspection-form [name=photos0]').setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
    await page.evaluate(()=>{delayAfter('blob');doubleSubmit('#inspection-form');});await page.evaluate(()=>window.started);
    await page.evaluate(()=>{PM.close();Work.open('inspect-new');document.querySelector('#inspection-form [name=title]').value='Keep this checklist';window.release();});
    await page.waitForTimeout(60);
    assert.deepEqual(await page.evaluate(()=>[window.calls,PM.records('inspection').length,document.querySelector('#inspection-form [name=title]').value]),[1,0,'Keep this checklist']);
  });
  await t.test('native share completing after its review closed does not advance email status',async()=>{
    await page.evaluate(async()=>{
      await PM.action('sample');
      Object.defineProperty(navigator,'share',{configurable:true,value:()=>new Promise(resolve=>{window.release=resolve;window.sharing=true;})});
      Work.open('message','sample-email');
    });
    await page.locator('#recipient-ok').check();await page.locator('#mail-share').click();
    await page.waitForFunction(()=>window.sharing);
    await page.evaluate(()=>{PM.close();Work.open('message','sample-email');window.release();});
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(()=>PM.get('sample-email').status),'Ready');
    assert.equal(await page.locator('#mail-share').isEnabled(),true);
  });
});

test('Documents and Tasks everyday journeys', async t => {
  const page = await open(t);
  const uncaught=[];page.on('pageerror',e=>uncaught.push(e.message));
  const today=await page.evaluate(()=>PM.today());
  await t.test('a document keeps one row and its own type when its details are edited',async()=>{
    // A file made by Leases has a type that is not in the standard list.
    await page.evaluate(async()=>{
      const d=PM.get('sample-garden-estimate');
      await PM.save('document',{id:'packet',name:'Lease packet.zip',filename:'Lease packet.zip',kind:'Lease packet',mime:'application/zip',hash:d.hash,size:d.size,version:1,created:new Date().toISOString(),immutable:true});
      await PM.refresh();PM.navigate('Documents');
    });
    await page.getByRole('radio',{name:'Lease packet (1)'}).check();
    assert.equal(await page.locator('#vault-list .doc-row').count(),1);
    await page.getByRole('radio',{name:'All (2)'}).check();
    await page.getByRole('button',{name:/Lease packet\.zip/}).click();
    await page.locator('#doc-review').click();
    assert.equal(await page.locator('#doc-meta [name=kind]').inputValue(),'Lease packet');
    await page.locator('#doc-meta [name=date]').fill('2026-11-01');
    await page.getByRole('button',{name:'Save details'}).click();await closed(page);
    assert.deepEqual(await page.evaluate(()=>[PM.records('document').length,document.querySelectorAll('#vault-list .doc-row').length,PM.records('document').find(d=>d.previousId==='packet').kind]),[3,2,'Lease packet']);
    assert.match(await page.getByRole('button',{name:/Lease packet\.zip/}).innerText(),/Nov 1, 2026[\s\S]*2 versions/);
    // The earlier version stays one tap away, and says what it is.
    await page.getByRole('button',{name:/Lease packet\.zip/}).click();
    await page.locator('dialog[open] details summary').click();
    await page.getByRole('button',{name:'See the earlier version'}).click();
    await page.getByText('This is an earlier version.').waitFor();
    assert.equal(await page.locator('#doc-review').count(),0);
    await page.locator('#dialog-close').click();
  });
  await t.test('a PDF is shown in the viewer and a file already saved is not ticked again',async()=>{
    await page.evaluate(()=>PM.action('doc','sample-garden-estimate'));
    const frame=page.locator('.preview-frame');await frame.waitFor();
    assert.equal(await frame.getAttribute('sandbox'),null);
    assert.equal(await page.getByRole('link',{name:'Open in a new tab'}).count(),1);
    if(await page.evaluate(()=>navigator.pdfViewerEnabled!==false)){
      let drawn=0;
      for(let i=0;i<40&&drawn<0.02;i++){await page.waitForTimeout(250);drawn=ink(await frame.screenshot());}
      assert.ok(drawn>=0.02,'the PDF preview stayed blank');
    }
    await page.locator('#dialog-close').click();
    await page.evaluate(()=>PM.action('import'));
    await page.locator('#import-files').setInputFiles({name:'copy.pdf',mimeType:'application/pdf',buffer:Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await (await PM.file(PM.get('sample-garden-estimate').hash)).arrayBuffer())]))});
    await page.getByText('Already saved',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[document.querySelector('[name=use0]').checked,document.querySelector('#import-save').disabled]),[false,true]);
    await page.locator('#import-files').setInputFiles([{name:'Roof invoice.txt',mimeType:'text/plain',buffer:Buffer.from('roof')},{name:'porch.png',mimeType:'image/png',buffer:Buffer.from('porch')}]);
    await page.getByRole('button',{name:'Save 2 documents'}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[document.querySelector('[name=kind0]').value,document.querySelector('[name=kind1]').value]),['Invoice','Photo']);
    await page.getByRole('button',{name:'Save 2 documents'}).click();await closed(page);
    assert.equal(await page.evaluate(()=>PM.records('document').filter(d=>['Roof invoice.txt','porch.png'].includes(d.name)).length),2);
  });
  await t.test('a reminder takes two clicks, and a task is marked done and put back from its row',async()=>{
    await page.evaluate(()=>PM.action('task-new'));
    assert.equal(await page.evaluate(()=>document.activeElement.name),'title');
    await page.keyboard.type('Renew landlord insurance');
    await page.getByRole('button',{name:'Save task'}).click();await closed(page);
    assert.deepEqual(await page.evaluate(()=>{const x=PM.records('task').find(r=>r.title==='Renew landlord insurance');return [x.kind,x.due,Boolean(x.completed)];}),['Reminder',today,false]);
    await page.evaluate(()=>PM.navigate('Tasks'));
    await page.getByRole('button',{name:'Done: Review irrigation estimate'}).click();
    await page.waitForFunction(()=>PM.get('sample-service').completed===true);
    assert.equal(await page.locator('[data-task="sample-service"]').count(),1);
    await page.locator('[data-task="sample-service"]').getByRole('button',{name:'Undo'}).click();
    await page.waitForFunction(()=>PM.get('sample-service').completed===false);
    assert.equal(await page.locator('[data-task-undo]').count(),0);
  });
  await t.test('a task without a date stays without one, and the calendar button waits for a date',async()=>{
    await page.evaluate(async()=>{await PM.save('task',{id:'undated',title:'Clear the gutters',kind:'Maintenance',due:'',completed:false});await PM.refresh();PM.action('task','undated');});
    assert.equal(await page.locator('#task-form [name=due]').inputValue(),'');
    await page.locator('#task-form details summary').click();
    assert.equal(await page.locator('#ics').isDisabled(),true);
    await page.getByText('Add a due date first.').waitFor();
    await page.getByRole('button',{name:'Next week'}).click();
    const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#ics').click()]);
    assert.equal(file.suggestedFilename(),'Clear the gutters.ics');
    await page.getByRole('button',{name:'No date'}).click();
    await page.getByRole('button',{name:'Save task'}).click();await closed(page);
    assert.equal(await page.evaluate(()=>PM.get('undated').due),'');
    // Mark done from the dialog closes it in one step and offers Undo.
    await page.evaluate(()=>PM.action('task','undated'));
    await page.getByRole('button',{name:'Mark done'}).click();await closed(page);
    assert.equal(await page.evaluate(()=>PM.get('undated').completed),true);
    await page.locator('#toast').getByRole('button',{name:'Undo'}).click();
    await page.waitForFunction(()=>PM.get('undated').completed===false);
  });
  await t.test('inspection photos add up across picks, rooms can be added and removed, and finishing locks the record',async()=>{
    await page.evaluate(()=>PM.action('inspect-new'));
    const form=page.locator('#inspection-form');
    assert.match(await form.locator('[name=title]').inputValue(),/^Routine inspection · /);
    await form.locator('[name=kind][value="Move-out"]').check();
    assert.match(await form.locator('[name=title]').inputValue(),/^Move-out inspection · /);
    await form.locator('[name=cond0][value="Damage"]').check();
    await form.locator('[name=photos0]').setInputFiles(photo('one.jpg',1));
    await form.locator('[name=photos0]').setInputFiles([photo('two.jpg',2),photo('three.jpg',3)]);
    const first=form.locator('[data-room]').first();
    assert.equal(await first.locator('.rc-thumb').count(),3);
    assert.equal(await first.locator('[data-photo-count]').innerText(),'3 photos');
    await first.getByRole('button',{name:'Remove two.jpg'}).click();
    assert.equal(await first.locator('.rc-thumb').count(),2);
    await page.getByRole('button',{name:'Add another room'}).click();
    assert.equal(await page.evaluate(()=>document.activeElement.name),'room2');
    await form.locator('[name=room2]').fill('Garage');
    await form.locator('[data-room]').nth(1).getByRole('button',{name:'Remove'}).click();
    assert.deepEqual(await form.locator('[data-room] input[type=text]').evaluateAll(list=>list.map(x=>x.name+'='+x.value)),['room0=Kitchen','room1=Garage']);
    await form.locator('details summary').click();
    await form.locator('[name=due]').fill(await page.evaluate(()=>PM.addDays(PM.today(),7)));
    await page.getByRole('button',{name:'Finish inspection',exact:true}).click();
    await page.getByText('1 room is not checked yet.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Finish and lock'}).click();await closed(page);
    const saved=await page.evaluate(()=>{const r=PM.records('inspection').find(x=>x.kind==='Move-out');return {done:r.completed,locked:r.immutable,rooms:r.items.map(i=>[i.room,i.condition,i.photos.map(p=>p.name).join()].join('|')),reminders:PM.records('task').filter(x=>x.inspectionId===r.id).map(x=>[x.due===r.due,x.completed])};});
    assert.deepEqual(saved,{done:true,locked:true,rooms:['Kitchen|Damage|one.jpg,three.jpg','Garage|Not inspected|'],reminders:[[true,false]]});
  });
  await t.test('a correction is saved only when the owner saves it, and Compare runs from move-in to the newest',async()=>{
    const count=()=>page.evaluate(()=>PM.records('inspection').length);
    const id=await page.evaluate(()=>PM.records('inspection').find(x=>x.kind==='Move-out').id);
    await page.evaluate(id=>PM.action('inspection',id),id);
    await page.getByRole('button',{name:'Add a correction or follow-up'}).click();
    await page.locator('#inspection-form').waitFor();
    assert.equal(await count(),2);
    await page.locator('#dialog-close').click();
    assert.equal(await count(),2);
    await page.evaluate(()=>PM.action('compare'));
    assert.deepEqual(await page.evaluate(id=>[document.querySelector('[name=compare0]').value,document.querySelector('[name=compare1]').value===id],id),['sample-checklist',true]);
    assert.deepEqual(await page.locator('#compare-rooms .rc-compare').evaluateAll(rows=>rows.map(r=>r.querySelector('strong').textContent+(r.querySelector('.ui-status--due')?.textContent==='Changed'?' changed':''))),['Kitchen changed','Living room','Garage']);
    assert.equal(await page.locator('#compare-rooms').getByText('Not recorded').count(),2);
    await page.locator('#dialog-close').click();
  });
  await t.test('an inspection closed by mistake comes back with its rooms and unsaved photos',async()=>{
    await page.evaluate(()=>PM.action('inspect-new'));
    const form=page.locator('#inspection-form');
    await form.locator('[name=photos0]').setInputFiles([photo('hall.jpg',7),photo('door.jpg',8)]);
    await page.getByRole('button',{name:'Add another room'}).click();
    await form.locator('[name=room2]').fill('Shed');
    await page.locator('#dialog-close').click();await closed(page);
    assert.equal(await page.evaluate(()=>PM.records('inspection').length),2);
    await page.evaluate(()=>PM.action('inspect-new'));
    await page.getByText('The rooms and photos you had not saved are still here.').waitFor();
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#inspection-form [data-room]')].map(r=>r.querySelector('input[type=text]').value+':'+r.querySelectorAll('.rc-thumb').length)),['Kitchen:2','Garage:0','Shed:0']);
    await page.getByRole('button',{name:'Save and finish later'}).click();await closed(page);
    assert.deepEqual(await page.evaluate(()=>{const r=PM.records('inspection').find(x=>!x.completed);return r.items.map(i=>i.room+':'+i.photos.map(p=>p.name).join());}),['Kitchen:hall.jpg,door.jpg','Garage:','Shed:']);
    // Once saved, a new inspection starts clean.
    await page.evaluate(()=>PM.action('inspect-new'));
    assert.deepEqual(await page.evaluate(()=>[document.querySelectorAll('#inspection-form .rc-thumb').length,document.querySelectorAll('#inspection-form .ui-note').length]),[0,0]);
    await page.locator('#dialog-close').click();
  });
  await t.test('an email keeps typed words, is sent in one review, and can be opened again afterwards',async()=>{
    await page.evaluate(()=>PM.action('compose'));
    const form=page.locator('#mail-form');
    // The address last used for this tenant is filled in, and the blank starter is never empty.
    assert.equal(await form.locator('[name=to]').inputValue(),'avery@example.invalid');
    assert.ok((await form.locator('[name=subject]').inputValue()).length>3&&(await form.locator('[name=body]').inputValue()).startsWith('Hello'));
    await form.locator('[name=template][value="Rent reminder"]').check();
    assert.equal(await form.locator('[name=subject]').inputValue(),'Rent reminder');
    await form.locator('[name=body]').fill('The plumber can come on Friday.');
    await form.locator('[name=template][value="Renewal"]').check();
    assert.equal(await form.locator('[name=body]').inputValue(),'The plumber can come on Friday.');
    await page.getByRole('button',{name:'Keep my text'}).click();
    assert.equal(await form.locator('[name=template]:checked').inputValue(),'Rent reminder');
    await form.locator('[name=attachment]').first().check();
    await page.getByRole('button',{name:'Review and send'}).click();
    // Without the tick nothing leaves, and the reason is shown beside the box.
    await page.locator('#mail-open').click();
    await page.locator('#mail-check').getByRole('alert').waitFor();
    await page.locator('#recipient-ok').check();
    await page.locator('#mail-ready').click();
    await page.waitForFunction(()=>PM.records('communication').some(m=>m.subject==='Rent reminder'&&m.status==='Ready'));
    await page.locator('#mail-status').getByText('Ready to send').waitFor();
    assert.equal(await page.locator('#recipient-ok').isChecked(),true);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#mail-open').click()]);
    assert.equal(download.suggestedFilename(),await page.evaluate(()=>PM.records('communication').find(m=>m.subject==='Rent reminder').attachments[0].name));
    await page.getByRole('button',{name:'Not yet, it is open in my mail app'}).click();await closed(page);
    const id=await page.evaluate(()=>PM.records('communication').find(m=>m.subject==='Rent reminder').id);
    assert.equal(await page.evaluate(id=>PM.get(id).status,id),'Handed to mail app/exported');
    await page.evaluate(id=>PM.action('message',id),id);
    await page.getByText('Opened in mail app',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>['mail-open','mail-edit','mail-copy','mail-sent'].map(x=>Boolean(document.getElementById(x)))),[true,true,true,true]);
    await page.getByRole('button',{name:'Open again'}).click();
    await page.getByRole('button',{name:'Yes, I sent it'}).click();await closed(page);
    assert.equal(await page.evaluate(id=>PM.get(id).status,id),'Sent confirmed by owner');
    await page.evaluate(id=>PM.action('message',id),id);
    await page.getByText('Sent',{exact:true}).first().waitFor();
    assert.deepEqual(await page.evaluate(()=>['mail-open','mail-edit','recipient-ok'].map(x=>Boolean(document.getElementById(x)))),[false,false,false]);
    await page.locator('#dialog-close').click();
  });
  await t.test('a mail app that did not open leaves the email ready',async()=>{
    await page.evaluate(()=>PM.action('message','sample-email'));
    await page.locator('#recipient-ok').check();await page.locator('#mail-open').click();
    await page.getByRole('button',{name:'It did not open'}).click();
    await page.locator('#mail-copy').waitFor();
    assert.equal(await page.evaluate(()=>PM.get('sample-email').status),'Ready');
    await page.locator('#dialog-close').click();
    assert.deepEqual(uncaught,[]);
  });
  await t.test('an email that has been sent on does not come back as an unfinished draft',async()=>{
    await page.evaluate(()=>PM.action('compose'));
    const form=page.locator('#mail-form');
    await form.locator('[name=subject]').fill('Gardener on Tuesday');
    await form.locator('[name=body]').fill('The gardener will come on Tuesday morning.');
    // Closing keeps the words for this session.
    await page.locator('#dialog-close').click();await closed(page);
    await page.evaluate(()=>PM.action('compose'));
    assert.equal(await form.locator('[name=subject]').inputValue(),'Gardener on Tuesday');
    await page.getByRole('button',{name:'Review and send'}).click();
    await page.locator('#recipient-ok').check();await page.locator('#mail-ready').click();
    await page.waitForFunction(()=>PM.records('communication').some(m=>m.subject==='Gardener on Tuesday'&&m.status==='Ready'));
    await page.locator('#dialog-close').click();await closed(page);
    // The next new email starts clean, so saving it cannot make a second copy of the first.
    await page.evaluate(()=>PM.action('compose'));
    assert.notEqual(await form.locator('[name=subject]').inputValue(),'Gardener on Tuesday');
    assert.ok(!(await form.locator('[name=body]').inputValue()).includes('gardener'));
    await page.locator('#dialog-close').click();await closed(page);
    assert.equal(await page.evaluate(()=>PM.records('communication').filter(m=>m.subject==='Gardener on Tuesday').length),1);
  });
  await t.test('an email about a document is addressed to the tenant the document belongs to',async()=>{
    const ids=await page.evaluate(async()=>{
      const p=PM.prop().id;
      const t=await PM.save('tenancy',{id:PM.uid(),propertyId:p,name:'Blake Ortiz',start:PM.addDays(PM.today(),20)});
      await PM.save('lease',{id:PM.uid(),schema:2,propertyId:p,tenancyId:t.id,name:'Lease – Blake Ortiz',step:0,facts:{},tenants:[{id:PM.uid(),name:'Blake Ortiz',email:'blake@example.invalid',phone:''}],clauses:{},customClauses:[],attachments:[]});
      const d=await PM.save('document',{id:PM.uid(),propertyId:p,tenancyId:t.id,name:'Lease – Blake Ortiz.pdf',filename:'Lease – Blake Ortiz.pdf',kind:'Lease',mime:'application/pdf',hash:await PM.blob(Files.pdf('Lease',[{heading:'Lease',lines:['Made-up lease.']}])),size:1,date:PM.today(),immutable:true,version:1});
      return {tenancy:t.id,doc:d.id,first:PM.records('tenancy')[0].id};
    });
    assert.notEqual(ids.first,ids.tenancy,'the current tenant is still listed first');
    await page.evaluate(id=>Work.open('compose',id),ids.doc);
    const form=page.locator('#mail-form');
    assert.equal(await form.locator('[name=to]').inputValue(),'blake@example.invalid');
    assert.ok((await form.locator('[name=body]').inputValue()).startsWith('Hello Blake Ortiz,'));
    assert.equal(await form.locator('[name=subject]').inputValue(),'Your lease to review and sign');
    await page.locator('#dialog-close').click();await closed(page);
    // A new email with no document still starts with the current tenant.
    await page.evaluate(()=>PM.action('compose'));
    assert.ok((await form.locator('[name=body]').inputValue()).startsWith('Hello Avery Morgan,'));
    await page.locator('#dialog-close').click();await closed(page);
    assert.deepEqual(uncaught,[]);
  });
});
