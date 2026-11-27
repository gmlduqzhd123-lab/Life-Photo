const assignmentKind = 'life-photo-station';
const resultKind = 'life-photo-station-result';
const states = ['waiting','active','held','done'];

export function eventIdentity(event) {
  const {id,title,total,round} = event || {};
  if (typeof id !== 'string' || !/^[0-9a-f-]{20,40}$/i.test(id)
    || typeof title !== 'string' || !title.trim() || title.length > 36
    || !Number.isInteger(total) || total < 1 || total > 99
    || !/^\d{4}-\d{2}-\d{2}$/.test(round?.date) || !/^[A-F0-9]{8}$/.test(round?.code)
    || round.code !== id.replaceAll('-','').slice(0,8).toUpperCase()) {
    throw Error('행사 이름과 회차가 있는 촬영대 파일을 선택해 주세요.');
  }
  return {id,title,total,round:{date:round.date,code:round.code}};
}

export function stationScope(station,total) {
  const {name,first,last} = station || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 24
    || ![first,last].every(Number.isInteger) || first < 1 || last < first || last > total) {
    throw Error('촬영대 이름과 담당 모둠 범위를 확인해 주세요.');
  }
  const scope = {name:name.trim().normalize('NFC'),first,last};
  if (station.id !== undefined) {
    if (typeof station.id !== 'string' || !/^[0-9a-f-]{20,40}$/i.test(station.id)
      || !Number.isSafeInteger(station.generation) || station.generation < 1) {
      throw Error('촬영대 배정 식별자를 확인해 주세요.');
    }
    Object.assign(scope,{id:station.id,generation:station.generation});
  }
  return scope;
}

export function stationPlan(entries,total) {
  if (!Array.isArray(entries) || entries.length > total) throw Error('촬영대 배정 수를 확인해 주세요.');
  const plan = entries.map(entry => stationScope(entry,total));
  const taken = new Set(), names = new Set(), ids = new Set();
  for (const {name,first,last,id} of plan) {
    const normalized = name.toLocaleLowerCase('ko');
    if (names.has(normalized) || !id || ids.has(id)) throw Error('촬영대 이름은 서로 다르게 지정해 주세요.');
    names.add(normalized);
    ids.add(id);
    for (let number = first; number <= last; number++) {
      if (taken.has(number)) throw Error(number + '모둠의 촬영대 배정이 겹쳐요.');
      taken.add(number);
    }
  }
  const missing = Array.from({length:total},(_,index) => index + 1).filter(number => !taken.has(number));
  return {plan:plan.sort((a,b) => a.first - b.first),missing};
}

export function readPinHash(pinHash) {
  if (pinHash === undefined) return undefined;
  if (typeof pinHash !== 'string' || !/^[a-f0-9]{64}$/.test(pinHash)) throw Error('교사 메뉴 잠금 설정을 확인해 주세요.');
  return pinHash;
}

export function stationAssignment(event,station,settings) {
  const identity = eventIdentity(event);
  if (event.station) throw Error('전체 행사를 운영하는 화면에서 배정 파일을 만들어 주세요.');
  return {kind:assignmentKind,version:2,event:identity,station:stationScope(station,identity.total),settings,
    pinHash:readPinHash(event.pinHash)};
}

export function openStationAssignment(data) {
  if (data?.kind !== assignmentKind || ![1,2].includes(data.version)) throw Error('촬영대 배정 파일을 골라 주세요.');
  const event = eventIdentity(data.event);
  const station = stationScope(data.station,event.total);
  const groups = Array.from({length:event.total},(_,index) => index+1 === station.first ? 'active'
    : index+1 > station.first && index+1 <= station.last ? 'waiting' : 'unassigned');
  return {event:{...event,station,groups,completed:0,current:station.first,revision:0,
    pinHash:data.version === 2 ? readPinHash(data.pinHash) : undefined},settings:data.settings};
}

export function stationResult(event) {
  const identity = eventIdentity(event);
  const station = stationScope(event.station,identity.total);
  const rows = [];
  for (let number = station.first; number <= station.last; number++) {
    const state = event.groups[number-1];
    const output = event.outputs?.[number];
    const marker = event.replacedAfterBatch?.[number] || 0;
    const prepared = event.printBatches?.some(batch => batch.number > marker && batch.groups.some(group => group.number === number));
    rows.push({number,state,output,printed:!!event.printed?.includes(number),reprint:!!event.reprint?.includes(number),prepared:!!prepared});
  }
  return {kind:resultKind,version:2,event:identity,station,rows,revision:event.revision ?? 0};
}

function readResult(data) {
  if (data?.kind !== resultKind || ![1,2].includes(data.version)) throw Error('촬영대 결과 파일을 골라 주세요.');
  const event = eventIdentity(data.event);
  const station = stationScope(data.station,event.total);
  const revision = data.version === 1 ? -1 : data.revision;
  if (!Number.isSafeInteger(revision) || revision < (data.version === 1 ? -1 : 0)) throw Error('촬영대 결과 버전을 확인해 주세요.');
  if (!Array.isArray(data.rows) || data.rows.length !== station.last - station.first + 1) throw Error('촬영대 모둠 범위가 달라요.');
  const rows = data.rows.map((row,index) => {
    const number = station.first + index;
    if (row?.number !== number || !states.includes(row.state)) throw Error('촬영대 결과의 모둠 번호를 확인해 주세요.');
    let output;
    if (row.output) {
      const {captured,target} = row.output;
      if (row.state !== 'done' || ![2,3,4].includes(target)
        || !Number.isInteger(captured) || captured < 1 || captured > target) throw Error('저장한 컷 수를 확인해 주세요.');
      output = {captured,target};
    }
    return {number,state:row.state,output,printed:row.printed === true,reprint:row.reprint === true,prepared:row.prepared === true};
  });
  return {kind:resultKind,version:data.version,event,station,rows,...(data.version === 2 ? {revision} : {})};
}

const stationKey = ({id,name,first,last}) => id || JSON.stringify([name,first,last]);

export function sameEventRound(a,b) {
  return a.id === b.id && a.title === b.title && a.total === b.total
    && a.round.code === b.round.code && a.round.date === b.round.date;
}

export function updateStationResults(previous,files) {
  if (!files.length) throw Error('합칠 촬영대 결과 파일을 선택해 주세요.');
  const incoming = files.map(readResult);
  const {event} = incoming[0];
  if ([...previous,...incoming].some(item => !sameEventRound(item.event,event))) {
    throw Error('같은 행사의 같은 회차 결과만 합칠 수 있어요.');
  }
  const results = new Map(previous.map(item => [stationKey(item.station),item]));
  let updated = 0, ignored = 0;
  for (const item of incoming) {
    const key = stationKey(item.station);
    const saved = results.get(key);
    if (saved) {
      const order = (item.station.generation || 0) - (saved.station.generation || 0)
        || (item.revision ?? -1) - (saved.revision ?? -1);
      const identical = JSON.stringify(saved) === JSON.stringify(item);
      if (order < 0 || identical) { ignored++; continue; }
      if (!order && item.version === 2) throw Error(item.station.name + ' 촬영대에 같은 버전의 다른 결과가 있어요. 사용할 파일을 확인해 주세요.');
    }
    results.set(key,item);
    updated++;
  }
  if (results.size > 99) throw Error('한 회차에 보관할 촬영대가 너무 많아요.');
  return {event,files:[...results.values()],updated,ignored};
}

export function mergeStationResults(files) {
  const {event,files:results} = updateStationResults([],files);
  const assigned = Array.from({length:event.total},() => []);
  for (const {station,rows} of results) for (const row of rows) assigned[row.number-1].push({...row,station:station.name});
  const outputs = {}, printed = [], reprint = [], prepared = [];
  const conflict = [], pending = [];
  const groups = assigned.map((entries,index) => {
    const number = index + 1;
    if (entries.length > 1) {
      conflict.push({number,stations:entries.map(entry => entry.station)});
      return 'conflict';
    }
    const entry = entries[0];
    if (entry?.state !== 'done') {
      pending.push(number);
      return entry?.state || 'waiting';
    }
    if (entry.output) outputs[number] = entry.output;
    if (entry.reprint) reprint.push(number);
    else if (entry.printed) printed.push(number);
    if (entry.prepared) prepared.push(number);
    return 'done';
  });
  return {event:{...event,groups,outputs,printed,reprint,prepared,completed:groups.filter(state => state === 'done').length},
    conflict,pending,stationCount:results.length};
}
