import {adjustedImage} from './photo-adjust.mjs';
import {CUT_W,CUT_H,exportSpec,originalPerson} from './core.mjs?v=scrapbook-flow';
const loaded=new Map();
export function loadImage(src){if(loaded.has(src))return loaded.get(src);const p=new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('이미지를 불러오지 못했어요.'));im.src=src;});loaded.set(src,p);p.catch(()=>loaded.delete(src));return p;}
export function forgetImage(src){loaded.delete(src);}
export function cover(ctx,img,x,y,w,h,fit='cover'){const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;const ratio=(fit==='contain'?Math.min:Math.max)(w/iw,h/ih),dw=iw*ratio,dh=ih*ratio;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
export async function backgroundImage(id,backgrounds){return loadImage(backgrounds.find(b=>b.id===id)?.url||'./assets/backgrounds/space.svg');}
export function drawItem(ctx,item,assets,adjustment){const a=assets.get(item.assetId);if(!a)return;ctx.save();ctx.translate(item.x,item.y);ctx.rotate(item.rotation*Math.PI/180);ctx.scale(item.scale,item.scale);if(item.border){ctx.save();ctx.shadowColor='#fff';ctx.shadowBlur=0;const d=7/item.scale;for(let i=0;i<12;i++){ctx.shadowOffsetX=Math.cos(i*Math.PI/6)*d;ctx.shadowOffsetY=Math.sin(i*Math.PI/6)*d;ctx.drawImage(a.image,-a.w/2,-a.h/2,a.w,a.h);}ctx.restore();}ctx.drawImage(item.kind==='person'?adjustedImage(a,adjustment):a.image,-a.w/2,-a.h/2,a.w,a.h);ctx.restore();}
export async function drawCut(canvas,cut,assets,backgrounds,{selected=null,placeholder=false}={}){const ctx=canvas.getContext('2d');const bg=await backgroundImage(cut.background,backgrounds);ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(canvas.width/CUT_W,canvas.height/CUT_H);ctx.fillStyle='#e7e6fa';ctx.fillRect(0,0,CUT_W,CUT_H);const originals=cut.items.filter(i=>i.kind==='person');if(cut.original&&originals.length){const a=assets.get(originalPerson(cut).assetId);if(a?.source)cover(ctx,adjustedImage(a,cut.adjustment,true),0,0,CUT_W,CUT_H);else cover(ctx,bg,0,0,CUT_W,CUT_H,cut.fit);}else cover(ctx,bg,0,0,CUT_W,CUT_H,cut.fit);
ctx.save();ctx.beginPath();ctx.rect(0,0,CUT_W,CUT_H);ctx.clip();for(const item of cut.items){if(cut.original&&item.kind==='person')continue;drawItem(ctx,item,assets,cut.adjustment);}ctx.restore();
if(placeholder&&!cut.items.length){ctx.fillStyle='#ffffffaa';ctx.beginPath();ctx.arc(600,390,64,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(600,640,150,160,0,Math.PI,0);ctx.fill();ctx.font='600 25px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.shadowColor='#121b47';ctx.shadowBlur=7;ctx.fillText('여기에 우리의 순간을 담아요',600,770);ctx.shadowBlur=0;}
if(selected&&!cut.original){const item=cut.items.find(i=>i.id===selected),a=item&&assets.get(item.assetId);if(a){ctx.save();ctx.translate(item.x,item.y);ctx.rotate(item.rotation*Math.PI/180);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.setLineDash([10,8]);const w=a.w*item.scale,h=a.h*item.scale;ctx.strokeRect(-w/2-12,-h/2-12,w+24,h+24);ctx.restore();}}ctx.restore();}
function fitText(ctx,text,maxWidth,start=54){let size=start;do{ctx.font=`700 ${size}px "Malgun Gothic", sans-serif`;if(ctx.measureText(text).width<=maxWidth)return;}while(--size>24);}
function paintFrame(ctx, spec, project) {
  const style = project.frameStyle || 'classic';
  ctx.fillStyle = style === 'classic' ? project.frame : '#fff4de';
  ctx.fillRect(0, 0, spec.w, spec.h);
  if (style === 'classic') return;

  ctx.fillStyle = project.frame;
  ctx.fillRect(0, 0, spec.w, 18);
  ctx.fillRect(0, spec.h - 18, spec.w, 18);
  if (style !== 'grid-paper') return;

  ctx.strokeStyle = '#2f718426';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = 28; y < spec.h; y += 28) {
    ctx.moveTo(0, y);
    ctx.lineTo(spec.w, y);
  }
  for (let x = 28; x < spec.w; x += 28) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, spec.h);
  }
  ctx.stroke();
}

function paintPhotoMount(ctx, rect, style) {
  if (style !== 'tape' && style !== 'paper-label') return;
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(rect.x - 11, rect.y - 11, rect.w + 22, rect.h + 22);
}

function paintTape(ctx, rect) {
  ctx.save();
  ctx.translate(rect.x + rect.w * .22, rect.y + 5);
  ctx.rotate(-.085);
  ctx.fillStyle = '#efc669ee';
  ctx.beginPath();
  ctx.moveTo(-135, -25);
  ctx.lineTo(135, -25);
  ctx.lineTo(130, -10);
  ctx.lineTo(138, 1);
  ctx.lineTo(132, 23);
  ctx.lineTo(-135, 23);
  ctx.lineTo(-129, 8);
  ctx.lineTo(-138, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintCaption(ctx, spec, project, logo) {
  const style = project.frameStyle || 'classic';
  const center = spec.w / 2;
  let y = spec.footerY;
  ctx.fillStyle = style === 'classic' ? contrast(project.frame) : '#352719';
  if (style === 'paper-label') {
    ctx.fillStyle = '#f7db99';
    ctx.fillRect(100, y - 30, spec.w - 200, logo ? 353 : 278);
    ctx.fillStyle = project.frame;
    ctx.fillRect(100, y - 30, 11, logo ? 353 : 278);
    ctx.fillStyle = '#352719';
  }
  ctx.textAlign = 'center';
  if (logo) {
    const k = Math.min(200 / logo.width, 70 / logo.height);
    ctx.drawImage(logo, center - logo.width * k / 2, y - 20, logo.width * k, logo.height * k);
    y += 75;
  }
  const textWidth = spec.w - (style === 'paper-label' ? 255 : 200);
  fitText(ctx, project.caption, textWidth);
  ctx.fillText(project.caption, center, y + 40, textWidth);
  ctx.font = '32px "Malgun Gothic", sans-serif';
  ctx.fillText(project.subtitle.slice(0, 50), center, y + 108, textWidth);
  ctx.font = '27px "Malgun Gothic", sans-serif';
  ctx.fillText([project.school, project.date].filter(Boolean).join(' · '), center, y + 165, textWidth);
  ctx.globalAlpha = .7;
  ctx.font = '21px sans-serif';
  ctx.fillText('상상네컷 · OUR LITTLE ADVENTURE', center, y + 225);
  ctx.globalAlpha = 1;
}

export async function renderProject(project, assets, backgrounds, scale = 1, logo = null) {
  await document.fonts.ready;
  const spec = exportSpec(project.layout, project.count || 4);
  const output = document.createElement('canvas');
  output.width = Math.round(spec.w * scale);
  output.height = Math.round(spec.h * scale);
  const ctx = output.getContext('2d');
  ctx.scale(scale, scale);
  paintFrame(ctx, spec, project);
  const cutCanvas = document.createElement('canvas');
  cutCanvas.width = CUT_W;
  cutCanvas.height = CUT_H;
  try {
    for (const [index, rect] of spec.cells.entries()) {
      await drawCut(cutCanvas, project.cuts[index], assets, backgrounds);
      paintPhotoMount(ctx, rect, project.frameStyle);
      ctx.drawImage(cutCanvas, rect.x, rect.y, rect.w, rect.h);
      if (project.frameStyle === 'tape') paintTape(ctx, rect);
    }
    paintCaption(ctx, spec, project, logo);
    return output;
  } finally {
    cutCanvas.width = cutCanvas.height = 0;
  }
}

export function drawPaperPreview(canvas, photo, paper) {
  const scale = 2;
  canvas.width = Math.round(paper.width * scale);
  canvas.height = Math.round(paper.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, paper.width, paper.height);
  for (const {x, y, w, h} of paper.cells) {
    cover(ctx, photo, x, y, w, h, 'contain');
  }
}
export function contrast(hex){const n=hex.replace('#','');const c=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16));return (c[0]*299+c[1]*587+c[2]*114)/1000>165?'#252039':'#ffffff';}
export function makeDecoration(type){const c=document.createElement('canvas');c.width=c.height=180;const x=c.getContext('2d');x.lineJoin='round';x.fillStyle=type==='heart'?'#ff719c':type==='star'?'#ffd966':'#bea7ff';x.strokeStyle='#fff';x.lineWidth=9;x.beginPath();if(type==='heart'){x.moveTo(90,155);x.bezierCurveTo(-10,100,0,20,52,32);x.bezierCurveTo(72,35,84,48,90,60);x.bezierCurveTo(115,0,190,30,153,98);x.bezierCurveTo(140,120,120,139,90,155);}else if(type==='star'){for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?34:75;x.lineTo(90+Math.cos(a)*r,90+Math.sin(a)*r);}x.closePath();}else{x.moveTo(90,10);x.quadraticCurveTo(98,80,170,90);x.quadraticCurveTo(98,98,90,170);x.quadraticCurveTo(82,98,10,90);x.quadraticCurveTo(82,82,90,10);}x.stroke();x.fill();return c;}
