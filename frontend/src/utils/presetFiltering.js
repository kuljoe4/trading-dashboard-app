/**
 * Pure preset classification, usage-group filtering, and sorting helpers.
 * Partitions presets cleanly into:
 *  - active: loaded base strategy, active variants, or strategies currently running in an active session
 *  - recent: recently loaded/saved presets or presets run in prior sessions (excluding active ones)
 *  - other: remaining library presets not currently active or recently used
 */

export function formatRelativePresetAge(tsMs, nowMs = Date.now()) {
  const ts = Number(tsMs);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const diffMs = Math.max(0, nowMs - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function classifyPresetUsage(preset, context = {}) {
  const name = preset?.name;
  const {
    activeBasePresetName = null,
    variantOrderMap = new Map(),
    activeSessionNames = new Set(),
    recentlyUsedNames = [],
    lastUsedTsByName = new Map(),
  } = context;

  const lastUsedTs = Number(lastUsedTsByName.get(name) || 0);

  if (name && activeBasePresetName && name === activeBasePresetName && !variantOrderMap.has(name)) {
    return { group: 'active', role: 'active_base', tier: 0, lastUsedTs };
  }
  if (name && variantOrderMap.has(name)) {
    return { group: 'active', role: 'active_variant', tier: 1, lastUsedTs };
  }
  if (name && activeSessionNames.has(name)) {
    return { group: 'active', role: 'active_session', tier: 2, lastUsedTs };
  }
  if (name && (recentlyUsedNames.includes(name) || lastUsedTs > 0)) {
    return { group: 'recent', role: 'recent', tier: 3, lastUsedTs };
  }
  return { group: 'other', role: 'other', tier: 4, lastUsedTs: 0 };
}

export function filterAndGroupPresets(presets, options = {}) {
  const safeList = Array.isArray(presets) ? presets.filter((p) => p && typeof p.name === 'string') : [];
  const {
    search = '',
    modeFilter = 'all', // 'all' | 'live' | 'testnet' | 'paper' | 'variants'
    usageFilter = 'all', // 'all' | 'active' | 'recent' | 'other'
    activeBasePresetName = null,
    activeVariants = [],
    sessionRecency = {},
    recentlyUsedNames = [],
  } = options;

  const variantOrderMap = new Map();
  (Array.isArray(activeVariants) ? activeVariants : []).forEach((v, idx) => {
    if (v?.strategy_label && !variantOrderMap.has(v.strategy_label)) {
      variantOrderMap.set(v.strategy_label, idx);
    }
  });

  const activeSessionNames = sessionRecency?.activeNames instanceof Set
    ? sessionRecency.activeNames
    : new Set(Array.isArray(sessionRecency?.activeNames) ? sessionRecency.activeNames : []);

  const lastUsedTsByName = sessionRecency?.lastUsedTsByName instanceof Map
    ? sessionRecency.lastUsedTsByName
    : new Map(Object.entries(sessionRecency?.lastUsedTsByName || {}));

  const searchLower = String(search || '').toLowerCase().trim();

  const baseFiltered = safeList.filter((p) => {
    const pMode = p.config?.trading_mode || (p.config?.paper_mode ? 'paper' : 'live');
    if (searchLower) {
      const nameMatch = p.name.toLowerCase().includes(searchLower);
      const labelMatch = String(p.config?.strategy_label || '').toLowerCase().includes(searchLower);
      const modeMatch = String(pMode || '').toLowerCase().includes(searchLower);
      if (!nameMatch && !labelMatch && !modeMatch) return false;
    }

    if (modeFilter !== 'all') {
      if (modeFilter === 'variants') {
        if (!variantOrderMap.has(p.name)) return false;
      } else if (pMode !== modeFilter) {
        return false;
      }
    }

    return true;
  });

  const metaByName = new Map();
  const context = {
    activeBasePresetName,
    variantOrderMap,
    activeSessionNames,
    recentlyUsedNames: Array.isArray(recentlyUsedNames) ? recentlyUsedNames : [],
    lastUsedTsByName,
  };

  for (const p of baseFiltered) {
    metaByName.set(p.name, classifyPresetUsage(p, context));
  }

  const comparePresets = (a, b) => {
    const metaA = metaByName.get(a.name);
    const metaB = metaByName.get(b.name);
    if (metaA.tier !== metaB.tier) return metaA.tier - metaB.tier;

    if (metaA.tier === 1) {
      return (variantOrderMap.get(a.name) ?? 0) - (variantOrderMap.get(b.name) ?? 0);
    }

    if (metaA.tier === 3) {
      const idxA = context.recentlyUsedNames.indexOf(a.name);
      const idxB = context.recentlyUsedNames.indexOf(b.name);
      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
      if (idxA !== -1 && idxB === -1) return -1;
      if (idxB !== -1 && idxA === -1) return 1;
      if (metaA.lastUsedTs !== metaB.lastUsedTs) return metaB.lastUsedTs - metaA.lastUsedTs;
    }

    return a.name.localeCompare(b.name);
  };

  const groups = {
    active: [],
    recent: [],
    other: [],
  };

  for (const p of baseFiltered) {
    const meta = metaByName.get(p.name);
    groups[meta.group].push(p);
  }

  groups.active.sort(comparePresets);
  groups.recent.sort(comparePresets);
  groups.other.sort(comparePresets);

  const counts = {
    all: baseFiltered.length,
    active: groups.active.length,
    recent: groups.recent.length,
    other: groups.other.length,
  };

  let items;
  if (usageFilter === 'active') {
    items = groups.active;
  } else if (usageFilter === 'recent') {
    items = groups.recent;
  } else if (usageFilter === 'other') {
    items = groups.other;
  } else {
    items = [...groups.active, ...groups.recent, ...groups.other];
  }

  return {
    items,
    groups,
    counts,
    metaByName,
  };
}
