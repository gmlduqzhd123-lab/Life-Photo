import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/',import.meta.url));
const portrait = process.argv[2] && path.resolve(process.argv[2]);
const port = Number(process.env.BOOTH_QA_PORT || 4185);
const types = {
  '.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript',
  '.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.wasm':'application/wasm'
};
const qaHome = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>상상네컷 브라우저 회귀 테스트</title>' +
  '<style>body{font:16px system-ui;max-width:940px;margin:24px auto;padding:0 16px} #samples{display:flex;gap:12px;flex-wrap:wrap} ' +
  'figure{margin:0;width:132px} canvas{display:block;width:130px;height:130px;object-fit:contain;background:#c1dce6} pre{white-space:pre-wrap}</style>' +
  '<h1>상상네컷 브라우저 회귀 테스트</h1><pre id="result" role="status">검증 중</pre><div id="samples"></div>' +
  '<script type="module" src="/__qa/run.mjs"></script></html>';
const failFirstPng = `<script>
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  let failPng = true;
  HTMLCanvasElement.prototype.toBlob = function(callback,type,...options) {
    if (failPng && type === 'image/png' && this.width >= 1440) {
      failPng = false;
      queueMicrotask(() => callback(null));
      return;
    }
    return originalToBlob.call(this,callback,type,...options);
  };
 </script>`;

http.createServer(async (request,response) => {
  try {
    const url = new URL(request.url,'http://127.0.0.1:' + port);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/__qa/') {
      response.writeHead(200,{'Content-Type':types['.html']}).end(qaHome);
      return;
    }
    let file;
    if (pathname === '/__qa/run.mjs') file = fileURLToPath(new URL('./browser-regression-suite.mjs',import.meta.url));
    else if (pathname === '/__qa/portrait.jpg' && portrait) file = portrait;
    else {
      file = path.resolve(root,'.' + pathname);
      const relative = path.relative(root,file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = path.join(file,'index.html');
    }
    let content = await readFile(file);
    if (file.endsWith('index.html') && url.searchParams.get('qa') === 'output') {
      content = String(content).replace('<head>','<head>' + failFirstPng);
    }
    response.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(content);
  } catch { response.writeHead(404).end(); }
}).listen(port,'127.0.0.1',() => {
  console.log('App http://127.0.0.1:' + port + '/');
  console.log('Browser checks http://127.0.0.1:' + port + '/__qa/');
});
