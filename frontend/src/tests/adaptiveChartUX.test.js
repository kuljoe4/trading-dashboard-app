import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Adaptive Chart X-Axis, Presets, Brush Slider, Tooltip & Circular Crosshairs Standard', () => {
  const analyticsPath = path.join(__dirname, '../components/Analytics.jsx');
  const analyticsSource = fs.readFileSync(analyticsPath, 'utf-8');

  test('StrategyPerformanceOverlayChart supports axis mode switching ("By Time" vs "By Trade")', () => {
    assert.ok(analyticsSource.includes('onClick={() => setAxisMode(\'time\')}'), 'Must support By Time axis mode toggle');
    assert.ok(analyticsSource.includes('onClick={() => setAxisMode(\'trade\')}'), 'Must support By Trade axis mode toggle');
    assert.ok(analyticsSource.includes('axisMode === \'time\''), 'Must evaluate time vs trade mode logic');
  });

  test('StrategyPerformanceOverlayChart renders range zoom presets (1W, 1M, 3M, 6M, YTD, 1Y, ALL)', () => {
    assert.ok(analyticsSource.includes('[\'1W\', \'1M\', \'3M\', \'6M\', \'YTD\', \'1Y\', \'ALL\']'), 'Must contain zoom preset options');
    assert.ok(analyticsSource.includes('handlePresetSelect(p)'), 'Must execute preset selection handler');
  });

  test('StrategyPerformanceOverlayChart includes draggable mini range brush slider underneath chart', () => {
    assert.ok(analyticsSource.includes('ref={brushRef}'), 'Must render brushRef container');
    assert.ok(analyticsSource.includes('handleBrushMouseDown'), 'Must handle mouse down on brush handles');
    assert.ok(analyticsSource.includes('rangeSpan'), 'Must manage rangeSpan state');
  });

  test('StrategyPerformanceOverlayChart renders bottom win/loss markers and rich floating hover tooltip', () => {
    assert.ok(analyticsSource.includes('key={`wl-marker-${i}`}'), 'Must render win/loss marker circles');
    assert.ok(analyticsSource.includes('Trade #{hoverData.tradeIndex}'), 'Must display Trade # in hover tooltip');
    assert.ok(analyticsSource.includes('hoverData.symbol'), 'Must display symbol in hover tooltip');
    assert.ok(analyticsSource.includes('formatDuration(hoverData.durationMs)'), 'Must display duration in hover tooltip');
  });

  test('StrategyPerformanceOverlayChart renders perfectly circular crosshair overlay markers via CSS absolute positioning', () => {
    assert.ok(analyticsSource.includes('absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full'), 'Must render circular PnL overlay marker');
    assert.ok(analyticsSource.includes('absolute w-2.5 h-2.5 -ml-1.25 -mt-1.25 rounded-full bg-accent'), 'Must render circular HitRate overlay marker');
  });
});
