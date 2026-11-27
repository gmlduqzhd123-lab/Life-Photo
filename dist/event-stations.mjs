const assignmentKind = 'life-photo-station';
const resultKind = 'life-photo-station-result';
const states = ['waiting','active','held','done'];

function eventIdentity(event) {
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

function stationScope(station,total) {
  const {name,first,last} = station || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 24
    || ![first,last].every(Number.isInteger) || first < 1 || last < first || last > total) {
    throw Error('촬영대 이름과 담당 모둠 범위를 확인해 주세요.');
  }
  return {name:name.trim(),first,last};
}

export function stationAssignment(event,station,settings) {
  const identity = eventIdentity(event);
  if (event.station) throw Error('전체 행사를 운영하는 화면에서 배정 파일을 만들어 주세요.');
  return {kind:assignmentKind,version:1,event:identity,station:stationScope(station,identity.total),settings};
}

export function openStationAssignment(data) {
  if (data?.kind !== assignmentKind || data.version !== 1) throw Error('촬영대 배정 파일을 골라 주세요.');
  const event = eventIdentity(data.event);
  const station = stationScope(data.station,event.total);
  const groups = Array.from({length:event.total},(_,index) => index+1 === station.first ? 'active'
    : index+1 > station.first && index+1 <= station.last ? 'waiting' : 'unassigned');
  return {event:{...event,station,groups,completed:0,current:station.first,revision:0},settings:data.settings};
}

export function stationResult(event) {
  const identity = eventIdentity(event);
  const station = stationScope(event.station,identity.total);
  const rows = [];
  for (let number = station.first; number <= station.last; number++) {
    const state = event.groups[number-1];
    const output = event.outputs?.[number];
    rows.push({number,state,output,printed:!!event.printed?.includes(number),reprint:!!event.reprint?.includes(number)});
  }
  return {kind:resultKind,version:1,event:identity,station,rows};
}

function readResult(data) {
  if (data?.kind !== resultKind || data.version !== 1) throw Error('촬영대 결과 파일을 골라 주세요.');
  const event = eventIdentity(data.event);
  const station = stationScope(data.station,event.total);
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
    return {number,state:row.state,output,printed:row.printed === true,reprint:row.reprint === true};
  });
  return {event,station,rows};
}

export function mergeStationResults(files) {
  if (!files.length) throw Error('합칠 촬영대 결과 파일을 선택해 주세요.');
  const results = files.map(readResult);
  const {event} = results[0];
  if (results.some(item => item.event.id !== event.id || item.event.title !== event.title || item.event.total !== event.total
    || item.event.round.code !== event.round.code || item.event.round.date !== event.round.date)) {
    throw Error('같은 행사의 같은 회차 결과만 합칠 수 있어요.');
  }
  const assigned = Array.from({length:event.total},() => []);
  for (const {station,rows} of results) for (const row of rows) assigned[row.number-1].push({...row,station:station.name});
  const outputs = {}, printed = [], reprint = [];
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
    return 'done';
  });
  return {event:{...event,groups,outputs,printed,reprint,completed:groups.filter(state => state === 'done').length},
    conflict,pending,stationCount:results.length};
}
