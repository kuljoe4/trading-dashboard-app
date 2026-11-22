import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Config Modal Default Collapsed State & Fast Market Indications Verification', () => {
  const configModalPath = path.resolve(__dirname, '../components/ConfigModal.jsx');
  const dashboardPath = path.resolve(__dirname, '../views/DashboardView.jsx');
  const scannerOverlayPath = path.resolve(__dirname, '../components/ScannerOverlay.jsx');

  const configModalCode = fs.readFileSync(configModalPath, 'utf8');
  const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
  const overlayCode = fs.readFileSync(scannerOverlayPath, 'utf8');

  // Verify ConfigModal defaults openSectionId to null for fresh config creation and recentExpanded to false
  assert.ok(
    configModalCode.includes("const [openSectionId, setOpenSectionId] = useState(() => {") &&
    configModalCode.includes("return null;"),
    'ConfigModal must default openSectionId to null so fresh section panels are collapsed by default'
  );
  assert.ok(
    configModalCode.includes("const [recentExpanded, setRecentExpanded] = useState(false);"),
    'ConfigModal must initialize recentExpanded to false by default'
  );

  // Verify DashboardView fast market expansion banner
  assert.ok(
    dashboardCode.includes("🔥 Fast Market Expansion"),
    'DashboardView ScannerPreview must render Fast Market Expansion banner when market activity is high'
  );

  // Verify ScannerOverlay fast market expansion alert bar and focus movers trigger
  assert.ok(
    overlayCode.includes("🔥 Fast Market Expansion"),
    'ScannerOverlay must render Fast Market Expansion alert bar when market regime is active'
  );
  assert.ok(
    overlayCode.includes("Focus Movers"),
    'ScannerOverlay fast market alert bar must include Focus Movers filter toggle'
  );
});
