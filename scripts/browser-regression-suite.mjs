import {readEvent,startEvent,advanceEvent,finishEvent} from '/storage.mjs?v=event-workflow';
import {eventFilename} from '/event-mode.mjs?v=event-workflow';
import {newProject,addItem} from '/core.mjs?v=event-workflow';
import {initSegmenter,segmentPhoto,resetSegmenter} from '/segment-client.mjs';
import {canvasBlob,makeCutout} from '/image-tools.mjs?v=event-workflow';
import {renderProject,loadImage} from '/render.mjs?v=event-workflow';
import {BUILT_IN_BACKGROUNDS} from '/background-catalog.mjs?v=mobile-ux';

const result = document.getElementById('result');
const notes = [];
const check = (condition,message) => { if (!condition) throw Error(message); };
function report(message) {
  notes.push(message);
  result.textContent = notes.join('\n');
}

async function checkProgress() {
  check(!(await readEvent()),'테스트 전용 주소에서 행사 기록을 비워 주세요.');
  let current = await startEvent({id:'qa',title:'회귀 검증',total:10,completed:0},{},[],null);
  const names = new Set();
  try {
    for (let group = 1; group <= 10; group += 1) {
      check(current.current === group,'잘못된 모둠 번호');
      if (group === 3) {
        const stale = current;
        current = await advanceEvent(current,'hold');
        check(current.groups[2] === 'held','3모둠 보류 실패');
        let rejected = false;
        try { await advanceEvent(stale,'select',5); }
        catch { rejected = true; }
        check(rejected,'동일 완료 수의 다른 창 쓰기 거부 실패');
        continue;
      }
      names.add(eventFilename(current,'완성','png'));
      current = await advanceEvent(current);
      current = (await readEvent()).event;
    }
    check(current.current === null && current.completed === 9,'보류 상태 복원 실패');
    current = await advanceEvent(current,'select',3);
    names.add(eventFilename(current,'완성','png'));
    check(eventFilename(current,'인쇄_A4','pdf') === '회귀_검증_03모둠_인쇄_A4.pdf','복귀 모둠 파일명 불일치');
    current = await advanceEvent(current);
    check(current.completed === 10 && current.current === null && names.size === 10,'완료 집계 불일치');
    report('PASS · IndexedDB 재조회, 10모둠, 순서 변경 및 다른 창 충돌');
  } finally {
    await finishEvent((await readEvent()).event);
  }
}

function canvas(width,height) {
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  return target;
}

function drawVariant(image, effect) {
  const variant = canvas(image.width,image.height);
  const ctx = variant.getContext('2d');
  if (effect === 'backlight') ctx.filter = 'brightness(60%) contrast(145%)';
  ctx.drawImage(image,0,0);
  ctx.filter = 'none';
  if (effect === 'backlight') {
    const light = ctx.createLinearGradient(0,0,variant.width,variant.height / 2);
    light.addColorStop(0,'#fff9d5aa');
    light.addColorStop(.36,'#ffffff00');
    ctx.fillStyle = light;
    ctx.fillRect(0,0,variant.width,variant.height);
  }
  if (effect === 'glasses') {
    ctx.strokeStyle = '#241d25';
    ctx.lineWidth = variant.width * .009;
    ctx.beginPath();
    for (const x of [.435,.55]) {
      ctx.moveTo((x + .051) * variant.width,.164 * variant.height);
      ctx.ellipse(x * variant.width,.164 * variant.height,.051 * variant.width,.025 * variant.height,0,0,2 * Math.PI);
    }
    ctx.moveTo(.485 * variant.width,.157 * variant.height);
    ctx.lineTo(.5 * variant.width,.157 * variant.height);
    ctx.stroke();
  }
  return variant;
}

function showSample(label,source) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  const thumbnail = canvas(140,140);
  const ratio = Math.min(140 / source.width,140 / source.height);
  const w = source.width * ratio;
  const h = source.height * ratio;
  thumbnail.getContext('2d').drawImage(source,(140-w)/2,(140-h)/2,w,h);
  figure.append(thumbnail,caption);
  document.getElementById('samples').append(figure);
}

const median = values => values.sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(1);
async function compareQualityAndSpeed() {
  let image;
  try { image = await loadImage('/__qa/portrait.jpg'); }
  catch { report('SKIP · 공개 검증용 초상 파일의 경로를 서버에 전달해 주세요.'); return; }
  await initSegmenter();
  const phases = {model:[],cutout:[],full:[],small:[]};
  async function cut(label, source) {
    const start = performance.now();
    const {mask,w,h} = await segmentPhoto(source);
    const segmented = performance.now();
    const cutout = makeCutout(source,mask,w,h);
    const end = performance.now();
    const foreground = mask.reduce((count,value) => count + Number(value > .5),0) / mask.length;
    check(foreground > .01 && foreground < .98,label + '의 인물 범위를 확인해 주세요.');
    phases.model.push(segmented-start);
    phases.cutout.push(end-segmented);
    showSample(label,cutout);
    report('PASS · ' + label + ' · 인물 마스크 ' + (100 * foreground).toFixed(1) + '%');
    return cutout;
  }
  const baseline = await cut('공개 원본·머리카락 경계',drawVariant(image,'baseline'));
  await cut('합성 역광',drawVariant(image,'backlight'));
  await cut('합성 안경',drawVariant(image,'glasses'));
  const overlap = canvas(image.width,image.height);
  const ctx = overlap.getContext('2d');
  ctx.fillStyle = '#ddd0bd';
  ctx.fillRect(0,0,overlap.width,overlap.height);
  ctx.drawImage(baseline,0,overlap.height * .17,overlap.width * .62,overlap.height * .83);
  ctx.drawImage(baseline,overlap.width * .36,overlap.height * .05,overlap.width * .64,overlap.height * .95);
  await cut('합성 두 인물 겹침',overlap);

  const project = newProject();
  const assets = new Map([['portrait',{image:baseline,w:baseline.width,h:baseline.height}]]);
  const backgrounds = BUILT_IN_BACKGROUNDS.map(background => ({...background,url:new URL(background.url,location.origin).href}));
  project.cuts.forEach(cut => addItem(cut,'portrait',baseline.width,baseline.height));
  const original = await renderProject(project,assets,backgrounds);
  original.toBlob = callback => callback(null);
  let stopped = false;
  try { await canvasBlob(original,'image/png'); }
  catch { stopped = true; }
  finally { original.width = original.height = 0; }
  check(stopped,'PNG 인코딩 실패가 반환되지 않았어요.');
  const retry = await renderProject(project,assets,backgrounds,2400 / 4400);
  const retryBytes = new Uint8Array(await (await canvasBlob(retry,'image/png')).slice(0,8).arrayBuffer());
  retry.width = retry.height = 0;
  check(retryBytes.join(',') === '137,80,78,71,13,10,26,10','사진을 유지한 PNG 재시도 실패');
  report('PASS · 고화질 PNG 인코딩 실패 뒤 같은 편집 내용으로 작은 PNG 생성');
  for (const [label,scale] of [['full',1],['small',2400 / 4400]]) {
    for (let pass = 0; pass < 4; pass += 1) {
      const start = performance.now();
      const photo = await renderProject(project,assets,backgrounds,scale);
      await canvasBlob(photo,'image/png');
      if (pass) phases[label].push(performance.now() - start);
      photo.width = photo.height = 0;
    }
  }
  report('측정 중앙값(ms) · 모델 ' + median(phases.model) + ' · 마스크 ' + median(phases.cutout) +
    ' · 고화질 PNG ' + median(phases.full) + ' · 작은 PNG ' + median(phases.small));
}

try {
  await checkProgress();
  await compareQualityAndSpeed();
  document.documentElement.dataset.result = 'pass';
} catch (error) {
  report('FAIL · ' + error.message);
  document.documentElement.dataset.result = 'fail';
} finally {
  resetSegmenter();
}
