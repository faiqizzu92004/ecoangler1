import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = name => readFileSync(path.join(root, name), 'utf8');
const inference = read('worker/inference.mjs').replace(/^export /gm, '');
const api = read('worker/api.js').replace(/^export /gm, '');
const source = ['// Generated EcoAngler Worker. Edit page.html, api.js, router.js or inference.mjs.',
  'const HTML = ' + JSON.stringify(read('worker/page.html')) + ';',
  'const WEBSITE_MODEL = ' + read('worker/website_model.json').trim() + ';',
  inference, api, read('worker/router.js')].join('\n\n');
writeFileSync(path.join(root, 'worker/index.js'), source);
console.log('Built EcoAngler:', Buffer.byteLength(source), 'bytes');
