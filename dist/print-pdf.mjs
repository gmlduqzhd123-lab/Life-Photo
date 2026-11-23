const points = millimeters => millimeters * 72 / 25.4;
const coordinate = value => String(Number(points(value).toFixed(4)));

// Reuse one JPEG image for each copy while keeping the page and placement in physical units.
export function createPrintPdf(jpeg, imageWidth, imageHeight, paper) {
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

  const operators = paper.cells.map(cell => {
    const scale = Math.min(cell.w / imageWidth, cell.h / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    const x = cell.x + (cell.w - width) / 2;
    const y = paper.height - cell.y - (cell.h + height) / 2;
    return ['q', coordinate(width), '0 0', coordinate(height), coordinate(x), coordinate(y), 'cm /Photo Do Q'].join(' ');
  }).join('\n') + '\n';

  append('%PDF-1.4\n');
  append(new Uint8Array([0x25,0xe2,0xe3,0xcf,0xd3,0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + coordinate(paper.width) + ' ' +
    coordinate(paper.height) + '] /Resources << /XObject << /Photo 4 0 R >> >> /Contents 5 0 R >>');
  object(4, '<< /Type /XObject /Subtype /Image /Width ' + imageWidth + ' /Height ' + imageHeight +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n',
    jpeg, '\nendstream');
  object(5, '<< /Length ' + encoder.encode(operators).length + ' >>\nstream\n', operators, 'endstream');

  const xref = length;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, {type:'application/pdf'});
}
