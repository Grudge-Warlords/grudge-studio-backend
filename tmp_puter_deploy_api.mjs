import fs from 'node:fs/promises';
import { puter } from '@heyputer/puter.js';

const env = await fs.readFile('/opt/grudge-studio-backend/.env', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').replace(/^\"|\"$/g, '').trim();

const token = get('PUTER_AUTH_TOKEN');
const username = get('PUTER_USERNAME') || 'GRUDACHAIN';
const subdomain = 'grudge-launcher-xu9q5';
const remoteDir = `/${username}/sites/${subdomain}/deployment`;

if (!token) throw new Error('Missing PUTER_AUTH_TOKEN');

puter.setAuthToken(token);

await puter.fs.mkdir(remoteDir, { dedupeName: true, createMissingParents: true });

const indexHtml = await fs.readFile('/opt/grudge-launcher-site/index.html', 'utf8');
const faviconSvg = await fs.readFile('/opt/grudge-launcher-site/favicon.svg', 'utf8');

await puter.fs.write(`${remoteDir}/index.html`, indexHtml, { overwrite: true, createMissingParents: true });
await puter.fs.write(`${remoteDir}/favicon.svg`, faviconSvg, { overwrite: true, createMissingParents: true });

try {
  await puter.hosting.create(subdomain, remoteDir);
} catch {
  await puter.hosting.update(subdomain, remoteDir);
}

console.log(`DEPLOYED=https://${subdomain}.puter.site`);
