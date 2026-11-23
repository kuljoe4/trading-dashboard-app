export const CONFIG_SECTION_ORDER_STORAGE_KEY = 'config_section_order_v1';

export const TAB_SECTION_DEFAULTS = {
  summary: ['summary_env', 'summary_scan', 'summary_entry', 'summary_exit', 'summary_risk'],
  scan: ['scan_general', 'scan_htf_cross', 'scan_global', 'scan_watchlist', 'scan_exclusion'],
  strategy: ['strategy_entry', 'strategy_params', 'strategy_exit', 'strategy_whipsaw', 'strategy_knife', 'strategy_timeframes'],
  risk: ['risk_guards', 'risk_martingale', 'risk_sl', 'risk_tp', 'risk_temporal'],
  env: ['adv_env', 'adv_capital'],
};

/**
 * Normalize a saved order list against known default section IDs for a tab.
 * Preserves the user's saved sequence, drops unknown/duplicate IDs,
 * and appends any newly introduced default IDs at the end.
 */
export function normalizeSectionOrder(tabId, savedOrder, fallbackOrder = TAB_SECTION_DEFAULTS[tabId] || []) {
  const defaults = Array.isArray(fallbackOrder) ? fallbackOrder : [];
  const validSet = new Set(defaults);
  const seen = new Set();
  const normalized = [];

  if (Array.isArray(savedOrder)) {
    for (const id of savedOrder) {
      if (typeof id === 'string' && validSet.has(id) && !seen.has(id)) {
        seen.add(id);
        normalized.push(id);
      }
    }
  }

  for (const id of defaults) {
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }

  return normalized;
}

export function normalizeSectionOrderMap(rawMap) {
  const safeMap = rawMap && typeof rawMap === 'object' ? rawMap : {};
  const result = {};
  for (const [tabId, defaults] of Object.entries(TAB_SECTION_DEFAULTS)) {
    result[tabId] = normalizeSectionOrder(tabId, safeMap[tabId], defaults);
  }
  return result;
}

export function loadPersistedSectionOrders(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const raw = storage ? storage.getItem(CONFIG_SECTION_ORDER_STORAGE_KEY) : null;
    if (!raw) return normalizeSectionOrderMap(null);
    const parsed = JSON.parse(raw);
    return normalizeSectionOrderMap(parsed);
  } catch {
    return normalizeSectionOrderMap(null);
  }
}

export function savePersistedSectionOrders(orderMap, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const normalized = normalizeSectionOrderMap(orderMap);
  try {
    if (storage) {
      storage.setItem(CONFIG_SECTION_ORDER_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {}
  return normalized;
}

export function moveSectionInOrder(order, sectionId, direction) {
  if (!Array.isArray(order)) return [];
  const idx = order.indexOf(sectionId);
  if (idx === -1) return [...order];

  let targetIdx = idx;
  if (direction === 'up') {
    targetIdx = Math.max(0, idx - 1);
  } else if (direction === 'down') {
    targetIdx = Math.min(order.length - 1, idx + 1);
  } else if (direction === 'top') {
    targetIdx = 0;
  } else if (direction === 'bottom') {
    targetIdx = order.length - 1;
  } else if (typeof direction === 'number' && Number.isFinite(direction)) {
    targetIdx = Math.max(0, Math.min(order.length - 1, idx + Math.trunc(direction)));
  }

  if (targetIdx === idx) return [...order];
  const next = [...order];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);
  return next;
}

export function reorderSectionIds(order, fromId, toId) {
  if (!Array.isArray(order) || !fromId || !toId || fromId === toId) {
    return Array.isArray(order) ? [...order] : [];
  }
  const fromIdx = order.indexOf(fromId);
  const toIdx = order.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [...order];
  const next = [...order];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

/**
 * Merge an updated list of visible IDs back into the full normalized tab order
 * so any conditionally hidden IDs remain intact.
 */
export function mergeVisibleReorder(fullOrder, nextVisibleOrder) {
  if (!Array.isArray(fullOrder)) return Array.isArray(nextVisibleOrder) ? [...nextVisibleOrder] : [];
  if (!Array.isArray(nextVisibleOrder) || nextVisibleOrder.length === 0) return [...fullOrder];
  const visibleSet = new Set(nextVisibleOrder);
  let cursor = 0;
  return fullOrder.map((id) => (visibleSet.has(id) ? nextVisibleOrder[cursor++] : id));
}

export function isCustomSectionOrder(tabId, order, defaults = TAB_SECTION_DEFAULTS[tabId] || []) {
  if (!Array.isArray(order) || !Array.isArray(defaults) || order.length !== defaults.length) {
    return false;
  }
  for (let i = 0; i < defaults.length; i += 1) {
    if (order[i] !== defaults[i]) return true;
  }
  return false;
}
