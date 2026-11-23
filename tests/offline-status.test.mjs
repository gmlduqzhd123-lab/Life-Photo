import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('offline readiness requires every asset of the current cache version',async()=>{
 const handlers={};let present=false,missing=false;const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
 const sandbox={URL,Set,Promise,self:{registration:{scope:'https://example.test/'},addEventListener:(n,f)=>handlers[n]=f},caches:{keys:async()=>present?['imagine-four-offline-v13']:[],open:async()=>({match:async url=>missing&&url.endsWith('/photo-adjust.mjs')?undefined:{ok:true}})}};
 vm.runInNewContext(source,sandbox);
 async function status(){let result,task;handlers.message({data:{type:'STATUS'},ports:[{postMessage:r=>result=r}],waitUntil:p=>task=p});await task;return result;}
 assert.equal((await status()).prepared,false);present=true;assert.equal((await status()).prepared,true);missing=true;assert.equal((await status()).prepared,false);
});
