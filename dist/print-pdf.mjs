const points = millimeters => millimeters * 72 / 25.4;
const coordinate = value => String(Number(points(value).toFixed(4)));

export function fitPrintImage(width, height, cell) {
  const scale = Math.min(cell.w / width, cell.h / height);
  const w = width * scale;
  const h = height * scale;
  return {x:cell.x + (cell.w - w) / 2,y:cell.y + (cell.h - h) / 2,w,h};
}

export function printTrimLines({x,y,w,h}) {
  const endX = x + w;
  const endY = y + h;
  return [
    [x - 2.5,y,x - .5,y], [x,y - 2.5,x,y - .5],
    [endX + .5,y,endX + 2.5,y], [endX,y - 2.5,endX,y - .5],
    [x - 2.5,endY,x - .5,endY], [x,endY + .5,x,endY + 2.5],
    [endX + .5,endY,endX + 2.5,endY], [endX,endY + .5,endX,endY + 2.5]
  ];
}

export function createPrintPdf(jpeg, imageWidth, imageHeight, paper) {
  const cells = paper.cells.map(cell => ({...fitPrintImage(imageWidth,imageHeight,cell),image:0}));
  return createImagePdf([{jpeg,width:imageWidth,height:imageHeight}], [cells], paper);
}

// One JPEG object per input keeps repeated photos and multi-page PDFs compact.
export function createImagePdf(images, pages, paper, {trim = false} = {}) {
  if (!images.length || !pages.length) throw Error('인쇄할 사진을 선택해 주세요.');
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  function append(part) {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.byteLength ?? bytes.size;
  }
  function object(number, ...body) {
    offsets[number] = length;
    append(number + ' 0 obj\n');
    for (const part of body) append(part);
    append('\nendobj\n');
  }

  append('%PDF-1.4\n');
  append(new Uint8Array([0x25,0xe2,0xe3,0xcf,0xd3,0x0a]));
  const pageStart = 3 + images.length;
  const name = index => index === 0 ? 'Photo' : 'Photo' + (index + 1);
  const pageNumbers = pages.map((_,index) => pageStart + 2 * index);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [' + pageNumbers.map(n => n + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  images.forEach(({jpeg,width,height},index) => {
    object(3 + index, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n',
      jpeg, '\nendstream');
  });
  pages.forEach((page,index) => {
    const number = pageNumbers[index];
    const references = [...new Set(page.map(cell => cell.image))]
      .map(image => '/' + name(image) + ' ' + (3 + image) + ' 0 R').join(' ');
    const draw = page.map(({image,x,y,w,h}) => ['q',coordinate(w),'0 0',coordinate(h),
      coordinate(x),coordinate(paper.height - y - h),'cm /' + name(image) + ' Do Q'].join(' '));
    if (trim) {
      const lines = page.flatMap(printTrimLines).map(([x1,y1,x2,y2]) => [
        coordinate(x1),coordinate(paper.height - y1),'m',coordinate(x2),coordinate(paper.height - y2),'l'
      ].join(' '));
      draw.push('q .4 w .2 G',...lines,'S Q');
    }
    const operators = draw.join('\n') + '\n';
    object(number, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + coordinate(paper.width) + ' ' +
      coordinate(paper.height) + '] /Resources << /XObject << ' + references + ' >> >> /Contents ' + (number + 1) + ' 0 R >>');
    object(number + 1, '<< /Length ' + encoder.encode(operators).length + ' >>\nstream\n', operators, 'endstream');
  });

  const xref = length;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, {type:'application/pdf'});
}
