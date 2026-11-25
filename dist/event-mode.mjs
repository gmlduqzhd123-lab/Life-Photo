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

export function changeEventGroup(event, action, group) {
  const {groups:previous, current, revision} = normalizeEvent(event);
  const groups = previous.slice();
  if (action === 'select') {
    if (!Number.isInteger(group) || !['held','waiting'].includes(groups[group - 1])) {
      throw Error('대기 또는 보류 중인 모둠을 선택해 주세요.');
    }
    if (current) groups[current - 1] = 'waiting';
  } else {
    if (!current || !['complete','hold'].includes(action)) throw Error('진행 중인 모둠을 확인해 주세요.');
    groups[current - 1] = action === 'complete' ? 'done' : 'held';
    group = groups.indexOf('waiting') + 1 || null;
  }
  if (group) groups[group - 1] = 'active';
  return {...event, groups, current:group, completed:groups.filter(state => state === 'done').length, revision:revision + 1};
}

export function eventFilenamePart(title) {
  return title.normalize('NFC').replace(/[\p{Cc}<>:"/\\|?*]/gu,' ')
    .trim().replace(/\s+/g,'_').replace(/^\.+|\.+$/g,'') || '상상네컷_행사';
}

export function eventFilename(event, variation, extension) {
  const group = eventGroupNumber(event);
  if (!group) return null;
  return [eventFilenamePart(event.title), String(group).padStart(2,'0') + '모둠', variation].filter(Boolean).join('_') + '.' + extension;
}
