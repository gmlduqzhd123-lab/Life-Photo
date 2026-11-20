// Bundles intentionally contain teacher-selected settings/assets only, never session photos.
import {BUILT_IN_BACKGROUNDS} from './background-catalog.mjs?v=background-gallery';
import {FRAME_STYLES} from './core.mjs?v=scrapbook-flow';
const LIMIT=50*1024*1024, allowedTypes=new Set(['image/png','image/jpeg','image/webp']);
export async function createBundle(preset,backgrounds,logo){
 const toData=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('이미지를 읽을 수 없어요.'));r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});
 const data={version:1,preset,backgrounds:await Promise.all(backgrounds.map(async b=>({id:b.id,name:b.name,data:await toData(b.blob)}))),logo:logo?await toData(logo):null};
 const json=JSON.stringify(data);if(new TextEncoder().encode(json).length>LIMIT*1.4)throw Error('설정 묶음이 너무 커요. 배경 용량을 줄여 주세요.');return new Blob([json],{type:'application/json'});
}
export function validateBundle(obj){
 if(!obj||obj.version!==1||!obj.preset||!Array.isArray(obj.backgrounds)||obj.backgrounds.length>20)throw Error('올바른 상상네컷 설정 묶음이 아니에요.');
 const p=obj.preset;if(![2,3,4].includes(p.count)||!['strip','grid'].includes(p.layout)||!/^#[0-9a-f]{6}$/i.test(p.frame)||![3,5].includes(Number(p.timer)))throw Error('촬영 설정을 확인할 수 없어요.');
 for(const key of ['caption','subtitle','school','date'])if(typeof p[key]!=='string'||p[key].length>100)throw Error('문구 설정을 확인할 수 없어요.');
 if(!Array.isArray(p.backgrounds)||p.backgrounds.length!==4||!p.backgrounds.every(id=>typeof id==='string'&&id.length<=80))throw Error('배경 설정을 확인할 수 없어요.');
 if(!Array.isArray(p.customMissions)||p.customMissions.length>4||!p.customMissions.every(x=>typeof x==='string'&&x.length<=60))throw Error('포즈 미션 설정을 확인할 수 없어요.');
 const decode=(data)=>{if(typeof data!=='string'||data.length>14*1024*1024)throw Error('이미지 크기나 형식이 올바르지 않아요.');const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);if(!match||!allowedTypes.has(match[1]))throw Error('지원하지 않는 이미지 형식이에요.');let raw;try{raw=atob(match[2]);}catch{throw Error('이미지 데이터가 손상됐어요.');}const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length>10*1024*1024)throw Error('이미지는 10MB 이하여야 해요.');return new Blob([bytes],{type:match[1]});};
 const ids=new Set();let total=0;const backgrounds=obj.backgrounds.map(b=>{if(!b||typeof b.id!=='string'||!/^custom-[a-zA-Z0-9-]{1,64}$/.test(b.id)||ids.has(b.id)||typeof b.name!=='string'||b.name.length>60)throw Error('배경 정보가 올바르지 않아요.');ids.add(b.id);const blob=decode(b.data);total+=blob.size;return{id:b.id,name:b.name,blob};});if(total>LIMIT)throw Error('배경의 합계가 50MB를 넘어요.');
 const builtins=new Set(BUILT_IN_BACKGROUNDS.map(b => b.id));if(p.backgrounds.some(id=>!builtins.has(id)&&!ids.has(id)))throw Error('설정에서 사용하는 배경이 묶음에 없어요.');
 if(p.frameStyle!==undefined&&!FRAME_STYLES.includes(p.frameStyle))throw Error('프레임 스타일을 확인할 수 없어요.');
 const preset={count:p.count,layout:p.layout,frame:p.frame,frameStyle:p.frameStyle??'classic',caption:p.caption,subtitle:p.subtitle,school:p.school,date:p.date,timer:Number(p.timer),sound:!!p.sound,mission:!!p.mission,lockBackground:!!p.lockBackground,customMissions:p.customMissions.slice(),backgrounds:p.backgrounds.slice()};return{preset,backgrounds,logo:obj.logo?decode(obj.logo):null};
}
