import {eventIdentity,readPinHash,sameEventRound,stationPlan,stationScope,updateStationResults} from './event-stations.mjs?v=event-operations';

const kind = 'life-photo-event-backup';
const states = ['waiting','active','held','done'];
const invalid = () => Error('행사 백업의 모둠 진행 기록을 확인해 주세요.');

function readEventState(data) {
  const identity = eventIdentity(data);
  const {total} = identity;
  const station = data.station ? stationScope(data.station,total) : undefined;
  const {first = 1,last = total} = station || {};
  const assigned = number => Number.isInteger(number) && number >= first && number <= last;
  if (!Array.isArray(data.groups) || data.groups.length !== total) throw invalid();
  const groups = data.groups.map((state,index) => {
    if (assigned(index + 1) ? !states.includes(state) : state !== 'unassigned') throw invalid();
    return state;
  });
  const current = groups.indexOf('active') + 1 || null;
  if (groups.lastIndexOf('active') !== groups.indexOf('active') || current !== data.current
    || !Number.isSafeInteger(data.revision) || data.revision < 0) throw invalid();
  const completed = groups.filter(state => state === 'done').length;
  const complete = number => assigned(number) && groups[number - 1] === 'done';
  const outputs = {};
  for (const [key,output] of Object.entries(data.outputs || {})) {
    const {captured,target} = output || {};
    if (!complete(Number(key)) || ![2,3,4].includes(target) || !Number.isInteger(captured)
      || captured < 1 || captured > target) throw invalid();
    outputs[Number(key)] = {captured,target};
  }
  const readGroups = (values,valid) => {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > total || values.some(number => !valid(number))) throw invalid();
    return [...new Set(values)];
  };
  const printed = readGroups(data.printed,complete);
  const reprint = readGroups(data.reprint,assigned);
  const retry = data.retry ?? null;
  if (retry !== null && (!complete(retry) || !(outputs[retry]?.captured < outputs[retry]?.target))) throw invalid();
  const plan = stationPlan(data.stationPlan || [],total).plan;
  if (station && plan.length) throw invalid();

  if (data.printBatches !== undefined && !Array.isArray(data.printBatches)) throw invalid();
  const printBatches = (data.printBatches || []).map((batch,index) => {
    if (batch?.number !== index + 1 || !Number.isFinite(Date.parse(batch.createdAt))
      || !Number.isInteger(batch.pages) || batch.pages < 1 || !Array.isArray(batch.groups)
      || !batch.groups.length || batch.groups.length > total) throw invalid();
    const seen = new Set();
    const cleaned = batch.groups.map(group => {
      const {number,copies} = group || {};
      if (!complete(number) || seen.has(number) || !Number.isInteger(copies) || copies < 1 || copies > 120) throw invalid();
      seen.add(number);
      return {number,copies};
    });
    return {number:batch.number,createdAt:batch.createdAt,pages:batch.pages,groups:cleaned};
  });
  const replacedAfterBatch = {};
  for (const [key,value] of Object.entries(data.replacedAfterBatch || {})) {
    if (!complete(Number(key)) || !Number.isInteger(value) || value < 0 || value > printBatches.length) throw invalid();
    replacedAfterBatch[Number(key)] = value;
  }
  return {...identity,station,groups,current,completed,revision:data.revision,outputs,printed,reprint,retry,
    stationPlan:plan,printBatches,replacedAfterBatch,pinHash:readPinHash(data.pinHash)};
}

function readResults(files,event) {
  if (!Array.isArray(files) || files.length > 99) throw Error('행사 백업의 촬영대 결과를 확인해 주세요.');
  if (!files.length) return [];
  const results = updateStationResults([],files);
  if (!sameEventRound(results.event,event)) throw Error('행사 백업의 촬영대 회차를 확인해 주세요.');
  return results.files;
}

export function eventBackup(event,settings,files = []) {
  const state = readEventState(event);
  return {kind,version:1,event:state,settings,results:readResults(files,state)};
}

export function openEventBackup(data) {
  if (data?.kind !== kind || data.version !== 1) throw Error('상상네컷 행사 백업 파일을 선택해 주세요.');
  return eventBackup(data.event,data.settings,data.results);
}
