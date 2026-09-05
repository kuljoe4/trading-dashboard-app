import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Chart Line Widths & Sharpe/Sortino Metrics UX Standard', () => {
  const analyticsPath = path.join(__dirname, '../components/Analytics.jsx');
  const dataChartsPath = path.join(__dirname, '../components/DataCharts.jsx');
  const dashboardViewPath = path.join(__dirname, '../views/DashboardView.jsx');
  const strategyDetailViewPath = path.join(__dirname, '../views/StrategyDetailView.jsx');

  const analyticsSource = fs.readFileSync(analyticsPath, 'utf-8');
  const dataChartsSource = fs.readFileSync(dataChartsPath, 'utf-8');
  const dashboardViewSource = fs.readFileSync(dashboardViewPath, 'utf-8');
  const strategyDetailViewSource = fs.readFileSync(strategyDetailViewPath, 'utf-8');

  test('chart SVG paths specify minimal line stroke widths (<= 0.8px)', () => {
    assert.ok(dataChartsSource.includes('strokeWidth="0.8"'), 'DataCharts Sparkline & Candlestick lines must specify minimal strokeWidth="0.8"');
    assert.ok(analyticsSource.includes('strokeWidth="0.4"'), 'Analytics lines must specify crisp minimal strokeWidth="0.4"');
    assert.ok(analyticsSource.includes('strokeWidth="0.5"'), 'Analytics PnL overlay lines must specify strokeWidth="0.5"');
    assert.ok(analyticsSource.includes('strokeWidth="0.6"'), 'Analytics HitRate overlay lines must specify strokeWidth="0.6"');
  });

  test('chart SVG filters specify minimal glow blur stdDeviation (<= 0.2)', () => {
    assert.ok(analyticsSource.includes('feGaussianBlur stdDeviation="0.15"'), 'Chart glow filter feGaussianBlur stdDeviation must be minimal (0.15)');
  });

  test('StrategyPerformanceOverlayChart computes and plots rolling PF, Sharpe, and Sortino ratio curves', () => {
    assert.ok(analyticsSource.includes('showPf && pfPathD'), 'StrategyPerformanceOverlayChart must render rolling Profit Factor path');
    assert.ok(analyticsSource.includes('showSharpe && sharpePathD'), 'StrategyPerformanceOverlayChart must render rolling Sharpe path');
    assert.ok(analyticsSource.includes('showSortino && sortinoPathD'), 'StrategyPerformanceOverlayChart must render rolling Sortino path');
    assert.ok(analyticsSource.includes('So: {Number(activePoint?.sortino || 0).toFixed(2)}'), 'StrategyPerformanceOverlayChart header must display Sortino ratio');
  });

  test('strategy cards in DashboardView render Sharpe (Sh) and Sortino (So) alongside PF with recommended value tooltips', () => {
    assert.ok(dashboardViewSource.includes('PF: {pfText}'), 'StrategyCard must render PF text');
    assert.ok(dashboardViewSource.includes('Sh: {sharpeText}'), 'StrategyCard must render Sharpe (Sh) text');
    assert.ok(dashboardViewSource.includes('So: {sortinoText}'), 'StrategyCard must render Sortino (So) text');
    assert.ok(dashboardViewSource.includes('Recommended: >= 1.0 (Acceptable), >= 1.5 (Good), >= 2.0 (Excellent)'), 'StrategyCard must include Sharpe recommendation tooltip');
    assert.ok(dashboardViewSource.includes('Recommended: >= 1.0 (Acceptable), >= 2.0 (Good), >= 3.0 (Excellent)'), 'StrategyCard must include Sortino recommendation tooltip');
  });

  test('StrategyDetailView renders Sharpe (Sh) and Sortino (So) StatCards and ratio toggles with recommended values tooltips', () => {
    assert.ok(strategyDetailViewSource.includes('label="Sharpe (Sh)"'), 'StrategyDetailView must render Sharpe StatCard');
    assert.ok(strategyDetailViewSource.includes('label="Sortino (So)"'), 'StrategyDetailView must render Sortino StatCard');
    assert.ok(strategyDetailViewSource.includes('Sharpe Ratio (Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 1.50 (Good), >= 2.00 (Excellent).'), 'StrategyDetailView must render Sharpe tooltip');
    assert.ok(strategyDetailViewSource.includes('Sortino Ratio (Downside Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 2.00 (Good), >= 3.00 (Excellent).'), 'StrategyDetailView must render Sortino tooltip');
    assert.ok(strategyDetailViewSource.includes('showPf={showPf}'), 'StrategyDetailView must pass showPf toggle to StrategyPerformanceOverlayChart');
    assert.ok(strategyDetailViewSource.includes('showSharpe={showSharpe}'), 'StrategyDetailView must pass showSharpe toggle to StrategyPerformanceOverlayChart');
    assert.ok(strategyDetailViewSource.includes('showSortino={showSortino}'), 'StrategyDetailView must pass showSortino toggle to StrategyPerformanceOverlayChart');
  });
});
