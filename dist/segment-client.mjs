let worker=null,readyPromise=null,ready=false,status=()=>{},counter=0,initCancel=null;
const pending=new Map();
export function setStatusListener(fn){status=fn;}
export function initSegmenter(){
 if(ready)return Promise.resolve();
 if(readyPromise)return readyPromise;
 status('loading');
 readyPromise=new Promise((resolve,reject)=>{
  const owned=new Worker(new URL('./segment-worker.js',import.meta.url));
  worker=owned;let settled=false;
  const timer=setTimeout(()=>fail(Error('인물 오리기 준비에 시간이 걸려요. 다시 준비하거나 원본 모드를 이용해 주세요.')),15000);
  const cancel=()=>{if(settled)return;settled=true;clearTimeout(timer);reject(new DOMException('준비 중단','AbortError'));};
  initCancel=cancel;
  function fail(error){if(settled||worker!==owned)return;settled=true;clearTimeout(timer);owned.terminate();worker=null;ready=false;readyPromise=null;initCancel=null;status('error');console.error('Segmentation preparation:',error.message);reject(error);}
  owned.onmessage=({data:d})=>{
   if(worker!==owned)return;
   if(d.type==='ready'){if(settled)return;settled=true;clearTimeout(timer);initCancel=null;ready=true;status('ready');resolve();return;}
   if(d.id){const job=pending.get(d.id);if(!job)return;pending.delete(d.id);clearTimeout(job.timer);if(d.type==='error')job.reject(Error(d.message));else job.resolve({mask:new Float32Array(d.mask),w:d.width,h:d.height});}
   else if(d.type==='error')fail(Error(d.message));
  };
  owned.onerror=e=>{if(!ready)fail(Error(e.message||'인물 오리기를 준비하지 못했어요. 원본 모드를 이용해 주세요.'));else resetSegmenter();};
  owned.postMessage({type:'init'});
 });return readyPromise;
}
export async function segmentPhoto(canvas){
 await initSegmenter();const owned=worker,id=++counter,bitmap=await createImageBitmap(canvas);
 if(worker!==owned){bitmap.close();throw new DOMException('이전 작업 중단','AbortError');}
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('인물 오리기가 지연되고 있어요. 다시 시도하거나 원본을 사용해 주세요.'));if(worker===owned)resetSegmenter();},10000);pending.set(id,{resolve,reject,timer});owned.postMessage({type:'segment',id,bitmap},[bitmap]);});
}
export function resetSegmenter(){
 initCancel?.();initCancel=null;
 for(const job of pending.values()){clearTimeout(job.timer);job.reject(new DOMException('이전 작업 중단','AbortError'));}
 pending.clear();worker?.terminate();worker=null;ready=false;readyPromise=null;status('idle');
}
