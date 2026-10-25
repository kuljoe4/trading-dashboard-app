import { test, describe } from 'node:test';
import assert from 'node:assert';

// Pure logic replication of presets normalization and partitioning as implemented in ConfigModal.jsx
function normalizePresetsResponse(res) {
  let rawData = res?.data;
  if (rawData && !Array.isArray(rawData)) {
    if (Array.isArray(rawData.presets)) {
      rawData = rawData.presets;
    } else if (Array.isArray(rawData.data)) {
      rawData = rawData.data;
    }
  }
  if (Array.isArray(rawData)) {
    return rawData.filter(p => p && typeof p === 'object' && typeof p.name === 'string');
  }
  return [];
}

function partitionPresets(presets, presetSearch = '', loadedPresetName = null, strategyVariants = [], recentlyUsedNames = []) {
  const searchLower = presetSearch.toLowerCase().trim();
  const safePresets = Array.isArray(presets) ? presets : [];
  const filtered = safePresets.filter(p =>
    p && typeof p.name === 'string' && (!searchLower || p.name.toLowerCase().includes(searchLower))
  );

  const active = [];
  const recentlyUsed = [];
  const available = [];

  const activeSet = new Set();
  filtered.forEach(p => {
    const isLoaded = loadedPresetName === p.name;
    const isVar = (strategyVariants || []).some(v => v.strategy_label === p.name);
    if (isLoaded || isVar) {
      active.push(p);
      activeSet.add(p.name);
    }
  });

  const recentSet = new Set(recentlyUsedNames);
  filtered.forEach(p => {
    if (activeSet.has(p.name)) return;
    if (recentSet.has(p.name)) {
      recentlyUsed.push(p);
    } else {
      available.push(p);
    }
  });

  recentlyUsed.sort((a, b) => {
    const idxA = recentlyUsedNames.indexOf(a.name);
    const idxB = recentlyUsedNames.indexOf(b.name);
    return idxA - idxB;
  });

  return { active, recentlyUsed, available };
}

function safeFilterPresets(presets, predicate) {
  const safe = Array.isArray(presets) ? presets : [];
  return safe.filter(predicate);
}

describe('ConfigModal Presets Data Validation & Array Resilience', () => {
  test('correctly normalizes direct array response', () => {
    const mockRes = {
      data: [
        { name: 'Preset A', config: {} },
        { name: 'Preset B', config: {} }
      ]
    };
    const normalized = normalizePresetsResponse(mockRes);
    assert.strictEqual(normalized.length, 2);
    assert.strictEqual(normalized[0].name, 'Preset A');
  });

  test('correctly normalizes nested { data: { presets: [...] } } response', () => {
    const mockRes = {
      data: {
        presets: [
          { name: 'Nested Preset 1', config: {} }
        ]
      }
    };
    const normalized = normalizePresetsResponse(mockRes);
    assert.strictEqual(normalized.length, 1);
    assert.strictEqual(normalized[0].name, 'Nested Preset 1');
  });

  test('correctly normalizes nested { data: { data: [...] } } response', () => {
    const mockRes = {
      data: {
        data: [
          { name: 'Wrapped Preset', config: {} }
        ]
      }
    };
    const normalized = normalizePresetsResponse(mockRes);
    assert.strictEqual(normalized.length, 1);
    assert.strictEqual(normalized[0].name, 'Wrapped Preset');
  });

  test('filters out invalid or non-object entries missing valid name', () => {
    const mockRes = {
      data: [
        { name: 'Valid Preset', config: {} },
        null,
        undefined,
        'string',
        { invalid: true },
        { name: 123 },
        { name: '' }
      ]
    };
    const normalized = normalizePresetsResponse(mockRes);
    assert.strictEqual(normalized.length, 2); // 'Valid Preset' and '' (string)
    assert.strictEqual(normalized[0].name, 'Valid Preset');
  });

  test('safely falls back to empty array on error objects or 404 responses', () => {
    const errorResponses = [
      { data: { statusCode: 404, message: 'Cannot GET /presets' } },
      { data: { error: 'Internal Server Error' } },
      { data: null },
      { data: undefined },
      { data: 'Error HTML string' },
      null,
      undefined
    ];

    for (const res of errorResponses) {
      const normalized = normalizePresetsResponse(res);
      assert.ok(Array.isArray(normalized), 'Must return an array');
      assert.strictEqual(normalized.length, 0);

      // Verify partitionPresets does NOT throw TypeError: filter is not a function
      assert.doesNotThrow(() => {
        const partitioned = partitionPresets(res?.data);
        assert.deepStrictEqual(partitioned, { active: [], recentlyUsed: [], available: [] });
      });

      // Verify safeFilterPresets does NOT throw
      assert.doesNotThrow(() => {
        const filtered = safeFilterPresets(res?.data, p => p.name === 'test');
        assert.deepStrictEqual(filtered, []);
      });
    }
  });

  test('partitionPresets functions properly with safe array data', () => {
    const validPresets = [
      { name: 'Scalp 1', config: {} },
      { name: 'Trend 2', config: {} },
      { name: 'Recent 3', config: {} }
    ];

    const partitioned = partitionPresets(validPresets, 'Trend', null, [], []);
    assert.strictEqual(partitioned.available.length, 1);
    assert.strictEqual(partitioned.available[0].name, 'Trend 2');
  });
});
