import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('offline readiness requires every asset of the current cache version',async()=>{
 const handlers={};let present=false,missing=false;const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
 const sandbox={URL,Set,Promise,self:{registration:{scope:'https://example.test/'},addEventListener:(n,f)=>handlers[n]=f},caches:{keys:async()=>present?['imagine-four-offline-v18']:[],open:async()=>({match:async url=>missing&&url.endsWith('/photo-adjust.mjs')?undefined:{ok:true}})}};
 vm.runInNewContext(source,sandbox);
 async function status(){let result,task;handlers.message({data:{type:'STATUS'},ports:[{postMessage:r=>result=r}],waitUntil:p=>task=p});await task;return result;}
 assert.equal((await status()).prepared,false);present=true;assert.equal((await status()).prepared,true);missing=true;assert.equal((await status()).prepared,false);
});

test('offline preparation keeps successful downloads and resumes from the next missing file', async () => {
  const handlers = {}, entries = new Map(), fetched = [];
  let interrupted = false;
  const source = await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{
    URL,Set,Promise,
    self:{registration:{scope:'https://example.test/'},addEventListener:(name,handler)=>handlers[name]=handler},
    caches:{keys:async()=>['imagine-four-offline-v18'],open:async()=>({
      match:async url=>entries.get(url), put:async (url,value)=>entries.set(url,value)
    })},
    fetch:async url=>{
      fetched.push(url);
      if (url.endsWith('/assets/backgrounds/ocean.svg')&&!interrupted) { interrupted=true; return {ok:false}; }
      return {ok:true};
    }
  });
  async function send(type) {
    const messages = [];
    let task;
    handlers.message({data:{type},ports:[{postMessage:value=>messages.push(value)}],waitUntil:value=>task=value});
    await task;
    return messages;
  }
  const initial = await send('PREPARE');
  const failure = initial.at(-1);
  assert.equal(failure.ok,false);
  assert.ok(failure.done > 0 && failure.done < failure.total);
  const first = new Set(entries.keys());
  const state = (await send('STATUS'))[0];
  assert.equal(state.done,first.size);
  assert.equal(state.prepared,false);
  const attempts = fetched.length;
  const resume = await send('PREPARE');
  assert.equal(resume[0].done,first.size);
  assert.ok(fetched.slice(attempts).every(url=>!first.has(url)));
  assert.equal(resume.at(-1).ok,true);
  assert.equal(resume.at(-1).done,failure.total);
  assert.equal((await send('STATUS'))[0].prepared,true);
});
