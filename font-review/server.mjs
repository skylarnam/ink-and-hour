import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 4096) throw new Error('The font selection request is too large.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A checklist request needs a JSON object.');
  return value;
}

export async function startReviewServer(store, onError) {
  const token = randomBytes(32).toString('hex');
  const streams = new Set();
  let origin = '';
  let renderStatus = null;
  const broadcast = (state) => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (`http://${request.headers.host}` !== origin) {
        json(response, 403, { error: 'This checklist is available only on its local address.' });
        return;
      }
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/') {
        const state = await store.read();
        const html = (await readFile(join(store.root, 'font-review/index.html'), 'utf8'))
          .replace('<meta name="review-token" content="">', `<meta name="review-token" content="${token}">`)
          .replace('<script id="initial-selection" type="application/json">{}</script>',
            `<script id="initial-selection" type="application/json">${JSON.stringify(state).replaceAll('<', '\\u003c')}</script>`);
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
        });
        response.end(html);
      } else if (request.method === 'GET' && url.pathname === '/api/selection') {
        json(response, 200, await store.read());
      } else if (request.method === 'POST' && ['/api/selection', '/api/render-status'].includes(url.pathname)) {
        if (request.headers.origin !== origin || request.headers['x-review-token'] !== token
          || request.headers['content-type'] !== 'application/json') {
          json(response, 403, { error: 'Selection changes must come from this checklist.' });
          return;
        }
        let input;
        try { input = await requestBody(request); } catch (error) {
          json(response, 400, { error: error.message });
          return;
        }
        if (url.pathname === '/api/selection') {
          if (Object.keys(input).some((key) => key !== 'id' && key !== 'checked')
            || typeof input.id !== 'string' || typeof input.checked !== 'boolean') {
            json(response, 400, { error: 'A selection request needs only a font id and a checkbox state.' });
            return;
          }
          json(response, 200, await store.update(input.id, input.checked));
        } else {
          const counts = ['rows', 'loadedFonts', 'boundCheckboxes', 'sourceFontPreviews', 'checkedCount', 'pendingSaves', 'revision'];
          if (counts.some((key) => !Number.isSafeInteger(input[key]) || input[key] < 0)
            || !Array.isArray(input.fontErrors) || input.fontErrors.some((error) => typeof error !== 'string')) {
            json(response, 400, { error: 'The render report is invalid.' });
            return;
          }
          renderStatus = Object.fromEntries(counts.map((key) => [key, input[key]]));
          renderStatus.fontErrors = input.fontErrors.slice(0, 5);
          json(response, 200, { received: true });
        }
      } else if (request.method === 'GET' && url.pathname === '/events') {
        const state = await store.read();
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        streams.add(response);
        request.on('close', () => streams.delete(response));
      } else if (url.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
      } else {
        json(response, 404, { error: 'This checklist page was not found.' });
      }
    })().catch((error) => {
      onError(error);
      if (!response.headersSent) json(response, 500, { error: error.message });
      else response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  store.listeners.add(broadcast);
  return {
    url: `${origin}/`,
    get renderStatus() { return renderStatus; },
    close: async () => {
      store.listeners.delete(broadcast);
      for (const stream of streams) stream.end();
      streams.clear();
      server.closeIdleConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
