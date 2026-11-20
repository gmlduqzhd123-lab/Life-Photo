import {BACKGROUND_FILTERS,BUILT_IN_BACKGROUNDS,listBackgrounds} from './background-catalog.mjs?v=background-gallery';
import {normalizeAdjustment} from './photo-adjust.mjs';
import {paintStroke} from './brush.mjs';
import {CUT_W,CUT_H,MISSIONS,uid,clamp,newProject,personItems,addItem,arrangePeople,exportSpec,hitItem,moveItem,History,isComplete,getPrintLayout,presetOf} from './core.mjs?v=classroom-tools';
import {drawCut,renderProject,loadImage,makeDecoration,forgetImage,drawPaperPreview} from './render.mjs?v=scrapbook-flow';
import {readPhoto,makeCutout} from './image-tools.mjs';
import {initSegmenter,segmentPhoto,resetSegmenter,setStatusListener} from './segment-client.mjs';
import {readSaved,saveSettings,clearSaved,listLessons,getLesson,saveLesson,deleteLesson} from './storage.mjs?v=classroom-tools';

const $=id=>document.getElementById(id),on=(id,event,fn)=>$(id).addEventListener(event,fn);
const assets = new Map();
const backgrounds = [...BUILT_IN_BACKGROUNDS];
let themeFilter = 'recommended';
let showFavorites = false;
let project=newProject(),active=0,selected=null,step='background',history=new History(),settings={timer:3,sound:false,mission:true,customMissions:[],lockBackground:false};
let printUrl=null,cameraEpoch=0,busy=false,cancelEpoch=0,stream=null,facing='user',running=false,replaceTarget=null,sourceMode='append',toastTimer,logo=null,logoBlob=null,presetStatus='',renderVersion=0,previewTimer,prepared=false,downloadUrl=null,gesture=null;
let preparedExport = null;
let requestedExport = null;
const pointers = new Map();
const classroomModeKey = 'booth-classroom-mode';
let classroomMode = false;
let lessonNames = [];
let lessonWorking = false;
try { classroomMode = localStorage.getItem(classroomModeKey) === 'on'; } catch {}
const mobileLayout = matchMedia('(max-width: 720px)');
let cameraFailed = false;
let previewRevision = 0;
const OFFLINE_VERSION='imagine-four-offline-v10';let favorites=new Set();try{favorites=new Set(JSON.parse(localStorage.getItem('booth-favorite-backgrounds')||'[]'));}catch{}
const cut=()=>project.cuts[active],item=()=>cut().items.find(x=>x.id===selected),currentAsset=()=>item()&&assets.get(item().assetId);
function message(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){if(e.name!=='AbortError')message(e.message||'다시 시도해 주세요.');}};}
function record(){history.record(project);}
function mutate(fn){if(busy)return;record();fn();cleanAssets();render();}
function cleanAssets(){const used=new Set([...project.cuts,...history.past.flatMap(x=>x.cuts),...history.future.flatMap(x=>x.cuts)].flatMap(c=>c.items.map(i=>i.assetId)));for(const [id,a]of assets){if(used.has(id))continue;assets.delete(id);if(a.image instanceof ImageBitmap)a.image.close();}}
function isDirty(){return project.cuts.some(c=>c.items.length);}
function setBusy(value,label='인물을 오리고 있어요'){busy=value;$('busy').hidden=!value;$('busy-label').textContent=label;renderControls();}
function scrollToStage() {
  if (mobileLayout.matches) $('workspace-editor').scrollIntoView({block: 'start'});
}

function setStep(value, {focusHeading = true} = {}) {
  if (busy || running) return;
  if (value !== 'camera') {
    stopCamera();
    selected = null;
    cameraFailed = false;
    $('camera-error').hidden = true;
  }
  step = value;
  render();
  if (focusHeading && mobileLayout.matches) {
    $('stage-title').focus({preventScroll: true});
    scrollToStage();
  }
}

function placeBackgroundPicker() {
  const picker = $('background-section');
  const host = mobileLayout.matches && step === 'background'
    ? $('mobile-background-slot')
    : $('background-sidebar');
  if (picker.parentElement !== host) host.prepend(picker);
}

function choosePhotoCut(index) {
  active = index;
  selected = null;
  replaceTarget = null;
  sourceMode = 'append';
  setStep(personItems(cut()).length ? 'edit' : 'camera', {focusHeading: false});
  scrollToStage();
  $('cut-grid').children[index]?.focus({preventScroll: true});
  $('cut-announcement').textContent = personItems(cut()).length
    ? `${index + 1}번 컷을 선택했어요. 사진을 꾸밀 수 있어요.`
    : `${index + 1}번 컷을 선택했어요. 이 컷을 찍거나 사진을 불러오세요.`;
}

function fillMissingCut() {
  const index = project.cuts.slice(0, project.count || 4).findIndex(c => !personItems(c).length);
  if (index >= 0) choosePhotoCut(index);
}

function confirmAction(title,text,{yesLabel='확인',noLabel='취소'}={}){return new Promise(resolve=>{$('confirm-title').textContent=title;$('confirm-message').textContent=text;$('confirm-yes').textContent=yesLabel;$('confirm-no').textContent=noLabel;const dialog=$('confirm-dialog');let done=false;const finish=value=>{if(done)return;done=true;dialog.close();$('confirm-yes').onclick=null;$('confirm-no').onclick=null;dialog.removeEventListener('cancel',cancel);resolve(value);};const cancel=e=>{e.preventDefault();finish(false);};$('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);dialog.addEventListener('cancel',cancel);dialog.showModal();});}
function errorChoice(text){return new Promise(resolve=>{const d=$('error-dialog');$('error-message').textContent=text;let done=false;const finish=value=>{if(done)return;done=true;d.close();d.removeEventListener('cancel',cancel);resolve(value);};const cancel=e=>{e.preventDefault();finish('cancel');};$('error-retry').onclick=()=>finish('retry');$('error-original').onclick=()=>finish('original');$('error-cancel').onclick=()=>finish('cancel');d.addEventListener('cancel',cancel);d.showModal();});}
function chooseBackground(background) {
  mutate(() => {
    const targets = $('all-backgrounds').checked ? project.cuts : [cut()];
    for (const current of targets) current.background = background.id;
  });
}

function toggleBackgroundFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  try {
    localStorage.setItem('booth-favorite-backgrounds', JSON.stringify([...favorites]));
  } catch {
    message('즐겨찾기는 이번 사용 중에만 유지돼요.');
  }
  renderBackgrounds();
}

function backgroundCard(background) {
  const current = cut().background === background.id;
  const card = document.createElement('div');
  card.className = 'background-choice';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'background-card' + (current ? ' active' : '');
  pick.dataset.backgroundControl = 'pick:' + background.id;
  pick.setAttribute('aria-label', `${background.name} 배경 선택`);
  pick.setAttribute('aria-pressed', String(current));
  pick.disabled = busy || running || settings.lockBackground;
  pick.onclick = () => chooseBackground(background);

  const wrap = document.createElement('span');
  wrap.className = 'image-wrap';
  const image = document.createElement('img');
  image.src = background.url;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  wrap.append(image);
  const title = document.createElement('strong');
  title.textContent = background.name;
  pick.append(wrap, title);

  const starred = favorites.has(background.id);
  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'favorite-toggle';
  star.dataset.backgroundControl = 'favorite:' + background.id;
  star.textContent = starred ? '★' : '☆';
  star.setAttribute('aria-label', `${background.name} 즐겨찾기`);
  star.setAttribute('aria-pressed', String(starred));
  star.disabled = busy || running || settings.lockBackground;
  star.onclick = () => toggleBackgroundFavorite(background.id);
  card.append(pick, star);
  return card;
}

function renderBackgrounds() {
  const grid = $('background-grid');
  const focusId = grid.contains(document.activeElement) ? document.activeElement.dataset.backgroundControl : null;
  const choices = listBackgrounds(backgrounds, showFavorites ? 'favorites' : themeFilter, favorites);
  grid.replaceChildren(...choices.map(backgroundCard));
  const favoriteFilter = $('background-favorites');
  favoriteFilter.setAttribute('aria-pressed', String(showFavorites));
  $('background-theme').value = themeFilter;
  $('background-count').textContent = `${backgrounds.length}가지 배경`;
  const current = backgrounds.find(b => b.id === cut().background);
  $('background-current').textContent = `현재 배경 · ${current?.name || '우주 탐험'}`;
  $('background-fit').value = cut().fit;

  const empty = $('background-empty');
  empty.hidden = choices.length > 0;
  empty.textContent = showFavorites
    ? '자주 쓰는 배경의 별을 누르면 여기에 모여요.'
    : '교사 설정에서 배경을 추가할 수 있어요.';
  if (focusId) {
    const movedFocus = [...grid.querySelectorAll('button')].find(b => b.dataset.backgroundControl === focusId);
    (movedFocus || favoriteFilter).focus({preventScroll: true});
  }
}

function updateBackgroundFilter() {
  $('background-grid').scrollLeft = 0;
  renderBackgrounds();
}

const themePicker = $('background-theme');
themePicker.replaceChildren(...BACKGROUND_FILTERS.map(([id, title]) => new Option(title, id)));
on('background-theme', 'change', () => {
  themeFilter = themePicker.value;
  showFavorites = false;
  updateBackgroundFilter();
});
on('background-favorites', 'click', () => {
  showFavorites = !showFavorites;
  updateBackgroundFilter();
});

async function render(){syncFields();placeBackgroundPicker();const version=++renderVersion;document.getElementById("full-preview-section").hidden=step!=='finish';const stageTitles={background:'상상 속으로 떠나볼까요',camera:'우리의 순간을 담아요',edit:'스티커처럼 자유롭게',finish:isComplete(project)?'반짝이는 사진을 완성했어요':'촬영 진행 상태를 확인해요'};$('cut-label').textContent=`${active+1}번째 컷`;$('stage-title').textContent=stageTitles[step];$('camera-guide').textContent=`${active+1}번째 컷을 찍어요. 카메라를 보고 포즈를 취해요.`;$('next-cut').textContent=active+1<(project.count||4)?`${active+2}번째 컷 만들기`:'전체 사진 확인하기';$('finish-example').hidden=!project.cuts.slice(0,project.count||4).some(c=>c.items.some(i=>i.example));renderRetakes();document.querySelectorAll('[data-step]').forEach(b=>{const is=b.dataset.step===step;b.classList.toggle('active',is);if(is)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});for(const s of ['background','camera','edit','finish'])$(`${s}-tools`).hidden=s!==step;$('scene-background').textContent=backgrounds.find(b=>b.id===cut().background)?.name||'나만의 배경';$('example-tag').hidden=!cut().items.some(i=>i.example);$('scene-tip').textContent=step==='camera'?'촬영 후 인물만 오려서 붙여요':step==='edit'?'스티커를 누르고 움직여 보세요':'사진 속 우리를 이 배경에 붙여요';$('scene-tip').hidden=busy||step==='finish';$('mission').textContent=settings.customMissions[active]||MISSIONS[active];$('mission').hidden=!settings.mission;renderBackgrounds();renderCutButtons();renderControls();renderItemControls();await drawCut($('scene'),cut(),assets,backgrounds,{selected,placeholder:true});if(version!==renderVersion)return;if(step==='finish')schedulePreview();}
function renderCutButtons() {
  const root = $('cut-grid');
  const count = project.count || 4;
  const cuts = project.cuts.slice(0, count);
  while (root.children.length > count) root.lastElementChild.remove();

  cuts.forEach((current, index) => {
    let button = root.children[index];
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => choosePhotoCut(index));
      root.append(button);
    }
    const hasPhoto = personItems(current).length > 0;
    button.className = 'cut-card' + (index === active ? ' active' : '');
    button.setAttribute('aria-label', `${index + 1}번 컷 · ${hasPhoto ? '사진 있음, 꾸미기' : '사진 없음, 촬영'}`);
    button.setAttribute('aria-pressed', String(index === active));
    button.disabled = busy || running;
    button.replaceChildren();
    if (current.items.length) {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 180;
      drawCut(canvas, current, assets, backgrounds).catch(() => {});
      button.append(canvas);
    } else {
      const empty = document.createElement('span');
      empty.textContent = '사진 없음';
      button.append(empty);
    }
    const number = document.createElement('span');
    number.className = 'cut-no';
    number.textContent = String(index + 1).padStart(2, '0');
    button.append(number);
  });
  const filled = cuts.filter(c => personItems(c).length).length;
  $('progress').textContent = `${filled} / ${count}`;
  $('progress-bar').style.width = `${filled / count * 100}%`;
}

function renderControls(){
 document.querySelectorAll('#cut-grid button').forEach(b=>b.disabled=busy||running);document.querySelectorAll('#background-grid button').forEach(b=>b.disabled=busy||running||settings.lockBackground);document.getElementById("all-backgrounds").disabled=busy||running||settings.lockBackground;$('undo').disabled=busy||running||!history.past.length;$('redo').disabled=busy||running||!history.future.length;renderFinishControls();$('capture').textContent=`${settings.timer}초 후 촬영`;$('auto-capture').textContent=`${project.count||4}컷 연속 촬영`;$('capture').disabled=!stream||busy||running;$('start-camera').hidden=!!stream;$('stop-camera').hidden=!stream;$('switch-camera').disabled=!stream||busy||running;$('auto-capture').disabled=!stream||busy||running;$('stop-capture').hidden=!running;$('photo-input').disabled=busy||running;$('photo-browse').disabled=busy||running;for(const id of ['go-camera','demo-fill','teacher-open','add-person','retake','clear-cut','next-cut','show-finish','new-group'])$(id).disabled=busy||running;document.querySelectorAll('[data-step]').forEach(b=>b.disabled=busy||running);$('toggle-original').disabled=busy||!personItems(cut()).length;$('toggle-original').textContent=cut().original?'스티커로 돌아가기':'원본 보기';$('background-fit').disabled=busy||settings.lockBackground;$('background-theme').disabled=busy||running;$('background-favorites').disabled=busy||running;$('scene').setAttribute('aria-busy',String(busy));$('classroom-mode-exit').disabled=busy||running;updateMobileAction();}
function renderItemControls(){const canArrange=!cut().original&&personItems(cut()).length>1;$('arrange-people').hidden=!canArrange;$('arrange-people').disabled=busy||running||!canArrange;const adjustment=normalizeAdjustment(cut().adjustment);for(const name of ['brightness','contrast','saturation']){const control=$(`adjust-${name}`);control.value=adjustment[name];control.disabled=busy||!personItems(cut()).length;$(name+'-value').textContent=adjustment[name]+'%';}$('adjust-reset').disabled=busy||!personItems(cut()).length;const it=item(),a=currentAsset();$('selected-tools').hidden=!it||cut().original;for(const id of ['item-front','item-back','item-center','item-duplicate','item-copy','item-delete','item-size','item-rotation','item-border','item-softness'])$(id).disabled=busy||!it;$('item-softness').disabled=busy||!a?.mask;if(it){$('item-size').value=Math.round(it.scale*100);$('item-rotation').value=it.rotation;$('item-softness').value=Math.round(it.softness*100);$('item-border').checked=it.border;}$('retake').disabled=busy||!personItems(cut()).length;$('brush-open').disabled=busy||!a?.mask;const list=$('item-list');list.replaceChildren();cut().items.forEach((it,i)=>{const b=document.createElement('button');b.className='item-chip'+(selected===it.id?' active':'');b.textContent=it.kind==='person'?`${it.example?'예시':'인물'} ${cut().items.slice(0,i+1).filter(x=>x.kind==='person').length}`:`장식 ${i+1}`;b.disabled=busy;b.onclick=()=>{selected=it.id;render();};list.append(b);});}
function schedulePreview() {
  clearTimeout(previewTimer);
  const revision = ++previewRevision;
  const version = renderVersion;
  previewTimer = setTimeout(safe(async () => {
    if (step !== 'finish') return;
    const preview = await renderProject(project, assets, backgrounds, .28, logo);
    if (revision !== previewRevision || version !== renderVersion || step !== 'finish') {
      preview.width = preview.height = 0;
      return;
    }
    const previous = $('full-preview').firstElementChild;
    if (previous) previous.width = previous.height = 0;
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', isComplete(project) ? '완성한 사진' : '촬영 중인 사진 미리보기');
    $('full-preview').replaceChildren(preview);
    renderPaperPreview();
  }), 120);
}

function stopCamera(){cameraEpoch++;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;$('camera').hidden=true;renderControls();}
async function startCamera(){cameraFailed=false;$('camera-error').hidden=true;stopCamera();const request=++cameraEpoch;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('HTTPS 또는 지원 브라우저에서 열어 주세요. 사진 불러오기도 사용할 수 있어요.');const pendingStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:960},aspectRatio:{ideal:4/3}},audio:false});if(request!==cameraEpoch||document.hidden||step!=='camera'){pendingStream.getTracks().forEach(t=>t.stop());return;}stream=pendingStream;$('camera').srcObject=stream;await $('camera').play();if(request!==cameraEpoch||document.hidden||step!=='camera'){if(stream===pendingStream)stopCamera();else pendingStream.getTracks().forEach(t=>t.stop());return;}if(!$('camera').videoWidth)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('카메라 영상을 준비하지 못했어요.')),7000);$('camera').onloadeddata=()=>{clearTimeout(timer);resolve();};});if(request!==cameraEpoch||document.hidden||step!=='camera'){if(stream===pendingStream)stopCamera();else pendingStream.getTracks().forEach(t=>t.stop());return;}$('camera').style.transform=facing==='user'?'scaleX(-1)':'none';$('camera').hidden=false;renderControls();}catch(e){if(request!==cameraEpoch)return;stopCamera();const known={NotAllowedError:'카메라 권한을 허용하거나 사진 불러오기를 이용해 주세요.',NotFoundError:'사용할 수 있는 카메라가 없어요. 사진 불러오기를 이용해 주세요.',NotReadableError:'다른 앱이 카메라를 사용 중일 수 있어요. 다른 앱을 닫고 다시 켜 주세요.'};cameraFailed=true;$('camera-error').textContent=known[e.name]||'카메라를 열지 못했어요. 사진 불러오기를 이용할 수 있어요.';$('camera-error').hidden=false;renderControls();}}
let audio;
function beep(){if(!settings.sound)return;try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);gain.gain.value=.035;osc.frequency.value=700;osc.start();osc.stop(audio.currentTime+.1);}catch{}}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function countdown(epoch){$('countdown').hidden=false;try{for(let i=settings.timer;i>0;i--){if(epoch!==cancelEpoch||!stream)throw new DOMException('촬영 중단','AbortError');$('countdown').textContent=i;beep();await delay(1000);}if(epoch!==cancelEpoch||!stream)throw new DOMException('촬영 중단','AbortError');}finally{$('countdown').hidden=true;}}
function captureCanvas(){const v=$('camera'),c=document.createElement('canvas');const w=v.videoWidth,h=v.videoHeight;if(!w||!h)throw Error('카메라가 준비된 뒤 다시 찍어 주세요.');const sw=Math.min(w,h*4/3),sh=Math.min(h,w*3/4),scale=Math.min(1,1600/sw);c.width=Math.round(sw*scale);c.height=Math.round(sh*scale);const ctx=c.getContext('2d');if(facing==='user'){ctx.translate(c.width,0);ctx.scale(-1,1);}ctx.drawImage(v,(w-sw)/2,(h-sh)/2,sw,sh,0,0,c.width,c.height);return c;}
async function processSource(source,{index=active,target=replaceTarget,original=false,epoch=cancelEpoch,mode=sourceMode}={}){let result=null,sourceOnly=original;while(!sourceOnly){try{setBusy(true);const m=await segmentPhoto(source);if(epoch!==cancelEpoch)return false;const image=makeCutout(source,m.mask,m.w,m.h);result={image,w:image.width,h:image.height,source,mask:m.mask,mw:m.w,mh:m.h};break;}catch(e){if(epoch!==cancelEpoch)return false;setBusy(false);const choice=await errorChoice(e.message);if(choice==='cancel')return false;if(choice==='original'){sourceOnly=true;break;}resetSegmenter();}}
if(epoch!==cancelEpoch)return false;if(sourceOnly)result={image:source,w:source.width,h:source.height,source};const c=project.cuts[index];if(!target&&mode!=='replace-cut'&&personItems(c).length>=3){setBusy(false);throw Error('한 컷에는 인물 3개까지 넣을 수 있어요. 기존 인물을 선택해 바꾸거나 다른 컷을 골라 주세요.');}record();const id=uid();assets.set(id,result);const old=target&&c.items.find(i=>i.id===target);if(mode==='replace-cut')c.items=[];else if(old)c.items=c.items.filter(i=>i.id!==target);const newItem=addItem(c,id,result.w,result.h);if(old){newItem.x=old.x;newItem.y=old.y;newItem.rotation=old.rotation;newItem.scale=old.scale*(assets.get(old.assetId)?.w||result.w)/result.w;}c.original=sourceOnly;selected=newItem.id;active=index;replaceTarget=null;sourceMode='append';setBusy(false);cleanAssets();return true;}
function reviewCapture(source){return new Promise(resolve=>{const d=$('capture-review'),c=$('capture-review-image');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);let done=false;const finish=value=>{if(done)return;done=true;d.close();d.removeEventListener('cancel',cancel);c.width=c.height=0;resolve(value);};const cancel=e=>{e.preventDefault();finish(false);};$('capture-retake').onclick=()=>finish(false);$('capture-use').onclick=()=>finish(true);d.addEventListener('cancel',cancel);d.showModal();});}
async function shoot(auto=false){if(busy||running||!stream)return;const epoch=++cancelEpoch;let indices=auto?project.cuts.slice(0,project.count||4).map((c,i)=>personItems(c).length?null:i).filter(i=>i!==null):[active];if(auto&&!indices.length){message('네 컷이 모두 찼어요. 바꿀 컷을 고르고 다시 찍기를 눌러 주세요.');return;}if(!auto&&!replaceTarget&&personItems(cut()).length>=3){message('이 컷의 인물을 선택해 다시 찍거나 다른 컷을 골라 주세요.');return;}running=true;renderControls();try{for(const index of indices){active=index;await render();await countdown(epoch);let source=captureCanvas();beep();if(!auto){while(!await reviewCapture(source)){if(epoch!==cancelEpoch||!stream)return;await countdown(epoch);source=captureCanvas();beep();}if(epoch!==cancelEpoch)return;}$('camera').hidden=true;const success=await processSource(source,{index,epoch});if(epoch!==cancelEpoch)break;if(!success)break;if(auto){$('camera').hidden=false;await delay(500);}}}finally{running=false;setBusy(false);$('countdown').hidden=true;stopCamera();step=isComplete(project)?'finish':personItems(cut()).length?'edit':'camera';render();scrollToStage();}}
on('start-camera','click',safe(startCamera));on('stop-camera','click',()=>stopCamera());on('switch-camera','click',safe(async()=>{facing=facing==='user'?'environment':'user';await startCamera();}));on('capture','click',safe(()=>shoot()));on('auto-capture','click',safe(()=>shoot(true)));on('stop-capture','click',()=>{cancelEpoch++;running=false;resetSegmenter();setBusy(false);stopCamera();message('촬영을 중단했어요. 완성된 컷은 남겨 두었어요.');});
function selectImports(files){return new Promise(resolve=>{const d=$('import-dialog'),list=$('import-list');let done=false;function show(){list.replaceChildren();files.forEach((file,i)=>{const row=document.createElement('div');row.className='import-row';const name=document.createElement('span');name.textContent=(i+1)+'. '+file.name;row.append(name);for(const [label,delta] of [['위로',-1],['아래로',1]]){const b=document.createElement('button');b.type='button';b.className='button compact';b.textContent=label;b.disabled=i+delta<0||i+delta>=files.length;b.onclick=()=>{[files[i],files[i+delta]]=[files[i+delta],files[i]];show();};row.append(b);}list.append(row);});}show();$('import-mode').hidden=files.length!==1||!personItems(cut()).length;function finish(ok){if(done)return;done=true;d.close();resolve(ok?{files,mode:document.querySelector('input[name="import-mode"]:checked').value}:null);}$('import-cancel').onclick=()=>finish(false);$('import-confirm').onclick=()=>finish(true);d.oncancel=e=>{e.preventDefault();finish(false);};d.querySelector('[data-close]').onclick=()=>finish(false);d.showModal();});}
on('photo-browse','click',()=>$('photo-input').click());
on('photo-input','change',safe(async e=>{const files=[...e.target.files];e.target.value='';if(!files.length)return;if(files.length>4){message('한 번에 사진 4장까지 선택할 수 있어요.');return;}const selection=await selectImports(files);if(!selection)return;const epoch=++cancelEpoch;stopCamera();const start=active;try{for(const file of selection.files){const index=selection.files.length===1?active:project.cuts.slice(0,project.count||4).map((c,j)=>({c,j})).find(({c,j})=>j>=start&&!personItems(c).length)?.j;if(index===undefined){message('빈 컷이 부족해 남은 사진은 넣지 않았어요.');break;}const choice=selection.files.length===1?selection.mode:'append';const target=choice==='replace-person'?(item()?.kind==='person'?item().id:personItems(project.cuts[index])[0]?.id):null;if(choice==='append'&&personItems(project.cuts[index]).length>=3)throw Error('인물은 컷마다 3개까지 넣을 수 있어요.');setBusy(true,'사진을 준비하고 있어요');const source=await readPhoto(file);if(epoch!==cancelEpoch)break;const ok=await processSource(source,{index,target,mode:choice==='replace-cut'?'replace-cut':'append',original:$('original-import').checked,epoch});if(!ok)break;step='edit';}}finally{setBusy(false);if(isComplete(project))step='finish';render();scrollToStage();}}));
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>setStep(b.dataset.step));on('go-camera','click',()=>{sourceMode='append';replaceTarget=null;setStep('camera');});on('show-finish','click',()=>setStep('finish'));on('fill-missing','click',fillMissingCut);on('next-cut','click',()=>{if(active+1>=(project.count||4)){setStep('finish');return;}active++;setStep(personItems(cut()).length?'edit':'background');});
on('add-person','click',()=>{replaceTarget=null;sourceMode='append';setStep('camera');});on('retake','click',()=>{const current=item()?.kind==='person'?item():personItems(cut())[0];if(!current)return;replaceTarget=current.id;sourceMode='append';setStep('camera');message('새 사진을 확정하기 전까지 기존 인물은 유지돼요.');});
on('toggle-original','click',safe(async()=>{if(cut().original){const it=personItems(cut())[0],a=assets.get(it.assetId);if(!a.mask&&!it.example){await processSource(a.source,{target:it.id});render();return;}}mutate(()=>cut().original=!cut().original);}));on('clear-cut','click',safe(async()=>{if(await confirmAction('이 컷을 비울까요?','다른 컷은 그대로 남아요. 실행 취소로 되돌릴 수 있어요.'))mutate(()=>{cut().items=[];cut().original=false;selected=null;});}));
on('undo','click',()=>{project=history.undo(project);active=Math.min(active,(project.count||4)-1);selected=null;cleanAssets();render();});on('redo','click',()=>{project=history.redo(project);active=Math.min(active,(project.count||4)-1);selected=null;cleanAssets();render();});
on('background-fit','change',e=>mutate(()=>cut().fit=e.target.value));
on('demo-fill','click',safe(async()=>{if(isDirty()&&!await confirmAction('예시 네컷으로 체험할까요?','현재 사진은 실행 취소로 되돌릴 수 있어요. 예시는 실제 인물 오리기 결과가 아니에요.'))return;const image=await loadImage('./assets/demo-person.svg');mutate(()=>{project.cuts.forEach((c,i)=>{c.background=['space','ocean','forest','party'][i];c.items=[];c.original=false;const id=uid();assets.set(id,{image,w:image.naturalWidth,h:image.naturalHeight});const it=addItem(c,id,image.naturalWidth,image.naturalHeight,'person',true);it.rotation=[-9,8,-5,6][i];});active=0;step='edit';selected=cut().items[0].id;});message('예시 실루엣으로 체험 중이에요. 실제 사진은 사진 찍기에서 넣어 주세요.');}));
function selectedMutation(fn){if(!item())return;mutate(()=>fn(item()));}
on('item-front','click',()=>selectedMutation(it=>{cut().items=cut().items.filter(x=>x!==it);cut().items.push(it);}));on('item-back','click',()=>selectedMutation(it=>{cut().items=cut().items.filter(x=>x!==it);cut().items.unshift(it);}));on('item-center','click',()=>selectedMutation(it=>{it.x=600;it.y=450;}));on('item-delete','click',()=>selectedMutation(it=>{cut().items=cut().items.filter(x=>x!==it);selected=null;}));
function duplicate(next){if(!item())return;const original=item(),dest=next?project.cuts[(active+1)%(project.count||4)]:cut();if(original.kind==='person'&&personItems(dest).length>=3){message('복사할 컷의 인물 스티커가 이미 3개예요.');return;}mutate(()=>{const copy={...original,id:uid(),x:clamp(original.x+(next?0:50),0,1200),y:clamp(original.y+(next?0:30),0,900)};dest.items.push(copy);if(!next)selected=copy.id;});if(next)message('다음 컷에 스티커를 복사했어요.');}
on('arrange-people','click',()=>{
  if (cut().original || personItems(cut()).length < 2) return;
  mutate(() => arrangePeople(cut(), assets));
  message('인물을 나란히 놓았어요. 각각 움직이거나 크기를 바꿀 수 있어요.');
});
on('item-duplicate','click',()=>duplicate(false));on('item-copy','click',()=>duplicate(true));on('item-border','change',e=>selectedMutation(it=>it.border=e.target.checked));
let sliderRecorded=false;
for(const id of ['item-size','item-rotation','item-softness']){on(id,'pointerdown',()=>{if(!busy&&item()){record();sliderRecorded=true;}});on(id,'keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&!sliderRecorded){record();sliderRecorded=true;}});on(id,'input',()=>{if(!item()||busy)return;if(!sliderRecorded){record();sliderRecorded=true;}if(id==='item-size')item().scale=Number($(id).value)/100;if(id==='item-rotation')item().rotation=Number($(id).value);if(id!=='item-softness'){drawCut($('scene'),cut(),assets,backgrounds,{selected});renderCutButtons();}});on(id,'change',safe(async()=>{sliderRecorded=false;if(id==='item-softness'&&item()){const a=currentAsset();if(a?.mask){const image=makeCutout(a.source,a.mask,a.mw,a.mh,Number($(id).value)/100),id=uid(),it=item();assets.set(id,{...a,image,w:image.width,h:image.height});it.scale*=a.w/image.width;it.assetId=id;it.softness=Number($('item-softness').value)/100;}}render();}));}
document.querySelectorAll('[data-decoration]').forEach(b=>b.onclick=()=>{if(cut().items.filter(x=>x.kind==='decoration').length>=8){message('장식은 한 컷에 8개까지 넣을 수 있어요.');return;}mutate(()=>{const image=makeDecoration(b.dataset.decoration),id=uid();assets.set(id,{image,w:180,h:180});const it=addItem(cut(),id,180,180,'decoration');it.scale=1;it.x=970;it.y=160;selected=it.id;});});
function point(e){const r=$('scene').getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*CUT_W,y:(e.clientY-r.top)/r.height*CUT_H};}
on('scene','pointerdown',e=>{if(busy||step==='camera'||cut().original)return;const p=point(e);pointers.set(e.pointerId,p);$('scene').setPointerCapture(e.pointerId);if(pointers.size===1){const it=hitItem(cut(),p.x,p.y,assets);selected=it?.id||null;if(it){record();gesture={x:p.x,y:p.y,ox:it.x,oy:it.y};}renderItemControls();drawCut($('scene'),cut(),assets,backgrounds,{selected});}else if(pointers.size===2&&item()){const [a,b]=[...pointers.values()];gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),angle:Math.atan2(b.y-a.y,b.x-a.x),scale:item().scale,rotation:item().rotation};}});
on('scene','pointermove',e=>{if(!pointers.has(e.pointerId)||!item()||!gesture)return;pointers.set(e.pointerId,point(e));if(pointers.size===2&&gesture.distance){const [a,b]=[...pointers.values()];item().scale=clamp(gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance,.15,2.5);item().rotation=clamp(gesture.rotation+(Math.atan2(b.y-a.y,b.x-a.x)-gesture.angle)*180/Math.PI,-180,180);}else if(pointers.size===1&&gesture.ox!==undefined){const p=point(e);moveItem(item(),gesture.ox+p.x-gesture.x,gesture.oy+p.y-gesture.y);}drawCut($('scene'),cut(),assets,backgrounds,{selected});renderItemControls();});
for(const type of ['pointerup','pointercancel'])on('scene',type,e=>{pointers.delete(e.pointerId);if(!pointers.size){gesture=null;render();}else gesture=null;});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||document.querySelector('dialog[open]')||busy)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();return;}if(document.activeElement!==$('scene')||!item())return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(moves[e.key]){e.preventDefault();const [x,y]=moves[e.key],n=e.shiftKey?30:10;selectedMutation(it=>moveItem(it,it.x+x*n,it.y+y*n));}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('item-delete').click();}});
for(const [id,key]of [['layout','layout'],['frame-color','frame'],['frame-style','frameStyle'],['caption','caption'],['subtitle','subtitle'],['date','date'],['school','school']]){on(id,'change',e=>mutate(()=>project[key]=e.target.value));}
function syncFields(){for(const [id,key]of [['layout','layout'],['frame-color','frame'],['frame-style','frameStyle'],['caption','caption'],['subtitle','subtitle'],['date','date'],['school','school']])$(id).value=project[key];}
function exportIsCurrent(entry) {
  return entry?.project === JSON.stringify(project) && entry.logo === logo;
}

function clearExportImage() {
  if ($('export-dialog').open) $('export-dialog').close();
  $('export-image').removeAttribute('src');
  $('export-new-tab').removeAttribute('href');
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  preparedExport = null;
}

function requestPngDownload() {
  if (!downloadUrl || !exportIsCurrent(preparedExport)) return;
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = preparedExport.name;
  link.click();
  requestedExport = {...preparedExport};
  $('export-dialog-status').textContent = '저장을 요청했어요. 기기에서 파일을 확인해 주세요.';
  renderFinishControls();
}

function showExportImage() {
  $('export-image').src = downloadUrl;
  $('export-new-tab').href = downloadUrl;
  $('export-dialog-status').textContent = '';
  $('export-dialog').showModal();
}

async function exportPng({small = false, view = false} = {}) {
  if (busy || !isComplete(project)) return;
  if (downloadUrl && exportIsCurrent(preparedExport) && preparedExport.small === small) {
    if (view) showExportImage();
    else requestPngDownload();
    return;
  }
  const epoch = cancelEpoch;
  const snapshot = {project: JSON.stringify(project), logo, small};
  stopCamera();
  setBusy(true, '네컷 사진을 만들고 있어요');
  let canvas;
  try {
    const spec = exportSpec(project.layout, project.count);
    const scale = small ? Math.min(1, 2400 / Math.max(spec.w, spec.h)) : 1;
    canvas = await renderProject(project, assets, backgrounds, scale, logo);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG 생성 실패')), 'image/png');
    });
    if (epoch !== cancelEpoch || !exportIsCurrent(snapshot)) return;
    clearExportImage();
    downloadUrl = URL.createObjectURL(blob);
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
    preparedExport = {...snapshot, name: `상상네컷_${date}_${Date.now().toString(36).slice(-5)}${small ? '_작게' : ''}.png`};
    if (view) showExportImage();
    else requestPngDownload();
  } catch {
    if (epoch === cancelEpoch) message(small
      ? '작은 PNG를 만들지 못했어요. 기기 공간을 확인하고 다시 시도해 주세요.'
      : '고화질 PNG를 만들지 못했어요. 작은 PNG 저장을 이용해 주세요.');
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (epoch === cancelEpoch) setBusy(false);
  }
}

function clearPrint(){if(printUrl){URL.revokeObjectURL(printUrl);printUrl=null;}$('print-image').removeAttribute('src');$('print-sheet').querySelectorAll('.print-copy').forEach(x=>x.remove());}
on('print-photo','click',safe(async()=>{if(busy||!isComplete(project))return;stopCamera();setBusy(true,'인쇄할 사진을 준비하고 있어요');let url;try{const canvas=await renderProject(project,assets,backgrounds,1,logo);const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('인쇄 이미지를 만들지 못했어요.')),'image/png'));canvas.width=canvas.height=0;clearPrint();url=URL.createObjectURL(blob);printUrl=url;const image=$('print-image');await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('인쇄 이미지를 불러오지 못했어요.'));image.src=url;});const sheet=$('print-sheet'),paper=getPrintLayout($('print-paper').value,$('print-copies').value),copies=paper.copies;sheet.dataset.copies=String(copies);for(let i=1;i<copies;i++){const copy=image.cloneNode();copy.removeAttribute('id');copy.className='print-copy';copy.alt='';sheet.append(copy);}let style=$('print-page-style');if(!style){style=document.createElement('style');style.id='print-page-style';document.head.append(style);}style.textContent=`@page{size:${paper.cssSize};margin:${paper.margin}mm} @media print{#print-sheet{height:${paper.height - 2 * paper.margin}mm;gap:${paper.gap}mm}}`;setBusy(false);const release=()=>{clearPrint();window.removeEventListener('afterprint',release);};window.addEventListener('afterprint',release);window.print();}catch(e){clearPrint();message('인쇄를 준비하지 못했어요. PNG 저장 후 기기의 사진 앱에서 인쇄해 주세요.');}finally{setBusy(false);}}));
on('download','click',()=>exportPng());
on('download-small','click',()=>exportPng({small:true}));
on('export-view','click',()=>exportPng({view:true}));
on('export-download','click',requestPngDownload);
on('new-group', 'click', safe(async () => {
  let title = '다음 모둠을 시작할까요?';
  let body = '다음 모둠을 시작하면 현재 사진과 편집 기록이 지워집니다.';
  let noLabel = '취소';
  if (isComplete(project) && !exportIsCurrent(requestedExport)) {
    title = '이번 사진을 먼저 저장할까요?';
    body = '현재 사진에 대한 PNG 저장 요청이 없어요. 저장이나 인쇄를 확인한 후 다음 모둠을 시작하세요. 계속하면 사진과 편집 기록이 지워져요.';
    noLabel = '사진 화면으로 돌아가기';
  } else if (isComplete(project)) {
    body = '기기에서 저장된 파일을 확인해 주세요. ' + body;
  } else if (isDirty()) {
    title = '빈 컷이 있는 상태로 다음 모둠을 시작할까요?';
    noLabel = '사진 화면으로 돌아가기';
  }
  if (!await confirmAction(title, body, {yesLabel:'다음 모둠 시작',noLabel})) return;
  const preset = presetOf(project, settings);
  cancelEpoch++;
  resetSegmenter();
  stopCamera();
  clearPrint();
  clearExportImage();
  requestedExport = null;
  history.clear();
  assets.clear();
  pointers.clear();
  gesture = null;
  const scene = $('scene');
  scene.getContext('2d').clearRect(0, 0, scene.width, scene.height);
  $('full-preview').replaceChildren();
  clearPaperPreview();
  $('full-preview-section').hidden = true;
  clearTimeout(previewTimer);
  project = newProject(preset);
  active = 0;
  selected = null;
  replaceTarget = null;
  sourceMode = 'append';
  step = 'background';
  await render();
  scrollToStage();
  message('다음 모둠을 위한 준비가 끝났어요.');
  initSegmenter().catch(() => {});
}));
function teacherSync(){$('cut-count').value=project.count||4;$('timer').value=settings.timer;$('sound').checked=settings.sound;$('mission-on').checked=settings.mission;$('lock-background').checked=settings.lockBackground;$('custom-missions').value=settings.customMissions.join('\n');renderCustomBackgrounds();$('preset-status').textContent=presetStatus;}
function openTeacherSettings() {
  teacherSync();
  $('teacher-dialog').showModal();
  refreshOfflineNotice();
  refreshLessons().catch(() => {
    $('lesson-status').textContent = '이 기기에서 수업 설정 목록을 읽지 못했어요.';
  });
}
on('teacher-open', 'click', openTeacherSettings);on('teacher-check-ready','click',()=>{$('teacher-dialog').close();$('check-ready').click();});on('privacy-open','click',()=>$('privacy-dialog').showModal());document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
on('cut-count','change',safe(async e=>{const n=Number(e.target.value);if(n<(project.count||4)&&project.cuts.slice(n,project.count).some(c=>c.items.length)){if(!await confirmAction('컷 수를 줄일까요?','화면에 보이지 않는 컷은 유지되며 컷 수를 다시 늘리면 돌아옵니다.')){e.target.value=project.count;return;}}mutate(()=>{project.count=n;active=Math.min(active,n-1);selected=null;});}));
on('timer','change',e=>{settings.timer=Number(e.target.value);renderControls();});on('sound','change',e=>settings.sound=e.target.checked);on('mission-on','change',e=>{settings.mission=e.target.checked;render();});on('lock-background','change',e=>{settings.lockBackground=e.target.checked;render();});on('custom-missions','change',e=>{settings.customMissions=e.target.value.split('\n').map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,4);render();});
function renderCustomBackgrounds(){const root=$('custom-background-list');root.replaceChildren();for(const b of backgrounds.filter(x=>!x.builtIn)){const div=document.createElement('div'),img=document.createElement('img'),span=document.createElement('span'),del=document.createElement('button');img.src=b.url;img.alt='';span.textContent=b.name;del.textContent='×';del.setAttribute('aria-label',`${b.name} 배경 삭제`);del.onclick=()=>{mutate(()=>{project.cuts.forEach(c=>{if(c.background===b.id)c.background='space';});backgrounds.splice(backgrounds.indexOf(b),1);forgetImage(b.url);URL.revokeObjectURL(b.url);});renderCustomBackgrounds();};div.append(img,span,del);root.append(div);}}
on('background-input','change',safe(async e=>{const files=[...e.target.files];e.target.value='';for(const file of files){if(backgrounds.filter(b=>!b.builtIn).length>=20)throw Error('나만의 배경은 20개까지 추가할 수 있어요.');await readPhoto(file);const id='custom-'+uid(),b={id,name:file.name.replace(/\.[^.]+$/,'').slice(0,24),url:URL.createObjectURL(file),blob:file,builtIn:false};backgrounds.push(b);}if(files.length){themeFilter='custom';showFavorites=false;}renderCustomBackgrounds();render();message('배경을 추가했어요. 기기에 보관하려면 설정 저장을 눌러 주세요.');}));
on('logo-input','change',safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;logo=await readPhoto(file);logoBlob=file;$('logo-status').textContent='로고가 준비됐어요. 네컷 완성 화면에서 확인해 주세요.';schedulePreview();}));on('remove-logo','click',()=>{logo=null;logoBlob=null;$('logo-status').textContent='로고를 지웠어요.';schedulePreview();});
on('save-preset','click',safe(async()=>{try{await saveSettings({...presetOf(project,settings),lockBackground:settings.lockBackground},backgrounds.filter(b=>!b.builtIn).map(({id,name,blob})=>({id,name,blob})),logoBlob);presetStatus='이 기기에 배경과 설정을 저장했어요. 학생 사진은 저장하지 않았어요.';}catch(e){presetStatus='기기에 저장하지 못했어요. 이번 사용 중에는 계속 쓸 수 있어요. '+e.message;}$('preset-status').textContent=presetStatus;}));
on('delete-preset','click',safe(async()=>{if(!await confirmAction('기본 시작 설정을 지울까요?','자동으로 불러오는 기본 시작 설정을 삭제해요. 이름 붙인 수업 설정과 현재 사진은 유지돼요.'))return;await clearSaved();presetStatus='기본 시작 설정을 삭제했어요. 현재 화면의 설정은 유지돼요.';$('preset-status').textContent=presetStatus;}));
setStatusListener(state=>{prepared=state==='ready';$('model-status').textContent=state==='ready'?'✓ 인물 오리기 준비 완료':state==='loading'?'인물 오리기 준비 중':'인물 오리기 다시 준비';$('model-status').classList.toggle('ready',prepared);});
on('model-status','click',safe(async()=>{if(prepared){message('사진을 찍거나 불러오면 인물을 오려 드려요.');return;}resetSegmenter();await initSegmenter();message('인물 오리기가 준비됐어요.');}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(running){cancelEpoch++;running=false;resetSegmenter();setBusy(false);}stopCamera();}});
window.addEventListener('pagehide',()=>{cancelEpoch++;renderVersion++;clearTimeout(previewTimer);if($('brush-dialog').open)$('brush-dialog').close();resetSegmenter();stopCamera();clearPrint();assets.clear();history.clear();project.cuts.forEach(c=>c.items=[]);document.querySelectorAll('#scene,#cut-grid canvas,#full-preview canvas,#brush-canvas,#paper-preview').forEach(c=>c.getContext('2d')?.clearRect(0,0,c.width,c.height));$('full-preview').replaceChildren();clearExportImage();requestedExport=null;});window.addEventListener('pageshow',event=>{if(event.persisted){active=0;selected=null;step='background';render();initSegmenter().catch(()=>{});}});
window.addEventListener('beforeunload',e=>{if(isDirty()){e.preventDefault();e.returnValue='';}});
async function boot(){syncClassroomMode();try{const saved=await readSaved();if(saved){for(const b of saved.backgrounds||[])backgrounds.push({...b,url:URL.createObjectURL(b.blob),builtIn:false});project=newProject(saved.preset);settings={...settings,...Object.fromEntries(Object.entries(saved.preset).filter(([k])=>['timer','sound','mission','customMissions','lockBackground'].includes(k)))};if(saved.logo){logo=await readPhoto(saved.logo);logoBlob=saved.logo;}presetStatus='저장해 둔 배경과 설정을 불러왔어요.';}}catch{presetStatus='기기 저장소를 사용할 수 없어 이번 사용 중에만 설정을 유지해요.';}syncFields();render();initSegmenter().catch(()=>message('인물 오리기 준비를 완료하지 못했어요. 다시 준비하거나 원본 모드로 사용할 수 있어요.'));}
boot();
import {enableBrush,checkReadiness} from './extras.mjs?v=scrapbook-flow';
enableBrush({getItem:item,getAsset:id=>assets.get(id),notify:message,apply:mask=>{const it=item(),a=currentAsset();if(!it||!a?.mask)throw Error('인물을 다시 선택해 주세요.');const image=makeCutout(a.source,mask,a.mw,a.mh,it.softness),id=uid();record();assets.set(id,{...a,mask:mask.slice(),image,w:image.width,h:image.height});it.scale*=a.w/image.width;it.assetId=id;cleanAssets();render();}});
const readinessActions={
 '브라우저 기본 기능':{hint:'지원되는 최신 브라우저에서 다시 열어 주세요.'},
 '카메라 기능':{hint:'카메라 지원 여부와 브라우저 권한을 확인하거나 사진을 불러오세요.',label:'촬영 화면으로',target:'camera'},
 '인물 오리기 모델':{hint:'인물 오리기 준비 상태를 다시 확인해 주세요.',label:'모델 준비 확인',target:'model'},
 '앱 파일':{hint:'인터넷 연결을 확인하고 오프라인 파일을 다시 준비해 주세요.',label:'오프라인 준비 설정',target:'offline'},
 '모델 파일':{hint:'인터넷 연결을 확인하고 오프라인 파일을 다시 준비해 주세요.',label:'오프라인 준비 설정',target:'offline'},
 'WASM 파일':{hint:'인터넷 연결을 확인하고 오프라인 파일을 다시 준비해 주세요.',label:'오프라인 준비 설정',target:'offline'},
 '오프라인 준비':{hint:'오프라인 사용은 선택 사항입니다. 업데이트 후에는 인터넷에 연결해 파일을 다시 준비해 주세요.',label:'오프라인 준비 설정',target:'offline'},
 '저장 공간':{hint:'기기 저장 공간과 브라우저 설정을 확인해 주세요. 기기에 저장하지 않고 이번 사용을 계속할 수도 있어요.',label:'기기 저장 설정',target:'offline'},
 '선택한 배경':{hint:'배경을 다시 선택하거나 배경 보관함을 확인해 주세요.',label:'배경 설정으로',target:'background'}
};
function goToReadinessTarget(target){$('ready-dialog').close();if(target==='camera'){setStep('camera');$('start-camera').focus();}else if(target==='model'){$('model-status').focus();$('model-status').scrollIntoView({block:'center'});}else if(target==='offline'||target==='background'){teacherSync();const section=$(target==='offline'?'teacher-preparation':'teacher-background');section.open=true;$('teacher-dialog').showModal();const destination=$(target==='offline'?'offline-prepare':'background-input');const focusTarget=target==='background'?section.querySelector('summary'):destination;section.scrollIntoView({block:'start'});if(focusTarget?.focus)focusTarget.focus();}}
on('check-ready','click',safe(async()=>{$('ready-dialog').showModal();$('ready-summary').textContent='준비 상태를 확인하고 있어요.';$('ready-list').textContent='확인 중...';const b=backgrounds.find(x=>x.id===cut().background);const checks=await checkReadiness(b?.url||'./assets/backgrounds/space.svg',prepared,import.meta.url);const offline=await offlineState();checks.push(['오프라인 준비',offline.prepared]);if(navigator.storage?.estimate){try{const estimate=await navigator.storage.estimate();if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage))checks.push(['저장 공간',estimate.quota-estimate.usage>30*1024*1024]);}catch{}}$('ready-summary').textContent=checks.every(([name,ok])=>ok||name==='오프라인 준비')?'기본 준비 항목을 확인했어요. 카메라는 직접 시험해 주세요.':'일부 항목을 확인해 주세요. 오프라인 준비는 선택 사항입니다.';const list=document.createElement('ul');for(const [name,ok] of checks){const li=document.createElement('li');const status=document.createElement('span');status.textContent=ok?(name==='카메라 기능'?'✓ 브라우저 기능 지원 · 카메라 (실제 영상 확인 필요)':name==='저장 공간'?'✓ 여유 공간 추정 · 저장 공간 (실제 저장은 별도 확인)':'✓ 확인됨 · '+name):'확인 필요 · '+name;li.append(status);if(!ok){const action=readinessActions[name];if(action){const hint=document.createElement('p');hint.textContent=action.hint;li.append(hint);if(action.target){const button=document.createElement('button');button.type='button';button.className='button compact';button.textContent=action.label;button.onclick=()=>goToReadinessTarget(action.target);li.append(button);}}}list.append(li);}$('ready-list').replaceChildren(list);}));
import {createBundle,validateBundle} from './preset-bundle.mjs?v=background-gallery';
on('bundle-export','click',safe(async()=>{const b=await createBundle({...presetOf(project,settings),lockBackground:settings.lockBackground},backgrounds.filter(x=>!x.builtIn),logoBlob);const url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download='상상네컷_수업설정.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);message('설정 묶음을 만들었어요. 학생 촬영 사진은 포함되지 않아요.');}));
on('bundle-input','change',safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>70*1024*1024)throw Error('설정 파일은 70MB 이하여야 해요.');let data;try{data=JSON.parse(await file.text());}catch{throw Error('설정 파일을 읽을 수 없어요.');}const bundle=validateBundle(data);for(const bg of bundle.backgrounds)await readPhoto(bg.blob);const newLogo=bundle.logo?await readPhoto(bundle.logo):null;if(!await confirmAction('수업 설정을 가져올까요?','현재 배경과 문구, 촬영 설정을 가져온 내용으로 바꿉니다. 촬영 사진은 유지되며 편집 취소 기록은 비워집니다. 기기에 영구 저장하려면 설정 저장을 눌러 주세요.'))return;applyLessonSnapshot(bundle, newLogo, {replaceBackgrounds:true});message('설정을 가져왔어요. 촬영 사진은 그대로 유지돼요.');}));
on('offline-prepare','click',safe(async()=>{if(!('serviceWorker' in navigator)){message('이 브라우저에서는 오프라인 준비를 지원하지 않아요.');return;}const button=$('offline-prepare');button.disabled=true;$('offline-status').textContent='필요한 파일을 저장하고 있어요. 인터넷 연결을 유지해 주세요.';try{const reg=await navigator.serviceWorker.register('./sw.js');const ready=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('오프라인 준비가 지연되고 있어요.')),20000))]);const worker=await currentOfflineWorker(reg);if(!worker)throw Error('새 버전의 오프라인 기능을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');const result=await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(Error('파일 저장에 시간이 오래 걸려요. 다시 시도해 주세요.')),180000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage({type:'PREPARE'},[channel.port2]);});if(!result.ok)throw Error(result.message);$('offline-status').textContent='기본 배경과 모델 파일을 이 브라우저에 저장했어요. 인터넷을 끄고 미리 시험해 주세요. 직접 추가한 배경은 기기에 설정을 저장해야 유지돼요.';}catch(e){$('offline-status').textContent='오프라인 파일을 모두 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요. '+e.message;}finally{button.disabled=false;}}));

let adjusting=false;
for(const name of ['brightness','contrast','saturation']){const control=$(`adjust-${name}`);control.addEventListener('pointerdown',()=>{if(!control.disabled){record();adjusting=true;}});control.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&!adjusting){record();adjusting=true;}});control.addEventListener('input',()=>{if(!adjusting){record();adjusting=true;}cut().adjustment={...normalizeAdjustment(cut().adjustment),[name]:Number(control.value)};$(name+'-value').textContent=control.value+'%';drawCut($('scene'),cut(),assets,backgrounds,{selected}).catch(e=>message(e.message));renderCutButtons();});control.addEventListener('change',()=>{adjusting=false;render();});}
on('adjust-reset','click',()=>mutate(()=>{cut().adjustment=normalizeAdjustment();}));on('adjust-all','click',()=>{if(!personItems(cut()).length)return;const value=normalizeAdjustment(cut().adjustment);mutate(()=>project.cuts.slice(0,project.count||4).forEach(c=>c.adjustment={...value}));message('현재 색감을 모든 컷에 적용했어요.');});

const colorPresets={basic:{brightness:100,contrast:100,saturation:100},bright:{brightness:115,contrast:100,saturation:100},vivid:{brightness:100,contrast:110,saturation:120}};
document.querySelectorAll('[data-color-preset]').forEach(button=>button.addEventListener('click',()=>{if(!personItems(cut()).length)return;mutate(()=>{cut().adjustment={...colorPresets[button.dataset.colorPreset]};});}));
let comparing=false;
function comparePhoto(show){if(!personItems(cut()).length||busy)return;comparing=show;$('compare-adjust').setAttribute('aria-pressed',String(show));const displayCut=show?{...cut(),adjustment:normalizeAdjustment()}:cut();drawCut($('scene'),displayCut,assets,backgrounds,{selected,placeholder:true}).catch(e=>message(e.message));}
const compare=$('compare-adjust');compare.addEventListener('pointerdown',e=>{e.preventDefault();compare.setPointerCapture(e.pointerId);comparePhoto(true);});for(const type of ['pointerup','pointercancel','lostpointercapture'])compare.addEventListener(type,()=>{if(comparing)comparePhoto(false);});compare.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();comparePhoto(true);}});compare.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();comparePhoto(false);}});compare.addEventListener('blur',()=>{if(comparing)comparePhoto(false);});compare.addEventListener('click',e=>{if(e.detail===0)comparePhoto(!comparing);});

function renderFinishControls() {
  const count = project.count || 4;
  const remaining = project.cuts.slice(0, count).filter(c => !personItems(c).length).length;
  const complete = remaining === 0;
  $('finish-title').textContent = complete ? '우리만의 사진, 완성!' : '전체 사진 미리보기';
  $('finish-preview-note').textContent = complete ? '저장본과 같은 배열이에요' : '촬영한 컷을 먼저 확인해요';
  $('save-status').textContent = complete
    ? `${count}컷이 모두 준비됐어요. PNG로 저장하거나 인쇄해 주세요.`
    : `${remaining}컷 더 찍으면 저장할 수 있어요.`;
  $('fill-missing').hidden = complete;
  $('fill-missing').disabled = busy || running;
  $('export-options').hidden = !complete;
  for (const id of ['download', 'download-small', 'export-view', 'print-photo']) {
    $(id).disabled = busy || running || !complete;
  }
  $('export-status').hidden = !complete;
  $('export-status').textContent = exportIsCurrent(requestedExport)
    ? `${requestedExport.small ? '작은 PNG' : '고화질 PNG'} 저장을 요청했어요. 기기에서 파일을 확인해 주세요.`
    : '고화질 또는 작은 PNG로 저장하거나, 이미지를 직접 열 수 있어요.';
  if (!complete) clearPaperPreview();
}

function updateMobileAction() {
  let target = 'go-camera';
  if (step === 'camera') {
    target = running ? 'stop-capture' : stream ? 'capture' : cameraFailed ? 'photo-browse' : 'start-camera';
  } else if (step === 'edit') {
    target = 'next-cut';
  } else if (step === 'finish') {
    target = isComplete(project) ? 'download' : 'fill-missing';
  }
  const entry = $(target);
  const button = $('mobile-action');
  if (button.dataset.target !== target) {
    $(button.dataset.target)?.removeAttribute('data-mobile-proxy');
    entry.setAttribute('data-mobile-proxy', '');
    button.dataset.target = target;
  }
  button.textContent = entry.textContent;
  button.disabled = entry.disabled || (busy && target !== 'stop-capture');
}

on('mobile-action', 'click', () => {
  const target = $('mobile-action').dataset.target;
  const control = $(target);
  if (control && !control.disabled) control.click();
});
mobileLayout.addEventListener('change', placeBackgroundPicker);

async function offlineState(){try{if(!('serviceWorker' in navigator))return{prepared:false};const reg=await navigator.serviceWorker.getRegistration('./');const worker=reg?.active;if(!worker)return{prepared:false};return await new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve({prepared:false});},1500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();const result=e.data;resolve({prepared:!!result?.prepared&&result.version===OFFLINE_VERSION});};worker.postMessage({type:'STATUS'},[channel.port2]);});}catch{return{prepared:false};}}
async function refreshOfflineNotice(){const state=await offlineState();$('offline-status').textContent=state.prepared?'이 버전의 오프라인 파일이 준비되어 있어요. 실제 기기에서 인터넷 없이 시험해 주세요.':'이 버전의 오프라인 파일이 준비되지 않았거나 확인되지 않았어요. 오프라인 사용 전 인터넷에 연결해 준비해 주세요.';}
function renderRetakes(){const root=$('retake-list');root.replaceChildren();project.cuts.slice(0,project.count||4).forEach((c,i)=>{if(!personItems(c).length)return;const b=document.createElement('button');b.type='button';b.className='button compact';b.textContent=`${i+1}번 컷 다시 찍기`;b.disabled=busy||running;b.onclick=()=>{active=i;selected=personItems(c)[0].id;replaceTarget=selected;sourceMode='append';setStep('camera');message('새 사진을 확정하기 전까지 기존 인물은 유지돼요.');};root.append(b);});}
function clearPaperPreview() {
  const paper = $('paper-preview');
  paper.hidden = true;
  paper.width = paper.height = 0;
}

function renderPaperPreview() {
  const photo = $('full-preview').querySelector('canvas');
  const complete = isComplete(project);
  $('paper-unavailable').hidden = complete;
  if (!complete || !photo || step !== 'finish') {
    clearPaperPreview();
    return;
  }
  const paper = getPrintLayout($('print-paper').value, $('print-copies').value);
  const preview = $('paper-preview');
  drawPaperPreview(preview, photo, paper);
  preview.setAttribute('aria-label', `${paper.cssSize} 용지에 완성 사진 ${paper.copies}장 예상 배치`);
  preview.hidden = false;
}
for(const id of ['print-paper','print-copies'])on(id,'change',renderPaperPreview);

async function currentOfflineWorker(reg){for(let i=0;i<20;i++){const worker=reg.active;if(worker){const result=await new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage({type:'STATUS'},[channel.port2]);});if(result?.version===OFFLINE_VERSION)return worker;}await new Promise(resolve=>setTimeout(resolve,250));}return null;}

function syncClassroomMode() {
  document.body.toggleAttribute('data-classroom-mode', classroomMode);
  $('classroom-mode-label').hidden = !classroomMode;
  $('classroom-mode-exit').hidden = !classroomMode;
}

function changeClassroomMode(value) {
  classroomMode = value;
  try { localStorage.setItem(classroomModeKey, value ? 'on' : 'off'); } catch {}
  syncClassroomMode();
}

on('classroom-mode-enter', 'click', () => {
  changeClassroomMode(true);
  $('teacher-dialog').close();
  $('stage-title').focus({preventScroll:true});
  scrollToStage();
  message('학생용 수업 모드를 시작했어요.');
});
on('classroom-mode-exit', 'click', safe(async () => {
  if (!await confirmAction('수업 모드를 종료할까요?', '교사 설정을 다시 열 수 있어요. 현재 사진은 유지됩니다.')) return;
  changeClassroomMode(false);
  openTeacherSettings();
}));

function updateLessonControls() {
  const selectedLesson = $('lesson-list').value;
  for (const id of ['lesson-name', 'lesson-save']) $(id).disabled = lessonWorking;
  $('lesson-list').disabled = lessonWorking || !lessonNames.length;
  $('lesson-load').disabled = lessonWorking || !selectedLesson;
  $('lesson-delete').disabled = lessonWorking || !selectedLesson;
}

async function refreshLessons(preferred = $('lesson-list').value) {
  lessonNames = await listLessons();
  const list = $('lesson-list');
  list.replaceChildren(new Option(
    lessonNames.length ? '설정을 선택해 주세요' : '저장한 설정이 없어요', ''
  ), ...lessonNames.map(name => new Option(name, name)));
  if (lessonNames.includes(preferred)) list.value = preferred;
  updateLessonControls();
}

function withLessonStorage(task) {
  return async event => {
    event?.preventDefault();
    if (lessonWorking) return;
    lessonWorking = true;
    updateLessonControls();
    try {
      await task();
    } catch (error) {
      $('lesson-status').textContent = error.message || '기기 저장 공간을 확인해 주세요.';
    } finally {
      lessonWorking = false;
      updateLessonControls();
    }
  };
}

function applyLessonSnapshot(saved, newLogo, {replaceBackgrounds = false} = {}) {
  const incoming = saved.backgrounds || [];
  const incomingIds = new Set(incoming.map(b => b.id));
  const existing = backgrounds.filter(b => !b.builtIn);
  const keep = replaceBackgrounds ? [] : existing.filter(b => !incomingIds.has(b.id));
  if (keep.length + incoming.length > 20) {
    throw Error('보관함에 배경이 너무 많아요. 배경과 로고에서 사용하지 않는 배경을 정리해 주세요.');
  }
  const loaded = incoming.map(b => ({...b, url: URL.createObjectURL(b.blob), builtIn:false}));
  for (const background of existing) {
    if (replaceBackgrounds || incomingIds.has(background.id)) {
      forgetImage(background.url);
      URL.revokeObjectURL(background.url);
    }
  }
  backgrounds.splice(0, backgrounds.length, ...backgrounds.filter(b => b.builtIn), ...keep, ...loaded);
  const preset = saved.preset;
  for (const key of ['count', 'layout', 'frame', 'frameStyle', 'caption', 'subtitle', 'school', 'date']) {
    project[key] = preset[key];
  }
  project.cuts.forEach((current, i) => { current.background = preset.backgrounds[i]; });
  for (const key of ['timer', 'sound', 'mission', 'lockBackground', 'customMissions']) settings[key] = preset[key];
  logo = newLogo;
  logoBlob = saved.logo;
  active = Math.min(active, project.count - 1);
  selected = replaceTarget = null;
  sourceMode = 'append';
  history.clear();
  cleanAssets();
  teacherSync();
  render();
}

on('lesson-list', 'change', updateLessonControls);
on('lesson-form', 'submit', withLessonStorage(async () => {
  const name = $('lesson-name').value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name) throw Error('설정 이름을 입력해 주세요.');
  const replace = lessonNames.includes(name);
  if (replace && !await confirmAction('같은 이름으로 저장할까요?', `‘${name}’ 설정을 현재 값으로 바꿉니다.`)) return;
  const preset = {...presetOf(project, settings), lockBackground: settings.lockBackground};
  const selectedIds = new Set(preset.backgrounds);
  const chosen = backgrounds.filter(b => !b.builtIn && selectedIds.has(b.id))
    .map(({id, name, blob}) => ({id, name, blob}));
  await saveLesson(name, preset, chosen, logoBlob, {replace});
  await refreshLessons(name);
  $('lesson-status').textContent = `‘${name}’ 설정을 이 기기에 저장했어요.`;
}));

on('lesson-load', 'click', withLessonStorage(async () => {
  const name = $('lesson-list').value;
  if (!name) return;
  const saved = await getLesson(name);
  if (!saved) {
    await refreshLessons();
    throw Error('선택한 수업 설정이 목록에서 없어졌어요.');
  }
  if (isDirty() && !await confirmAction('이 수업 설정을 적용할까요?', '현재 사진은 유지되며 배경과 꾸미기 설정이 바뀌고 실행 취소 기록은 비워져요.')) return;
  const newLogo = saved.logo ? await readPhoto(saved.logo) : null;
  applyLessonSnapshot(saved, newLogo);
  $('lesson-status').textContent = `‘${name}’ 설정을 적용했어요.`;
}));

on('lesson-delete', 'click', withLessonStorage(async () => {
  const name = $('lesson-list').value;
  if (!name || !await confirmAction('수업 설정을 삭제할까요?', `‘${name}’ 설정을 이 기기에서 지웁니다.`)) return;
  await deleteLesson(name);
  await refreshLessons();
  $('lesson-status').textContent = `‘${name}’ 설정을 삭제했어요.`;
}));
updateLessonControls();
