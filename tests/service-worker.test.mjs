import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {BUILT_IN_BACKGROUNDS} from '../dist/background-catalog.mjs';
test('offline cache intercepts only approved app assets and never photo or POST requests',async()=>{
 const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');const handlers={};const cached={kind:'cached-app'};
 const sandbox={URL,Set,Response,self:{registration:{scope:'https://example.test/'},addEventListener:(name,fn)=>handlers[name]=fn},caches:{match:async()=>cached},fetch:async()=>{throw Error('offline');}};
 vm.runInNewContext(source,sandbox);let response;
 handlers.fetch({request:{url:'https://example.test/app.mjs?v=background-gallery',method:'GET'},respondWith:p=>response=p});assert.equal(await response,cached);
 for(const background of BUILT_IN_BACKGROUNDS){response=undefined;handlers.fetch({request:{url:new URL(background.url,'https://example.test/').href,method:'GET'},respondWith:p=>response=p});assert.equal(await response,cached,background.id);}
 for(const request of [{url:'blob:https://example.test/private-photo',method:'GET'},{url:'https://example.test/photo.jpg',method:'GET'},{url:'https://external.test/app.mjs',method:'GET'},{url:'https://example.test/app.mjs?v=background-gallery',method:'POST'}]){let intercepted=false;handlers.fetch({request,respondWith:()=>intercepted=true});assert.equal(intercepted,false,request.url);}
});
