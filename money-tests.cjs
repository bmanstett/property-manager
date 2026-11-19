'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
require('./pdf-font.js');
require('./export.js');
require('./money.js');
const M=Money.model;
const prop={id:'p',type:'property',name:'Cedar Test House'};
const tenant={id:'t',type:'tenancy',propertyId:'p',start:'2026-01-01',nextDue:'2026-12-01',depositCents:150000,rentCents:300000};
const charge=M.schedule(tenant,'2027-01-31',new Set());
const setup=[prop,tenant,...charge];
const payment=(id,value,alloc,day='2026-12-01')=>({type:'payment',id,propertyId:'p',tenancyId:'t',date:day,amount:value,account:'Checking',allocations:alloc});
const to=(c,amount)=>({chargeId:c.id,amount});
const payments=[payment('paid1',100000,[to(charge[0],100000)]),payment('paid2',200000,[to(charge[0],200000)])];
const deposit=(id,kind,amount,date,allocations=[])=>({id,kind,amount,date,allocations,type:'deposit',propertyId:'p',tenancyId:'t',account:'Checking'});
const expense=(id,mode,splits,attachments=[])=>({type:'expense',id,propertyId:'p',mode,date:'2026-12-02',vendor:'Fixture vendor',amount:splits.reduce((a,s)=>a+s.amount,0),splits,attachments,account:'Checking'});
const part=(category,amount,propertyId='p')=>({category,amount,propertyId});
let objects=[],files=new Map();
function env(records){
  objects=structuredClone(records);files=new Map();
  global.PM={all:type=>objects.filter(x=>!x._deleted&&x.type===type),records:type=>objects.filter(x=>!x._deleted&&x.type===type&&(!x.propertyId||x.propertyId==='p')),chargeVersions:id=>objects.filter(x=>x.type==='charge'&&x.tenancyId===id),get:id=>objects.find(x=>x.id===id&&!x._deleted),today:()=>'2026-12-15',uid:()=>crypto.randomUUID(),dataset:()=>'sample',prop:()=>prop,currency:n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100),zip:Files.zip,pdf:Files.pdf,
    blob:async blob=>{const key=createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');files.set(key,blob);return key;},file:async hash=>files.get(hash),
    save:async(type,r)=>{await PM.batch([{...r,type}]);return r;},batch:async rows=>{const combined=new Map(objects.map(x=>[x.id,x]));Money.protectTermChanges(objects.filter(x=>!x._deleted),rows);rows.forEach(r=>combined.set(r.id,r));Money.validateImport([...combined.values()].filter(r=>!r._deleted));objects=[...combined.values()];return rows;}};
}
test('exact decimal cents, calendar dates, and clamped, idempotent recurring charges',()=>{
  assert.equal(M.cents('102.09'),10209);assert.equal(M.cents('-0.50'),-50);
  assert.throws(()=>M.cents('1e2'));assert.throws(()=>M.cents('1.255'));assert.throws(()=>M.cents('9999999999999999'));
  assert.equal(M.dateOK('2026-02-29'),false);assert.equal(M.dateOK('2024-02-29'),true);
  const q=M.schedule({...tenant,nextDue:'2024-01-31'},'2024-03-31',new Set());
  assert.deepEqual(q.map(x=>x.date),['2024-01-31','2024-02-29','2024-03-31']);
  assert.deepEqual(M.schedule({...tenant,nextDue:'2024-01-31'},'2024-03-31',new Set(q.map(c=>c.id))),[]);
  const changed=M.schedule({...tenant,nextDue:'2026-01-05',rentChanges:[{from:'2026-02-06',rentCents:315000,reason:'Executed amendment'}]},'2026-04-30',new Set());
  assert.deepEqual(changed.map(c=>c.amount),[300000,300000,315000,315000]);
});
test('setup carries opening liability, makes expected charges, and creates no rent receipt',async()=>{
  env([prop,tenant]);await Money.ensure();await Money.ensure();
  assert.equal(PM.records('payment').length,0);assert.equal(PM.records('charge').length,2);
  const s=Money.home();assert.equal(s.deposit,150000);assert.equal(s.income,0);assert.equal(s.outstanding,300000);
});
test('end a tenancy, reinstate its canceled future charge, and update its rent without duplicating the obligation',async()=>{
  env(setup);const ended={...tenant,end:'2026-12-31'};
  const cancel=Money.termChanges(tenant,ended,{reason:'Returned possession',from:ended.end});
  assert.equal(cancel.find(r=>r.type==='charge').id,charge[1].id);assert.equal(cancel.find(r=>r.type==='charge')._deleted,true);
  await PM.batch([ended,...cancel]);await Money.ensure();assert.equal(PM.records('charge').length,1);
  const extended={...ended,end:'2027-01-31'};const reinstate=Money.termChanges(ended,extended,{reason:'Written extension',from:extended.end});
  await PM.batch([extended,...reinstate]);await Money.ensure();assert.equal(PM.records('charge').length,2);
  const newRent={...extended,rentChanges:[{from:'2027-01-01',rentCents:315000,reason:'Executed renewal'}]};
  const reprice=Money.termChanges(extended,newRent,{reason:'Executed renewal',from:'2027-01-01'});
  assert.equal(reprice.find(r=>r.type==='charge').id,charge[1].id);await PM.batch([newRent,...reprice]);
  assert.equal(PM.get(charge[1].id).amount,315000);assert.equal(PM.get(charge[0].id).amount,300000);assert.equal(PM.records('scheduleAdjustment').length,3);
  assert.deepEqual(Money.termChanges(newRent,newRent),[]);
  const linked=payment('advance',130000,[{...to(charge[1],130000),chargeTermEventId:PM.get(charge[1].id).termEventId}]);await PM.batch([linked]);
  assert.throws(()=>Money.termChanges(newRent,ended,{reason:'New move-out date'}),/linked/);
});
test('a concurrent allocation blocks a stale reprice; a divergent device allocation against an older rent version is rejected',async()=>{
  env(setup);const revised={...tenant,rentChanges:[{from:'2027-01-01',rentCents:310000,reason:'Lease amendment'}]};
  const proposal=Money.termChanges(tenant,revised,{from:'2027-01-01',reason:'Lease amendment'});
  const unexpected=payment('advance',1000,[to(charge[1],1000)]);await PM.batch([unexpected]);
  await assert.rejects(PM.batch([revised,...proposal]),/linked/);assert.equal(PM.get(charge[1].id).amount,300000);
  env(setup);await PM.batch([revised,...proposal]);await assert.rejects(PM.batch([unexpected]),/different rent-term versions/);
  assert.throws(()=>Money.termChanges(tenant,{...tenant,end:'2026-11-30'},{reason:'Backdated removal'}),/historical/);
});
test('partial payments, many-to-one, multi-period and unapplied amounts',()=>{
  const partial=M.summary([payments[0]],charge,'2026-12-15','p');assert.equal(partial.outstanding,200000);assert.equal(partial.received,100000);
  const full=M.summary(payments,charge,'2026-12-15','p');assert.equal(full.outstanding,0);assert.equal(full.received,300000);
  const multi=payment('multi',450000,[to(charge[0],200000),to(charge[1],150000)]);
  assert.equal(M.summary([multi],charge,'2026-12-15','p').credit,100000);
  assert.deepEqual(M.allocate(450000,multi.allocations,M.balances(charge,[])),multi.allocations);
  assert.throws(()=>M.allocate(10,multi.allocations,M.balances(charge,[])));
  assert.throws(()=>Money.validateImport([...setup,...payments,payment('over',300000,[to(charge[0],300000)])]));
});
test('refundable deposits and later application preserve cash vs income distinction',()=>{
  const dep=deposit('dep','receipt',60000,'2026-12-01'), use=deposit('use','applyRent',-20000,'2026-12-03',[to(charge[0],20000)]);
  assert.equal(M.classification(dep,'p').income,0);
  assert.deepEqual(M.classification(use,'p'),{cash:0,expenses:0,income:20000,liability:-20000,taxOnly:0});
  assert.equal(M.summary([dep,use],charge,'2026-12-15','p').deposit,40000);
  assert.equal(Money.validateImport([...setup,dep,use]),true);
});
test('advance December rent retains January allocation, writes off no cash-basis expense',()=>{
  const advance=payment('a',300000,[to(charge[1],300000)],'2026-12-28');
  const wo={type:'writeoff',id:'wo',propertyId:'p',tenancyId:'t',date:'2026-12-31',amount:5000,allocations:[to(charge[0],5000)]};
  assert.equal(M.annual('2026','p',[advance,wo]).totals.income,300000);
  assert.equal(M.annual('2027','p',[advance,wo]).totals.income,0);
  assert.equal(M.annual('2026','p',[advance,wo]).totals.expenses,0);
  assert.equal(M.balances(charge,[advance,wo]).get(charge[1].id),0);
});
test('matching an imported payment keeps one cash entry and rejects duplicate/excess matches',()=>{
  const bank={id:'bank:stable',type:'bankline',propertyId:'p',date:'2026-12-02',description:'Rent',account:'Checking',amount:100000,matchedId:'paid1'};
  assert.equal(Money.validateImport([...setup,payments[0],bank]),true);
  assert.equal(M.annual('2026','p',[payments[0],bank]).totals.income,100000);
  assert.throws(()=>Money.validateImport([...setup,payments[0],bank,{...bank,id:'second'}]));
});
test('returns invert the original receipt and its charge allocation',()=>{
  const returned={...payments[0],id:'return',reverses:'paid1',amount:-100000,date:'2026-12-03',allocations:[to(charge[0],-100000)]};
  assert.equal(Money.validateImport([...setup,...payments,returned]),true);
  assert.equal(M.summary([...payments,returned],charge,'2026-12-15','p').outstanding,100000);
  assert.equal(M.annual('2026','p',[...payments,returned]).totals.income,200000);
  assert.throws(()=>Money.validateImport([...setup,...payments,returned,{...returned,id:'again'}]));
});
test('partial rent refunds retain receipt-year income, cap each original allocation, and can return unapplied credit',()=>{
  const original=payment('advance',150000,[to(charge[1],100000)],'2026-12-20');
  const part={...original,id:'partial',date:'2027-01-05',reverses:original.id,kind:'rentRefund',amount:-55000,allocations:[to(charge[1],-40000)],notes:'Refunded agreed excess'};
  assert.equal(Money.validateImport([...setup,original,part]),true);
  assert.equal(M.annual('2026','p',[original,part]).totals.income,150000);
  assert.equal(M.annual('2027','p',[original,part]).totals.income,-55000);
  assert.equal(M.summary([original,part],charge,'2027-01-31','p').credit,35000);
  assert.throws(()=>Money.validateImport([...setup,original,part,{...part,id:'excess',amount:-40000,allocations:[]}]),/exceed/);
  const final={...part,id:'rest',amount:-95000,allocations:[to(charge[1],-60000)]};
  assert.equal(Money.validateImport([...setup,original,part,final]),true);
  assert.equal(M.summary([original,part,final],charge,'2027-01-31','p').credit,0);
});
test('three receipt files count one expense, cross-property splits preserve invoice total',()=>{
  const e=expense('e','expense',[part('repairs',2853),part('supplies',1147,'p2')],['a','b','c']);
  const docs=['a','b','c'].map(id=>({id,type:'document',propertyId:'p'}));
  const r=[...setup,{...prop,id:'p2'},...docs,e];
  assert.equal(Money.validateImport(r),true);assert.equal(M.annual('2026','p',[e]).totals.expenses,2853);assert.equal(M.annual('2026','p2',[e]).totals.expenses,1147);
  assert.throws(()=>Money.validateImport(r.filter(d=>d.id!=='b')));
  assert.throws(()=>M.validateSplits(1001,[part('repairs',1000)]));
});
test('mortgage principal, restricted escrow, card settlement, and depreciation treatments',()=>{
  const tx=[expense('m','mortgage',[part('principal',60000),part('interest',40000),part('escrow',10000)]),
    expense('e','escrowDisbursement',[part('taxes',7000)]),expense('cc','creditCard',[part('repairs',25000)]),
    expense('ccpay','expense',[part('card',25000)]),expense('dep','depreciation',[part('depreciation',4400)])];
  const a=M.annual('2026','p',tx);assert.deepEqual(a.totals,{income:0,expenses:72000,cash:-135000,taxOnly:4400});
});
test('CSV parser handles quoted fields, BOM, CRLF, bad shapes and formula-injection strings',()=>{
  assert.deepEqual(M.parseCsv('\ufeffdate,desc,amount\r\n2026-01-01,"Merchant, Inc.","1,200.00"'),[['date','desc','amount'],['2026-01-01','Merchant, Inc.','1,200.00']]);
  assert.throws(()=>M.parseCsv('a,b\r\n1'));assert.throws(()=>M.parseCsv('a,b\n"bad",a"'));
  assert.match(M.csv([['=formula','   +cmd','normal',-123]]),/"'=formula","'   \+cmd","normal","-123"/);
});
function unzip(buffer){
  const entries=new Map();let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50){
    const size=buffer.readUInt32LE(offset+18),nameSize=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
    const name=buffer.toString('utf8',offset+30,offset+30+nameSize), start=offset+30+nameSize+extra;
    entries.set(name,buffer.subarray(start,start+size));offset=start+size;
  }
  return entries;
}
test('actual immutable CPA ZIP contains original receipt bytes, selectable PDF, monthly ledger, reconciled category totals, and exclusions',async()=>{
  env([...setup,...payments]);
  const docs=[];
  for(const i of [1,2,3]){const b=new Blob(['fixture image '+i]),hash=await PM.blob(b);docs.push({id:'receipt'+i,type:'document',kind:'Receipt',propertyId:'p',name:'receipt'+i+'.jpg',hash,size:b.size});}
  await PM.batch([...docs,{id:'private',type:'document',propertyId:'p',kind:'Lease',name:'private-lease.pdf'},expense('expense','expense',[part('repairs',11999)],docs.map(d=>d.id))]);
  const data=Money.packetData('p','2026'), artifact=await Money.generatePacket(data,new Set(docs.map(d=>d.id)));
  const zipped=unzip(Buffer.from(await artifact.blob.arrayBuffer()));
  assert.equal(zipped.get('Annual-summary.pdf').subarray(0,5).toString(),'%PDF-');
  assert.ok(zipped.get('Annual-summary.pdf').includes(Buffer.from('/ToUnicode')));
  assert.equal(zipped.get('support/0002-receipt2.jpg').toString(),'fixture image 2');
  assert.ok(![...zipped.keys()].some(k=>k.includes('private')));
  const monthly=M.parseCsv(zipped.get('reports/monthly.csv').toString()).slice(1);
  assert.equal(monthly.reduce((s,r)=>s+Number(r[1]),0),300000);assert.equal(monthly.reduce((s,r)=>s+Number(r[2]),0),11999);
  const ledger=M.parseCsv(zipped.get('ledger/transactions.csv').toString()).slice(1);
  assert.equal(ledger.reduce((s,r)=>s+Number(r[12]),0),300000);assert.equal(ledger.reduce((s,r)=>s+Number(r[13]),0),11999);
  const snapshot=PM.get(artifact.id);assert.equal(snapshot.immutable,true);assert.equal(snapshot.manifest.preliminary,true);
  assert.equal(snapshot.manifest.files.length,zipped.size);assert.equal((await PM.file(snapshot.hash)).size,artifact.blob.size);
});
test('volume check validates 5 years of charges, 6,000 ledger entries, and 10,000 metadata records',t=>{
  const started=performance.now(), cs=M.schedule({...tenant,nextDue:'2022-01-01'},'2026-12-31',new Set());
  const expenses=Array.from({length:6000},(_,i)=>({...expense('e'+i,'expense',[part('repairs',i+1)]),date:cs[i%60].date,attachments:['doc'+i]}));
  const docs=Array.from({length:10000},(_,i)=>({id:'doc'+i,type:'document',propertyId:'p',name:'Invoice '+i}));
  const loaded=performance.now();assert.ok(Money.validateImport([prop,tenant,...cs,...expenses,...docs]));const validated=performance.now();
  const result=M.annual('2026','p',expenses);assert.equal(result.rows.length,1200);
  t.diagnostic('Fixture '+(loaded-started).toFixed(1)+' ms; prospective ledger validation '+(validated-loaded).toFixed(1)+' ms; calendar-year aggregation '+(performance.now()-validated).toFixed(1)+' ms.');
});
