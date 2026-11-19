'use strict';
// Development browser checks. Data and PDF fixtures are fictional. No external requests.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const runtime=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies');
let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core'));}catch{({chromium}=require(path.join(runtime,'node','node_modules','playwright-core')));}
require('./rules.js');
test('source register, effective dates, distinct protections and safe update validation',()=>{
  const R=globalThis.LeaseRules,rule=id=>R.base.rules.find(r=>r.id===id);
  assert.equal(R.validate(R.base).rules.length,R.base.rules.length);
  const review=(id,f)=>R.evaluate(rule(id),{agreementDate:'2026-11-18',state:'CA',...f}).status;
  assert.equal(review('lead',{built:1970}),R.unknown);
  assert.equal(review('lead',{built:1970,leadExemption:'No',kind:'Fixed term'}),R.required);
  assert.equal(review('lead',{built:1982}),R.na);
  assert.equal(review('sd',{jurisdiction:'Other incorporated city',boundarySource:'Official parcel map'}),R.na);
  assert.equal(review('sd',{jurisdiction:'City of San Diego',boundarySource:'Official parcel map',sdCoverage:'Covered',sdBasis:'Documented local coverage review'}),R.required);
  assert.equal(review('stove',{agreementDate:'2025-12-31',applianceException:'No'}),R.na);
  assert.equal(review('stove',{agreementDate:'2026-01-01',applianceException:'No',ownFridge:'No'}),R.required);
  assert.equal(review('futurePets',{}),R.na);
  assert.equal(review('futurePets',{agreementDate:'2027-04-01'}),R.review);
  assert.equal(review('internet',{internet:'Yes',periodic:'Yes'}),R.required);
  assert.equal(review('deposit',{deposit:'4000',rent:'3000',depositWhen:'2026-01-01',smallOwner:'Yes',service:'Yes',ownerType:'Natural person'}),R.review);
  const f={propertyType:'Apartment',ownerType:'Natural person',firstOccupancy:'2000-01-01',regulated:'No',capCoverage:'Covered',capBasis:'synthetic attorney memo'};
  assert.equal(review('cap',f),R.required);
  assert.equal(review('cause',f),R.unknown);
  for(const mutate of [p=>p.rules[0].url='javascript:alert(1)',p=>p.rules[0].trigger='eval',p=>p.rules.pop(),p=>p.rules[0].effective='2027-02-30',p=>p.rules[1].id=p.rules[0].id]){
    const pkg=structuredClone(R.base);mutate(pkg);assert.throws(()=>R.validate(pkg));
  }
});
test('generate, revise, sign and retain actual lease packet files in a disposable browser',async t=>{
  const whitelist=new Set(['index.html','app.js','style.css','accessibility.css','lease.css','money.css','storage.js','leases.js','lease-notices.js','github-sync.js','rules.js','export.js','pdf-font.js','money.js','records.js','icons.js','manifest.webmanifest','sw.js']);
  const server=http.createServer((req,res)=>{
    const n=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!whitelist.has(n)&&!/^((legal-assets|assets)\/[A-Za-z0-9_.-]+)$/.test(n)){res.writeHead(404).end();return;}
    const p=path.join(__dirname,n);
    if(!fs.existsSync(p)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({html:'text/html',js:'application/javascript',css:'text/css',pdf:'application/pdf',png:'image/png',webmanifest:'application/manifest+json'})[path.extname(n).slice(1)]||'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const chrome=process.env.CHROME_PATH||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'):undefined);
  const browser=await chromium.launch({headless:true,executablePath:chrome});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>globalThis.PM?.prop()&&PM.records('tenancy').length);
  await page.evaluate(()=>PM.navigate('Leases'));
  await page.locator('[data-lease="create"]').first().click();
  const wizard=page.locator('#ls-wizard');
  await wizard.locator('[name=built]').fill('2999');
  await wizard.locator('[data-lease="step"][data-ref="2"]').click();
  await page.locator('#ls-error').filter({hasText:'construction year'}).waitFor();
  await wizard.locator('[name=built]').fill('');
  await wizard.locator('[data-lease="step"][data-ref="2"]').click();
  await wizard.locator('[name=termStart]').fill('2027-04-01');
  await wizard.locator('[name=end]').fill('2027-03-31');
  await wizard.locator('[data-lease="save"]').click();
  await page.locator('#ls-error').filter({hasText:'term end precedes'}).waitFor();
  await wizard.locator('[name=end]').fill('2028-03-31');
  await wizard.locator('[name=dueDay]').fill('32');
  await wizard.locator('[data-lease="save"]').click();
  await page.locator('#ls-error').filter({hasText:'whole rent due day'}).waitFor();
  await wizard.locator('[name=dueDay]').fill('1');
  const clauseText='Bicycle storage is in room B.\nUse the west entrance.';
  await wizard.getByRole('button',{name:'Add clause'}).click();
  await wizard.getByLabel('Clause title (optional)').fill('Bicycle storage');
  await wizard.getByLabel('Clause wording').fill(clauseText);
  await wizard.getByRole('button',{name:'Add clause'}).click();
  await wizard.getByLabel('Clause title (optional)').last().fill('Garden access');
  await wizard.getByLabel('Clause wording').last().fill('Garden hours apply to beds <A> & <B>.');
  await wizard.getByRole('button',{name:'Move up'}).click();
  await wizard.getByRole('button',{name:'Add clause'}).click();
  await wizard.getByLabel('Clause wording').last().fill('Deleted test clause');
  await wizard.getByRole('button',{name:'Remove clause'}).last().click();
  await wizard.getByRole('button',{name:'Save & close'}).click();
  await page.getByRole('button',{name:/Residential lease.*Terms/}).click();
  assert.equal(await wizard.getByLabel('Clause wording').last().inputValue(),clauseText);
  await wizard.getByRole('button',{name:'Open full preview'}).click();
  assert.deepEqual(await page.locator('.ls-paper h3').filter({hasText:/Additional clause/}).allTextContents(),['Additional clause 1 — Garden access','Additional clause 2 — Bicycle storage']);
  await page.getByText('Garden hours apply to beds <A> & <B>.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to agreement'}).click();
  await wizard.getByRole('button',{name:'Disclosures',exact:true}).click();
  await wizard.locator('[name=bedbugContact]').fill('Fictional office box 14');
  await wizard.locator('[name=meganHousing]').selectOption('Single-family residential property');
  await wizard.locator('[name=flood]').selectOption('No');
  await page.locator('[data-lease="step"][data-ref="5"]').click();
  await page.getByRole('button',{name:'Generate draft packet'}).click();
  await page.waitForFunction(()=>PM.records('leasePacket').some(s=>s.mode==='draft'));
  const original=await page.evaluate(async()=>{
    const s=PM.records('leasePacket').find(x=>x.mode==='draft');
    const pdf=await PM.file(PM.get(s.worksheetId).hash);
    const archive=await PM.file(s.archiveHash);
    return {id:s.id,leaseId:s.leaseId,rev:s._rev,hash:s.archiveHash,missing:s.review.filter(x=>x.status==='More information needed').length,pdfBytes:Array.from(new Uint8Array(await pdf.arrayBuffer())),zipBytes:Array.from(new Uint8Array(await archive.arrayBuffer()))};
  });
  assert.ok(original.missing>0);assert.equal(Buffer.from(original.pdfBytes.slice(0,5)).toString(),'%PDF-');
  const python=process.env.PYTHON_PATH||path.join(runtime,'python','python.exe');
  const parsePacket=[
    'import io,sys,zipfile','from pypdf import PdfReader',
    'z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))','assert z.testzip() is None',
    'html=z.read("review/printable-draft.html").decode("utf-8")',
    'pdf=PdfReader(io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith("draft.pdf")))))',
    'text=" ".join(" ".join(p.extract_text().split()) for p in pdf.pages)',
    'assert "Garden hours apply to beds &lt;A&gt; &amp; &lt;B&gt;." in html',
    'assert "Garden hours apply to beds <A> & <B>." in text',
    'assert "Bicycle storage is in room B. Use the west entrance." in text',
    'assert "Deleted test clause" not in html+text',
    'for term in ["www.meganslaw.ca.gov", "Life Cycle and Reproduction", "Fictional office box 14", "https://myhazards.caloes.ca.gov/"]:',
    ' assert term in html and term in text, term',
    'assert text.index("Additional clause 1") < text.index("Additional clause 2")',
  ].join('\n');
  execFileSync(python,['-c',parsePacket],{input:Buffer.from(original.zipBytes)});
  if(process.env.PM_LEASE_QA_DIR){fs.mkdirSync(process.env.PM_LEASE_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.PM_LEASE_QA_DIR,'lease-draft.pdf'),Buffer.from(original.pdfBytes));}
  await page.evaluate(()=>PM.close());
  const fixture=await page.evaluate(async leaseId=>{
    const d=PM.get(leaseId);
    const b=PM.pdf('Fictional attorney-review test fixture',[...d.customClauses.map(c=>({heading:c.title,lines:[c.text]})),{heading:'Signature block',lines:['Alex Example __________________','Robin Example __________________']}]);
    const doc=await PM.save('document',{id:PM.uid(),propertyId:d.propertyId,name:'Synthetic reviewed contract.pdf',kind:'Agreement',hash:await PM.blob(b),mime:b.type,size:b.size,date:PM.today(),immutable:true});
    const facts={...d.facts,state:'CA',premises:'Fictional residence',kind:'Fixed term',city:'San Diego',county:'San Diego',boundarySource:'Synthetic official boundary review',firstOccupancy:'1961-01-01',capBasis:'Fixture counsel review',causeBasis:'Fixture counsel review',sdBasis:'Fixture municipality memo',built:'1960',landlord:'Alex Example',adults:'Robin Example',agreementDate:PM.today(),start:'2026-01-01',termStart:'2026-11-20',end:'2027-11-19',deposit:'1800',rent:'1800',depositWhen:'2026-01-01',dueDay:'1',methods:'Check or electronic transfer by agreement',noticeContact:'Synthetic address and phone',attorneyName:'Test reviewer',attorneyDate:PM.today(),attorneyScope:'Synthetic QA fixture only',attorneyDoc:doc.id,rights:'Yes'};
    for(const [k,arr] of Object.entries(LeaseRules.fields))facts[k]=arr[1].includes('No')?'No':arr[1][0];
    const record=await PM.save('lease',{...d,facts,step:5,name:'Synthetic completion test',reviewedInputs:true});
    Leases.open('lease',record.id);return doc.id;
  },original.leaseId);
  await page.getByText('Use a completed attorney-reviewed agreement',{exact:true}).click();
  await page.getByRole('button',{name:'Review and freeze packet'}).click();
  await page.waitForSelector('#ls-final');
  await page.locator('#ls-final textarea:not([name^="clause."])').evaluateAll(nodes=>nodes.forEach(n=>n.value='Synthetic reviewed clause and exhibit reference'));
  await page.locator('#ls-final input[type="checkbox"]').check();
  await page.getByRole('button',{name:'Freeze reviewed packet'}).click();
  assert.equal(await page.locator('#ls-final textarea[name^="clause."]:invalid').count(),2);
  await page.locator('#ls-final textarea[name^="clause."]').evaluateAll(nodes=>nodes.forEach((n,i)=>n.value='Agreement page 1, section '+(i+1)));
  await page.getByRole('button',{name:'Freeze reviewed packet'}).click();
  await page.waitForFunction(()=>PM.records('leasePacket').some(s=>s.mode==='reviewed'));
  const snap=await page.evaluate(()=>PM.records('leasePacket').find(s=>s.mode==='reviewed'));
  assert.equal(snap.signers.length,2);assert.notEqual(snap.contractId,fixture);
  assert.equal(snap.customClauses[1].text,clauseText);
  assert.equal(snap.clauseReferences[snap.customClauses[1].id],'Agreement page 1, section 2');
  assert.ok(await page.evaluate(([src,frozen])=>PM.get(src).hash===PM.get(frozen).hash,[fixture,snap.contractId]));
  assert.ok(!snap.attachments.some(a=>a.path.endsWith('epa-lead-lessor-en.pdf')));
  assert.equal(snap.attachments.filter(a=>a.path.startsWith('disclosures/')).length,3);
  await page.locator('[data-lease="recordSign"]').first().click();
  await page.locator('#ls-sign [name=document]').setInputFiles({name:'Returned fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from(original.pdfBytes)});
  await page.locator('#ls-sign [name=method]').selectOption({index:1});await page.locator('#ls-sign [name=basis]').fill('Verified synthetic evidence for one listed signer.');
  await page.getByRole('button',{name:'Save signature evidence'}).click();
  await page.waitForSelector('.ls-info:has-text("Partially signed")');
  await page.locator('[data-lease="recordSign"]').first().click();
  await page.locator('#ls-sign [name=document]').setInputFiles({name:'Returned final fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from(original.pdfBytes)});
  await page.locator('#ls-sign [name=method]').selectOption({index:1});await page.locator('#ls-sign [name=basis]').fill('Verified both names against test packet.');
  await page.getByRole('button',{name:'Save signature evidence'}).click();await page.waitForSelector('.ls-info:has-text("Fully signed")');
  await page.locator('[data-lease=markOperative]').click();await page.locator('#ls-operative [name=signedDoc]').selectOption({label:'Returned final fixture.pdf'});
  await page.locator('#ls-operative [name=basis]').fill('Fictional complete signed copy.');await page.getByRole('button',{name:'Confirm executed agreement'}).click();
  await page.waitForFunction(()=>PM.records('operativeLease').length===1);
  await page.evaluate(i=>Leases.open('amend',i),snap.id);await page.locator('[data-lease=save]').click();
  await page.waitForFunction(()=>PM.records('lease').some(d=>d.facts.kind==='Amendment'));
  const amendment=await page.evaluate(()=>PM.records('lease').find(d=>d.facts.kind==='Amendment'));
  assert.equal(amendment.customClauses[1].text,clauseText);assert.equal(amendment.facts.attorneyDoc,'');
  assert.equal(await page.evaluate(i=>PM.get(i).archiveHash,snap.id),snap.archiveHash);
  assert.equal(await page.evaluate(i=>PM.get(i)._rev,original.id),original.rev);
  const importChecks=await page.evaluate(()=>{
    const valid=PM.all();Leases.validateImport(valid);
    const mutations=[
      r=>{r.find(x=>x.type==='signature').packetHash='bad';},
      r=>{r.find(x=>x.type==='leasePacket').package.rules[0].url='javascript:bad';},
      r=>{r.find(x=>x.type==='leasePacket'&&x.mode==='reviewed').archiveHash='bad';},
      r=>{r.find(x=>x.type==='operativeLease').signedDoc='missing';},
      r=>{r.find(x=>x.type==='lease').attachments=['missing'];},
      r=>{delete r.find(x=>x.type==='leasePacket'&&x.mode==='reviewed').clauseReferences;},
      r=>{r.find(x=>x.type==='leasePacket'&&x.mode==='draft').customClauses[1].id=r.find(x=>x.type==='leasePacket'&&x.mode==='draft').customClauses[0].id;}
    ];
    return mutations.map(m=>{const r=structuredClone(valid);m(r);try{Leases.validateImport(r);return false;}catch{return true;}});
  });
  assert.deepEqual(importChecks,[true,true,true,true,true,true,true]);
  const oldDraft=await page.evaluate(async id=>{
    const source=PM.get(id),pkg=structuredClone(source.package);
    pkg.rules=pkg.rules.slice(0,pkg.rules.findIndex(r=>r.id==='floodBaseline'));
    pkg.version='legacy-test-source';
    await PM.save('legalPackage',{propertyId:source.propertyId,package:pkg,installed:new Date().toISOString(),reviewer:'Prior reviewer',basis:'Synthetic historical package',immutable:true});
    const {type,_rev,_ancestors,_device,_parents,_updatedAt,customClauses,...rest}=source;
    const prior=await PM.save('lease',{...rest,id:PM.uid(),step:5,package:pkg});
    Leases.validateImport(PM.all());Leases.open('lease',prior.id);
    return prior.id;
  },original.leaseId);
  await page.getByText('Use a completed attorney-reviewed agreement',{exact:true}).click();
  await page.getByRole('button',{name:'Review and freeze packet'}).click();
  await page.getByText('Update this draft’s rule package to review the additional California requirements.').waitFor();
  await page.getByRole('button',{name:'Return to agreement'}).click();
  await page.getByRole('button',{name:'Update draft rules'}).click();
  await wizard.locator('[name=waterSubmeter]').waitFor();
  assert.ok(await page.evaluate(id=>PM.get(id).package.version===LeaseRules.base.version&&!PM.get(id).reviewedInputs,oldDraft));
  await wizard.getByRole('button',{name:'Terms',exact:true}).click();
  await wizard.getByRole('button',{name:'Add clause'}).click();
  const nonLatin='自行車停放在 B 室。';
  await wizard.getByLabel('Clause wording').fill(nonLatin);
  await wizard.getByRole('button',{name:'Packet',exact:true}).click();
  await wizard.getByRole('button',{name:'Generate draft packet'}).click();
  await page.getByRole('button',{name:'Download printable agreement'}).waitFor();
  const htmlRecord=await page.evaluate(async id=>{
    const packet=PM.records('leasePacket').find(s=>s.leaseId===id);
    const sheet=PM.get(packet.worksheetId);
    Leases.validateImport(PM.all());
    return {mime:sheet.mime,text:await (await PM.file(sheet.hash)).text()};
  },oldDraft);
  assert.equal(htmlRecord.mime,'text/html');assert.ok(htmlRecord.text.includes(nonLatin));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
