'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const base = 'http://127.0.0.1:8143/';
const allowed = new Set([...require('./build-static.cjs').assets, 'sw.js']);
let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')); }
catch { ({chromium} = require(path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core'))); }

test('Work dialog lifetime, scoped writes and safe retries', async t => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || (process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined)});
  t.after(()=>browser.close());
  const page = await browser.newPage({serviceWorkers:'block'});
  // Only compiled public assets are served. All writes use disposable, real IndexedDB.
  await page.route(base+'**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if(!allowed.has(name)&&!/^assets\/[\w.-]+$/.test(name))return route.fulfill({status:404,body:''});
    const contentType=({js:'application/javascript',html:'text/html',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'})[path.extname(name).slice(1)]||'application/octet-stream';
    await route.fulfill({contentType,body:fs.readFileSync(path.join(__dirname,name))});
  });
  await page.goto(base);await page.waitForFunction(()=>window.PM?.prop()&&PM.records('tenancy').length);
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
