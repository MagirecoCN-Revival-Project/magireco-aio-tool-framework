import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import onRequest from '../edge-functions/open.js';

const root = fileURLToPath(new URL('../apps/router/dist/', import.meta.url));
const host = process.env.AIO_PREVIEW_HOST || '127.0.0.1';
const port = Number(process.env.AIO_PREVIEW_PORT || '4173');
const base = `http://${host}:${port}`;

const contentType = (path) => ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}[extname(path)] || 'application/octet-stream');

function fixturePage(kind, url) {
  const story = kind === 'Reader'
    ? url.pathname.split('/').filter(Boolean).at(-1)
    : url.searchParams.get('story');
  const section = url.searchParams.get('section');
  const readerRevision = url.searchParams.get('readerRevision');
  return `<!doctype html><meta charset="utf-8"><title>${kind} fixture</title>`
    + `<main><h1>${kind} 已收到路由</h1><p id="story">story=${story ?? ''}</p>`
    + (section ? `<p id="section">section=${section}</p>` : '')
    + (readerRevision ? `<p id="reader-revision">readerRevision=${readerRevision}</p>` : '')
    + '<p><a href="/">返回 Story Router</a></p></main>';
}

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url || '/', base);
  if (url.pathname === '/open') {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const response = onRequest({
      request: new Request(url, { method: incoming.method, headers }),
      env: {
        AIO_READER_BASE_URL: `${base}/fixture-reader/`,
        AIO_ADV_BASE_URL: `${base}/fixture-adv`,
        AIO_ADV_HANDOFF_ENABLED: '1',
      },
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
    return;
  }
  if (url.pathname.startsWith('/fixture-reader/reader/')) {
    outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    outgoing.end(fixturePage('Reader', url));
    return;
  }
  if (url.pathname === '/fixture-adv') {
    outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    outgoing.end(fixturePage('ADV', url));
    return;
  }
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const path = join(root, requested);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    outgoing.writeHead(404).end('Not Found');
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    const headers = { 'Content-Type': contentType(path) };
    if (url.pathname === '/story-routes.json' || url.pathname === '/story-router-client.js') {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Cache-Control'] = 'public, max-age=300';
    }
    outgoing.writeHead(200, headers);
    createReadStream(path).pipe(outgoing);
  } catch {
    outgoing.writeHead(404).end('Not Found');
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Story Router preview: ${base}/\n`);
});
