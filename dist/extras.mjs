import {paintStroke} from './brush.mjs';
export function enableBrush({getItem,getAsset,apply,notify}){
 const $=id=>document.getElementById(id),d=$('brush-dialog'),c=$('brush-canvas'),ctx=c.getContext('2d');let asset,mask,mode=1,history=[],previous=null;
 function redraw(){if(!asset)return;ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(asset.source,0,0,c.width,c.height);const layer=document.createElement('canvas');layer.width=asset.mw;layer.height=asset.mh;const lc=layer.getContext('2d'),im=lc.createImageData(layer.width,layer.height);for(let i=0;i<mask.length;i++){im.data[i*4]=230;im.data[i*4+1]=48;im.data[i*4+2]=70;im.data[i*4+3]=Math.round((1-mask[i])*145);}lc.putImageData(im,0,0);ctx.drawImage(layer,0,0,c.width,c.height);$('brush-undo').disabled=!history.length;}
 function position(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*asset.mw,y:(e.clientY-r.top)/r.height*asset.mh};}
 function paint(e){const p=position(e),radius=Number($('brush-size').value);paintStroke(mask,asset.mw,asset.mh,previous||p,p,radius,mode);previous=p;redraw();}
 $('brush-open').onclick=()=>{const it=getItem();asset=it&&getAsset(it.assetId);if(!asset?.mask){notify('먼저 인물 사진을 선택해 주세요.');return;}mask=new Float32Array(asset.mask);history=[];mode=1;c.width=asset.source.width;c.height=asset.source.height;redraw();d.showModal();};
 $('brush-restore').onclick=()=>{mode=1;$('brush-restore').classList.add('primary');$('brush-erase').classList.remove('primary');};$('brush-erase').onclick=()=>{mode=0;$('brush-erase').classList.add('primary');$('brush-restore').classList.remove('primary');};
 c.onpointerdown=e=>{history.push(mask.slice());if(history.length>20)history.shift();previous=null;c.setPointerCapture(e.pointerId);paint(e);};c.onpointermove=e=>{if(c.hasPointerCapture(e.pointerId))paint(e);};c.onpointerup=()=>{previous=null;};c.onpointercancel=()=>{previous=null;};
 $('brush-undo').onclick=()=>{if(history.length){mask=history.pop();redraw();}};
 for(const id of ['brush-cancel','brush-discard'])$(id).onclick=()=>{d.close();asset=null;mask=null;c.width=c.height=1;};
 d.addEventListener('close',()=>{asset=null;mask=null;history=[];c.width=c.height=1;});
 $('brush-apply').onclick=()=>{try{apply(mask);d.close();asset=null;mask=null;c.width=c.height=1;}catch(e){notify(e.message);}};
}
export async function checkReadiness(backgroundUrl,modelReady,appUrl='./app.mjs'){
 const checks=[['브라우저 기본 기능',!!(window.Worker&&window.createImageBitmap&&window.HTMLCanvasElement)],['카메라 기능',!!navigator.mediaDevices?.getUserMedia],['인물 오리기 모델',modelReady]];
 for(const [name,url] of [['앱 파일',appUrl],['모델 파일','./vendor/models/selfie_segmenter.tflite'],['WASM 파일','./vendor/mediapipe/wasm/vision_wasm_internal.wasm'],['선택한 배경',backgroundUrl]]){try{const r=await fetch(url,{method:'GET',cache:'no-store'});checks.push([name,r.ok]);r.body?.cancel();}catch{checks.push([name,false]);}}
 return checks;
}
