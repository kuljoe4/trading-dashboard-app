1. **Understand Goal**: Redesign the Presets tab in `ConfigModal.jsx` matching the provided mockups ("Clean · desktop@1x.png" and "Clean · mobile + batch@1x.png").
2. **PresetItem Component**:
    - Update layout: dot indicator (green for Live, cyan for Testnet, gray for Paper).
    - Dense summary: `<interval> · <risk>% risk · SL <sl>% · TP <tp>R`.
    - If `isLoaded` and `isDirty`, show `x unsaved changes` next to title.
    - Inline Expansion: If `isLoaded` and `isDirty`, display diff cards below the header (e.g. Risk per trade, Stop loss, Trailing stop). Show `Update preset`, `Save as new`, `Revert`, `Duplicate`, `Delete` actions.
    - If `!isLoaded` or `!isDirty`, clicking row should likely select it (for mobile batch select) OR load it. In the new design, the action buttons inside the expanded loaded preset handle the save/revert logic.
3. **Tab Layout (Presets Directory)**:
    - Top Header: "Presets", search input (with `/` shortcut), "Import / Export" tools menu.
    - Filters: All, Live, Testnet, Paper, Variants.
    - Footer: "Variants x / max · combined risk Y% of Z% cap", "Clear variants" button.
4. **Data logic**:
    - `presetTabFilter` needs states: `all`, `live`, `testnet`, `paper`, `variants`.
    - Computed `filteredPresets` based on `presetTabFilter` and `presetSearch`.
    - Combined risk calculation: sum of `risk_pct_per_trade` of `cfg.strategy_variants` + maybe base? Wait, design says `Variants 2 / 4 · combined risk 1.5% of 5.0% cap`. So it's just variants' risk, or variants + base? I'll sum the active variants `risk_pct_per_trade` and show it against `CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT` or similar. Let's look at `CONFIG_LIMITS` and `max_total_risk_pct`. The cap is likely `cfg.max_total_risk_pct`.
5. **Pre-commit Checks**: Wait, we need to run `pnpm test`, `pnpm build`, and maybe some linter. The standard instructions say `pre_commit_instructions` tool handles it.
6. **Execution**:
    - Implement a `PresetDiff` utility component or inline logic to compare `cfg` and `preset.config`.
    - Replace the whole preset tab render block in `ConfigModal.jsx` with the new layout.
    - Replace `PresetItem` definition with the redesigned dense version.
    - Update `ConfigModal.jsx` states to support the new filter tabs.
    - Ensure Mobile view matches batch selection mockups (using `selectedPresetNames` state that already exists).
