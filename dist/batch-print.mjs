import {getPrintLayout} from './core.mjs?v=event-workflow';
import {createImagePdf,fitPrintImage,printTrimLines} from './print-pdf.mjs?v=event-workflow';

const pngSignature = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82];
const fileLimit = 30;
const maxFileBytes = 32 * 1024 * 1024;

export function pngPrintDimensions(bytes) {
  if (bytes.length < 24 || !pngSignature.every((byte,index) => bytes[index] === byte)) {
    throw Error('PNG 파일을 골라 주세요.');
  }
  const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (!width || !height || Math.max(width,height) > 6000 || width * height > 20_000_000) {
    throw Error('사진 크기를 줄여 다시 추가해 주세요.');
  }
  return {width,height};
}

export function planBatchPrint(files, perPage, margin) {
  const paper = getPrintLayout('A4',perPage,{margin:[8,12,16].includes(Number(margin)) ? Number(margin) : 8,gap:6});
  const pages = [];
  let count = 0;
  files.forEach((file,image) => {
    for (let copy = 0; copy < file.copies; copy += 1) {
      const slot = count % paper.copies;
      if (!slot) pages.push([]);
      pages.at(-1).push({...fitPrintImage(file.width,file.height,paper.cells[slot]),image});
      count += 1;
    }
  });
  return {paper,pages,count};
}

async function printJpeg(file,maxSide) {
  const scale = Math.min(1,maxSide / Math.max(file.width,file.height));
  const width = Math.max(1,Math.round(scale * file.width));
  const height = Math.max(1,Math.round(scale * file.height));
  const bitmap = await createImageBitmap(file.blob,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0,0,width,height);
    context.drawImage(bitmap,0,0,width,height);
    const jpeg = await new Promise((resolve,reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(Error('이 사진을 인쇄용으로 변환하지 못했어요.'));
    },'image/jpeg',.93));
    return {jpeg,width,height};
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

export function setupBatchPrint({downloadBlob,filename}) {
  const $ = id => document.getElementById('batch-print-' + id);
  const dialog = $('dialog');
  const files = [];
  let page = 0;
  let working = false;
  let epoch = 0;
  let filenameForDialog;

  function refreshPreview() {
    const {paper,pages,count} = planBatchPrint(files,$('per-page').value,$('margin').value);
    page = Math.max(0,Math.min(pages.length - 1,page));
    const sheet = $('sheet');
    sheet.replaceChildren();
    $('options').hidden = $('preview').hidden = !count;
    $('sheet-label').textContent = count ? (page + 1) + ' / ' + pages.length + '쪽 · 사진 ' + count + '장' : '';
    $('prev').disabled = working || !page;
    $('next').disabled = working || page >= pages.length - 1;
    $('save').disabled = working || !count;
    if (!count) return;
    for (const cell of pages[page]) {
      const photo = document.createElement('img');
      const file = files[cell.image];
      photo.src = file.url;
      photo.alt = file.blob.name;
      photo.style.left = cell.x / paper.width * 100 + '%';
      photo.style.top = cell.y / paper.height * 100 + '%';
      photo.style.width = cell.w / paper.width * 100 + '%';
      photo.style.height = cell.h / paper.height * 100 + '%';
      sheet.append(photo);
      if ($('marks').checked) for (const [x1,y1,x2,y2] of printTrimLines(cell)) {
        const line = document.createElement('span');
        line.className = 'batch-trim-line';
        line.setAttribute('aria-hidden','true');
        line.style.left = x1 / paper.width * 100 + '%';
        line.style.top = y1 / paper.height * 100 + '%';
        if (x1 === x2) line.style.height = (y2 - y1) / paper.height * 100 + '%';
        else line.style.width = (x2 - x1) / paper.width * 100 + '%';
        sheet.append(line);
      }
    }
  }

  function renderFiles(focus) {
    $('files').replaceChildren(...files.map((entry,index) => {
      const row = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = entry.blob.name;
      const controls = document.createElement('div');
      controls.className = 'batch-file-controls';
      const copiesLabel = document.createElement('label');
      copiesLabel.textContent = '매수';
      const copies = document.createElement('select');
      copies.setAttribute('aria-label',entry.blob.name + ' 인쇄 매수');
      copies.append(...[1,2,3,4].map(value => new Option(value + '장',value)));
      copies.value = entry.copies;
      copies.onchange = () => { entry.copies = Number(copies.value); refreshPreview(); };
      copiesLabel.append(copies);
      controls.append(copiesLabel);
      const actions = [
        ['위로',-1,index === 0],['아래로',1,index === files.length - 1],['제거',0,false]
      ];
      for (const [label,offset,disabled] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button compact';
        button.textContent = label;
        button.disabled = working || disabled;
        button.dataset.batchFileAction = disabled ? 'unavailable' : 'available';
        button.setAttribute('aria-label',entry.blob.name + ' ' + label);
        button.onclick = () => {
          if (working) return;
          if (offset) [files[index],files[index + offset]] = [files[index + offset],files[index]];
          else URL.revokeObjectURL(files.splice(index,1)[0].url);
          renderFiles({at:offset ? index + offset : Math.min(index,files.length - 1),label});
        };
        controls.append(button);
      }
      row.append(name,controls);
      return row;
    }));
    refreshPreview();
    if (focus) {
      const row = $('files').children[focus.at];
      const buttons = row ? [...row.querySelectorAll('button:not(:disabled)')] : [];
      (buttons.find(button => button.textContent === focus.label) || buttons[0] || $('choose')).focus();
    }
  }

  function setWorking(value) {
    working = value;
    $('choose').disabled = value;
    for (const element of dialog.querySelectorAll('select, input[type="checkbox"], [data-close]')) element.disabled = value;
    for (const button of dialog.querySelectorAll('[data-batch-file-action]')) {
      button.disabled = value || button.dataset.batchFileAction === 'unavailable';
    }
    refreshPreview();
  }

  for (const opener of document.querySelectorAll('[data-batch-open]')) {
    opener.addEventListener('click',() => openBatchPrint());
  }
  $('choose').onclick = () => { if (!working) $('input').click(); };
  $('input').onchange = event => {
    const selected = [...event.target.files];
    event.target.value = '';
    return addFiles(selected.sort((first,second) => first.name.localeCompare(second.name,'ko',{numeric:true})));
  };

  async function addFiles(selected) {
    if (!selected.length || working) return;
    setWorking(true);
    const token = epoch;
    const issues = [];
    for (const blob of selected) {
      if (token !== epoch) return;
      if (files.length >= fileLimit) {
        issues.push('한 번에 ' + fileLimit + '개까지 추가할 수 있어요.');
        break;
      }
      if (files.some(file => file.blob.name === blob.name && file.blob.size === blob.size
          && file.blob.lastModified === blob.lastModified)) continue;
      try {
        if (blob.size > maxFileBytes) throw Error('32MB 이하 파일을 골라 주세요.');
        const dimensions = pngPrintDimensions(new Uint8Array(await blob.slice(0,24).arrayBuffer()));
        const check = await createImageBitmap(blob,{resizeWidth:24});
        check.close();
        if (token !== epoch) return;
        files.push({blob,...dimensions,copies:1,url:URL.createObjectURL(blob)});
      } catch (error) {
        issues.push(blob.name + ' · ' + (error.message || '사진을 열 수 없어요.'));
      }
    }
    if (token !== epoch) return;
    $('status').textContent = issues.length ? issues.slice(0,3).join(' / ') : files.length + '개 파일을 선택했어요.';
    setWorking(false);
    renderFiles();
  }

  function openBatchPrint(initial = []) {
    if (dialog.open) return;
    filenameForDialog = filename();
    dialog.showModal();
    return addFiles(initial);
  }

  $('per-page').onchange = $('margin').onchange = $('marks').onchange = refreshPreview;
  $('prev').onclick = () => { page -= 1; refreshPreview(); };
  $('next').onclick = () => { page += 1; refreshPreview(); };
  $('save').onclick = async () => {
    if (working || !files.length) return;
    const token = epoch;
    const selected = files.slice();
    const plan = planBatchPrint(selected,$('per-page').value,$('margin').value);
    const trim = $('marks').checked;
    setWorking(true);
    $('status').textContent = 'A4 PDF를 만들고 있어요.';
    try {
      const images = [];
      const maxSide = Math.ceil(Math.max(plan.paper.cells[0].w,plan.paper.cells[0].h) * 300 / 25.4);
      for (const file of selected) {
        images.push(await printJpeg(file,maxSide));
        if (token !== epoch) return;
      }
      downloadBlob(createImagePdf(images,plan.pages,plan.paper,{trim}),filenameForDialog);
      $('status').textContent = plan.pages.length + '쪽 PDF 저장을 요청했어요. 저장된 파일을 인쇄해 주세요.';
    } catch (error) {
      $('status').textContent = error.message || 'PDF 저장에 실패했어요. 다시 시도해 주세요.';
    } finally {
      if (token === epoch) setWorking(false);
    }
  };

  function clearFiles() {
    epoch += 1;
    for (const file of files) URL.revokeObjectURL(file.url);
    files.length = 0;
    page = 0;
    $('status').textContent = '';
    setWorking(false);
    renderFiles();
  }
  dialog.addEventListener('cancel',event => { if (working) event.preventDefault(); });
  dialog.addEventListener('close',clearFiles);
  window.addEventListener('pagehide',() => { if (dialog.open) dialog.close(); clearFiles(); });
  return openBatchPrint;
}
