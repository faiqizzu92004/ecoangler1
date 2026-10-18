import http from 'node:http';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const server = http.createServer(async (req, res) => {
  try {
    const response = await worker.fetch(new Request('http://127.0.0.1:8787' + req.url, {method: req.method}), {}, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Preview error'); }
});
server.listen(8787, '127.0.0.1', () => console.log('Local: http://127.0.0.1:8787'));
