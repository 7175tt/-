import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiKeySettingsStore, GEMINI_API_KEY_STORAGE_KEY as KEY, getGeminiKeySettings, normalizeGeminiApiKey } from '../services/geminiKeySettings';

const firstKey = 'synthetic_test_key_123456789';
const secondKey = 'synthetic_replacement_987654321';
class FakeStorage {
  values = new Map<string, string>();
  failSet = false;
  failRemove = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failSet) throw new Error(`Denied secret: ${value}`); this.values.set(key, value); }
  removeItem(key: string) { if (this.failRemove) throw new Error(`Denied secret: ${this.getItem(key)}`); this.values.delete(key); }
}
const setup = () => {
  const session = new FakeStorage(), local = new FakeStorage();
  const options = { sessionStorage: () => session, localStorage: () => local };
  return { session, local, options, store: createGeminiKeySettingsStore(options) };
};

test('default storage is tab session only, survives reload, and is absent from a new session', () => {
  const { store, session, local, options } = setup();
  store.save(`  ${firstKey}\n`);
  assert.equal(session.getItem(KEY), firstKey);
  assert.equal(local.getItem(KEY), null);
  assert.deepEqual(createGeminiKeySettingsStore(options).getSettings(), { apiKey: firstKey, remember: false, error: null });
  assert.equal(createGeminiKeySettingsStore({ ...options, sessionStorage: () => new FakeStorage() }).getSettings().apiKey, '');
  assert.deepEqual([...session.values.keys()], [KEY]);
});

test('remembering is explicit and switching back removes the durable copy', () => {
  const { store, session, local, options } = setup();
  store.save(firstKey);
  store.save(secondKey, true);
  assert.equal(session.getItem(KEY), null);
  assert.equal(local.getItem(KEY), secondKey);
  assert.equal(createGeminiKeySettingsStore({ ...options, sessionStorage: () => new FakeStorage() }).getSettings().remember, true);
  store.save(firstKey, false);
  assert.equal(local.getItem(KEY), null);
  assert.equal(session.getItem(KEY), firstKey);
});

test('failed replacement or persistence move retains the existing key and never exposes it in errors', () => {
  const { store, session, local } = setup();
  store.save(firstKey, true);
  local.failSet = true;
  assert.throws(() => store.save(secondKey, true), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(firstKey) && !error.message.includes(secondKey));
    return true;
  });
  assert.equal(local.getItem(KEY), firstKey);
  local.failSet = false;
  local.failRemove = true;
  assert.throws(() => store.save(secondKey, false), /未能完整儲存/);
  assert.equal(local.getItem(KEY), firstKey);
  assert.equal(session.getItem(KEY), null, 'new session copy is rolled back if old durable copy cannot be removed');
  assert.equal(store.getSettings().apiKey, firstKey);
  assert.ok(!store.getSettings().error?.includes(firstKey));
});

test('clear removes every copy and reports blocked removal rather than claiming success', () => {
  const { store, session, local } = setup();
  store.save(firstKey, true);
  local.failRemove = true;
  assert.throws(() => store.clear(), /未能完整移除/);
  assert.equal(store.getSettings().apiKey, firstKey);
  assert.equal(local.getItem(KEY), firstKey);
  local.failRemove = false;
  session.setItem(KEY, secondKey);
  store.clear();
  assert.equal(session.getItem(KEY), null);
  assert.equal(local.getItem(KEY), null);
  assert.deepEqual(store.getSettings(), { apiKey: '', remember: false, error: null });
});

test('a partial clear restores the tab key when the remembered copy cannot be removed', () => {
  const { store, session, local } = setup();
  session.setItem(KEY, firstKey);
  local.setItem(KEY, secondKey);
  local.failRemove = true;
  assert.throws(() => store.clear(), /未能完整移除/);
  assert.equal(session.getItem(KEY), firstKey);
  assert.equal(local.getItem(KEY), secondKey);
  assert.equal(store.getSettings().apiKey, firstKey);
});

test('malformed stored values are never used as request keys and can still be removed', () => {
  const { store, local } = setup();
  local.setItem(KEY, 'not-a-valid-key');
  assert.equal(store.getSettings().apiKey, '');
  assert.match(store.getSettings().error!, /格式不正確/);
  store.clear();
  assert.equal(local.getItem(KEY), null);
  assert.equal(store.getSettings().error, null);
});

test('invalid key input never changes storage and never appears in error text', () => {
  const { store, session } = setup();
  store.save(firstKey);
  for (const value of ['short', '<secret>'.repeat(4), 'x'.repeat(257), 'validlengthbut\ninjectedsecret']) {
    assert.throws(() => store.save(value), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(value));
      return true;
    });
    assert.equal(session.getItem(KEY), firstKey);
  }
  assert.equal(normalizeGeminiApiKey('a'.repeat(20)), 'a'.repeat(20));
  assert.equal(normalizeGeminiApiKey('a'.repeat(256)), 'a'.repeat(256));
});

test('snapshots remain stable, subscribers receive changes, and storage updates refresh safely', () => {
  const session = new FakeStorage(), local = new FakeStorage();
  let storageChanged = () => {}, removed = false, notifications = 0;
  const store = createGeminiKeySettingsStore({ sessionStorage: () => session, localStorage: () => local,
    subscribeToChanges: listener => { storageChanged = listener; return () => { removed = true; }; } });
  const initial = store.getSettings();
  assert.equal(initial, store.getSettings());
  const unsubscribe = store.subscribe(() => notifications++);
  store.save(firstKey);
  assert.equal(notifications, 1);
  store.save(firstKey);
  assert.equal(notifications, 1);
  local.setItem(KEY, secondKey);
  storageChanged();
  assert.equal(store.getSettings().apiKey, firstKey, 'a tab key takes precedence over another tab’s remembered key');
  session.removeItem(KEY);
  storageChanged();
  assert.equal(store.getSettings().apiKey, secondKey);
  assert.equal(store.getSettings().remember, true);
  unsubscribe();
  assert.equal(removed, true);
});

test('SSR and blocked browser storage can be read without throwing or leaking exception text', () => {
  assert.equal(getGeminiKeySettings().apiKey, '');
  const blocked = createGeminiKeySettingsStore({ sessionStorage: () => { throw new Error(firstKey); }, localStorage: () => null });
  assert.equal(blocked.getSettings().apiKey, '');
  assert.ok(blocked.getSettings().error);
  assert.ok(!blocked.getSettings().error?.includes(firstKey));
  assert.throws(() => blocked.save(secondKey), /未能完整儲存/);
});
