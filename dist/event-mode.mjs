export function normalizeEvent(event) {
  if (Array.isArray(event.groups)) return event;
  const groups = Array.from({length:event.total}, (_, index) => index < event.completed ? 'done' : 'waiting');
  const current = groups.indexOf('waiting') + 1 || null;
  if (current) groups[current - 1] = 'active';
  return {...event, groups, current, revision:0};
}

export function eventGroupNumber(event) {
  return event ? normalizeEvent(event).current : null;
}

export function changeEventGroup(event, action, group, output) {
  const {groups:previous, current, revision} = normalizeEvent(event);
  const groups = previous.slice();
  let outputs = event.outputs;
  if (action === 'select') {
    if (!Number.isInteger(group) || !['held','waiting'].includes(groups[group - 1])) {
      throw Error('대기 또는 보류 중인 모둠을 선택해 주세요.');
    }
    if (current) groups[current - 1] = 'waiting';
  } else {
    if (!current || !['complete','hold'].includes(action)) throw Error('진행 중인 모둠을 확인해 주세요.');
    if (action === 'complete' && output) {
      const {captured,target} = output;
      if (!validOutput(output)) throw Error('저장한 컷 수를 확인해 주세요.');
      outputs = {...outputs,[current]:{captured,target}};
    }
    groups[current - 1] = action === 'complete' ? 'done' : 'held';
    group = groups.indexOf('waiting') + 1 || null;
  }
  if (group) groups[group - 1] = 'active';
  return {...event, groups, current:group, completed:groups.filter(state => state === 'done').length, revision:revision + 1,
    ...(outputs ? {outputs} : {})};
}

function validOutput({captured,target}) {
  return Number.isInteger(target) && target >= 2 && target <= 4
    && Number.isInteger(captured) && captured >= 1 && captured <= target;
}

export function eventOutputLabel(output) {
  if (!output) return '';
  const {captured,target} = output;
  return (captured < target ? '일부 저장 ' : '전체 저장 ') + captured + '/' + target;
}

export function eventFilenamePart(title) {
  return title.normalize('NFC').replace(/[\p{Cc}<>:"/\\|?*]/gu,' ')
    .trim().replace(/\s+/g,'_').replace(/^\.+|\.+$/g,'') || '상상네컷_행사';
}

export function eventRound(id,date = new Date()) {
  return {
    date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(date),
    code:id.replaceAll('-','').slice(0,8).toUpperCase()
  };
}

export function eventFilePrefix(event) {
  return [eventFilenamePart(event.title),event.round?.date,event.round?.code].filter(Boolean).join('_');
}

export function eventFilename(event, variation, extension) {
  const group = eventGroupNumber(event);
  if (!group) return null;
  return [eventFilePrefix(event), String(group).padStart(2,'0') + '모둠', variation].filter(Boolean).join('_') + '.' + extension;
}

export function archiveEvent(current,report,closedAt) {
  const event = normalizeEvent(current);
  const {id,title,total,completed,groups} = event;
  const outputs = {};
  for (let index = 0; index < groups.length; index++) {
    const number = index + 1;
    const output = event.outputs?.[number];
    if (groups[index] === 'done' && output && validOutput(output)) {
      outputs[number] = {captured:output.captured,target:output.target};
    }
  }
  const round = event.round ? {date:event.round.date,code:event.round.code} : undefined;
  const reprint = (event.reprint || []).filter(number => Number.isInteger(number) && number >= 1 && number <= total);
  const inspection = report ? {skipped:report.skipped,pendingLegacy:report.pendingLegacy || 0,
    rows:groups.map((group,index) => {
      const number = index + 1;
      const checked = report.rows.find(row => row.number === number);
      const files = checked?.files || 0;
      return {number,group,files,duplicates:checked?.duplicates || 0,missing:group === 'done' && !files,
        reprint:reprint.includes(number),output:outputs[number]};
    })} : null;
  return {id,title,total,completed,groups:[...groups],round,reprint,outputs,closedAt,inspection};
}
