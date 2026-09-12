import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Rest Telemetry & Preset Multi-Select UI/UX Standards', () => {
  const metricsFilePath = path.join(__dirname, '../components/SystemMetrics.jsx');
  const modalFilePath = path.join(__dirname, '../components/ConfigModal.jsx');

  test('SystemMetrics renders ultra-dense REST Call Distribution badges and mobile telemetry drawer', () => {
    const code = fs.readFileSync(metricsFilePath, 'utf8');
    assert.ok(code.includes('api_requests_breakdown'), 'SystemMetrics must reference api_requests_breakdown');
    assert.ok(code.includes('REST Call Distribution'), 'SystemMetrics must display REST Call Distribution section header');
    assert.ok(code.includes('handleCopyDiagnostics'), 'SystemMetrics must support handleCopyDiagnostics snippet generation');
    assert.ok(code.includes('isMobileDiagOpen'), 'SystemMetrics must provide mobile diagnostic drawer state');
    assert.ok(code.includes('System Telemetry & Diagnostics'), 'SystemMetrics must render mobile telemetry drawer title');
  });

  test('ConfigModal implements multi-select preset controls and batch actions', () => {
    const code = fs.readFileSync(modalFilePath, 'utf8');
    assert.ok(code.includes('selectedPresetNames'), 'ConfigModal must track selectedPresetNames in state');
    assert.ok(code.includes('handleSelectAllPresets'), 'ConfigModal must provide handleSelectAllPresets toggle');
    assert.ok(code.includes('handleCopySelectedPresets'), 'ConfigModal must support handleCopySelectedPresets batch copy');
    assert.ok(code.includes('handleExportSelectedPresets'), 'ConfigModal must support handleExportSelectedPresets batch export');
    assert.ok(code.includes('handleDeleteSelectedPresets'), 'ConfigModal must support handleDeleteSelectedPresets batch delete');
    assert.ok(code.includes('handleCopyActiveToClipboard'), 'ConfigModal must support handleCopyActiveToClipboard for single active config');
    assert.ok(code.includes('handlePasteActiveFromClipboard'), 'ConfigModal must support handlePasteActiveFromClipboard for single active config');
  });
});
