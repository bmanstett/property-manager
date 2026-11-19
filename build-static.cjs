/* Optional maintainer tool. Users install the ready-made static release. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname;
const assets=['index.html','manifest.webmanifest','style.css','money.css','lease.css','accessibility.css','icons.js','pdf-font.js','export.js','github-sync.js','storage.js','rules.js','money.js','lease-notices.js','leases.js','records.js','app.js','LICENSE-Liberation.txt','assets/icon-192.png','assets/icon-512.png','assets/juniper-house.png','legal-assets/epa-lead-en.pdf','legal-assets/epa-lead-lessor-en.pdf','legal-assets/sdhc-guide-en.pdf','legal-assets/cdph-dampness-mold-en.pdf'];
const read=file=>fs.readFileSync(path.join(root,file));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function worker(override={},template=read('sw-template.js').toString()){
  const manifest=Object.fromEntries(assets.map(file=>[file,hash(override[file]??read(file))]));
  const release=hash(JSON.stringify(manifest)+template).slice(0,20);
  return {release,text:template.replace('__PM_RELEASE__',release).replace('/*__PM_ASSETS__*/{}',JSON.stringify(manifest,null,2))};
}
async function build(){
  const {release,text}=worker();
  const checking=process.argv.includes('--check');
  if(checking&&read('sw.js').toString()!==text)throw Error('The service-worker asset manifest is stale. Run node build-static.cjs.');
  if(!checking)fs.writeFileSync(path.join(root,'sw.js'),text);
  if(process.argv.includes('--worker-only')){console.log('Generated service worker '+release);return;}
  for(const file of assets.filter(name=>name.endsWith('.js'))){
    new (require('node:vm').Script)(read(file).toString(),{filename:file});
  }
  const dist=path.join(root,'dist');
  if(!checking)fs.mkdirSync(dist,{recursive:true});
  const output=[...assets,'sw.js'];
  // Catch stale or private files instead of silently distributing them.
  const allowed=new Set(output);
  for(const entry of fs.readdirSync(dist,{recursive:true,withFileTypes:true})){
    if(entry.isDirectory())continue;
    const full=path.join(entry.parentPath||entry.path,entry.name);
    const relative=path.relative(dist,full).split(path.sep).join('/');
    if(!entry.isFile()||!allowed.has(relative))throw Error('Unexpected file in dist: '+relative+'. Review it before packaging.');
  }
  for(const file of output){
    const dest=path.join(dist,file);
    if(checking){
      if(!read(file).equals(fs.readFileSync(dest)))throw Error('Stale release asset: '+file);
    }else{
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.copyFileSync(path.join(root,file),dest);
    }
  }
  require('./export.js');
  const blob=await Files.zip(output.map(name=>({name,data:new Blob([read(name)])})));
  const packed=Buffer.from(await blob.arrayBuffer()),archive=path.join(root,'Property-Manager-static.zip');
  if(checking){
    if(!packed.equals(fs.readFileSync(archive)))throw Error('ZIP archive differs from the verified release.');
    console.log('Verified '+output.length+' allowlisted assets, service-worker integrity manifest, dist directory and ZIP, release '+release+'.');
  }else{
    fs.writeFileSync(archive,packed);
    console.log('Packaged '+output.length+' allowlisted assets, '+blob.size+' bytes, release '+release+'.');
  }
}
module.exports={assets,worker};
if(require.main===module)build().catch(e=>{console.error(e.message);process.exitCode=1;});
