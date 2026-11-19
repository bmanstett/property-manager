/* Release compiler replaces the two marked constants in the distributed sw.js. */
'use strict';
const RELEASE='__PM_RELEASE__';
const ASSETS=/*__PM_ASSETS__*/{};
const PREFIX='property-manager-static-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+RELEASE;
const url=path=>new URL(path,self.registration.scope).href;
const known=new Map(Object.entries(ASSETS).map(([path,hash])=>[url(path),hash]));
const hash=async response=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
async function verified(response,expected){
  return !!response&&response.ok&&await hash(response.clone())===expected;
}
async function fill(){
  const cache=await caches.open(CACHE);
  try{
    for(const [address,expected] of known){
      const response=await fetch(new Request(address,{cache:'reload',credentials:'same-origin',redirect:'error'}));
      if(!await verified(response,expected))throw Error('Incomplete or inconsistent application release.');
      await cache.put(address,response);
    }
  }catch(error){await caches.delete(CACHE);throw error;}
}
self.addEventListener('install',event=>event.waitUntil(fill()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
  await clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data==='verify-cache'||event.data==='repair-cache'){
    event.waitUntil((async()=>{
      let ready=false;
      try{
        const cache=await caches.open(CACHE);
        ready=true;
        for(const [address,expected] of known){
          if(await verified(await cache.match(address),expected))continue;
          if(event.data==='repair-cache'){
            const replacement=await fetch(new Request(address,{cache:'reload',credentials:'same-origin',redirect:'error'}));
            if(await verified(replacement,expected)){await cache.put(address,replacement);continue;}
          }
          ready=false;break;
        }
      }catch{ready=false;}
      event.ports[0]?.postMessage({ready,release:RELEASE,assets:known.size});
    })());
  }
  if(event.data==='activate-update'){
    event.waitUntil((async()=>{
      const tabs=await clients.matchAll({type:'window',includeUncontrolled:true});
      if(tabs.some(client=>client.id!==event.source?.id&&client.url.startsWith(self.registration.scope))){
        event.source?.postMessage({type:'update-blocked',message:'Close other Property Manager tabs before applying this update.'});return;
      }
      await self.skipWaiting();
    })());
  }
});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const target=new URL(request.url);
  if(target.origin!==self.location.origin)return;
  target.search='';target.hash='';
  if(target.href===self.registration.scope&&request.mode==='navigate')target.pathname+='index.html';
  if(!known.has(target.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const saved=await cache.match(target.href);if(saved)return saved;
    try{
      const response=await fetch(target.href,{cache:'reload',credentials:'same-origin',redirect:'error'});
      if(!await verified(response,known.get(target.href)))throw Error('Incorrect release');
      await cache.put(target.href,response.clone());return response;
    }catch{
      return new Response('The required application file is unavailable offline. Reconnect and verify the installation.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
