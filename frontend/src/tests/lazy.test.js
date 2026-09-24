import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { lazyWithRetry } from '../lib/lazy.js';

describe('lazyWithRetry', () => {
  let sessionStorageStore = new Map();
  let reloadMock;
  const originalWindow = global.window;
  const originalSessionStorage = global.sessionStorage;

  beforeEach(() => {
    sessionStorageStore.clear();

    // Safely mock global sessionStorage
    global.sessionStorage = {
      getItem: (key) => sessionStorageStore.get(key) || null,
      setItem: (key, value) => { sessionStorageStore.set(key, String(value)); }
    };

    // Safely mock global window and reload
    reloadMock = mock.fn();
    global.window = {
      ...originalWindow,
      location: {
        reload: reloadMock
      }
    };

    // Mock console.warn to keep test output clean
    mock.method(console, 'warn', () => {});

    // Mock Date.now to have predictable time
    mock.method(Date, 'now', () => 1000000);
  });

  afterEach(() => {
    // Restore globals non-destructively
    global.sessionStorage = originalSessionStorage;
    global.window = originalWindow;
    mock.restoreAll();
  });

  test('successfully resolves component', async () => {
    const componentImport = async () => ({ default: 'MyComponent' });
    const lazyComponent = lazyWithRetry(componentImport);

    // In React 18, lazy component contains _payload which has _result as the factory function.
    // Since this project uses native node:test without an ESM mocking loader,
    // this is the only way to invoke the inner closure returned to React.lazy.
    const result = await lazyComponent._payload._result();
    assert.deepStrictEqual(result, { default: 'MyComponent' });
  });

  test('forces reload on ChunkLoadError when last reload was long ago', async () => {
    const componentImport = async () => {
      const err = new Error('ChunkLoadError');
      err.name = 'ChunkLoadError';
      throw err;
    };

    sessionStorageStore.set('last-chunk-error-reload', '900000'); // 100s ago

    const lazyComponent = lazyWithRetry(componentImport);
    const promise = lazyComponent._payload._result();

    // Wait for the async logic to execute
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(reloadMock.mock.calls.length, 1, 'window.location.reload should be called once');
    assert.strictEqual(sessionStorageStore.get('last-chunk-error-reload'), '1000000', 'sessionStorage should be updated with new timestamp');
  });

  test('forces reload on dynamic module fetch error', async () => {
    const componentImport = async () => {
      throw new Error('Failed to fetch dynamically imported module: https://example.com/chunk.js');
    };

    sessionStorageStore.set('last-chunk-error-reload', '0');

    const lazyComponent = lazyWithRetry(componentImport);
    lazyComponent._payload._result();

    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(reloadMock.mock.calls.length, 1);
  });

  test('throws error if last reload was too recent to prevent infinite loop', async () => {
    const componentImport = async () => {
      const err = new Error('ChunkLoadError');
      err.name = 'ChunkLoadError';
      throw err;
    };

    sessionStorageStore.set('last-chunk-error-reload', '995000'); // 5s ago (less than 10000ms limit)

    const lazyComponent = lazyWithRetry(componentImport);

    try {
      await lazyComponent._payload._result();
      assert.fail('Should have thrown error');
    } catch (e) {
      assert.strictEqual(e.name, 'ChunkLoadError');
    }

    assert.strictEqual(reloadMock.mock.calls.length, 0, 'Should not reload');
  });

  test('throws non-chunk errors immediately without reloading', async () => {
    const componentImport = async () => {
      throw new TypeError('Some standard error');
    };

    const lazyComponent = lazyWithRetry(componentImport);

    try {
      await lazyComponent._payload._result();
      assert.fail('Should have thrown error');
    } catch (e) {
      assert.strictEqual(e.message, 'Some standard error');
    }

    assert.strictEqual(reloadMock.mock.calls.length, 0, 'Should not reload');
  });
});
