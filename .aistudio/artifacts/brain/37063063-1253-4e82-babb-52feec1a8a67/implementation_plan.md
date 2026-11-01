# Implementation Plan & Resolution: Strategy Variants Configuration, Preset Persistence & Metrics Isolation

## Root Cause Analysis

1. **`coerceAndSanitizeConfig` Forcibly Cleared Variants**:
   - `coerceAndSanitizeConfig` in `ConfigModal.jsx` had a blanket assignment `c.strategy_variants = []` originally intended to prevent runaway recursion in nested variants. Because this function was also called on the root base strategy during save, it wiped `base.strategy_variants` back to `[]` whenever variant settings were updated.
2. **`savePreset` & `handleConfirmSaveAsNew` Stripped Variants in Presets**:
   - When updating or saving presets in the Presets library, `savePreset` and `handleConfirmSaveAsNew` explicitly forced `strategy_variants: []`, causing library presets to permanently lose their configured variants whenever preset parameters were updated.
3. **`loadPreset` Ignored Saved Preset Variants**:
   - `loadPreset` was discarding `p.config.strategy_variants` and falling back to filtering `cfg.strategy_variants`.
4. **Base Card Metrics Aggregation & State Leakage**:
   - In `DashboardView.jsx`, when `strategy_variants` was stripped or empty, active trades for variants fell back to the base strategy label in `pnlMap`.
   - Furthermore, the base strategy card's `totalPnl`, `entryCount`, and `hitCount` defaulted to the global session aggregates (`currentStrategy.totalPnl`, `currentStrategy.entryCount`, `currentStrategy.hitCount`) rather than isolating the base strategy's own metrics. When the base strategy was paused and the user left the app, returning hours later showed only the base strategy with all variant stats accumulated into it.

---

## Fixes Implemented

1. **`ConfigModal.jsx` - Recursive Depth Guard with Variant Preservation**:
   - Updated `coerceAndSanitizeConfig(rawConfig, isNestedVariant = false)`. When `isNestedVariant` is `true`, nested variants inside a variant are zeroed out (`c.strategy_variants = []`) to prevent infinite recursion (>1 level deep). When `isNestedVariant` is `false`, the base strategy's `strategy_variants` array is preserved and each child variant is mapped and sanitized.
   - In `buildConfigToSave`: Updated variant editing branch to merge the edited variant into `base.strategy_variants` and invoke `coerceAndSanitizeConfig(base, false)` so that the full root config retains all variants.
   - In `savePreset`: Base presets retain their configured `strategy_variants` in `presetPayload` instead of forcing `strategy_variants: []`. (Only saving an individual variant directly as a preset zeros out variants).
   - In `loadPreset`: Presets with attached `strategy_variants` restore those variants upon loading, deduplicating any variant matching the promoted base name.
   - In `handleConfirmSaveAsNew`: Preserves attached variants in the newly created preset.

2. **`DashboardView.jsx` - Safe Merge & Metrics Isolation**:
   - In `handleConfigSave`: Added checks ensuring that saving either a variant or the base strategy never wipes `finalConfig.strategy_variants`.
   - In `activePnlMap`: If an active trade belongs to a specific variant label, that label is registered into `pnlMap` dynamically rather than collapsing into the base strategy label.
   - In `StrategyCard` (Base Card): Derived `baseTotalPnl`, `baseEntryCount`, and `baseHitCount` strictly from the base strategy's metrics (`safeVariantStats[baseLabel]` or `baseMetric + activePnlMap[baseLabel]`). When variants are active, the base card never defaults to global session aggregates (`currentStrategy.totalPnl`), completely isolating each strategy card's metrics.

3. **Verification**:
   - Verified with `compile_applet` (100% successful build).
   - Verified with `lint_applet` (passed without syntax or import issues).
   - Restarted development server.
