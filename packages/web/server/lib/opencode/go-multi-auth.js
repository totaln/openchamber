import fs from 'fs';
import os from 'os';
import path from 'path';
import { readAuthFile, writeAuthFile } from './auth.js';

const PROVIDER_ID = 'opencode-go';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'opencode-go-accounts.json');
const ACCOUNT_FILE_MODE = 0o600;

function emptyData() {
  return { version: 1, accounts: [], activeIndex: 0 };
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object' || typeof account.apiKey !== 'string') {
    return null;
  }

  const apiKey = account.apiKey.trim();
  if (!apiKey) {
    return null;
  }

  const label = typeof account.label === 'string' && account.label.trim()
    ? account.label.trim()
    : undefined;
  const addedAt = Number.isFinite(account.addedAt) ? account.addedAt : Date.now();
  return { apiKey, label, addedAt };
}

function normalizeData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) {
    return emptyData();
  }

  const accounts = data.accounts
    .map((account) => normalizeAccount(account))
    .filter(Boolean);
  const activeIndex = Number.isInteger(data.activeIndex) && data.activeIndex >= 0
    ? Math.min(data.activeIndex, Math.max(0, accounts.length - 1))
    : 0;

  return { version: 1, accounts, activeIndex };
}

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return emptyData();
  }

  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Failed to read OpenCode Go accounts: ${error.message}`);
  }
}

function saveAccounts(data) {
  const normalized = normalizeData(data);
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const tmp = `${ACCOUNTS_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.chmodSync(tmp, ACCOUNT_FILE_MODE);
  fs.renameSync(tmp, ACCOUNTS_FILE);
  return normalized;
}

function labelForAccount(account, index) {
  return account.label || `Account ${index + 1}`;
}

function applyAccountToAuth(account, index) {
  const label = labelForAccount(account, index);
  const auth = readAuthFile();
  auth[PROVIDER_ID] = {
    type: 'api',
    key: account.apiKey,
    label,
  };
  writeAuthFile(auth);
  return label;
}

function clearProviderAuth() {
  const auth = readAuthFile();
  if (!auth[PROVIDER_ID]) {
    return false;
  }
  delete auth[PROVIDER_ID];
  writeAuthFile(auth);
  return true;
}

function getActiveAccount() {
  const data = loadAccounts();
  if (data.accounts.length === 0) {
    return null;
  }

  const index = Math.max(0, Math.min(data.activeIndex, data.accounts.length - 1));
  return { account: data.accounts[index], index };
}

function applyActiveAccountToAuth() {
  const active = getActiveAccount();
  if (!active) {
    return null;
  }
  return applyAccountToAuth(active.account, active.index);
}

function addAccount(apiKey, label) {
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!trimmedKey) {
    throw new Error('API key is required');
  }

  const data = loadAccounts();
  data.accounts.push({
    apiKey: trimmedKey,
    label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
    addedAt: Date.now(),
  });
  if (data.accounts.length === 1) {
    data.activeIndex = 0;
  }

  const saved = saveAccounts(data);
  return { index: saved.accounts.length - 1, total: saved.accounts.length };
}

function switchToNext() {
  const data = loadAccounts();
  if (data.accounts.length < 2) {
    return null;
  }

  const fromIndex = Math.max(0, Math.min(data.activeIndex, data.accounts.length - 1));
  const nextIndex = (fromIndex + 1) % data.accounts.length;
  data.activeIndex = nextIndex;
  const saved = saveAccounts(data);
  const active = saved.accounts[nextIndex];
  const activeLabel = applyAccountToAuth(active, nextIndex);

  return {
    from: labelForAccount(saved.accounts[fromIndex], fromIndex),
    to: activeLabel,
    index: nextIndex,
  };
}

function removeAccount(index) {
  const data = loadAccounts();
  if (!Number.isInteger(index) || index < 0 || index >= data.accounts.length) {
    return { removed: false, authChanged: false, activeLabel: null };
  }

  const wasActive = index === data.activeIndex;
  data.accounts.splice(index, 1);
  if (data.accounts.length === 0) {
    saveAccounts(data);
    return { removed: true, authChanged: clearProviderAuth(), activeLabel: null };
  }

  if (data.activeIndex >= data.accounts.length) {
    data.activeIndex = data.accounts.length - 1;
  } else if (index < data.activeIndex) {
    data.activeIndex -= 1;
  }

  const saved = saveAccounts(data);
  if (!wasActive) {
    return { removed: true, authChanged: false, activeLabel: null };
  }

  const active = saved.accounts[saved.activeIndex];
  return {
    removed: true,
    authChanged: true,
    activeLabel: applyAccountToAuth(active, saved.activeIndex),
  };
}

function listAccounts() {
  const data = loadAccounts();
  return data.accounts.map((account, index) => ({
    index,
    label: labelForAccount(account, index),
    isCurrent: index === data.activeIndex,
    hasKey: Boolean(account.apiKey),
  }));
}

export {
  ACCOUNTS_FILE,
  PROVIDER_ID,
  addAccount,
  applyAccountToAuth,
  applyActiveAccountToAuth,
  clearProviderAuth,
  getActiveAccount,
  listAccounts,
  loadAccounts,
  normalizeData,
  removeAccount,
  saveAccounts,
  switchToNext,
};
