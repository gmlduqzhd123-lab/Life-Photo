export function normalizeEvent(event) {
  if (Array.isArray(event.groups)) return event;
  const groups = Array.from({length:event.total}, (_, index) => index < event.completed ? 'done' : 'waiting');
  const current = groups.indexOf('waiting') + 1 || null;
  if (current) groups[current - 1] = 'active';
  return {...event, groups, current, revision:0};
}

export function eventGroupNumber(event) {
  return event ? event.retry || normalizeEvent(event).current : null;
}

export function eventGroupTotal(event) {
  return event.station ? event.station.last - event.station.first + 1 : event.total;
}

export function canRetryGroup(event,group) {
  const output = event.outputs?.[group];
  return !event.retry && event.groups[group - 1] === 'done' && output?.captured < output?.target;
}

export function changeEventGroup(event, action, group, output) {
  event = normalizeEvent(event);
  const {groups:previous,current,revision,retry} = event;
  if (retry) {
    if (action === 'cancel-retry') return {...event,retry:null,revision:revision + 1};
    if (action !== 'complete') throw Error('재촬영을 마치거나 취소해 주세요.');
    if (!output || !validOutput(output) || output.captured !== output.target
      || output.target !== event.outputs[retry].target) throw Error('모든 컷을 채운 뒤 재촬영 결과를 확정해 주세요.');
    const outputs = {...event.outputs,[retry]:{captured:output.captured,target:output.target}};
    return {...event,retry:null,outputs,revision:revision + 1,
      printed:(event.printed || []).filter(number => number !== retry),
      reprint:(event.reprint || []).filter(number => number !== retry)};
  }
  if (action === 'retry') {
    if (!canRetryGroup(event,group)) throw Error('일부 저장한 모둠을 골라 주세요.');
    return {...event,retry:group,revision:revision + 1};
  }
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

export function eventPrintLabel(event,number) {
  if (event.reprint?.includes(number)) return '재출력 필요';
  if (event.printed?.includes(number)) return '인쇄 확인';
  return event.groups[number - 1] === 'done' ? '출력 대기' : '';
}

export function confirmEventPrint(event,numbers) {
  const groups = new Set(numbers);
  if (!groups.size || [...groups].some(number => !Number.isInteger(number)
    || event.groups[number - 1] !== 'done' || event.retry === number)) throw Error('저장을 마친 모둠을 선택해 주세요.');
  return {...event,printed:[...new Set([...(event.printed || []),...groups])],
    reprint:(event.reprint || []).filter(number => !groups.has(number)),revision:event.revision + 1};
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
  const station = event.station ? {name:event.station.name,first:event.station.first,last:event.station.last} : undefined;
  const reprint = (event.reprint || []).filter(number => Number.isInteger(number) && number >= 1 && number <= total);
  const printed = (event.printed || []).filter(number => Number.isInteger(number) && number >= 1 && number <= total);
  const inspection = report ? {skipped:report.skipped,pendingLegacy:report.pendingLegacy || 0,
    rows:groups.map((group,index) => {
      const number = index + 1;
      const checked = report.rows.find(row => row.number === number);
      const files = checked?.files || 0;
      return {number,group,files,duplicates:checked?.duplicates || 0,missing:group === 'done' && !files,
        reprint:reprint.includes(number),output:outputs[number],printStatus:eventPrintLabel(event,number)};
    })} : null;
  return {id,title,total,completed,groups:[...groups],round,station,reprint,printed,outputs,closedAt,inspection};
}
