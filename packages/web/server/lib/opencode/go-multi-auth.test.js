import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.HOME;
const temporaryHomes = [];

async function importWithTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-go-multi-auth-'));
  temporaryHomes.push(home);
  process.env.HOME = home;
  vi.resetModules();
  const [multiAuth, auth] = await Promise.all([
    import('./go-multi-auth.js'),
    import('./auth.js'),
  ]);
  return { home, multiAuth, auth };
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  vi.resetModules();
  while (temporaryHomes.length > 0) {
    fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
  }
});

describe('OpenCode Go multi-auth', () => {
  it('stores accounts with owner-only permissions and never lists API keys', async () => {
    const { multiAuth } = await importWithTempHome();

    expect(multiAuth.addAccount(' first-key ', ' Work ')).toMatchObject({ index: 0, total: 1 });

    expect(fs.statSync(multiAuth.ACCOUNTS_FILE).mode & 0o777).toBe(0o600);
    expect(multiAuth.loadAccounts().accounts[0]).toMatchObject({
      apiKey: 'first-key',
      label: 'Work',
    });
    expect(multiAuth.listAccounts()).toEqual([
      { index: 0, label: 'Work', isCurrent: true, hasKey: true },
    ]);
  });

  it('applies the current account to OpenCode auth and switches immediately', async () => {
    const { multiAuth, auth } = await importWithTempHome();
    auth.writeAuthFile({ openai: { type: 'oauth' } });
    multiAuth.addAccount('first-key', 'First');
    multiAuth.addAccount('second-key', 'Second');

    expect(multiAuth.applyActiveAccountToAuth()).toBe('First');
    expect(auth.readAuthFile()).toMatchObject({
      openai: { type: 'oauth' },
      'opencode-go': { type: 'api', key: 'first-key', label: 'First' },
    });

    expect(multiAuth.switchToNext()).toMatchObject({ from: 'First', to: 'Second', index: 1 });
    expect(auth.readAuthFile()['opencode-go']).toEqual({ type: 'api', key: 'second-key', label: 'Second' });
    expect(multiAuth.listAccounts()[1].isCurrent).toBe(true);
  });

  it('does not rotate when applying auth during repeated startup', async () => {
    const { multiAuth, auth } = await importWithTempHome();
    multiAuth.addAccount('first-key', 'First');
    multiAuth.addAccount('second-key', 'Second');
    multiAuth.switchToNext();

    expect(multiAuth.applyActiveAccountToAuth()).toBe('Second');
    expect(multiAuth.applyActiveAccountToAuth()).toBe('Second');
    expect(auth.readAuthFile()['opencode-go']).toEqual({ type: 'api', key: 'second-key', label: 'Second' });
    expect(multiAuth.listAccounts()[1].isCurrent).toBe(true);
  });

  it('applies a remaining account after removing the current one and clears auth after removing the last account', async () => {
    const { multiAuth, auth } = await importWithTempHome();
    multiAuth.addAccount('first-key', 'First');
    multiAuth.addAccount('second-key', 'Second');
    multiAuth.applyActiveAccountToAuth();
    multiAuth.switchToNext();

    expect(multiAuth.removeAccount(1)).toMatchObject({
      removed: true,
      authChanged: true,
      activeLabel: 'First',
    });
    expect(auth.readAuthFile()['opencode-go']).toEqual({ type: 'api', key: 'first-key', label: 'First' });
    expect(multiAuth.listAccounts()).toEqual([
      { index: 0, label: 'First', isCurrent: true, hasKey: true },
    ]);

    expect(multiAuth.removeAccount(0)).toMatchObject({ removed: true, authChanged: true, activeLabel: null });
    expect(auth.readAuthFile()['opencode-go']).toBeUndefined();
  });

  it('throws on unreadable account JSON instead of treating it as an empty account list', async () => {
    const { multiAuth } = await importWithTempHome();
    fs.mkdirSync(path.dirname(multiAuth.ACCOUNTS_FILE), { recursive: true });
    fs.writeFileSync(multiAuth.ACCOUNTS_FILE, '{not-json', 'utf8');

    expect(() => multiAuth.loadAccounts()).toThrow('Failed to read OpenCode Go accounts');
  });
});
