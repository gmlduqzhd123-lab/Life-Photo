import {eventFilenamePart} from './event-mode.mjs?v=event-workflow';

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

export function inspectEventFiles(event,names) {
  const prefix = eventFilenamePart(event.title) + '_';
  const rows = event.groups.map((group,index) => ({
    number:index + 1,group,reprint:!!event.reprint?.includes(index + 1),files:0,duplicates:0,seen:new Set()
  }));
  let skipped = 0;
  for (const raw of names) {
    const name = raw.normalize('NFC');
    const ending = name.startsWith(prefix) && name.slice(prefix.length).match(/^([0-9]{2})모둠_(.+?)(?: ?\(\d+\))?\.(png|pdf)$/i);
    const row = ending && rows[Number(ending[1]) - 1];
    const variant = ending?.[2];
    const format = ending?.[3]?.toLowerCase();
    if (!row || !(format === 'png' ? /^(완성|작게|[1-4]컷(?:_작게)?)$/.test(variant)
      : /^인쇄_(A4|A6|Letter|4x6)(?:_[1-4]컷)?$/.test(variant))) {
      skipped++;
      continue;
    }
    const key = variant + '.' + format;
    row.files++;
    if (row.seen.has(key)) row.duplicates++;
    row.seen.add(key);
  }
  return {skipped,rows:rows.map(({seen,...row}) => ({...row,missing:row.group === 'done' && !row.files}))};
}

const groupLabels = {waiting:'대기',active:'진행 중',held:'보류',done:'완료'};

export function eventReportCsv(event,report) {
  const csvLine = values => values.map(value => {
    const label = String(value);
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(label) ? "'" + label : label;
    return '"' + safe.replaceAll('"','""') + '"';
  }).join(',');
  const rows = report?.rows || inspectEventFiles(event,[]).rows;
  return '\uFEFF' + [
    csvLine(['행사','모둠','진행 상태','저장 파일 확인','중복 파일 수','재출력']),
    ...rows.map(row => csvLine([event.title,row.number,groupLabels[row.group],
      !report ? '미점검' : row.files ? row.files + '개' : row.missing ? '누락' : '없음',
      report ? row.duplicates : '',row.reprint ? '필요' : '']))
  ].join('\r\n') + '\r\n';
}
