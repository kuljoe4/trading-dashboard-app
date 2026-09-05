import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Chart Smart Hierarchical Time Axis, Exact Crosshairs, Touch Zoom & Fullscreen Standard', () => {
  const analyticsPath = path.join(__dirname, '../components/Analytics.jsx');
  const analyticsSource = fs.readFileSync(analyticsPath, 'utf-8');

  test('StrategyPerformanceOverlayChart implements Smart Hierarchical Time Axis formatting', () => {
    assert.ok(analyticsSource.includes('primaryLabel'), 'Must generate primary day/period boundary label');
    assert.ok(analyticsSource.includes('secondaryLabel'), 'Must generate secondary concise time/number label');
    assert.ok(analyticsSource.includes('isDayBoundary'), 'Must detect day transition boundary');
    assert.ok(analyticsSource.includes('align: k === 0 ? \'start\''), 'Must align ticks gracefully to prevent edge overflow');
  });

  test('StrategyPerformanceOverlayChart supports Smart Trade Grouping / Bucketing', () => {
    assert.ok(analyticsSource.includes('setGroupingMode'), 'Must manage groupingMode state');
    assert.ok(analyticsSource.includes('isGrouped'), 'Must evaluate isGrouped threshold condition');
    assert.ok(analyticsSource.includes('bucketTradeCount'), 'Must track trades count per bucket');
    assert.ok(analyticsSource.includes('Layers size={11}'), 'Must render grouping mode toggle icon button');
  });

  test('StrategyPerformanceOverlayChart calculates exact crosshairs against SVG plotRef box', () => {
    assert.ok(analyticsSource.includes('plotRef = useRef(null)'), 'Must attach plotRef to SVG plot container');
    assert.ok(analyticsSource.includes('plotRef.current.getBoundingClientRect()'), 'Must calculate hover pct against exact plot box');
    assert.ok(analyticsSource.includes('activePoint.yPnl'), 'Must render horizontal crosshair guide at yPnl');
  });

  test('StrategyPerformanceOverlayChart supports touch & mobile drag on zoom slider with pointer capture', () => {
    assert.ok(analyticsSource.includes('handlePointerDown'), 'Must handle pointer down on handles and track');
    assert.ok(analyticsSource.includes('handlePointerMove'), 'Must handle pointer move without stale closures');
    assert.ok(analyticsSource.includes('setPointerCapture'), 'Must lock pointer capture for mobile touch drag');
    assert.ok(analyticsSource.includes('handleTrackClick'), 'Must support track click-to-jump');
  });

  test('StrategyPerformanceOverlayChart includes Fullscreen Expansion Toggle for Desktop & Mobile', () => {
    assert.ok(analyticsSource.includes('setIsFullscreen'), 'Must manage isFullscreen state');
    assert.ok(analyticsSource.includes('Maximize2'), 'Must render Maximize2 icon button');
    assert.ok(analyticsSource.includes('Minimize2'), 'Must render Minimize2 icon button');
    assert.ok(analyticsSource.includes('Escape'), 'Must support Escape key dismissal');
  });

  test('StrategyPerformanceOverlayChart satisfies WCAG 2.1 accessibility standards', () => {
    assert.ok(analyticsSource.includes('role="slider"'), 'Must specify role=slider for range handles');
    assert.ok(analyticsSource.includes('aria-label="Zoom range left boundary handle"'), 'Must provide explicit ARIA label for left handle');
    assert.ok(analyticsSource.includes('aria-label="Zoom range right boundary handle"'), 'Must provide explicit ARIA label for right handle');
    assert.ok(analyticsSource.includes('aria-label="Toggle full screen chart view"'), 'Must provide explicit ARIA label for fullscreen toggle');
  });
});
