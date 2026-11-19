/* Browser acceptance for touch targets, native zoom, keyboard and accessibility tree. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {assets,worker}=require('./build-static.cjs');
let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core'));}
catch{({chromium}=require(path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core')));}
const chrome=process.env.CHROME_PATH||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined);
const types={'.css':'text/css','.js':'application/javascript','.html':'text/html','.webmanifest':'application/manifest+json','.png':'image/png','.pdf':'application/pdf','.txt':'text/plain'};
test('accessibility at mobile width and native browser zoom',async t=>{
  const files=Object.fromEntries(assets.map(n=>[n,fs.readFileSync(path.join(__dirname,n))]));
  files['sw.js']=Buffer.from(worker(files).text);
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!Object.hasOwn(files,file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]);res.end(files[file]);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'property-manager-zoom-'));
  const ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:null,executablePath:chrome,args:['--window-size=1440,1000']});
  t.after(async()=>{await ctx.close();await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});});
  const page=ctx.pages()[0],url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);await page.locator('.property-hero').waitFor();
  const client=await ctx.newCDPSession(page);
  await client.send('Accessibility.enable');
  const errors=new Set(),views=[];
  async function audit(name){
    const found=await page.evaluate(()=>{
      const scope=document.querySelector('dialog[open]')||document;
      const issues=[];
      if(document.documentElement.scrollWidth>innerWidth)issues.push('page horizontal overflow');
      if(scope instanceof HTMLDialogElement&&scope.scrollWidth>scope.clientWidth+1)issues.push('dialog horizontal overflow');
      const label=el=>(el.getAttribute('aria-label')||el.innerText||el.name||el.id||el.className||el.tagName).trim().replace(/\s+/g,' ').slice(0,44);
      let checked=0;
      for(const control of scope.querySelectorAll('button,summary,input:not([type=hidden]),select,textarea,a[href]')){
        const r=control.getBoundingClientRect();
        if(!r.width||!r.height||getComputedStyle(control).visibility==='hidden'||control.closest('[hidden]'))continue;
        if(control.matches('.skip')&&r.bottom<0)continue;
        if(control.closest('details:not([open])')&&!control.matches('summary'))continue;
        if(control.matches('summary')&&control.closest('details')?.parentElement?.closest('details:not([open])'))continue;
        const target=control.matches('input[type=checkbox],input[type=radio],input[type=file]')?control.closest('label')||control:control;
        const box=target.getBoundingClientRect();checked++;
        if(box.width<43.98||box.height<43.98)issues.push('target '+label(control)+' ['+control.className+'] '+Math.round(box.width)+'×'+Math.round(box.height));
        if(innerWidth<=430&&control.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')&&parseFloat(getComputedStyle(control).fontSize)<16)issues.push('mobile form text '+label(control)+' is '+getComputedStyle(control).fontSize);
      }
      // Compare solid rendered text/background colors. Artwork and layered
      // translucent backgrounds require a separate visual inspection.
      const color=s=>s.match(/[\d.]+/g)?.map(Number);
      function luminance(rgb){
        const linear=rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
        return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
      }
      const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
      for(let n=walker.nextNode();n;n=walker.nextNode()){
        if(!n.textContent.trim())continue;
        const el=n.parentElement;
        if(!el||el.closest('script,style,option,[hidden],[disabled],.property-hero,svg')||el.closest('dialog')?.open===false||!el.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
        let bg,layer=el;
        while(layer){
          const style=getComputedStyle(layer),rgba=color(style.backgroundColor);
          if(style.backgroundImage!=='none'||Number(style.opacity)<1)break;
          if(rgba&&(rgba.length===3||rgba[3]===1)){bg=rgba;break;}
          if(rgba?.[3]>0)break;
          layer=layer.parentElement;
        }
        if(!bg)continue;
        const style=getComputedStyle(el),fg=color(style.color);if(!fg||fg[3]<1)continue;
        const a=luminance(bg),b=luminance(fg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const size=parseFloat(style.fontSize),large=size>=24||size>=18.66&&Number(style.fontWeight)>=700;
        if(ratio+.005<(large?3:4.5))issues.push('contrast '+n.textContent.trim().slice(0,30)+' ['+el.className+'] '+ratio.toFixed(2));
      }
      return {issues,checked,w:innerWidth,h:innerHeight};
    });
    const {nodes}=await client.send('Accessibility.getFullAXTree');
    for(const n of nodes){
      if(!n.ignored&&['button','textbox','checkbox','combobox','searchbox','link'].includes(n.role?.value)&&!String(n.name?.value||'').trim())found.issues.push('unnamed '+n.role.value);
    }
    for(const e of found.issues)errors.add(name+': '+e);
    views.push({name,targets:found.checked,width:found.w});
  }
  async function routine(label){
    for(const n of ['Home','Money','Leases','Documents','Tasks']){
      await page.locator('[data-nav="'+n+'"]:visible').first().click();
      await audit(label+' '+n);
    }
    for(const act of ['payment','expense','inspect-new','compose','create','import','storage']){
      await page.evaluate(act=>PM.action(act),act);
      await page.locator('dialog[open]').waitFor();await audit(label+' '+act);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({width:375,height:812});await routine('375px');
  await page.locator('[data-nav=Home]:visible').first().click();
  const opener=page.locator('[data-act=payment]:visible').first();await opener.click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-close');
  const tree=await client.send('Accessibility.getFullAXTree');
  assert.ok(tree.nodes.some(n=>n.role?.value==='dialog'&&n.name?.value==='Record payment'&&n.properties?.some(p=>p.name==='modal'&&p.value.value)));
  assert.ok(tree.nodes.some(n=>n.role?.value==='textbox'&&n.name?.value==='Account'));
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));
  await page.keyboard.press('Escape');assert.ok(await opener.evaluate(el=>el===document.activeElement));
  assert.ok(await page.locator('#toast[role=status][aria-live=polite]').count());
  await page.setViewportSize({width:1440,height:1000});
  const before=await page.evaluate(()=>({width:innerWidth,ratio:devicePixelRatio}));
  const prefs=await ctx.newPage();await prefs.goto('chrome://settings/appearance');
  await prefs.evaluate(()=>new Promise((resolve,reject)=>chrome.settingsPrivate.setDefaultZoom(2,()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve())));
  await prefs.close();
  await page.waitForFunction(b=>devicePixelRatio>=b.ratio*1.99&&innerWidth<=b.width*.51,before,{timeout:6000});
  const after=await page.evaluate(()=>({width:innerWidth,ratio:devicePixelRatio}));
  t.diagnostic('Native browser zoom: '+JSON.stringify(before)+' → '+JSON.stringify(after));
  await routine('200%');
  t.diagnostic('Audited '+views.length+' screens and dialogs, '+views.reduce((total,x)=>total+x.targets,0)+' visible controls.');
  assert.deepEqual([...errors],[]);
});
