import {addPrintBatch,archiveEvent,changeEventGroup,confirmEventPrint,normalizeEvent} from './event-mode.mjs?v=event-operations';
import {stationPlan,updateStationResults} from './event-stations.mjs?v=event-operations';

const DB = 'imagine-four-settings';
const STORE = 'settings';
const STARTUP = 'preset';
const ACTIVE_CLASSROOM = 'active-classroom';
const ACTIVE_EVENT = 'active-event';
const RECENT_EVENTS = 'recent-events';
const LESSON_PREFIX = 'lesson:';
const STATION_RESULTS_PREFIX = 'station-results:';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('기기 저장 공간이 다른 창에서 사용 중이에요.'));
  });
}

async function accessStore(mode, startRequest) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let answer;
      let failure;
      transaction.oncomplete = () => resolve(answer);
      transaction.onabort = () => reject(failure || transaction.error || Error('기기 저장 공간을 확인해 주세요.'));
      try {
        startRequest(
          transaction.objectStore(STORE),
          value => { answer = value; },
          error => { failure = error; transaction.abort(); }
        );
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  } finally {
    database.close();
  }
}

function readKey(key) {
  return accessStore('readonly', (store, result) => {
    const request = store.get(key);
    request.onsuccess = () => result(request.result ?? null);
  });
}

function deleteKey(key) {
  return accessStore('readwrite', store => store.delete(key));
}

function snapshot(preset, backgrounds, logo) {
  const size = backgrounds.reduce((total, background) => total + background.blob.size, 0);
  if (backgrounds.length > 20 || size > 50 * 1024 * 1024) {
    throw Error('배경은 20개, 합계 50MB까지 저장할 수 있어요.');
  }
  return {preset, backgrounds, logo};
}

export const readSaved = () => readKey(STARTUP);
export const clearSaved = () => deleteKey(STARTUP);
export async function saveSettings(preset, backgrounds, logo = null) {
  const data = snapshot(preset, backgrounds, logo);
  return accessStore('readwrite', store => store.put(data, STARTUP));
}

export const readClassroom = () => readKey(ACTIVE_CLASSROOM);
export const clearClassroom = () => deleteKey(ACTIVE_CLASSROOM);
export function saveClassroom(preset, backgrounds, logo = null) {
  const data = snapshot(preset, backgrounds, logo);
  return accessStore('readwrite', store => store.put(data, ACTIVE_CLASSROOM));
}

export async function readEvent() {
  const saved = await readKey(ACTIVE_EVENT);
  return saved ? {...saved,event:normalizeEvent(saved.event)} : null;
}

export function startEvent(event, preset, backgrounds, logo) {
  event = normalizeEvent(event);
  const data = {...snapshot(preset,backgrounds,logo),event};
  return accessStore('readwrite', (store,result,fail) => {
    const request = store.add(data,ACTIVE_EVENT);
    request.onsuccess = () => result(event);
    request.onerror = e => {
      e.preventDefault();
      fail(request.error?.name === 'ConstraintError'
        ? Error('이미 이 기기에서 진행 중인 행사가 있어요. 화면을 새로고침해 주세요.') : request.error);
    };
  });
}

function updateEvent(expected, apply) {
  return accessStore('readwrite', (store,result,fail) => {
    const request = store.get(ACTIVE_EVENT);
    request.onsuccess = () => {
      const saved = request.result;
      if (saved?.event?.id !== expected.id || normalizeEvent(saved.event).revision !== expected.revision) {
        fail(Error('다른 창에서 행사 진행이 바뀌었어요. 현재 사진을 저장한 뒤 화면을 새로고침해 주세요.'));
        return;
      }
      try { apply(store,saved,result); }
      catch (error) { fail(error); }
    };
  });
}

export function advanceEvent(expected, action = 'complete', group, output) {
  return updateEvent(expected,(store,saved,result) => {
    const event = changeEventGroup(saved.event, action, group, output);
    store.put({...saved,event},ACTIVE_EVENT);
    result(event);
  });
}

export function setEventReprint(expected,group,value) {
  return updateEvent(expected,(store,saved,result) => {
    const current = normalizeEvent(saved.event);
    if (!Number.isInteger(group) || group < 1 || group > current.total) throw Error('모둠 번호를 확인해 주세요.');
    const reprint = new Set(current.reprint || []);
    if (value) reprint.add(group);
    else reprint.delete(group);
    const printed = value ? (current.printed || []).filter(number => number !== group) : current.printed;
    const event = {...current,reprint:[...reprint],printed,revision:current.revision + 1};
    store.put({...saved,event},ACTIVE_EVENT);
    result(event);
  });
}

export function markEventPrinted(expected,numbers) {
  return updateEvent(expected,(store,saved,result) => {
    const event = confirmEventPrint(normalizeEvent(saved.event),numbers);
    store.put({...saved,event},ACTIVE_EVENT);
    result(event);
  });
}

export function saveEventPrintBatch(expected,numbers,pages) {
  return updateEvent(expected,(store,saved,result) => {
    const event = addPrintBatch(normalizeEvent(saved.event),numbers,pages,new Date().toISOString());
    store.put({...saved,event},ACTIVE_EVENT);
    result(event);
  });
}

export function setStationPlan(expected,entries) {
  return updateEvent(expected,(store,saved,result) => {
    const {event:current} = saved;
    const {plan} = stationPlan(entries,current.total);
    const event = {...current,stationPlan:plan,revision:current.revision + 1};
    store.put({...saved,event},ACTIVE_EVENT);
    result(event);
  });
}

export async function listStationResultRounds() {
  return accessStore('readonly',(store,result) => {
    const request = store.getAll(IDBKeyRange.bound(STATION_RESULTS_PREFIX,'station-results;',false,true));
    request.onsuccess = () => result(request.result.sort((a,b) => b.event.round.date.localeCompare(a.event.round.date)));
  });
}

export const readStationResults = id => readKey(STATION_RESULTS_PREFIX + id);

export function saveStationResults(files) {
  const incoming = updateStationResults([],files);
  const key = STATION_RESULTS_PREFIX + incoming.event.id;
  return accessStore('readwrite',(store,result,fail) => {
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const saved = request.result?.files || [];
        const updated = updateStationResults(saved,files);
        store.put({event:updated.event,files:updated.files},key);
        result({...updated,previous:saved});
      } catch (error) { fail(error); }
    };
  });
}

export function restoreEventBackup(event,preset,backgrounds,logo,files) {
  const data = {...snapshot(preset,backgrounds,logo),event};
  const key = STATION_RESULTS_PREFIX + event.id;
  return accessStore('readwrite',(store,result,fail) => {
    const active = store.add(data,ACTIVE_EVENT);
    active.onerror = error => {
      error.preventDefault();
      fail(Error('진행 중인 행사를 백업하고 종료한 뒤 복원해 주세요.'));
    };
    active.onsuccess = () => {
      if (!files.length) { result(event); return; }
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const updated = updateStationResults(request.result?.files || [],files);
          store.put({event:updated.event,files:updated.files},key);
          result(event);
        } catch (error) { fail(error); }
      };
    };
  });
}

export async function readRecentEvents() {
  return (await readKey(RECENT_EVENTS)) || [];
}

export function finishEvent(expected,report = null) {
  return updateEvent(expected,(store,saved,result) => {
    const closed = archiveEvent(saved.event,report,new Date().toISOString());
    const request = store.get(RECENT_EVENTS);
    request.onsuccess = () => {
      const sameStation = (first,second) => first?.name === second?.name && first?.first === second?.first && first?.last === second?.last;
      const recent = (request.result || []).filter(entry => entry.id !== closed.id || !sameStation(entry.station,closed.station));
      store.put([closed,...recent].slice(0,20),RECENT_EVENTS);
      store.delete(ACTIVE_EVENT);
      result(closed);
    };
  });
}

function lessonRange() {
  return IDBKeyRange.bound(LESSON_PREFIX, 'lesson;', false, true);
}

export function listLessons() {
  return accessStore('readonly', (store, result) => {
    const request = store.getAllKeys(lessonRange());
    request.onsuccess = () => result(
      request.result.map(key => key.slice(LESSON_PREFIX.length)).sort((a, b) => a.localeCompare(b, 'ko'))
    );
  });
}

export const getLesson = name => readKey(LESSON_PREFIX + name);
export const deleteLesson = name => deleteKey(LESSON_PREFIX + name);

export async function saveLesson(name, preset, backgrounds, logo, {replace = false} = {}) {
  const key = LESSON_PREFIX + name;
  const data = snapshot(preset, backgrounds, logo);
  return accessStore('readwrite', (store, _result, fail) => {
    const request = store.getAllKeys(lessonRange());
    request.onsuccess = () => {
      const existing = request.result.includes(key);
      if (existing && !replace) {
        fail(Error('같은 이름의 설정이 이미 있어요. 이름을 바꾸거나 다시 저장해 주세요.'));
      } else if (!existing && request.result.length >= 12) {
        fail(Error('수업 설정은 12개까지 보관할 수 있어요. 필요 없는 설정을 먼저 삭제해 주세요.'));
      } else {
        store.put(data, key);
      }
    };
  });
}
