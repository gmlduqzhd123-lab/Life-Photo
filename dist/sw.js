const VERSION='imagine-four-offline-v21';
const paths=['./','./index.html','./styles.css?v=event-operations','./app.mjs?v=event-operations','./event-mode.mjs?v=event-operations','./event-templates.mjs?v=event-workflow','./batch-print.mjs?v=event-operations','./core.mjs?v=event-workflow','./core.mjs?v=scrapbook-flow','./core.mjs?v=classroom-tools','./core.mjs?v=classroom-review','./print-pdf.mjs?v=event-workflow','./render.mjs?v=event-workflow','./image-tools.mjs','./image-tools.mjs?v=event-workflow','./segment-client.mjs','./segment-worker.js','./storage.mjs?v=event-operations','./studio-flow.mjs?v=event-operations','./event-stations.mjs?v=event-operations','./event-backup.mjs?v=event-operations','./brush.mjs','./extras.mjs?v=classroom-review','./preset-bundle.mjs?v=background-gallery','./background-catalog.mjs?v=background-gallery','./background-catalog.mjs?v=mobile-ux','./photo-adjust.mjs','./vendor/mediapipe/vision_bundle.js','./vendor/mediapipe/wasm/vision_wasm_internal.js','./vendor/mediapipe/wasm/vision_wasm_internal.wasm','./vendor/mediapipe/wasm/vision_wasm_module_internal.js','./vendor/mediapipe/wasm/vision_wasm_module_internal.wasm','./vendor/models/selfie_segmenter.tflite',...['space','ocean','forest','dinosaur','clouds','stage','classroom','party'].map(x=>'./assets/backgrounds/'+x+'.svg'),'./assets/demo-person.svg',...['track-finish','graduation-wall','library-maze','science-lab','school-crosswalk','cherry-lane','summer-picnic','autumn-station','snowman-village','rainy-alley','aurora-field','volcano-field','desert-dunes','waterfall-bridge','firefly-cave','hanok-alley','airport-gate','pyramids','canal-bridge','night-market','giant-desk','toy-train','cookie-bakery','treasure-map','popup-castle','lunar-base','robot-workshop','sky-station','time-portal','submarine'].map(id=>'./assets/backgrounds/scrapbook/'+id+'.webp')];
const absolute=paths.map(p=>new URL(p,self.registration.scope).href),allowed=new Set(absolute);
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();for(const k of await caches.keys())if(k.startsWith('imagine-four-offline-')&&k!==VERSION)await caches.delete(k);})()));

let preparing = null;
let latestProgress = null;
const progressPorts = new Set();

async function missingPaths(cache) {
  const present = await Promise.all(absolute.map(url => cache.match(url)));
  return absolute.filter((_,index) => !present[index]);
}

function broadcastProgress(done,total) {
  latestProgress = {type:'PROGRESS',done,total};
  for (const port of progressPorts) port.postMessage(latestProgress);
}

async function prepareMissing() {
  const total = absolute.length;
  let done = 0;
  try {
    const cache = await caches.open(VERSION);
    const missing = await missingPaths(cache);
    done = total - missing.length;
    broadcastProgress(done,total);
    for (const url of missing) {
      const response = await fetch(url,{cache:'reload',credentials:'same-origin'});
      if (!response.ok || response.redirected) throw Error('일부 파일을 받지 못했어요. 인터넷 연결을 확인해 주세요.');
      await cache.put(url,response);
      broadcastProgress(++done,total);
    }
    return {type:'RESULT',ok:true,done,total};
  } catch {
    return {type:'RESULT',ok:false,done,total,message:'받아 둔 파일은 이 기기에 남아 있어요.'};
  }
}

async function getStatus() {
  const total = absolute.length;
  let done = 0;
  try {
    if ((await caches.keys()).includes(VERSION)) {
      const cache = await caches.open(VERSION);
      done = total - (await missingPaths(cache)).length;
    }
  } catch {}
  return {version:VERSION,prepared:done===total,done,total};
}

self.addEventListener('message',event => {
  const type = event.data?.type;
  const port = event.ports[0];
  if (!port || !['PREPARE','STATUS'].includes(type)) return;
  event.waitUntil((async () => {
    if (type === 'STATUS') { port.postMessage(await getStatus()); return; }
    progressPorts.add(port);
    if (latestProgress) port.postMessage(latestProgress);
    if (!preparing) preparing = prepareMissing().finally(() => { preparing = latestProgress = null; });
    try { port.postMessage(await preparing); }
    finally { progressPorts.delete(port); }
  })());
});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);const key=url.href;if(event.request.method!=='GET'||!allowed.has(key))return;event.respondWith((async()=>{try{const response=await fetch(event.request);if(response.ok&&!response.redirected)return response;throw Error('unavailable');}catch{const cached=await caches.match(key,{cacheName:VERSION});return cached||Response.error();}})());});
