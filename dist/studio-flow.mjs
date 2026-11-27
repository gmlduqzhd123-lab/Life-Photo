import {eventFilePrefix,eventFilenamePart,eventOutputLabel} from './event-mode.mjs?v=event-review';

const anchors = {
  'track-finish':{center:600,feet:801,height:560},
  'graduation-wall':{center:600,feet:815,height:625},
  'space':{center:595,feet:730,height:530},
  'ocean':{center:640,feet:720,height:510},
  'classroom':{center:620,feet:825,height:590},
  'stage':{center:600,feet:790,height:570},
  'hanok-alley':{center:610,feet:814,height:570}
};

export function suggestedPlacement(background, people) {
  const {center,feet,height} = anchors[background] || {center:600,feet:815,height:578};
  const span = Math.min(820,people.length * 420);
  const slot = span / people.length;
  return people.map(({id,width,height:sourceHeight},index) => {
    const scale = Math.min(2.5,height / sourceHeight,(slot - 24) / width);
    return {id,x:center - span / 2 + slot * (index + .5),y:feet - sourceHeight * scale / 2,scale,rotation:0};
  });
}

function matchEventOutput(name,prefix) {
  if (!name.startsWith(prefix)) return null;
  const ending = name.slice(prefix.length).match(/^([0-9]{2})모둠_(.+?)(?: ?\(\d+\))?\.(png|pdf)$/i);
  if (!ending) return null;
  const [,number,variant,ext] = ending;
  const format = ext.toLowerCase();
  if (!(format === 'png' ? /^(완성|작게|[1-4]컷(?:_작게)?)$/.test(variant)
    : /^인쇄_(A4|A6|Letter|4x6)(?:_[1-4]컷)?$/.test(variant))) return null;
  return {number:Number(number),variant,format};
}

export function inspectEventFiles(event,names,{acceptLegacy = false} = {}) {
  const prefix = eventFilePrefix(event) + '_';
  const legacyPrefix = eventFilenamePart(event.title) + '_';
  const rows = event.groups.map((group,index) => ({
    number:index + 1,group,output:event.outputs?.[index + 1],reprint:!!event.reprint?.includes(index + 1),
    files:0,duplicates:0,seen:new Set(),png:[]
  }));
  let skipped = 0;
  let pendingLegacy = 0;
  for (const [index,raw] of names.entries()) {
    const name = raw.normalize('NFC');
    const current = matchEventOutput(name,prefix);
    const legacy = !current && event.round && matchEventOutput(name,legacyPrefix);
    const match = current || legacy;
    const row = match && rows[match.number - 1];
    if (!row) {
      skipped++;
      continue;
    }
    if (legacy && !acceptLegacy) {
      pendingLegacy++;
      continue;
    }
    const {variant,format} = match;
    const key = variant + '.' + format;
    row.files++;
    if (format === 'png') row.png.push(index);
    if (row.seen.has(key)) row.duplicates++;
    row.seen.add(key);
  }
  return {skipped,pendingLegacy,rows:rows.map(({seen,...row}) => ({...row,missing:row.group === 'done' && !row.files}))};
}

export const eventGroupLabels = {waiting:'대기',active:'진행 중',held:'보류',done:'완료'};

export function eventReportCsv(event,report) {
  const csvLine = values => values.map(value => {
    const label = String(value);
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(label) ? "'" + label : label;
    return '"' + safe.replaceAll('"','""') + '"';
  }).join(',');
  const rows = report?.rows || inspectEventFiles(event,[]).rows;
  return '\uFEFF' + [
    csvLine(['행사','모둠','진행 상태','저장 파일 확인','중복 파일 수','재출력','저장한 컷','행사일','회차']),
    ...rows.map(row => csvLine([event.title,row.number,eventGroupLabels[row.group],
      !report ? '미점검' : row.files ? row.files + '개' : row.missing ? '누락' : '없음',
      report ? row.duplicates : '',row.reprint ? '필요' : '',eventOutputLabel(row.output),
      event.round?.date || '',event.round?.code || '']))
  ].join('\r\n') + '\r\n';
}

export function cameraCrop(width,height) {
  const w = Math.min(width,height * 4 / 3);
  const h = Math.min(height,width * 3 / 4);
  return {x:(width-w)/2,y:(height-h)/2,w,h};
}

export function cameraGuideBox(width,height,viewWidth,viewHeight) {
  if (Math.min(width,height,viewWidth,viewHeight) <= 0) return null;
  const scale = Math.min(viewWidth/width,viewHeight/height);
  const {w,h} = cameraCrop(width,height);
  const guideWidth = w*scale/viewWidth*100;
  const guideHeight = h*scale/viewHeight*100;
  return {left:(100-guideWidth)/2,top:(100-guideHeight)/2,width:guideWidth,height:guideHeight};
}
