/* Release compiler replaces the two marked constants in the distributed sw.js. */
'use strict';
const RELEASE='0f1d34ce513c64b42118';
const ASSETS={
  "index.html": "abcba25840eb251bc4c711b37c9b659e63e805b639efa1886a583a891acc253f",
  "manifest.webmanifest": "e2281fc428a79f01cb335519b997b8a5e8ec341b8d2e8230d732b48c9ee9e4de",
  "ui.css": "d513d47bedb56d3af7bf17ffe980651460904adde3f80e45fac8d4f901fea0de",
  "style.css": "c9116a5e0d80b302a656dc39d1313c5f991a3e34e00f3450a22feb0a1582cc0d",
  "money.css": "3c589ec6d438a9ddb512c7f9e5605214a36fd9eafb144d85cd1a346f3fe70e0b",
  "lease.css": "d5c264af1b20b351386d33f6e9b318d42508eec1480779fceaf5528af95bd36c",
  "lease-sign.css": "3f453d09f7c03eeb74ee189476251823c89ff553b2ab440592a805c5d819134b",
  "records.css": "0012a1f85cccdcf6b47e1b0cbebc6636bb33da2ae4d99e723be646799809d4da",
  "backup.css": "c9f7859d688f744b47727f299d96961bc06e16a83608179517e3ddf1003d2b1b",
  "accessibility.css": "1f6199ab60e0b375f52a020c874a8fc28a1555398567fc167b637c2e2262c8b1",
  "icons.js": "71c2f1e54de30c027cb758515bfac9e6821f5529c8d44292e543fb60bc8c9c3b",
  "ui.js": "ad2eb1846c59ea0aadb10c7c3f2f076c1ac2c443765bdb77bd48077bed148987",
  "pdf-font.js": "170354c2f260ec95e61be85463fb6d5f7b2f09d5df962025b9bb75a6768aee3a",
  "export.js": "c91db8c34be64354724458cb861efa56aa7b045a8d8040c02b49c38d0e4ea5db",
  "github-sync.js": "7cc0f26c248cec72f4dc899c12dc6fda833c32d409a8c510e6ca18aabfb750f2",
  "storage.js": "f7e5de6fa5acbeb6612d7c67ba5fc100c3c1d955a7ad06c8719844999f778a69",
  "money.js": "c049d7e6b783b73b59d0e339863087c044ff6d7e0cfe61cf4fb0a5053b039c1a",
  "lease-law.js": "b70653769398ef7c4587ec96c036c1988bff99fc15b85d6276153263e6f88626",
  "lease-clauses.js": "a49233b0b241c8c362a85dc8d2bdfe639b5f685197198ae6ecd8f202fa5aa650",
  "lease-document.js": "905e47f2d8f74e41df7b0b2338fb1307323f531712f6acf909f246035bf427bb",
  "lease-packets.js": "d32e642fd1d462ecf83e889265e2be91fc38f1c7952919c5d83aec387f4a20d7",
  "leases.js": "aad45cec70147f9218bd4cf6bca41f17ad465f53abfbac61d71a27939e5c101c",
  "records.js": "a61add33b724c8d230db730bcd45a09ef701fcb68f45145d33601410a602f7b4",
  "app.js": "3c4a3ac8c4e72593b65d8c698164be86c017fe9dc42b856ed4a2c154cf8ad575",
  "LICENSE-Liberation.txt": "93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b",
  "assets/icon-192.png": "689c9b47b244fa2d46737b61b785ca889f101d751a084cd1bf03daacf37f4894",
  "assets/icon-512.png": "68a06b32d6fd429b8d6e6bd649f40bb1cbfe6cd8a7ea671883f9ef776181174c",
  "assets/juniper-house.png": "72a406716f829b0c4b9c260cc28dd55cad6c942e33f24969f32fb5145ad2fc10",
  "legal-assets/epa-lead-en.pdf": "a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8",
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
