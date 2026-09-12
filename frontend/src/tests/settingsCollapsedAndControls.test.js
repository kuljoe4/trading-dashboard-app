import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('SettingsView sections default to collapsed and include performance controls', () => {
  const settingsViewPath = path.join(__dirname, '../views/SettingsView.jsx');
  const code = fs.readFileSync(settingsViewPath, 'utf-8');

  // Verify openSections initializes to an empty set so sections default to collapsed
  assert.ok(
    code.includes('const [openSections, setOpenSections] = useState(new Set())'),
    'SettingsView must initialize openSections to an empty Set so sections default to collapsed'
  );

  // Verify section buttons enforce aria-expanded
  assert.ok(
    code.includes('aria-expanded={openSections.has('),
    'Section accordion buttons must enforce aria-expanded attribute'
  );

  // Verify controls exist for database auto-pruning retention
  assert.ok(
    code.includes('id="log_retention_days"') && code.includes('id="trade_retention_days"'),
    'SettingsView must include log_retention_days and trade_retention_days input controls'
  );

  // Verify hibernation mode controls
  assert.ok(
    code.includes('patchConfig({ hibernation_mode: mode.id })'),
    'SettingsView must wire hibernation_mode selection buttons to patchConfig'
  );
});
