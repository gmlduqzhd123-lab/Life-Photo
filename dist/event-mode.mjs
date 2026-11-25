export function eventGroupNumber(event) {
  return event.completed < event.total ? event.completed + 1 : null;
}

export function eventFilename(event, variation, extension) {
  const group = event && eventGroupNumber(event);
  if (!group) return null;
  const title = event.title.normalize('NFC').replace(/[\p{Cc}<>:"/\\|?*]/gu,' ')
    .trim().replace(/\s+/g,'_').replace(/^\.+|\.+$/g,'') || '상상네컷_행사';
  return [title, String(group).padStart(2,'0') + '모둠', variation].filter(Boolean).join('_') + '.' + extension;
}
