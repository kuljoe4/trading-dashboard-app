import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Presets & Variant UX Verification', async (t) => {
  const configModalPath = fs.existsSync(path.resolve(__dirname, '../components/ConfigModal.jsx'))
    ? path.resolve(__dirname, '../components/ConfigModal.jsx')
    : path.resolve('frontend/src/components/ConfigModal.jsx');
  const dashboardViewPath = fs.existsSync(path.resolve(__dirname, '../views/DashboardView.jsx'))
    ? path.resolve(__dirname, '../views/DashboardView.jsx')
    : path.resolve('frontend/src/views/DashboardView.jsx');

  const configModalContent = fs.readFileSync(configModalPath, 'utf8');
  const dashboardViewContent = fs.readFileSync(dashboardViewPath, 'utf8');

  await t.test('1. Start Session / Apply Changes button is NOT overlapped by fixed bottom bar in Presets panel', () => {
    // Assert that the presets panel does not have fixed bottom-0 / fixed bottom-[68px]
    assert.doesNotMatch(
      configModalContent,
      /id="config-panel-presets"[\s\S]*?fixed bottom-(?:0|\[68px\])/,
      'The presets panel must not contain a fixed bottom bar that hovers over the sticky footer'
    );

    // Verify docked in-flow variants & batch summary container is present
    assert.match(
      configModalContent,
      /In-flow Variants & Batch Summary Bar/,
      'Docked in-flow variants bar should be present in presets section'
    );
  });

  await t.test('2. "Save as new" and SavePresetModal dialog are properly integrated', () => {
    // Assert SavePresetModal component exists
    assert.match(configModalContent, /const SavePresetModal = \({/, 'SavePresetModal component must be defined');

    // Assert SavePresetModal is rendered with handlers
    assert.match(configModalContent, /<SavePresetModal[\s\S]*?isOpen={saveModalState\.isOpen}/, 'SavePresetModal must be rendered');

    // Assert handleConfirmSaveAsNew calls presetsAPI.save
    assert.match(configModalContent, /presetsAPI\.save\(newName, payload\)/, 'handleConfirmSaveAsNew must call presetsAPI.save');
  });

  await t.test('3. Variant presets are color-coded with violet palette and badge', () => {
    // PresetItem color coding
    assert.match(configModalContent, /border-violet-500\/30 bg-violet-500\/\[0\.03\]/, 'Variant presets must have violet styling');
    assert.match(configModalContent, /Variant #\$\{variantIndex \+ 1\}/, 'Variant presets must show variant index badge/title');
    assert.match(configModalContent, /bg-violet-400 shadow-\[0_0_8px_rgba\(167,139,250,0\.8\)\]/, 'Variant status indicator must be violet');
  });

  await t.test('4. Editing variant preserves base strategy configuration in memory and prevents becoming active base', () => {
    // Verify baseConfigBackup and editingVariantIdx state
    assert.match(configModalContent, /editingVariantIdx, setEditingVariantIdx/);
    assert.match(configModalContent, /baseConfigBackup, setBaseConfigBackup/);

    // Verify startEditingVariant snapshots base config and preserves variants list
    assert.match(configModalContent, /const startEditingVariant = React\.useCallback\(/);
    assert.match(configModalContent, /strategy_variants: currentBase\.strategy_variants \|\| \[\]/);

    // Verify variants are never marked as isLoaded active base
    assert.match(configModalContent, /isLoaded = \([\s\S]*?\) && !isVariant;/);

    // Verify buildConfigToSave merges variant edits back into baseConfigBackup
    assert.match(configModalContent, /if \(editingVariantIdx !== null && baseConfigBackup\)/);
    assert.match(configModalContent, /variants\[editingVariantIdx\] = sanitizedVariant;/);

    // Verify DashboardView passes baseConfig and initialEditingVariantIndex to ConfigModal
    assert.match(dashboardViewContent, /baseConfig=\{config\}/);
    assert.match(dashboardViewContent, /initialEditingVariantIndex=\{editingVariantIndex\}/);
  });

  await t.test('5. Preset section search and filter tabs are clear and responsive', () => {
    // Search input is not hidden on sm/mobile
    assert.doesNotMatch(configModalContent, /placeholder="Search presets by name or mode\.\.\. \(\/\)"[\s\S]*?hidden sm:block/);
    assert.match(configModalContent, /Search presets by name or mode\.\.\./);

    // Filter tabs are horizontally scrollable with no-scrollbar
    assert.match(configModalContent, /overflow-x-auto no-scrollbar/);
    assert.match(configModalContent, /Variants/);
  });

  await t.test('6. Preset sub-header ribbon in other tabs is ultra-dense, without redundant preset labels or links', () => {
    // Sub-header renders when section !== 'presets'
    assert.match(configModalContent, /{section !== 'presets' && \(/);

    // Ultra-dense ribbon does NOT contain redundant "Preset:" label or "Presets →" link
    assert.doesNotMatch(
      configModalContent,
      /Ultra-Dense[\s\S]*?Preset:\s*['"]\$\{loadedPresetName\}['"]/
    );
    assert.doesNotMatch(
      configModalContent,
      /Ultra-Dense[\s\S]*?Presets\s*→/
    );

    // Variant subheader displays V{index} and action buttons
    assert.match(configModalContent, /V\{editingVariantIdx \+ 1\}/);
    assert.match(configModalContent, /Save Variant/);
    assert.match(configModalContent, /Base Safe/);

    // Base preset subheader displays sync status and Update / Save As
    assert.match(configModalContent, /Synced/);
    assert.match(configModalContent, /Modified/);
    assert.match(configModalContent, /<span>Update<\/span>/);
    assert.match(configModalContent, />\s*Save As\s*</);
  });
});
