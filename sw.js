/* Release compiler replaces the two marked constants in the distributed sw.js. */
'use strict';
const RELEASE='cbfe25320cb7d46178d2';
const ASSETS={
  "index.html": "5feb840d149faf7f93ceb9ee1105050305af64625e7082be61fcd915e8873747",
  "manifest.webmanifest": "e2281fc428a79f01cb335519b997b8a5e8ec341b8d2e8230d732b48c9ee9e4de",
  "style.css": "82b2a61be799a5a6ca7b233c1a9037c9e38f8b471fa44ee452269ad69306f793",
  "money.css": "0130cfa7cb2963af51612a9ee6f09dec65f34576f413c841ac78b6ea669a9103",
  "lease.css": "5fdd4ee73b2accf8c34c6f5ef770c5aa7cc6ac0a235fb8b821f9606ef3baf166",
  "accessibility.css": "c395ea82a3317cb3bf82a4f97d89266b359ca818e792c0b22d97c7d57995f9b2",
  "icons.js": "f34ab287fe35942bf1b1de405b7401cb88f7c122be5c41620670941ac2c786e5",
  "pdf-font.js": "170354c2f260ec95e61be85463fb6d5f7b2f09d5df962025b9bb75a6768aee3a",
  "export.js": "40267157105e4a8d8a58da1c4707fc27cb63b6aefb39183f2a5fcf83701c356d",
  "github-sync.js": "b4cfeaf7849e9c67d3bdc95ce90aa9ecd17b89466e43fe3c3566f03b813f9bb2",
  "storage.js": "b96d2aea89dfa581f6ab9d35183d9ce6cccf7ae8a2ccd01cd032f8988d0f7709",
  "rules.js": "4021bf17f9dcfffddbe4f58097836de73df6133973183d6a69a92c44f437e543",
  "money.js": "cb3186a99ad43906be4a1b79691319110e1eef7cc83daa0ab89e17ce0a7f98ff",
  "lease-notices.js": "8f65ab6806bb9dfd67667f51aee65a3a9bf75aa7e6df88fbd734b7b4f1afe099",
  "leases.js": "aa83c6dc26e1eea138cf8f4135c14e05834ec75978fdf6aa3a1a186e27db0884",
  "records.js": "4401dd62b27399c104865e252e29f8637604659547a50f6f77e4ac430cb224f6",
  "app.js": "2ff2710c41f40f2c4c31dcf5686a32b4a96810aa798d09dd4c15162398f2628f",
  "LICENSE-Liberation.txt": "93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b",
  "assets/icon-192.png": "689c9b47b244fa2d46737b61b785ca889f101d751a084cd1bf03daacf37f4894",
  "assets/icon-512.png": "68a06b32d6fd429b8d6e6bd649f40bb1cbfe6cd8a7ea671883f9ef776181174c",
  "assets/juniper-house.png": "72a406716f829b0c4b9c260cc28dd55cad6c942e33f24969f32fb5145ad2fc10",
  "legal-assets/epa-lead-en.pdf": "a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8",
  "legal-assets/epa-lead-lessor-en.pdf": "abf50bc2bd2dac206f3354e1d5980eb9b769d06cf466e64fb1f17a053d8a3022",
  "legal-assets/sdhc-guide-en.pdf": "72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc",
  "legal-assets/cdph-dampness-mold-en.pdf": "4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6"
};
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
