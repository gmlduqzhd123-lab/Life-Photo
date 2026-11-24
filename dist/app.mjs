import {BACKGROUND_FILTERS,BUILT_IN_BACKGROUNDS,listBackgrounds,searchBackgrounds} from './background-catalog.mjs?v=mobile-ux';
import {normalizeAdjustment} from './photo-adjust.mjs';
import {createPrintPdf} from './print-pdf.mjs?v=classroom-output';
import {paintStroke} from './brush.mjs';
import {CUT_W,CUT_H,MISSIONS,uid,clamp,newProject,personItems,addItem,arrangePeople,exportSpec,hitItem,moveItem,History,isComplete,getPrintLayout,presetOf,nextEmptyCut,defaultStickerScale,photographedProject,MAX_STICKERS,emptyCutIndices,swapVisibleCuts,originalPerson} from './core.mjs?v=classroom-review';
import {drawCut,renderProject,loadImage,makeDecoration,forgetImage,drawPaperPreview,cover} from './render.mjs?v=classroom-review';
import {readPhoto,inspectPhoto,makeCutout} from './image-tools.mjs?v=classroom-recovery';
import {initSegmenter,segmentPhoto,resetSegmenter,setStatusListener} from './segment-client.mjs';
import {readSaved,saveSettings,clearSaved,listLessons,getLesson,saveLesson,deleteLesson,readClassroom,clearClassroom,saveClassroom} from './storage.mjs?v=classroom-recovery';

const $=id=>document.getElementById(id),on=(id,event,fn)=>$(id).addEventListener(event,fn);
const assets = new Map();
const backgrounds = [...BUILT_IN_BACKGROUNDS];
let themeFilter = 'recommended';
let showFavorites = false;
let showAllBackgrounds = false;
let backgroundUndo = null;
let project=newProject(),active=0,selected=null,step='background',history=new History(),settings={timer:3,sound:false,mission:true,customMissions:[],lockBackground:false};
let printUrl=null,cameraEpoch=0,busy=false,cancelEpoch=0,stream=null,facing='user',running=false,replaceTarget=null,sourceMode='append',toastTimer,logo=null,logoBlob=null,presetStatus='',renderVersion=0,previewTimer,prepared=false,downloadUrl=null,gesture=null;
let preparedExport = null;
let requestedExport = null;
const pointers = new Map();
const classroomModeKey = 'booth-classroom-mode';
let classroomMode = false;
let lessonNames = [];
let lessonWorking = false;
let loadedLesson = null;
let groupStartPreset = null;
let importReport = null;
let pendingImportRetry = null;
try { classroomMode = localStorage.getItem(classroomModeKey) === 'on'; } catch {}
const mobileLayout = matchMedia('(max-width: 720px)');
let cameraFailed = false;
let cameraConnecting = false;
let cameraDelayed = false;
let cameraWaitTimer;
let previewRevision = 0;
const OFFLINE_VERSION='imagine-four-offline-v15';let favorites=new Set();try{favorites=new Set(JSON.parse(localStorage.getItem('booth-favorite-backgrounds')||'[]'));}catch{}
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
    selected = replaceTarget = null;
    sourceMode = 'append';
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
  positionBackgroundGallery();
}

function positionBackgroundGallery() {
  const compact = mobileLayout.matches && step === 'background' && themeFilter === 'recommended'
    && !showFavorites && !showAllBackgrounds && !$('background-search').value.trim();
  const heading = $('background-heading').parentElement;
  const search = $('background-search').parentElement;
  const row = $('background-current').parentElement;
  const results = $('background-results');
  const grid = $('background-grid');
  if (compact) {
    if (heading.nextElementSibling !== row) heading.after(row, grid, results);
  } else if (search.nextElementSibling !== results) {
    search.after(results, row, grid);
  }
}

function choosePhotoCut(index, {showActions = true} = {}) {
  if (busy || running) return;
  if (showActions && step === 'finish' && personItems(project.cuts[index]).length) {
    openCutActions(index);
    return;
  }
  active = index;
  selected = null;
  replaceTarget = null;
  sourceMode = 'append';
  setStep(personItems(cut()).length ? 'edit' : 'camera', {focusHeading: false});
  scrollToStage();
  const focusTarget = showActions && !mobileLayout.matches ? $('cut-grid').children[index] : $('stage-title');
  focusTarget?.focus({preventScroll: true});
  $('cut-announcement').textContent = personItems(cut()).length
    ? `${index + 1}번 컷을 선택했어요. 사진을 꾸밀 수 있어요.`
    : `${index + 1}번 컷을 선택했어요. 이 컷을 찍거나 사진을 불러오세요.`;
}

function placeCutStrip() {
  const atFinish = step === 'finish';
  const section = $('cuts-section');
  const host = $(atFinish ? 'finish-cuts-slot' : 'main-cuts-slot');
  if (section.parentElement !== host) host.append(section);
  $('show-finish').hidden = atFinish;
  $('finish-cut-hint').hidden = !atFinish;
}

function startRetake(index, stickerId) {
  active = index;
  selected = replaceTarget = stickerId;
  sourceMode = 'append';
  cameraFailed = false;
  $('camera-error').hidden = true;
  setStep('camera');
  $('stage-title').focus({preventScroll: true});
  message('새 사진을 확정하기 전까지 기존 인물은 유지돼요.');
}

function retakeGuide() {
  const people = personItems(cut());
  const position = people.findIndex(person => person.id === replaceTarget);
  const target = (active + 1) + '번 컷' + (people.length > 1 && position >= 0 ? ' · 인물 ' + (position + 1) : '');
  return target + ' 다시 찍기 · 사진을 불러와 바꿀 수도 있어요.';
}

function openCutActions(index) {
  const dialog = $('cut-action-dialog');
  const people = personItems(project.cuts[index]);
  $('cut-action-title').textContent = (index + 1) + '번 컷';
  $('edit-picked-cut').hidden = step === 'edit';
  const ordering = step === 'finish';
  $('cut-order-actions').hidden = !ordering;
  for (const [id, offset] of [['cut-move-earlier',-1], ['cut-move-later',1]]) {
    const button = $(id);
    const destination = index + offset;
    button.disabled = !ordering || destination < 0 || destination >= project.count;
    button.onclick = () => {
      if (button.disabled || busy || running) return;
      dialog.close();
      mutate(() => {
        if (!swapVisibleCuts(project,index,destination)) return;
        active = destination;
        selected = null;
      });
      $('cut-grid').children[destination]?.focus({preventScroll:true});
      $('cut-announcement').textContent = (index + 1) + '번 컷을 ' + (destination + 1) + '번으로 옮겼어요.';
    };
  }
  $('edit-picked-cut').onclick = () => {
    dialog.close();
    choosePhotoCut(index, {showActions: false});
  };
  $('cut-retake-options').replaceChildren(...people.map((person, position) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button retake-person';
    const title = document.createElement('span');
    title.textContent = people.length === 1 ? '다시 찍기' : '인물 ' + (position + 1) + ' 다시 찍기';
    button.append(stickerThumbnail(person), title);
    button.onclick = () => {
      dialog.close();
      startRetake(index, person.id);
    };
    return button;
  }));
  dialog.showModal();
}

function captureCut(index) {
  active = index;
  selected = replaceTarget = null;
  sourceMode = 'append';
  setStep('camera');
}

function fillMissingCut() {
  const index = nextEmptyCut(project, active);
  if (index >= 0) captureCut(index);
}

function continueProject() {
  if (isComplete(project)) setStep('finish');
  else fillMissingCut();
}

function confirmAction(title,text,{yesLabel='확인',noLabel='취소'}={}){return new Promise(resolve=>{$('confirm-title').textContent=title;$('confirm-message').textContent=text;$('confirm-yes').textContent=yesLabel;$('confirm-no').textContent=noLabel;const dialog=$('confirm-dialog');let done=false;const finish=value=>{if(done)return;done=true;dialog.close();$('confirm-yes').onclick=null;$('confirm-no').onclick=null;dialog.removeEventListener('cancel',cancel);resolve(value);};const cancel=e=>{e.preventDefault();finish(false);};$('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);dialog.addEventListener('cancel',cancel);dialog.showModal();});}
function errorChoice(text){return new Promise(resolve=>{const d=$('error-dialog');$('error-message').textContent=text;let done=false;const finish=value=>{if(done)return;done=true;d.close();d.removeEventListener('cancel',cancel);resolve(value);};const cancel=e=>{e.preventDefault();finish('cancel');};$('error-retry').onclick=()=>finish('retry');$('error-original').onclick=()=>finish('original');$('error-cancel').onclick=()=>finish('cancel');d.addEventListener('cancel',cancel);d.showModal();});}
function chooseBackground(background) {
  if (busy || running || settings.lockBackground) return;
  const all = $('all-backgrounds').checked;
  const targets = all ? project.cuts.slice(0, project.count || 4) : [cut()];
  if (targets.every(current => current.background === background.id)) return;
  mutate(() => { for (const current of targets) current.background = background.id; });
  backgroundUndo = history.past.at(-1);
  $('background-applied-status').textContent = all
    ? targets.length + '컷에 적용됨' : (active + 1) + '번 컷에 적용됨';
  renderBackgroundFeedback();
}

function renderBackgroundFeedback() {
  const available = !!backgroundUndo && backgroundUndo === history.past.at(-1);
  $('background-applied').hidden = !available;
  $('background-undo').disabled = busy || running;
}

on('background-undo', 'click', () => {
  if (backgroundUndo === history.past.at(-1)) $('undo').click();
  $('background-all').focus({preventScroll:true});
});

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
  positionBackgroundGallery();
  const query = $('background-search').value.trim();
  const collection = showFavorites ? listBackgrounds(backgrounds, 'favorites', favorites) : backgrounds;
  const grouped = showAllBackgrounds && !query;
  const choices = query ? searchBackgrounds(collection, query) : showFavorites || grouped
    ? collection : listBackgrounds(backgrounds, themeFilter, favorites);
  grid.toggleAttribute('data-grouped', grouped);
  const themeName = BACKGROUND_FILTERS.find(([id]) => id === themeFilter)?.[1];
  $('background-heading').textContent = showFavorites ? '즐겨찾기 배경' : query ? '배경 검색 결과' : grouped ? '전체 배경' : themeName;
  $('background-results').hidden = !query;
  $('background-results').textContent = '검색 결과 ' + choices.length + '개';
  $('background-search-clear').hidden = !$('background-search').value;
  if (grouped) {
    const groups = document.createDocumentFragment();
    for (const [id, title] of BACKGROUND_FILTERS) {
      if (id === 'recommended') continue;
      const matches = listBackgrounds(choices, id, favorites);
      if (!matches.length) continue;
      const section = document.createElement('section');
      section.className = 'background-collection';
      const heading = document.createElement('h3');
      heading.textContent = title;
      section.append(heading, ...matches.map(backgroundCard));
      groups.append(section);
    }
    grid.replaceChildren(groups);
  } else grid.replaceChildren(...choices.map(backgroundCard));
  $('background-all').setAttribute('aria-pressed', String(grouped));
  $('background-all').textContent = grouped ? '추천 배경 보기' : '전체 배경 보기';
  const favoriteFilter = $('background-favorites');
  favoriteFilter.setAttribute('aria-pressed', String(showFavorites));
  $('background-theme').value = themeFilter;
  $('background-count').textContent = `${backgrounds.length}가지 배경`;
  const current = backgrounds.find(b => b.id === cut().background);
  $('background-current').textContent = `현재 배경 · ${current?.name || '우주 탐험'}`;
  $('background-fit').value = cut().fit;

  const empty = $('background-empty');
  empty.hidden = choices.length > 0;
  empty.textContent = query ? '찾는 배경이 없어요. 다른 키워드를 입력해 보세요.' : showFavorites
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
  $('background-search').value = '';
  showFavorites = showAllBackgrounds = false;
  updateBackgroundFilter();
});
on('background-favorites', 'click', () => {
  showFavorites = !showFavorites;
  showAllBackgrounds = false;
  $('background-search').value = '';
  updateBackgroundFilter();
});
on('background-all', 'click', () => {
  showAllBackgrounds = !showAllBackgrounds || !!$('background-search').value;
  showFavorites = false;
  $('background-search').value = '';
  if (!showAllBackgrounds) themeFilter = 'recommended';
  updateBackgroundFilter();
});
on('background-search', 'input', updateBackgroundFilter);
on('background-search-clear', 'click', () => {
  $('background-search').value = '';
  $('background-search').focus();
  updateBackgroundFilter();
});

async function render(){syncFields();placeBackgroundPicker();placeCutStrip();document.body.dataset.stage=step;$('edit-near-photo').hidden=step!=='edit';const version=++renderVersion;document.getElementById("full-preview-section").hidden=step!=='finish';const stageTitles={background:'상상 속으로 떠나볼까요',camera:'우리의 순간을 담아요',edit:'스티커처럼 자유롭게',finish:isComplete(project)?'반짝이는 사진을 완성했어요':'촬영 진행 상태를 확인해요'};$('cut-label').textContent=`${active+1}번째 컷`;$('stage-title').textContent=stageTitles[step];$('camera-guide').textContent=replaceTarget?retakeGuide():`${active+1}번째 컷을 찍어요. 카메라를 보고 포즈를 취해요.`;$('next-cut').textContent=isComplete(project)?'완성 사진 보기':personItems(cut()).length?'다음 빈 컷 찍기':'이 컷 찍기';const examples=project.cuts.some(current=>current.items.some(item=>item.example));$('finish-example').hidden=!examples;$('example-transition').hidden=!examples||step==='finish';$('leave-example-finish').hidden=!examples;document.querySelectorAll('[data-step]').forEach(b=>{const is=b.dataset.step===step;b.classList.toggle('active',is);if(is)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});for(const s of ['background','camera','edit','finish'])$(`${s}-tools`).hidden=s!==step;$('scene-background').textContent=backgrounds.find(b=>b.id===cut().background)?.name||'나만의 배경';$('example-tag').hidden=!cut().items.some(i=>i.example);$('scene-tip').textContent=step==='camera'?'촬영 후 인물만 오려서 붙여요':step==='edit'?'스티커를 누르고 움직여 보세요':'사진 속 우리를 이 배경에 붙여요';$('scene-tip').hidden=busy||step==='finish';$('mission').textContent=settings.customMissions[active]||MISSIONS[active];$('mission').hidden=!settings.mission;renderBackgrounds();renderCutButtons();renderControls();renderItemControls();drawImportReport();await drawCut($('scene'),cut(),assets,backgrounds,{selected,placeholder:true});if(version!==renderVersion)return;if(step==='finish')schedulePreview();}
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
    button.setAttribute('aria-label', `${index + 1}번 컷 · ${hasPhoto ? (step === 'finish' ? '사진 있음, 꾸미기 또는 다시 찍기' : '사진 있음, 꾸미기') : '사진 없음, 촬영'}`);
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
  renderClassroomProgress(filled, count);
  $('progress').textContent = `${filled} / ${count}`;
  $('progress-bar').style.width = `${filled / count * 100}%`;
}

function renderControls(){
 renderLessonSummary();
 syncHandoff();
 $('import-result-close').disabled = busy || running;
 for (const button of $('import-failure-list').querySelectorAll('button')) button.disabled = busy || running || button.dataset.missingCut === 'true';
 $('leave-example').disabled = $('leave-example-finish').disabled = busy || running;
 renderBackgroundFeedback();
 document.querySelectorAll('#cut-grid button').forEach(b=>b.disabled=busy||running);document.querySelectorAll('#background-grid button').forEach(b=>b.disabled=busy||running||settings.lockBackground);$('all-backgrounds').disabled=$('current-background-only').disabled=busy||running||settings.lockBackground;$('undo').disabled=busy||running||!history.past.length;$('redo').disabled=busy||running||!history.future.length;renderFinishControls();$('capture').textContent=`${settings.timer}초 후 촬영`;$('auto-capture').textContent=`${project.count||4}컷 연속 촬영`;$('capture').disabled=!stream||cameraConnecting||busy||running;$('start-camera').hidden=!!stream;$('start-camera').disabled=cameraConnecting||busy||running;$('keep-camera').disabled=busy||running;$('stop-camera').hidden=!stream;$('switch-camera').disabled=!stream||cameraConnecting||busy||running;$('auto-capture').disabled=!stream||cameraConnecting||busy||running||!!replaceTarget;$('stop-capture').hidden=!running;$('photo-input').disabled=busy||running;$('photo-browse').disabled=busy||running;for(const id of ['go-camera','demo-fill','teacher-open','add-person','retake','clear-cut','next-cut','show-finish','new-group'])$(id).disabled=busy||running;document.querySelectorAll('[data-step]').forEach(b=>b.disabled=busy||running);renderOriginalControls();$('background-fit').disabled=busy||settings.lockBackground;$('background-theme').disabled=busy||running;$('background-all').disabled=busy||running;$('background-favorites').disabled=busy||running;$('scene').setAttribute('aria-busy',String(busy));$('classroom-mode-exit').disabled=busy||running;updateMobileAction();}
function renderItemControls(){
  const peopleCount = personItems(cut()).length;
  $('people-limit').textContent = '인물 ' + peopleCount + '/' + MAX_STICKERS;
  $('add-person').textContent = peopleCount >= MAX_STICKERS ? '인물 교체' : '인물 추가';
  const canArrange=!cut().original&&peopleCount>1;$('cut-tools').hidden=!canArrange;$('arrange-people').disabled=busy||running||!canArrange;const adjustment=normalizeAdjustment(cut().adjustment);for(const name of ['brightness','contrast','saturation']){const control=$(`adjust-${name}`);control.value=adjustment[name];control.disabled=busy||!personItems(cut()).length;$(name+'-value').textContent=adjustment[name]+'%';}$('adjust-reset').disabled=busy||!personItems(cut()).length;const it=item(),a=currentAsset();$('selected-tools').hidden=$('item-transform').hidden=!it||cut().original;for(const id of ['item-front','item-back','item-center','item-duplicate','item-copy','item-delete','item-size','item-rotation','item-border','item-softness'])$(id).disabled=busy||!it;$('item-softness').disabled=busy||!a?.mask;$('item-transform-reset').disabled=busy||!a;if(it){$('item-size').value=Math.round(it.scale*100);$('item-rotation').value=Math.round(it.rotation);renderTransformValues();$('item-softness').value=Math.round(it.softness*100);$('item-border').checked=it.border;}$('retake').disabled=busy||running||!personItems(cut()).length;$('brush-open').disabled=busy||!a?.mask;renderItemPicker();}

function renderTransformValues() {
  $('item-size-value').textContent = $('item-size').value + '%';
  $('item-rotation-value').textContent = $('item-rotation').value + '°';
}

on('item-transform-reset', 'click', () => {
  const asset = currentAsset();
  if (!asset) return;
  selectedMutation(sticker => {
    sticker.scale = sticker.kind === 'person' ? defaultStickerScale(asset.w, asset.h) : 1;
    sticker.rotation = 0;
  });
});

function stickerThumbnail(sticker) {
  const canvas = document.createElement('canvas');
  canvas.width = 84;
  canvas.height = 62;
  canvas.setAttribute('aria-hidden', 'true');
  const asset = assets.get(sticker.assetId);
  if (!asset) return canvas;
  const scale = Math.min(canvas.width / asset.w, canvas.height / asset.h);
  const width = asset.w * scale;
  const height = asset.h * scale;
  canvas.getContext('2d').drawImage(asset.image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas;
}

function renderItemPicker() {
  const current = cut();
  const picker = $('item-picker');
  picker.hidden = step !== 'edit' || current.original || !current.items.length;
  if (picker.hidden) return;
  const list = $('item-list');
  const existing = new Map([...list.children].map(button => [button.dataset.stickerId, button]));
  let people = 0;
  let decorations = 0;
  for (const [position, sticker] of current.items.entries()) {
    let button = existing.get(sticker.id);
    if (button) existing.delete(sticker.id);
    else {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'item-chip';
      button.dataset.stickerId = sticker.id;
      button.onclick = () => { selected = sticker.id; render(); };
    }
    const label = sticker.kind === 'person'
      ? (sticker.example ? '예시 ' : '인물 ') + ++people : '장식 ' + ++decorations;
    if (button.dataset.assetId !== sticker.assetId || button.lastChild?.textContent !== label) {
      button.replaceChildren(stickerThumbnail(sticker), label);
      button.dataset.assetId = sticker.assetId;
    }
    button.disabled = busy || running;
    button.setAttribute('aria-pressed', String(sticker.id === selected));
    if (list.children[position] !== button) list.insertBefore(button, list.children[position] || null);
  }
  for (const unused of existing.values()) unused.remove();
}
function clearFinishPreview() {
  const parent = $('full-preview');
  const canvas = parent.firstElementChild;
  if (canvas) canvas.width = canvas.height = 0;
  parent.replaceChildren();
  clearPaperPreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  const revision = ++previewRevision;
  const version = renderVersion;
  previewTimer = setTimeout(safe(async () => {
    if (step !== 'finish') return;
    const output = photographedProject(project);
    if (!output.count) {
      clearFinishPreview();
      return;
    }
    const preview = await renderProject(output, assets, backgrounds, .28, logo);
    if (revision !== previewRevision || version !== renderVersion || step !== 'finish') {
      preview.width = preview.height = 0;
      return;
    }
    const previous = $('full-preview').firstElementChild;
    if (previous) previous.width = previous.height = 0;
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', output.count + '컷 저장본 미리보기');
    preview.dataset.cutCount = String(output.count);
    $('full-preview').replaceChildren(preview);
    renderPaperPreview();
  }), 120);
}

function cameraStatus(text = '') {
  const status = $('camera-connection');
  status.textContent = text;
  status.hidden = !text;
}

function stopCamera() {
  cameraEpoch++;
  clearTimeout(cameraWaitTimer);
  cameraConnecting = cameraDelayed = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $('camera').srcObject = null;
  $('camera').hidden = true;
  cameraStatus();
  renderControls();
}

function requestCamera(direction) {
  if (!navigator.mediaDevices?.getUserMedia) throw Error('이 브라우저에서는 카메라를 사용할 수 없어요.');
  return navigator.mediaDevices.getUserMedia({
    video: {facingMode:{ideal:direction},width:{ideal:1280},height:{ideal:960},aspectRatio:{ideal:4/3}},
    audio: false
  });
}

async function prepareVideo(video, input) {
  video.srcObject = input;
  let timeout;
  let ready;
  try {
    await Promise.race([
      (async () => {
        await video.play();
        if (!video.videoWidth && video.srcObject === input) {
          await new Promise(resolve => {
            ready = resolve;
            video.addEventListener('loadeddata', ready, {once:true});
          });
        }
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('카메라 영상을 준비하지 못했어요.')), 7000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
    if (ready) video.removeEventListener('loadeddata', ready);
  }
}

async function startCamera() {
  stopCamera();
  cameraFailed = false;
  $('camera-error').hidden = true;
  cameraConnecting = true;
  const request = ++cameraEpoch;
  const stillCurrent = () => request === cameraEpoch && !document.hidden && step === 'camera';
  cameraStatus('카메라 권한 응답을 기다리고 있어요.');
  renderControls();
  cameraWaitTimer = setTimeout(() => {
    if (!stillCurrent()) return;
    cameraDelayed = true;
    cameraStatus('연결이 늦어지고 있어요. 사진을 불러와 계속할 수 있어요.');
    renderControls();
  }, 5500);
  try {
    const input = await requestCamera(facing);
    if (!stillCurrent()) { input.getTracks().forEach(track => track.stop()); return; }
    stream = input;
    cameraStatus('카메라 영상을 연결하고 있어요.');
    const video = $('camera');
    await prepareVideo(video, input);
    if (!stillCurrent()) return;
    video.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
    video.hidden = false;
    cameraStatus();
  } catch (error) {
    if (!stillCurrent()) return;
    stopCamera();
    const hints = {NotAllowedError:'카메라 권한을 허용하거나 사진 불러오기를 이용해 주세요.',NotFoundError:'사용할 수 있는 카메라가 없어요. 사진을 불러와 계속할 수 있어요.',NotReadableError:'다른 앱에서 카메라를 쓰고 있을 수 있어요. 해당 앱을 닫고 다시 켜거나 사진을 불러와 주세요.'};
    cameraFailed = true;
    $('camera-error').textContent = hints[error.name] || '카메라를 열지 못했어요. 사진을 불러와 계속할 수 있어요.';
    $('camera-error').hidden = false;
  } finally {
    if (request === cameraEpoch) {
      clearTimeout(cameraWaitTimer);
      cameraConnecting = cameraDelayed = false;
      renderControls();
    } else if (cameraFailed) renderControls();
  }
}
let audio;
function beep(){if(!settings.sound)return;try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);gain.gain.value=.035;osc.frequency.value=700;osc.start();osc.stop(audio.currentTime+.1);}catch{}}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function countdown(epoch){$('countdown').hidden=false;try{for(let i=settings.timer;i>0;i--){if(epoch!==cancelEpoch||!stream)throw new DOMException('촬영 중단','AbortError');$('countdown').textContent=i;beep();await delay(1000);}if(epoch!==cancelEpoch||!stream)throw new DOMException('촬영 중단','AbortError');}finally{$('countdown').hidden=true;}}
function cameraFrame(v, mirror){const c=document.createElement('canvas');const w=v.videoWidth,h=v.videoHeight;if(!w||!h)throw Error('카메라가 준비된 뒤 다시 찍어 주세요.');const sw=Math.min(w,h*4/3),sh=Math.min(h,w*3/4),scale=Math.min(1,1600/sw);c.width=Math.round(sw*scale);c.height=Math.round(sh*scale);const ctx=c.getContext('2d');if(mirror){ctx.translate(c.width,0);ctx.scale(-1,1);}ctx.drawImage(v,(w-sw)/2,(h-sh)/2,sw,sh,0,0,c.width,c.height);return c;}
async function prepareSourceAsset(source,{original,epoch,interactive}) {
  if (original) return {asset:{image:source,w:source.width,h:source.height,source},original:true};
  while (epoch === cancelEpoch) {
    setBusy(true);
    try {
      const mask = await segmentPhoto(source);
      if (epoch !== cancelEpoch) return null;
      const image = makeCutout(source,mask.mask,mask.w,mask.h);
      return {asset:{image,w:image.width,h:image.height,source,mask:mask.mask,mw:mask.w,mh:mask.h},original:false};
    } catch (error) {
      if (epoch !== cancelEpoch) return null;
      if (!interactive) throw error;
      setBusy(false);
      const choice = await errorChoice(error.message);
      if (epoch !== cancelEpoch || choice === 'cancel') return null;
      if (choice === 'original') return {asset:{image:source,w:source.width,h:source.height,source},original:true};
      resetSegmenter();
    }
  }
  return null;
}

async function prepareCutDraft(source,{index,target,original = false,epoch = cancelEpoch,mode = 'append',interactive = true}) {
  const previous = project.cuts[index];
  const next = structuredClone(previous);
  const oldIndex = target ? next.items.findIndex(item => item.id === target) : -1;
  const old = next.items[oldIndex];
  if (!old && mode !== 'replace-cut' && personItems(next).length >= MAX_STICKERS) {
    throw Error('한 컷에는 인물 3개까지 넣을 수 있어요. 기존 인물을 선택해 바꾸거나 다른 컷을 골라 주세요.');
  }
  const result = await prepareSourceAsset(source,{original,epoch,interactive});
  if (!result || epoch !== cancelEpoch) return null;
  const {asset} = result;
  const id = uid();
  if (mode === 'replace-cut') next.items = [];
  else if (old) next.items.splice(oldIndex,1);
  const sticker = addItem(next,id,asset.w,asset.h);
  if (old) {
    const originalWidth = assets.get(old.assetId)?.w || asset.w;
    Object.assign(sticker,{x:old.x,y:old.y,rotation:old.rotation,scale:old.scale*originalWidth/asset.w,border:old.border,softness:old.softness});
    next.items.splice(oldIndex,0,next.items.pop());
  }
  next.original = result.original && personItems(next).length === 1;
  if (next.original) next.originalPerson = sticker.id;
  else delete next.originalPerson;
  return {previous,next,asset,id,stickerId:sticker.id};
}

function commitCutDraft(index,draft) {
  if (project.cuts[index] !== draft.previous) return false;
  record();
  assets.set(draft.id,draft.asset);
  project.cuts[index] = draft.next;
  selected = draft.stickerId;
  active = index;
  replaceTarget = null;
  sourceMode = 'append';
  setBusy(false);
  cleanAssets();
  return true;
}

async function processSource(source,{index=active,target=replaceTarget,original=false,epoch=cancelEpoch,mode=sourceMode,interactive=true}={}) {
  const draft = await prepareCutDraft(source,{index,target,original,epoch,mode,interactive});
  return !!draft && epoch === cancelEpoch && commitCutDraft(index,draft);
}
function reviewCapture(source){return new Promise(resolve=>{const d=$('capture-review'),c=$('capture-review-image');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);let done=false;const finish=value=>{if(done)return;done=true;d.close();d.removeEventListener('cancel',cancel);c.width=c.height=0;resolve(value);};const cancel=e=>{e.preventDefault();finish(false);};$('capture-retake').onclick=()=>finish(false);$('capture-use').onclick=()=>finish(true);d.addEventListener('cancel',cancel);d.showModal();});}
async function captureShot(epoch) {
  await countdown(epoch);
  const source = cameraFrame($('camera'),facing==='user');
  beep();
  return source;
}

async function shootReplacement(index,target,epoch) {
  while (epoch === cancelEpoch && stream) {
    const source = await captureShot(epoch);
    $('camera').hidden = true;
    const draft = await prepareCutDraft(source,{index,target,epoch});
    if (!draft || epoch !== cancelEpoch) return false;
    const comparisonAssets = new Map(assets).set(draft.id,draft.asset);
    const choice = await showCutComparison({
      title:'바꿀 사진을 비교해 보세요',
      afterLabel:draft.next.original ? '새 원본 결과' : '새 합성 결과',
      before:canvas => drawCut(canvas,draft.previous,assets,backgrounds),
      after:canvas => drawCut(canvas,draft.next,comparisonAssets,backgrounds),
      retake:true,epoch
    });
    if (epoch !== cancelEpoch) return false;
    if (choice === 'apply') return commitCutDraft(index,draft);
    if (choice !== 'retry') return false;
    $('camera').hidden = false;
  }
  return false;
}

async function shoot(auto = false) {
  if (busy || running || cameraConnecting || !stream) return;
  const indices = auto ? project.cuts.slice(0, project.count || 4).flatMap((current, index) =>
    personItems(current).length ? [] : [index]) : [active];
  if (!indices.length) { message('모든 컷이 준비됐어요. 바꿀 컷을 고르고 다시 찍기를 눌러 주세요.'); return; }
  if (!auto && !replaceTarget && personItems(cut()).length >= MAX_STICKERS) {
    message('이 컷의 인물을 선택해 다시 찍거나 다른 컷을 골라 주세요.');
    return;
  }
  const canContinue = !auto && !personItems(cut()).length && $('keep-camera').checked;
  const epoch = ++cancelEpoch;
  let captured = false;
  running = true;
  renderControls();
  try {
    for (const index of indices) {
      active = index;
      await render();
      if (!auto && replaceTarget) {
        captured = await shootReplacement(index,replaceTarget,epoch);
        break;
      }
      let source = await captureShot(epoch);
      if (!auto) {
        while (!await reviewCapture(source)) {
          if (epoch !== cancelEpoch || !stream) return;
          source = await captureShot(epoch);
        }
        if (epoch !== cancelEpoch) return;
      }
      $('camera').hidden = true;
      captured = await processSource(source, {index, epoch});
      if (epoch !== cancelEpoch || !captured) break;
      if (auto) { $('camera').hidden = false; await delay(500); }
    }
  } finally {
    running = false;
    setBusy(false);
    $('countdown').hidden = true;
    const next = nextEmptyCut(project, active);
    if (epoch === cancelEpoch && captured && canContinue && stream && next >= 0) {
      active = next;
      selected = null;
      $('camera').hidden = false;
      message('다음 빈 컷을 준비했어요. 포즈를 정한 뒤 촬영해 주세요.');
    } else {
      stopCamera();
      step = next < 0 ? 'finish' : personItems(cut()).length ? 'edit' : 'camera';
      if (step !== 'camera') { replaceTarget = null; sourceMode = 'append'; }
    }
    render();
    scrollToStage();
  }
}
on('start-camera','click',safe(startCamera));on('stop-camera','click',()=>stopCamera());on('switch-camera','click',safe(async()=>{facing=facing==='user'?'environment':'user';await startCamera();}));on('capture','click',safe(()=>shoot()));on('auto-capture','click',safe(()=>shoot(true)));on('stop-capture','click',()=>{if(!running)return;cancelEpoch++;resetSegmenter();setBusy(false);stopCamera();message('촬영을 중단했어요. 완성된 컷은 남겨 두었어요.');});
function selectImports(files) {
  return new Promise(resolve => {
    const dialog = $('import-dialog');
    const batch = files.length > 1;
    const slots = batch ? emptyCutIndices(project, active) : [active];
    const people = batch ? [] : personItems(cut());
    const rows = files.map((file, id) => ({file, id, url:URL.createObjectURL(file), include:true, result:'pending', error:''}));
    let checking = false;
    let closed = false;
    const modes = [...dialog.querySelectorAll('input[name="import-mode"]')];
    const [append, replacePerson] = modes;
    append.disabled = people.length >= MAX_STICKERS;
    const initialPerson = people.find(person => person.id === replaceTarget) || (item()?.kind === 'person' ? item() : null);
    modes.forEach(input => { input.checked = (people.length && (replaceTarget || append.disabled)) ? input === replacePerson : input === append; });
    $('import-mode').hidden = !people.length;
    const personControls = people.map((person, index) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'import-person';
      radio.value = person.id;
      radio.checked = person.id === initialPerson?.id || people.length === 1;
      label.append(radio, stickerThumbnail(person), '인물 ' + (index + 1) + ' 교체');
      radio.onchange = refresh;
      return label;
    });
    $('import-person-options').replaceChildren(...personControls);

    const selection = () => {
      const mode = modes.find(input => input.checked)?.value || 'append';
      const target = dialog.querySelector('input[name="import-person"]:checked')?.value;
      const plan = rows.filter(row => row.include).slice(0, slots.length)
        .map((row, position) => ({file:row.file, index:slots[position], id:row.id, result:row.result, error:row.error}));
      return {plan, mode, target, batch};
    };

    function updateStatus() {
      const {plan, mode, target} = selection();
      const replacing = !!people.length && mode === 'replace-person';
      $('import-person-group').hidden = !replacing;
      const ready = plan.filter(entry => entry.result === 'ready').length;
      const invalid = plan.filter(entry => entry.result === 'invalid').length;
      const waiting = plan.length - ready - invalid;
      const excluded = rows.length - plan.length;
            $('import-confirm').disabled = !plan.length || !!waiting || (ready > 0 && replacing && !target);
      $('import-confirm').textContent = !ready && !waiting && !!invalid ? '실패 파일 확인' : '사진 넣기';
      const personIndex = people.findIndex(person => person.id === target);
      const placement = (active + 1) + '번 컷' + (replacing ? (target ? ' · 인물 ' + (personIndex + 1) + ' 교체' : ' · 바꿀 인물을 선택해 주세요.') : '');
      const count = waiting ? '확인 중 ' + waiting + '장' : ready ? ready + '장 넣기' : '넣을 사진이 없어요.';
      const notes = (invalid ? ' · ' + invalid + '장 열 수 없음' : '') + (excluded ? ' · ' + excluded + '장 제외' : '');
      $('import-summary').textContent = batch ? count + notes : placement + ' · ' + count + notes;
      for (const row of rows) {
        const destination = dialog.querySelector('[data-import-note="' + row.id + '"]');
        const entry = plan.find(current => current.id === row.id);
        destination.textContent = entry
          ? (entry.index + 1) + '번 컷' + (row.result === 'invalid' ? ' · ' + row.error : row.result === 'pending' ? ' · 파일 확인 중' : '')
          : row.include ? '빈 컷 부족 · 이번에 넣지 않음' : '제외됨';
        destination.classList.toggle('import-invalid', row.result === 'invalid' && !!entry);
      }
    }

    async function inspectAssigned() {
      if (checking || closed) return;
      checking = true;
      try {
        while (!closed) {
          const planned = selection().plan.find(entry => entry.result === 'pending');
          if (!planned) break;
          const row = rows.find(current => current.id === planned.id);
          try { await inspectPhoto(row.file); row.result = 'ready'; }
          catch (error) { row.result = 'invalid'; row.error = error.message; }
          if (!closed) updateStatus();
        }
      } finally { checking = false; }
    }

    function refresh() {
      $('import-list').replaceChildren(...rows.map((row, position) => {
        const preview = document.createElement('div');
        preview.className = 'import-row';
        const image = document.createElement('img');
        image.src = row.url;
        image.alt = '';
        image.loading = 'lazy';
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = row.file.name;
        const destination = document.createElement('span');
        destination.className = 'note';
        destination.dataset.importNote = String(row.id);
        text.append(name,destination);
        preview.append(image,text);
        if (batch) {
          const actions = document.createElement('div');
          actions.className = 'import-actions';
          for (const [label, delta] of [['위로',-1],['아래로',1],[row.include ? '제외' : '다시 넣기',0]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button compact';
            button.dataset.importAction = row.id + ':' + delta;
            button.textContent = label;
            button.setAttribute('aria-label', row.file.name + ' ' + label);
            button.disabled = position + delta < 0 || position + delta >= rows.length;
            button.onclick = () => {
              if (!delta) row.include = !row.include;
              else [rows[position],rows[position + delta]] = [rows[position + delta],rows[position]];
              refresh();
              const next = dialog.querySelector('[data-import-action="' + row.id + ':' + delta + '"]');
              (next.disabled ? previewFallback(row.id) : next).focus({preventScroll:true});
            };
            actions.append(button);
          }
          preview.append(actions);
        }
        return preview;
      }));
      updateStatus();
      inspectAssigned();
    }

    const previewFallback = id => dialog.querySelector('[data-import-action="' + id + ':0"]');
    for (const input of modes) input.onchange = refresh;
    const finish = (accept) => {
      if (closed) return;
      closed = true;
      const result = selection();
      dialog.close();
      $('import-list').replaceChildren();
      $('import-person-options').replaceChildren();
      for (const row of rows) URL.revokeObjectURL(row.url);
      resolve(accept ? result : null);
    };
    $('import-cancel').onclick = () => finish(false);
    $('import-confirm').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.querySelector('[data-close]').onclick = () => finish(false);
    refresh();
    dialog.showModal();
  });
}
on('photo-browse','click',() => {
  if (cameraConnecting) stopCamera();
  $('photo-input').click();
});
function drawImportReport() {
  const panel = $('import-result-panel');
  panel.hidden = !importReport;
  if (!importReport) { $('import-failure-list').replaceChildren(); return; }
  const {added, failures} = importReport;
  $('import-result-status').textContent = added + '장 추가 · ' + failures.length + '장 실패';
  $('import-failure-list').replaceChildren(...failures.map(failure => {
    const index = project.cuts.slice(0, project.count).findIndex(current => current.id === failure.cutId);
    const li = document.createElement('li');
    const description = document.createElement('span');
    description.textContent = failure.name + (index >= 0 ? ' · ' + (index + 1) + '번 컷' : '') + ' · ' + failure.reason;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button compact';
    retry.textContent = '파일 다시 고르기';
    retry.setAttribute('aria-label', failure.name + ' 다시 고르기');
    retry.dataset.missingCut = String(index < 0);
    retry.disabled = busy || running || index < 0;
    retry.onclick = () => { pendingImportRetry = failure; $('import-retry-input').click(); };
    li.append(description, retry);
    if (failure.originalFile) {
      const original = document.createElement('button');
      original.type = 'button';
      original.className = 'button compact';
      original.textContent = '이 사진을 원본으로 넣기';
      original.setAttribute('aria-label', failure.name + ' 원본으로 넣기');
      original.dataset.missingCut = String(index < 0);
      original.disabled = busy || running || index < 0;
      original.onclick = safe(() => retryImport(failure,failure.originalFile,true));
      li.append(original);
    }
    return li;
  }));
}

function forgetImportReport() {
  importReport = pendingImportRetry = null;
  drawImportReport();
}

async function importPhoto(file, index, options, onDecoded) {
  setBusy(true, '사진을 준비하고 있어요');
  const source = await readPhoto(file);
  onDecoded?.();
  if (options.epoch !== cancelEpoch) return false;
  return processSource(source, {...options, index});
}

function finishImport(epoch, added) {
  if (epoch !== cancelEpoch) return;
  setBusy(false);
  if (added) step = isComplete(project) ? 'finish' : 'edit';
  render();
  scrollToStage();
  if (importReport) $('import-result-panel').scrollIntoView({block:'nearest'});
}

on('import-result-close', 'click', forgetImportReport);
on('photo-input', 'change', safe(async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  const selection = await selectImports(files);
  if (!selection) return;
  forgetImportReport();
  const epoch = ++cancelEpoch;
  stopCamera();
  const options = {
    epoch, original: $('original-import').checked, interactive:!selection.batch,
    target: selection.mode === 'replace-person' ? selection.target : null,
    mode: selection.mode === 'replace-cut' ? 'replace-cut' : 'append'
  };
  const report = {added:0, failures:[]};
  try {
    for (const entry of selection.plan) {
      const current = project.cuts[entry.index];
      let decoded = false;
      try {
        if (entry.result === 'invalid') throw Error(entry.error);
        const ok = await importPhoto(entry.file, entry.index, options, () => { decoded = true; });
        if (epoch !== cancelEpoch) return;
        if (ok) report.added++;
        else if (selection.batch) throw Error('사진을 넣지 못했어요.');
      } catch (error) {
        if (epoch !== cancelEpoch) return;
        report.failures.push({
          name:entry.file.name, reason:error.message || '사진을 처리할 수 없어요.',
          cutId:current.id, items:current.items.map(item => item.id),
          original:options.original, target:options.target, mode:options.mode,
          originalFile: decoded && !options.original ? entry.file : null
        });
      }
    }
  } finally {
    if (epoch === cancelEpoch) importReport = selection.batch || report.failures.length ? report : null;
    finishImport(epoch,report.added);
  }
}));

on('import-retry-input', 'change', safe(async event => {
  const file = event.target.files[0];
  event.target.value = '';
  const failure = pendingImportRetry;
  pendingImportRetry = null;
  if (file) await retryImport(failure,file);
}));

async function retryImport(failure,file,useOriginal = false) {
  if (!importReport?.failures.includes(failure) || busy || running) return;
  const index = project.cuts.slice(0,project.count).findIndex(current => current.id === failure.cutId);
  const unchanged = index >= 0 && project.cuts[index].items.map(item => item.id).join() === failure.items.join();
  if (!unchanged) { message('이 컷을 편집했어요. 컷을 선택한 뒤 사진을 불러와 주세요.'); return; }
  stopCamera();
  const epoch = ++cancelEpoch;
  let added = false;
  let decoded = false;
  try {
    added = await importPhoto(file,index,{epoch,original:useOriginal||failure.original,target:failure.target,mode:failure.mode},() => { decoded = true; });
    if (epoch !== cancelEpoch || !added) return;
    importReport.added++;
    importReport.failures = importReport.failures.filter(current => current !== failure);
  } catch (error) {
    if (epoch === cancelEpoch) {
      failure.name = file.name;
      failure.reason = error.message;
      failure.originalFile = decoded && !failure.original ? file : null;
    }
  } finally { finishImport(epoch,added); }
}
document.querySelectorAll('[data-step]').forEach(button => {
  button.onclick = () => {
    if (button.dataset.step === 'edit' && !personItems(cut()).length) captureCut(active);
    else setStep(button.dataset.step);
  };
});on('go-camera','click',()=>{sourceMode='append';replaceTarget=null;setStep('camera');});on('show-finish','click',()=>setStep('finish'));on('fill-missing','click',fillMissingCut);on('next-cut','click',continueProject);
on('add-person', 'click', () => {
  if (personItems(cut()).length >= MAX_STICKERS) { openCutActions(active); return; }
  replaceTarget = null;
  sourceMode = 'append';
  setStep('camera');
});on('retake','click',()=>{
  const people = personItems(cut());
  const current = item()?.kind === 'person' ? item() : people.length === 1 ? people[0] : null;
  if (current) startRetake(active, current.id);
  else if (people.length) openCutActions(active);
});
function leaveExample() {
  if (busy || running) return;
  mutate(() => {
    for (const current of project.cuts) {
      if (originalPerson(current)?.example) current.original = false;
      current.items = current.items.filter(sticker => !sticker.example);
    }
    const next = nextEmptyCut(project,active);
    selected = replaceTarget = null;
    sourceMode = 'append';
    if (next >= 0) { active = next; step = 'camera'; }
    else step = 'finish';
  });
  scrollToStage();
  $('stage-title').focus({preventScroll:true});
  message('예시 스티커를 지웠어요. 실제 사진과 배경은 남아 있어요.');
}
on('leave-example', 'click', leaveExample);
on('leave-example-finish', 'click', leaveExample);
function originalReference() {
  const people = personItems(cut());
  if (cut().original) return originalPerson(cut());
  return people.find(person => person.id === selected && assets.get(person.assetId)?.source)
    || people.find(person => assets.get(person.assetId)?.source);
}

function renderOriginalControls() {
  const source = assets.get(originalReference()?.assetId)?.source;
  $('compare-original').disabled = busy || running || !source;
  $('toggle-original').disabled = busy || running || (!source && !cut().original);
  $('toggle-original').textContent = cut().original ? '스티커 합성으로 돌아가기' : '이 컷을 원본으로 바꾸기';
}

for (const [id,result] of [['cut-compare-keep','keep'],['cut-compare-retry','retry'],['cut-compare-apply','apply']]) {
  on(id, 'click', () => $('cut-compare-dialog').close(result));
}

async function showCutComparison({title, afterLabel, before, after, retake = false, epoch = cancelEpoch}) {
  const dialog = $('cut-compare-dialog');
  const first = $('cut-compare-before');
  const second = $('cut-compare-after');
  const temp = [first,second].map(canvas => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    return copy;
  });
  try {
    await Promise.all([before(temp[0]), after(temp[1])]);
    if (epoch !== cancelEpoch) return 'keep';
    for (const [index,canvas] of [first,second].entries()) {
      const context = canvas.getContext('2d');
      context.clearRect(0,0,canvas.width,canvas.height);
      context.drawImage(temp[index],0,0);
    }
  } finally { for (const canvas of temp) canvas.width = canvas.height = 0; }
  $('cut-compare-title').textContent = title;
  $('cut-compare-after-label').textContent = afterLabel;
  $('cut-compare-keep').textContent = retake ? '기존 컷 유지' : '닫기';
  $('cut-compare-retry').hidden = $('cut-compare-apply').hidden = !retake;
  dialog.returnValue = 'keep';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      for (const canvas of [first,second]) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
      resolve(dialog.returnValue);
    }, {once:true});
    dialog.showModal();
  });
}

on('compare-original','click',safe(async () => {
  const reference = originalReference();
  const source = assets.get(reference?.assetId)?.source;
  if (!source || busy || running) return;
  const current = cut();
  const number = personItems(current).indexOf(reference) + 1;
  setBusy(true, '원본을 비교하고 있어요');
  try {
    await showCutComparison({
      title:'원본과 비교', afterLabel:'인물 ' + number + ' 원본',
      before:canvas => drawCut(canvas,current,assets,backgrounds),
      after:canvas => cover(canvas.getContext('2d'),source,0,0,canvas.width,canvas.height)
    });
  } finally { setBusy(false); }
}));

on('toggle-original','click',safe(async () => {
  if (busy || running) return;
  const current = cut();
  const reference = originalReference();
  const asset = assets.get(reference?.assetId);
  if (current.original) {
    if (asset?.source && !asset.mask && personItems(current).length === 1) {
      try { await processSource(asset.source,{target:reference.id}); }
      finally { setBusy(false); render(); }
    } else mutate(() => { current.original = false; delete current.originalPerson; });
    return;
  }
  if (!asset?.source) return;
  const number = personItems(current).indexOf(reference) + 1;
  if (!await confirmAction('이 컷을 원본으로 바꿀까요?', '인물 ' + number + '의 원본 사진을 이 컷의 저장본에 적용해요. 편집 화면에서 스티커 합성으로 돌아갈 수 있어요.', {yesLabel:'원본 적용'})) return;
  mutate(() => { current.original = true; current.originalPerson = reference.id; });
}));on('clear-cut','click',safe(async()=>{if(await confirmAction('이 컷을 비울까요?','다른 컷은 그대로 남아요. 실행 취소로 되돌릴 수 있어요.'))mutate(()=>{cut().items=[];cut().original=false;selected=null;});}));
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
for(const id of ['item-size','item-rotation','item-softness']){on(id,'pointerdown',()=>{if(!busy&&item()){record();sliderRecorded=true;}});on(id,'keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&!sliderRecorded){record();sliderRecorded=true;}});on(id,'input',()=>{if(!item()||busy)return;if(!sliderRecorded){record();sliderRecorded=true;}if(id==='item-size')item().scale=Number($(id).value)/100;if(id==='item-rotation')item().rotation=Number($(id).value);if(id!=='item-softness'){renderTransformValues();drawCut($('scene'),cut(),assets,backgrounds,{selected});renderCutButtons();}});on(id,'change',safe(async()=>{sliderRecorded=false;if(id==='item-softness'&&item()){const a=currentAsset();if(a?.mask){const image=makeCutout(a.source,a.mask,a.mw,a.mh,Number($(id).value)/100),id=uid(),it=item();assets.set(id,{...a,image,w:image.width,h:image.height});it.scale*=a.w/image.width;it.assetId=id;it.softness=Number($('item-softness').value)/100;}}render();}));}
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

function downloadImage(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
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
  downloadImage(downloadUrl, preparedExport.name);
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

async function exportPng({small = false, view = false, partial = false} = {}) {
  const output = partial ? photographedProject(project) : project;
  if (busy || !output.count || (!partial && !isComplete(project))) return;
  if (downloadUrl && exportIsCurrent(preparedExport) && preparedExport.small === small && preparedExport.partial === partial) {
    if (view) showExportImage();
    else requestPngDownload();
    return true;
  }
  const epoch = cancelEpoch;
  const snapshot = {project: JSON.stringify(project), logo, small, partial, count: output.count};
  stopCamera();
  setBusy(true, '네컷 사진을 만들고 있어요');
  let canvas;
  try {
    const spec = exportSpec(output.layout, output.count);
    const scale = small ? Math.min(1, 2400 / Math.max(spec.w, spec.h)) : 1;
    canvas = await renderProject(output, assets, backgrounds, scale, logo);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG 생성 실패')), 'image/png');
    });
    if (epoch !== cancelEpoch || !exportIsCurrent(snapshot)) return;
    clearExportImage();
    downloadUrl = URL.createObjectURL(blob);
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
    preparedExport = {...snapshot, name: `상상네컷_${date}_${Date.now().toString(36).slice(-5)}${partial ? '_' + output.count + '컷' : small ? '_작게' : ''}.png`};
    if (view) showExportImage();
    else requestPngDownload();
    return true;
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
function canvasBlob(canvas,type,quality) {
  return new Promise((resolve,reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(Error('인쇄 이미지를 만들지 못했어요.'));
  },type,quality));
}

on('print-photo','click',safe(async () => {
  const output = photographedProject(project);
  if (busy || running || !output.count) return;
  const epoch = cancelEpoch;
  const paper = getPrintLayout($('print-paper').value,$('print-copies').value);
  stopCamera();
  setBusy(true,'인쇄할 사진을 준비하고 있어요');
  let canvas;
  try {
    canvas = await renderProject(output,assets,backgrounds,1,logo);
    const blob = await canvasBlob(canvas,'image/png');
    if (epoch !== cancelEpoch) return;
    clearPrint();
    printUrl = URL.createObjectURL(blob);
    const image = $('print-image');
    await new Promise((resolve,reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error('인쇄 이미지를 불러오지 못했어요.'));
      image.src = printUrl;
    });
    if (epoch !== cancelEpoch) return;
    const sheet = $('print-sheet');
    sheet.dataset.copies = String(paper.copies);
    for (let i=1;i<paper.copies;i++) {
      const copy = image.cloneNode();
      copy.removeAttribute('id');
      copy.className = 'print-copy';
      copy.alt = '';
      sheet.append(copy);
    }
    $('print-page-style').textContent = '@page{size:' + paper.cssSize + ';margin:' + paper.margin + 'mm} @media print{#print-sheet{height:' + (paper.height - 2*paper.margin) + 'mm;gap:' + paper.gap + 'mm}}';
    setBusy(false);
    window.addEventListener('afterprint',clearPrint,{once:true});
    window.print();
  } catch {
    clearPrint();
    if (epoch === cancelEpoch) message('인쇄를 준비하지 못했어요. PDF 저장으로 다시 시도해 주세요.');
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (epoch === cancelEpoch) setBusy(false);
  }
}));
on('download-pdf', 'click', safe(async () => {
  const output = photographedProject(project);
  if (busy || running || !output.count) return;
  const paperKey = $('print-paper').value;
  const paper = getPrintLayout(paperKey, $('print-copies').value);
  const epoch = cancelEpoch;
  stopCamera();
  setBusy(true, '인쇄용 PDF를 만들고 있어요');
  let canvas;
  try {
    canvas = await renderProject(output, assets, backgrounds, 1, logo);
    const jpeg = await canvasBlob(canvas,'image/jpeg',.95);
    if (epoch !== cancelEpoch) return;
    const pdf = createPrintPdf(jpeg, canvas.width, canvas.height, paper);
    const url = URL.createObjectURL(pdf);
    const suffix = output.count === project.count ? '' : '_' + output.count + '컷';
    downloadImage(url, '상상네컷_인쇄_' + (paperKey === 'photo-4x6' ? '4x6' : paper.cssSize) + suffix + '.pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('인쇄용 PDF 저장을 요청했어요. 기기에서 파일을 확인해 주세요.');
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    setBusy(false);
  }
}));
on('download','click',()=>exportPng());
on('download-partial','click',()=>exportPng({partial:true}));
on('download-small','click',()=>exportPng({small:true}));
on('export-view','click',()=>exportPng({view:true}));
on('export-download','click',requestPngDownload);
function syncHandoff() {
  $('handoff-save').disabled = busy;
  $('handoff-checked').disabled = busy;
  $('handoff-keep-style').disabled = busy;
  $('handoff-discard').disabled = busy;
  $('handoff-next').disabled = busy || !$('handoff-checked').checked;
}

on('handoff-checked', 'change', syncHandoff);
on('handoff-save', 'click', safe(async () => {
  const partial = !isComplete(project);
  $('handoff-status').textContent = 'PNG를 준비하고 있어요.';
  const saved = await exportPng({partial});
  $('handoff-status').textContent = saved
    ? '저장을 요청했어요. 기기에서 파일을 열어 확인해 주세요.'
    : 'PNG를 만들지 못했어요. 다시 시도하거나 사진 화면으로 돌아가 주세요.';
}));

on('new-group', 'click', safe(async () => {
  const {count} = photographedProject(project);
  if (count) {
    const partial = !isComplete(project);
    $('handoff-checked').checked = false;
    $('handoff-keep-style').checked = !classroomMode;
    $('handoff-discard').hidden = !partial;
    $('handoff-save').textContent = partial ? '찍은 ' + count + '컷만 저장' : '고화질 PNG 저장하기';
    $('handoff-status').textContent = exportIsCurrent(requestedExport)
      ? '기기에 저장된 PNG를 확인해 주세요.' : partial
        ? '찍은 ' + count + '컷을 PNG로 저장할 수 있어요.' : '사진을 저장하거나 인쇄한 뒤 확인해 주세요.';
    syncHandoff();
    $('handoff-dialog').showModal();
    return;
  }
  if (await confirmAction('다음 모둠을 시작할까요?', '현재 사진과 편집 기록이 지워집니다.', {yesLabel:'다음 모둠 시작',noLabel:'사진 화면으로 돌아가기'})) {
    await resetForNextGroup(!classroomMode);
  }
}));

on('handoff-next', 'click', safe(async () => {
  if (busy || !$('handoff-checked').checked) return;
  const keepStyle = $('handoff-keep-style').checked;
  $('handoff-dialog').close();
  await resetForNextGroup(keepStyle);
}));

on('handoff-discard', 'click', safe(async () => {
  if (busy) return;
  const keepStyle = $('handoff-keep-style').checked;
  $('handoff-dialog').close();
  if (await confirmAction('저장 없이 넘어갈까요?', '촬영한 사진과 편집 기록이 지워집니다.', {yesLabel:'저장 없이 넘어가기',noLabel:'취소'})) {
    await resetForNextGroup(keepStyle);
  } else $('handoff-dialog').showModal();
}));

async function resetForNextGroup(keepStyle) {
  const preset = !keepStyle && groupStartPreset ? groupStartPreset : presetOf(project, settings);
  cancelEpoch++;
  resetSegmenter();
  stopCamera();
  clearPrint();
  clearExportImage();
  requestedExport = null;
  forgetImportReport();
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
}
let rehearsalEpoch = 0;
let rehearsalStream = null;
let rehearsalBackground;

function stopRehearsalCamera() {
  if (rehearsalStream) rehearsalStream.getTracks().forEach(track => track.stop());
  rehearsalStream = null;
  $('rehearsal-video').srcObject = null;
  $('rehearsal-video').hidden = $('rehearsal-take').hidden = true;
}

function resetRehearsal() {
  rehearsalEpoch++;
  stopRehearsalCamera();
  $('rehearsal-input-tools').hidden = false;
  $('rehearsal-camera').hidden = false;
  $('rehearsal-camera').disabled = $('rehearsal-browse').disabled = false;
  $('rehearsal-output-tools').hidden = true;
  const result = $('rehearsal-result');
  const paper = $('rehearsal-print');
  result.hidden = paper.hidden = true;
  result.width = result.height = paper.width = paper.height = 0;
  $('rehearsal-status').textContent = '시험용 카메라를 켜거나 사진을 불러와 주세요.';
}

on('rehearsal-open', 'click', () => {
  stopCamera();
  rehearsalBackground = {background:cut().background, fit:cut().fit};
  resetRehearsal();
  $('rehearsal-dialog').showModal();
});
on('rehearsal-dialog', 'close', resetRehearsal);
window.addEventListener('pagehide', () => {
  if (!$('rehearsal-dialog').open) return;
  resetRehearsal();
  $('rehearsal-dialog').close();
});
on('rehearsal-reset', 'click', () => { resetRehearsal(); $('rehearsal-camera').focus(); });

on('rehearsal-camera', 'click', async () => {
  const epoch = ++rehearsalEpoch;
  const status = $('rehearsal-status');
  const video = $('rehearsal-video');
  $('rehearsal-camera').disabled = true;
  status.textContent = '카메라 권한 응답을 기다리고 있어요.';
  try {
    const input = await requestCamera('user');
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open || document.hidden) {
      input.getTracks().forEach(track => track.stop());
      return;
    }
    rehearsalStream = input;
    status.textContent = '카메라 영상을 연결하고 있어요.';
    await prepareVideo(video, input);
    if (epoch !== rehearsalEpoch) return;
    video.hidden = $('rehearsal-take').hidden = false;
    $('rehearsal-camera').hidden = true;
    $('rehearsal-take').focus();
    status.textContent = '영상이 보이면 시험 촬영을 눌러 주세요.';
  } catch {
    if (epoch !== rehearsalEpoch) return;
    stopRehearsalCamera();
    $('rehearsal-camera').disabled = false;
    status.textContent = '카메라를 열지 못했어요. 권한을 확인하거나 시험용 사진을 불러와 주세요.';
  }
});

async function prepareRehearsalPhoto(readSource) {
  const epoch = ++rehearsalEpoch;
  const status = $('rehearsal-status');
  $('rehearsal-input-tools').hidden = true;
  status.textContent = '시험 사진에서 인물을 오리고 있어요.';
  try {
    const source = await readSource();
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open) return;
    stopRehearsalCamera();
    const result = await segmentPhoto(source);
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open) return;
    const image = makeCutout(source, result.mask, result.w, result.h);
    const card = {...rehearsalBackground, items:[]};
    addItem(card, 'trial', image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = CUT_W;
    canvas.height = CUT_H;
    await drawCut(canvas, card, new Map([['trial',{image,w:image.width,h:image.height}]]), backgrounds);
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open) return;
    const preview = $('rehearsal-result');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    preview.hidden = $('rehearsal-output-tools').hidden = false;
    status.textContent = '인물 오리기를 마쳤어요. 파일 저장과 인쇄 배치를 확인해 주세요.';
    $('rehearsal-save').focus();
  } catch (error) {
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open) return;
    resetRehearsal();
    status.textContent = error.message || '시험 사진을 처리하지 못했어요. 다시 시도해 주세요.';
  }
}

on('rehearsal-take', 'click', () => prepareRehearsalPhoto(() => cameraFrame($('rehearsal-video'), true)));
on('rehearsal-browse', 'click', () => $('rehearsal-input').click());
on('rehearsal-input', 'change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) prepareRehearsalPhoto(() => readPhoto(file));
});
on('rehearsal-save', 'click', () => {
  const epoch = rehearsalEpoch;
  $('rehearsal-save').disabled = true;
  $('rehearsal-result').toBlob(blob => {
    $('rehearsal-save').disabled = false;
    if (epoch !== rehearsalEpoch || !$('rehearsal-dialog').open) return;
    if (!blob) { $('rehearsal-status').textContent = '시험 PNG를 만들지 못했어요. 다시 시도해 주세요.'; return; }
    const url = URL.createObjectURL(blob);
    downloadImage(url, '상상네컷_시험촬영.png');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('rehearsal-status').textContent = '시험 PNG 저장을 요청했어요. 기기에서 파일을 열어 확인해 주세요.';
  }, 'image/png');
});
on('rehearsal-paper', 'click', () => {
  const paper = $('rehearsal-print');
  paper.hidden = false;
  drawPaperPreview(paper, $('rehearsal-result'), getPrintLayout($('print-paper').value, $('print-copies').value));
  paper.scrollIntoView({block:'nearest'});
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && $('rehearsal-dialog').open && (rehearsalStream || $('rehearsal-camera').disabled)) {
    resetRehearsal();
    $('rehearsal-status').textContent = '다른 화면으로 이동해 카메라를 껐어요. 다시 켤 수 있어요.';
  }
});

function teacherSync(){$('cut-count').value=project.count||4;$('timer').value=settings.timer;$('sound').checked=settings.sound;$('mission-on').checked=settings.mission;$('lock-background').checked=settings.lockBackground;$('custom-missions').value=settings.customMissions.join('\n');renderCustomBackgrounds();$('preset-status').textContent=presetStatus;renderLessonSummary();}
function openTeacherSettings() {
  teacherSync();
  $('teacher-dialog').showModal();
  refreshOfflineNotice();
  refreshLessons().catch(() => {
    $('lesson-status').textContent = '이 기기에서 수업 설정 목록을 읽지 못했어요.';
  });
}
on('teacher-share', 'click', event => {
  if (event.target.closest('[data-ys-install], [data-qr]')) $('teacher-dialog').close();
});
on('teacher-open', 'click', openTeacherSettings);on('teacher-check-ready','click',()=>{$('teacher-dialog').close();$('check-ready').click();});on('privacy-open','click',()=>$('privacy-dialog').showModal());document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
on('cut-count','change',safe(async e=>{const n=Number(e.target.value);if(n<(project.count||4)&&project.cuts.slice(n,project.count).some(c=>c.items.length)){if(!await confirmAction('컷 수를 줄일까요?','화면에 보이지 않는 컷은 유지되며 컷 수를 다시 늘리면 돌아옵니다.')){e.target.value=project.count;return;}}mutate(()=>{project.count=n;active=Math.min(active,n-1);selected=null;});}));
on('timer','change',e=>{settings.timer=Number(e.target.value);renderControls();});on('sound','change',e=>{settings.sound=e.target.checked;renderLessonSummary();});on('mission-on','change',e=>{settings.mission=e.target.checked;render();});on('lock-background','change',e=>{settings.lockBackground=e.target.checked;render();});on('custom-missions','change',e=>{settings.customMissions=e.target.value.split('\n').map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,4);render();});
function renderCustomBackgrounds(){const root=$('custom-background-list');root.replaceChildren();for(const b of backgrounds.filter(x=>!x.builtIn)){const div=document.createElement('div'),img=document.createElement('img'),span=document.createElement('span'),del=document.createElement('button');img.src=b.url;img.alt='';span.textContent=b.name;del.textContent='×';del.setAttribute('aria-label',`${b.name} 배경 삭제`);del.onclick=()=>{mutate(()=>{project.cuts.forEach(c=>{if(c.background===b.id)c.background='space';});backgrounds.splice(backgrounds.indexOf(b),1);forgetImage(b.url);URL.revokeObjectURL(b.url);});renderCustomBackgrounds();};div.append(img,span,del);root.append(div);}}
on('background-input','change',safe(async e=>{const files=[...e.target.files];e.target.value='';for(const file of files){if(backgrounds.filter(b=>!b.builtIn).length>=20)throw Error('나만의 배경은 20개까지 추가할 수 있어요.');await readPhoto(file);const id='custom-'+uid(),b={id,name:file.name.replace(/\.[^.]+$/,'').slice(0,24),url:URL.createObjectURL(file),blob:file,builtIn:false};backgrounds.push(b);}if(files.length){themeFilter='custom';showFavorites=false;}renderCustomBackgrounds();render();message('배경을 추가했어요. 기기에 보관하려면 설정 저장을 눌러 주세요.');}));
on('logo-input','change',safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;logo=await readPhoto(file);logoBlob=file;$('logo-status').textContent='로고가 준비됐어요. 네컷 완성 화면에서 확인해 주세요.';renderLessonSummary();schedulePreview();}));on('remove-logo','click',()=>{logo=null;logoBlob=null;$('logo-status').textContent='로고를 지웠어요.';renderLessonSummary();schedulePreview();});
on('save-preset','click',safe(async()=>{try{await saveSettings({...presetOf(project,settings),lockBackground:settings.lockBackground},backgrounds.filter(b=>!b.builtIn).map(({id,name,blob})=>({id,name,blob})),logoBlob);captureGroupStart();presetStatus='이 기기에 배경과 설정을 저장했어요. 학생 사진은 저장하지 않았어요.';}catch(e){presetStatus='기기에 저장하지 못했어요. 이번 사용 중에는 계속 쓸 수 있어요. '+e.message;}$('preset-status').textContent=presetStatus;}));
on('delete-preset','click',safe(async()=>{if(!await confirmAction('기본 시작 설정을 지울까요?','자동으로 불러오는 기본 시작 설정을 삭제해요. 이름 붙인 수업 설정과 현재 사진은 유지돼요.'))return;await clearSaved();presetStatus='기본 시작 설정을 삭제했어요. 현재 화면의 설정은 유지돼요.';$('preset-status').textContent=presetStatus;}));
setStatusListener(state=>{prepared=state==='ready';$('model-status').textContent=state==='ready'?'✓ 인물 오리기 준비 완료':state==='loading'?'인물 오리기 준비 중':'인물 오리기 다시 준비';$('model-status').classList.toggle('ready',prepared);});
on('model-status','click',safe(async()=>{if(prepared){message('사진을 찍거나 불러오면 인물을 오려 드려요.');return;}resetSegmenter();await initSegmenter();message('인물 오리기가 준비됐어요.');}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(running){cancelEpoch++;if($('cut-compare-dialog').open)$('cut-compare-dialog').close('keep');resetSegmenter();setBusy(false);}stopCamera();}});
window.addEventListener('pagehide',()=>{cancelEpoch++;renderVersion++;clearTimeout(previewTimer);if($('brush-dialog').open)$('brush-dialog').close();resetSegmenter();stopCamera();clearPrint();assets.clear();history.clear();project.cuts.forEach(c=>c.items=[]);document.querySelectorAll('#scene,#cut-grid canvas,#full-preview canvas,#brush-canvas,#paper-preview').forEach(c=>c.getContext('2d')?.clearRect(0,0,c.width,c.height));$('full-preview').replaceChildren();forgetImportReport();clearExportImage();requestedExport=null;});window.addEventListener('pageshow',event=>{if(event.persisted){active=0;selected=null;step='background';render();initSegmenter().catch(()=>{});}});
window.addEventListener('beforeunload',e=>{if(isDirty()){e.preventDefault();e.returnValue='';}});
async function boot() {
  syncClassroomMode();
  try {
    const resume = classroomMode ? await readClassroom() : null;
    const saved = resume || await readSaved();
    if (saved) {
      for (const background of saved.backgrounds || []) {
        backgrounds.push({...background,url:URL.createObjectURL(background.blob),builtIn:false});
      }
      project = newProject(saved.preset);
      for (const key of ['timer','sound','mission','customMissions','lockBackground']) {
        if (Object.hasOwn(saved.preset,key)) settings[key] = saved.preset[key];
      }
      if (saved.logo) { logo = await readPhoto(saved.logo); logoBlob = saved.logo; }
      presetStatus = resume ? '이 기기에 보관한 수업 설정을 불러왔어요.' : '저장해 둔 배경과 설정을 불러왔어요.';
      if (resume) message('보관한 수업 설정으로 시작했어요.');
    }
  } catch {
    presetStatus = '기기 저장소를 사용할 수 없어 이번 사용 중에만 설정을 유지해요.';
  }
  captureGroupStart();
  syncFields();
  render();
  initSegmenter().catch(() => message('인물 오리기 준비를 완료하지 못했어요. 다시 준비하거나 원본 모드로 사용할 수 있어요.'));
}
boot();
import {enableBrush,checkReadiness} from './extras.mjs?v=classroom-review';
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
on('bundle-input','change',safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>70*1024*1024)throw Error('설정 파일은 70MB 이하여야 해요.');let data;try{data=JSON.parse(await file.text());}catch{throw Error('설정 파일을 읽을 수 없어요.');}const bundle=validateBundle(data);for(const bg of bundle.backgrounds)await readPhoto(bg.blob);const newLogo=bundle.logo?await readPhoto(bundle.logo):null;if(!await confirmAction('수업 설정을 가져올까요?','현재 배경과 문구, 촬영 설정을 가져온 내용으로 바꿉니다. 촬영 사진은 유지되며 편집 취소 기록은 비워집니다. 기기에 영구 저장하려면 설정 저장을 눌러 주세요.'))return;applyLessonSnapshot(bundle, newLogo, {replaceBackgrounds:true});markLesson(null);message('설정을 가져왔어요. 촬영 사진은 그대로 유지돼요.');}));
function showOfflineProgress(done,total) {
  const progress = $('offline-progress');
  progress.hidden = !total;
  if (total) { progress.max = total; progress.value = done; }
}

function prepareOffline(worker) {
  return new Promise((resolve,reject) => {
    const channel = new MessageChannel();
    let timer;
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        channel.port1.close();
        reject(Error('파일 저장에 시간이 오래 걸려요. 다시 누르면 남은 파일부터 받아요.'));
      },180000);
    };
    channel.port1.onmessage = ({data}) => {
      showOfflineProgress(data.done,data.total);
      if (data.type === 'PROGRESS') {
        $('offline-status').textContent = data.done + '/' + data.total + '개 준비 · 남은 파일을 받고 있어요.';
        wait();
        return;
      }
      clearTimeout(timer);
      channel.port1.close();
      resolve(data);
    };
    wait();
    worker.postMessage({type:'PREPARE'},[channel.port2]);
  });
}

on('offline-prepare','click',safe(async () => {
  if (!('serviceWorker' in navigator)) { message('이 브라우저에서는 오프라인 준비를 지원하지 않아요.'); return; }
  const button = $('offline-prepare');
  const status = $('offline-status');
  button.disabled = true;
  status.textContent = '현재 버전에 준비된 파일을 확인하고 있어요.';
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    const worker = await currentOfflineWorker(registration);
    if (!worker) throw Error('새 버전의 오프라인 기능이 준비되지 않았어요. 잠시 후 다시 눌러 주세요.');
    const result = await prepareOffline(worker);
    if (result.ok) status.textContent = result.done + '/' + result.total + '개 준비 완료. 인터넷을 끄고 시험할 수 있어요.';
    else status.textContent = result.done + '/' + result.total + '개 준비. 다시 누르면 남은 파일부터 받아요. ' + (result.message || '');
  } catch (error) { status.textContent = error.message || '다시 누르면 남은 파일부터 받아요.'; }
  finally { button.disabled = false; }
}));

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
  const filled = photographedProject(project).count;
  const remaining = count - filled;
  const complete = remaining === 0;
  $('finish-title').textContent = complete ? '우리만의 사진, 완성!' : '전체 사진 미리보기';
    $('finish-preview-note').textContent = filled ? filled + '컷 PNG와 같은 배열이에요' : '첫 컷을 찍어 보세요';
  $('full-preview-empty').hidden = !!filled;
  $('save-status').textContent = complete
    ? `${count}컷이 모두 준비됐어요. PNG로 저장하거나 인쇄해 주세요.`
    : filled ? `${filled}컷을 찍었어요. 찍은 컷을 저장하거나 인쇄할 수 있어요.`
      : `${remaining}컷을 찍으면 저장할 수 있어요.`;
  $('fill-missing').hidden = complete;
  $('fill-missing').disabled = busy || running;
  $('export-options').hidden = !complete;
  $('finish-print-actions').hidden = !filled;
  $('download-partial').hidden = complete || !filled;
  $('download-partial').disabled = busy || running;
  $('download-partial').textContent = '찍은 ' + filled + '컷만 저장';
  for (const id of ['download', 'download-small', 'export-view']) {
    $(id).disabled = busy || running || !complete;
  }
  for (const id of ['print-photo','download-pdf']) $(id).disabled = busy || running || !filled;
  if (!filled) clearPaperPreview();
  const saved = exportIsCurrent(requestedExport);
  $('export-status').hidden = !complete && !saved;
  $('export-status').textContent = saved
    ? (requestedExport.partial ? '찍은 ' + requestedExport.count + '컷 PNG' : requestedExport.small ? '작은 PNG' : '고화질 PNG')
      + ' 저장을 요청했어요. 기기에서 파일을 확인해 주세요.'
    : '고화질 또는 작은 PNG로 저장하거나, 이미지를 직접 열 수 있어요.';
}

function updateMobileAction() {
  let target = 'go-camera';
  if (step === 'camera') {
    target = running ? 'stop-capture' : cameraFailed || cameraDelayed ? 'photo-browse' : stream && !cameraConnecting ? 'capture' : 'start-camera';
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
  if (target !== 'download') button.parentElement.removeAttribute('data-inline-save-visible');
  button.textContent = cameraConnecting && target === 'start-camera' ? '카메라 연결 중' : entry.textContent;
  button.disabled = entry.disabled || (busy && target !== 'stop-capture');
}

if ('IntersectionObserver' in window) {
  const inlineSave = $('download');
  const observer = new IntersectionObserver(([entry]) => {
    const bar = $('mobile-action').parentElement;
    bar.toggleAttribute('data-inline-save-visible', entry.intersectionRatio === 1 && step === 'finish');
  }, {threshold: 1, rootMargin: '0px 0px -68px'});
  observer.observe(inlineSave);
}

on('mobile-action', 'click', () => {
  const target = $('mobile-action').dataset.target;
  const control = $(target);
  if (control && !control.disabled) control.click();
});
mobileLayout.addEventListener('change', placeBackgroundPicker);

async function offlineState() {
  try {
    if (!('serviceWorker' in navigator)) return {prepared:false};
    const worker = (await navigator.serviceWorker.getRegistration('./'))?.active;
    if (!worker) return {prepared:false};
    return await new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve({prepared:false}); },1500);
      channel.port1.onmessage = ({data}) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(data?.version === OFFLINE_VERSION ? data : {prepared:false});
      };
      worker.postMessage({type:'STATUS'},[channel.port2]);
    });
  } catch { return {prepared:false}; }
}

async function refreshOfflineNotice() {
  const state = await offlineState();
  if ($('offline-prepare').disabled) return;
  showOfflineProgress(state.done,state.total);
  $('offline-status').textContent = state.prepared
    ? state.done + '/' + state.total + '개 준비 완료. 인터넷을 끄고 시험할 수 있어요.'
    : state.done ? state.done + '/' + state.total + '개 준비. 남은 파일을 이어서 받아 주세요.'
      : '오프라인 사용 전 인터넷에 연결해 이 버전의 파일을 준비해 주세요.';
}
function clearPaperPreview() {
  const paper = $('paper-preview');
  paper.hidden = true;
  paper.width = paper.height = 0;
}

function renderPaperPreview() {
  const paper = getPrintLayout($('print-paper').value, $('print-copies').value);
  $('print-summary').textContent = (paper.label ? '4×6인치' : paper.cssSize) + ' · ' + paper.copies + '장';
  const photo = $('full-preview').querySelector('canvas');
  const count = photographedProject(project).count;
  $('paper-unavailable').hidden = !!count;
  if (!count || Number(photo?.dataset.cutCount) !== count || step !== 'finish') {
    clearPaperPreview();
    return;
  }
  const preview = $('paper-preview');
  drawPaperPreview(preview, photo, paper);
  preview.setAttribute('aria-label', `${paper.label || paper.cssSize + ' 용지'}에 ${count}컷 사진 ${paper.copies}장 예상 배치`);
  preview.hidden = false;
}
for(const id of ['print-paper','print-copies'])on(id,'change',renderPaperPreview);

async function currentOfflineWorker(reg){for(let i=0;i<20;i++){const worker=reg.active;if(worker){const result=await new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage({type:'STATUS'},[channel.port2]);});if(result?.version===OFFLINE_VERSION)return worker;}await new Promise(resolve=>setTimeout(resolve,250));}return null;}

function renderClassroomProgress(filled, count) {
  const label = {background: '배경', camera: '촬영', edit: '꾸미기', finish: '완성'}[step];
  $('classroom-progress').textContent = filled + '/' + count + '컷 · ' + label;
}

function syncClassroomMode() {
  document.body.toggleAttribute('data-classroom-mode', classroomMode);
  $('classroom-mode-label').hidden = !classroomMode;
  $('classroom-mode-exit').hidden = !classroomMode;
}

function changeClassroomMode(value) {
  classroomMode = value;
  if (value) captureGroupStart();
  try { localStorage.setItem(classroomModeKey, value ? 'on' : 'off'); } catch {}
  syncClassroomMode();
}

on('classroom-mode-enter', 'click', safe(async () => {
  const button = $('classroom-mode-enter');
  const remember = $('classroom-persist');
  const status = $('classroom-persist-status');
  if (button.disabled) return;
  button.disabled = remember.disabled = true;
  status.hidden = !remember.checked;
  status.textContent = '수업 설정을 이 기기에 보관하고 있어요.';
  try {
    if (remember.checked) {
      await saveClassroom(currentLessonPreset(), backgrounds.filter(background => !background.builtIn)
        .map(({id,name,blob}) => ({id,name,blob})), logoBlob);
    } else await clearClassroom().catch(() => {});
    changeClassroomMode(true);
    $('teacher-dialog').close();
    status.hidden = true;
    $('stage-title').focus({preventScroll:true});
    scrollToStage();
    message(remember.checked ? '수업 설정을 기기에 보관하고 학생용 모드를 시작했어요.' : '학생용 수업 모드를 시작했어요.');
  } catch {
    status.hidden = false;
    status.textContent = '이 기기에 설정을 보관하지 못했어요. 다시 시도하거나 보관 선택을 해제하고 시작해 주세요.';
  } finally { button.disabled = remember.disabled = false; }
}));
on('classroom-mode-exit', 'click', safe(async () => {
  if (!await confirmAction('수업 모드를 종료할까요?', '교사 설정을 다시 열 수 있어요. 현재 사진은 유지됩니다.')) return;
  changeClassroomMode(false);
  await clearClassroom().catch(() => {});
  openTeacherSettings();
}));

function captureGroupStart() {
  groupStartPreset = structuredClone(presetOf(project, settings));
}

function currentLessonPreset() {
  return {...presetOf(project, settings), lockBackground: settings.lockBackground};
}

function renderLessonSummary() {
  const count = project.count || 4;
  const backgroundsInUse = new Set(project.cuts.slice(0, count).map(current => current.background));
  const name = backgrounds.find(background => backgroundsInUse.has(background.id))?.name;
  const backgroundSummary = backgroundsInUse.size > 1 ? '배경 ' + backgroundsInUse.size + '종' : (name || '기본') + ' 배경';
  $('current-lesson-summary').textContent = [loadedLesson?.name || '현재 설정', count + '컷', settings.timer + '초', backgroundSummary].join(' · ');
  $('lesson-modified').hidden = !loadedLesson || (loadedLesson.settings === JSON.stringify(currentLessonPreset()) && loadedLesson.logo === logoBlob);
}

function markLesson(name) {
  loadedLesson = name ? {name, settings: JSON.stringify(currentLessonPreset()), logo: logoBlob} : null;
  renderLessonSummary();
}

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
  captureGroupStart();
  teacherSync();
  render();
}

on('lesson-list', 'change', updateLessonControls);
on('lesson-form', 'submit', withLessonStorage(async () => {
  const name = $('lesson-name').value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name) throw Error('설정 이름을 입력해 주세요.');
  const replace = lessonNames.includes(name);
  if (replace && !await confirmAction('같은 이름으로 저장할까요?', `‘${name}’ 설정을 현재 값으로 바꿉니다.`)) return;
  const preset = currentLessonPreset();
  const selectedIds = new Set(preset.backgrounds);
  const chosen = backgrounds.filter(b => !b.builtIn && selectedIds.has(b.id))
    .map(({id, name, blob}) => ({id, name, blob}));
  const baseline = {name, settings: JSON.stringify(preset), logo: logoBlob};
  await saveLesson(name, preset, chosen, logoBlob, {replace});
  loadedLesson = baseline;
  renderLessonSummary();
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
  markLesson(name);
  $('lesson-status').textContent = `‘${name}’ 설정을 적용했어요.`;
}));

on('lesson-delete', 'click', withLessonStorage(async () => {
  const name = $('lesson-list').value;
  if (!name || !await confirmAction('수업 설정을 삭제할까요?', `‘${name}’ 설정을 이 기기에서 지웁니다.`)) return;
  await deleteLesson(name);
  if (loadedLesson?.name === name) markLesson(null);
  await refreshLessons();
  $('lesson-status').textContent = `‘${name}’ 설정을 삭제했어요.`;
}));
updateLessonControls();
