'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {assets,worker}=require('./build-static.cjs');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core'));}catch{({chromium}=require(path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core')));}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.pdf':'application/pdf','.png':'image/png'};
test('Installed rental ledger, receipts, bank matching, reconciliation and CPA download offline',async t=>{
  const files=new Set(assets),sw=worker().text;
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(file==='sw.js'){res.setHeader('Content-Type','text/javascript');res.end(sw);return;}
    if(!files.has(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');fs.createReadStream(path.join(__dirname,file)).pipe(res);
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'),headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  let page=await context.newPage();const base='http://127.0.0.1:'+server.address().port+'/';
  await page.goto(base);await page.getByRole('heading',{name:'Property overview'}).waitFor();
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null,{},{timeout:15000});
  await page.close();await context.setOffline(true);
  page=await context.newPage();page.setDefaultTimeout(7000);await page.goto(base);await page.getByRole('heading',{name:'Property overview'}).waitFor();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const date=await page.evaluate(()=>PM.today().slice(0,7)+'-01');
  const close=async()=>{if(await page.locator('dialog[open]').count())await page.locator('#dialog-close').click();};
  const doMoney=(key)=>page.locator('[data-money="'+key+'"]:visible').first().click();
  const field=(name)=>page.locator('#mf-form [name="'+name+'"]');
  const save=(text)=>page.locator('#mf-form').getByRole('button',{name:text,exact:true}).click();
  await page.locator('[data-nav="Money"]:visible').first().click();
  const png=fs.readFileSync(path.join(__dirname,'assets','icon-192.png'));
  const images=[1,2,3].map(i=>({name:'Synthetic-receipt-'+i+'.png',mimeType:'image/png',buffer:Buffer.concat([png,Buffer.from('fixture '+i)])}));
  await t.test('first offline expense and three retained receipt images',async()=>{
    await doMoney('receipt');await page.locator('#mf-files').setInputFiles(images);
    await page.waitForFunction(()=>PM.records('document').filter(d=>d.receiptInbox).length===3);
    await field('vendor').fill('Three image vendor');await field('amount').fill('79.21');await field('category0').selectOption('repairs');
    await field('notes').fill('Synthetic inspection repair');await save('Save expense');
    await page.waitForFunction(()=>PM.records('expense').some(e=>e.vendor==='Three image vendor'));
    const result=await page.evaluate(async()=>{const t=PM.records('expense').find(e=>e.vendor==='Three image vendor');return {amount:t.amount,docs:await Promise.all(t.attachments.map(async id=>{const doc=PM.get(id);return {id:doc.transactionId,name:doc.name,tail:await(await PM.file(doc.hash)).slice(-9).text()};})),id:t.id};});
    assert.equal(result.amount,7921);assert.equal(result.docs.length,3);
    assert.deepEqual(result.docs.map(d=>d.tail),['fixture 1','fixture 2','fixture 3']);assert.ok(result.docs.every(d=>d.id===result.id));
    await page.getByRole('button',{name:/Three image vendor/}).first().click();await doMoney('reclass');await field('category0').selectOption('maintenance');await field('reason').fill('Reviewed vendor service details');await save('Save corrected categories');await page.waitForFunction(()=>PM.records('expense').some(e=>e.categoryHistory?.length));
  });
  await t.test('repeat a CSV, confirm bank match, reconcile opening and closing balances',async()=>{
    await doMoney('tab:reconcile');
    const source={name:'Checking.csv',mimeType:'text/csv',buffer:Buffer.from('date,description,amount,id\r\n'+date+',Rent payment,3200.00,BANK-001\r\n')};
    async function upload(count){await doMoney('csv');await field('statement').setInputFiles(source);await save('Map columns');await field('refCol').selectOption('3');await save('Preview lines');await save('Import '+count+' bank lines');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));}
    await upload(1);const original=await page.evaluate(()=>PM.records('payment').length);
    await doMoney('match');const matching=await page.evaluate(day=>PM.records('payment').find(r=>r.date===day).id,date);
    await field('candidate').selectOption(matching);await save('Confirm match');await page.waitForFunction(()=>PM.records('bankline')[0].matchedId);
    await upload(0);assert.equal(await page.evaluate(()=>PM.records('bankline').length),1);assert.equal(await page.evaluate(()=>PM.records('payment').length),original);
    await doMoney('reconcile');await field('start').fill(date);await field('end').fill(date);await field('opening').fill('1250.00');await field('closing').fill('4450.00');await save('Save reconciliation');await page.waitForFunction(()=>PM.records('reconciliation').length===1);
    assert.equal(await page.evaluate(()=>PM.records('reconciliation')[0].difference),0);
  });
  await t.test('generate and download real CPA archive with matching immutable snapshot',async()=>{
    await doMoney('cpa');await save('Review packet');const download=page.waitForEvent('download');await save('Generate preliminary ZIP');const result=await download;
    const data=fs.readFileSync(await result.path());assert.equal(data.readUInt32LE(0),0x04034b50);assert.ok(data.includes(Buffer.from('Annual-summary.pdf')));
    if(process.env.PM_FINANCE_QA_DIR){
      let pos=0;
      while(data.readUInt32LE(pos)===0x04034b50){
        const length=data.readUInt32LE(pos+18),nameLength=data.readUInt16LE(pos+26),extra=data.readUInt16LE(pos+28);
        const start=pos+30+nameLength+extra,name=data.toString('utf8',pos+30,pos+30+nameLength);
        if(name==='Annual-summary.pdf'){fs.mkdirSync(process.env.PM_FINANCE_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.PM_FINANCE_QA_DIR,name),data.subarray(start,start+length));break;}
        pos=start+length;
      }
    }
    assert.ok(data.includes(Buffer.from('Synthetic-receipt-3.png')));assert.ok(data.includes(Buffer.from('reports/reconciliations.csv')));
    const stored=await page.evaluate(async()=>{const e=PM.records('export').find(r=>r.kind==='CPA packet');return {bytes:(await PM.file(e.hash)).size,id:e.id,immutable:e.immutable};});
    assert.equal(stored.bytes,data.length);assert.equal(stored.immutable,true);assert.deepEqual(errors,[]);
  });
  await t.test('return part of a posted rent receipt through its detail view and retain the previously exported ZIP',async()=>{
    await close();await doMoney('tab:activity');const original=await page.evaluate(day=>PM.records('payment').find(t=>t.date===day).id,date);
    await page.locator('[data-money="activity"][data-id="'+original+'"]').click();await doMoney('rentRefund');
    await field('amount').fill('126.75');await field('reason').fill('Documented partial return');await save('Post rent return');
    await page.waitForFunction(()=>PM.records('payment').some(r=>r.kind==='rentRefund'&&r.amount===-12675));
    assert.equal(await page.evaluate(()=>Money.home().outstanding),12675);
    assert.equal(await page.evaluate(id=>PM.get(id).amount,original),320000);
    assert.equal(await page.evaluate(()=>PM.records('export').filter(e=>e.kind==='CPA packet').length),1);
  });
  await t.test('property terms preview updates, cancels, and reinstates an existing future obligation offline',async()=>{
    await close();await page.locator('[data-nav="Home"]:visible').first().click();
    const bill=await page.evaluate(()=>PM.records('charge').find(c=>c.date>PM.today()));
    const day=await page.evaluate(()=>PM.today());
    async function edit(){await page.locator('[data-act="property"]:visible').first().click();await page.locator('[data-act="edit-property"]:visible').first().click();return page.locator('#rental-details');}
    async function confirm(form){await form.getByRole('button',{name:'Save rental details'}).click();await form.getByRole('button',{name:'Confirm schedule change'}).click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));}
    let f=await edit();await f.locator('summary').click();await f.locator('[name=rent]').fill('3250');await f.locator('[name=from]').fill(bill.date);await f.locator('[name=reason]').fill('Reviewed renewal');await confirm(f);
    assert.equal(await page.evaluate(id=>PM.get(id).amount,bill.id),325000);
    f=await edit();await f.locator('[name=end]').fill(day);await f.locator('[name=reason]').fill('Possession returned');await confirm(f);
    assert.equal(await page.evaluate(id=>Boolean(PM.get(id)),bill.id),false);
    await page.reload();await page.getByRole('heading',{name:'Property overview'}).waitFor();
    f=await edit();await f.locator('[name=end]').fill('');await f.locator('[name=reason]').fill('Documented extension');await confirm(f);
    assert.equal(await page.evaluate(id=>PM.get(id).amount,bill.id),325000);
    assert.deepEqual(await page.evaluate(()=>PM.records('scheduleAdjustment').flatMap(e=>e.changes.map(c=>c.action)).sort()),['canceled','reinstated','repriced']);
    assert.deepEqual(errors,[]);
  });
});
