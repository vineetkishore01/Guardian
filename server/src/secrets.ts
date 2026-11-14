import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from './logger.js';

const DATA_DIR = process.env.DATA_DIR || '/data';
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const LOCAL_SECRETS_FILE = path.join(process.cwd(), 'data', 'secrets.json');

function getSecretsPath(): string {
  if (fs.existsSync(DATA_DIR)) {
    return SECRETS_FILE;
  }
  const localDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(localDir)) {
    try {
      fs.mkdirSync(localDir, { recursive: true });
    } catch {
      // fallback
    }
  }
  return LOCAL_SECRETS_FILE;
}

interface SecretsStore {
  routerPasswords: Record<string, string>; // routerId -> encrypted or raw string
}

let cachedSecrets: SecretsStore | null = null;

function loadSecrets(): SecretsStore {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const filePath = getSecretsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      cachedSecrets = JSON.parse(raw) as SecretsStore;
      if (!cachedSecrets.routerPasswords) {
        cachedSecrets.routerPasswords = {};
      }
      return cachedSecrets;
    }
  } catch (err) {
    logger.error('secrets', 'Failed to read secrets file', { err: (err as Error).message });
  }

  cachedSecrets = { routerPasswords: {} };
  return cachedSecrets;
}

function saveSecrets(store: SecretsStore): void {
  cachedSecrets = store;
  const filePath = getSecretsPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    logger.error('secrets', 'Failed to save secrets file', { err: (err as Error).message });
  }
}

export function getRouterPassword(routerId: string): string | undefined {
  const secrets = loadSecrets();
  return secrets.routerPasswords[routerId];
}

export function setRouterPassword(routerId: string, secret: string): void {
  const secrets = loadSecrets();
  secrets.routerPasswords[routerId] = secret;
  saveSecrets(secrets);
}

export function deleteRouterPassword(routerId: string): void {
  const secrets = loadSecrets();
  delete secrets.routerPasswords[routerId];
  saveSecrets(secrets);
}

export function hasRouterPassword(routerId: string): boolean {
  const secrets = loadSecrets();
  return Boolean(secrets.routerPasswords[routerId]);
}
