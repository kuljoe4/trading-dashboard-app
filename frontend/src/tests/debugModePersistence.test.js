import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

class StorageMock {
  constructor() {
    this.store = {};
  }
  clear() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new StorageMock();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new StorageMock();
}

const { useTradingStore } = await import('../store/trading.js');

describe('Debug Mode App Settings Persistence Standard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useTradingStore.setState({
      config: {
        debug_mode: false,
      },
      sessionActive: false,
    });
  });

  test('patchConfig saves debug_mode to localStorage and sessionStorage config_draft', async () => {
    const store = useTradingStore.getState();

    await store.patchConfig({ debug_mode: true });

    assert.strictEqual(localStorage.getItem('global_debug_mode'), 'true');
    assert.strictEqual(useTradingStore.getState().config.debug_mode, true);

    const draft = JSON.parse(sessionStorage.getItem('config_draft') || '{}');
    assert.strictEqual(draft.debug_mode, true);
  });

  test('updateConfig saves debug_mode to localStorage', () => {
    const store = useTradingStore.getState();

    store.updateConfig({ debug_mode: true });

    assert.strictEqual(localStorage.getItem('global_debug_mode'), 'true');
    assert.strictEqual(useTradingStore.getState().config.debug_mode, true);
  });

  test('patchConfig turns off debug_mode and updates localStorage to false', async () => {
    localStorage.setItem('global_debug_mode', 'true');
    useTradingStore.setState({ config: { debug_mode: true } });

    const store = useTradingStore.getState();
    await store.patchConfig({ debug_mode: false });

    assert.strictEqual(localStorage.getItem('global_debug_mode'), 'false');
    assert.strictEqual(useTradingStore.getState().config.debug_mode, false);
  });
});
