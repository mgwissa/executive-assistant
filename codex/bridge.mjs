import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function loadLocalConfig() {
  const config = {};
  try {
    const text = await readFile(resolve('.env.codex-bridge'), 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      config[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return config;
}

const config = await loadLocalConfig();
const url = process.env.CODEX_BRIDGE_URL || config.CODEX_BRIDGE_URL;
const secret = process.env.CODEX_BRIDGE_SECRET || config.CODEX_BRIDGE_SECRET;

if (!url || !secret) {
  console.error('Missing CODEX_BRIDGE_URL or CODEX_BRIDGE_SECRET. Copy .env.codex-bridge.example to .env.codex-bridge and fill it in.');
  process.exit(1);
}

const [command = 'context', ...args] = process.argv.slice(2);
let payload;
if (command === 'context') {
  payload = { action: 'context' };
} else if (command === 'search') {
  const query = args.join(' ').trim();
  if (!query) throw new Error('Usage: node codex/bridge.mjs search <query>');
  payload = { action: 'notes.search', query };
} else if (command === 'request') {
  const file = args[0];
  if (!file) throw new Error('Usage: node codex/bridge.mjs request <json-file>');
  payload = JSON.parse(await readFile(resolve(file), 'utf8'));
} else {
  throw new Error(`Unknown command "${command}"`);
}

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-codex-secret': secret,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

process.stdout.write(`${JSON.stringify({ status: response.status, ...body }, null, 2)}\n`);
if (!response.ok && response.status !== 207) process.exit(1);

