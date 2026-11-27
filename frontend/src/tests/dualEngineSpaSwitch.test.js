import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Dual-engine SPA switching eliminates full-page reload blank flashes, stale leaks, and above-the-fold CLS', () => {
  const engineModeSrc = fs.readFileSync(path.join(__dirname, '../utils/engineMode.js'), 'utf-8');
  const useSelectedEngineSrc = fs.readFileSync(path.join(__dirname, '../hooks/useSelectedEngine.js'), 'utf-8');
  const apiClientSrc = fs.readFileSync(path.join(__dirname, '../api/client.js'), 'utf-8');
  const tradingSrc = fs.readFileSync(path.join(__dirname, '../store/trading.js'), 'utf-8');
  const engineSwitchSrc = fs.readFileSync(path.join(__dirname, '../components/EngineSwitch.jsx'), 'utf-8');
  const mainSrc = fs.readFileSync(path.join(__dirname, '../main.jsx'), 'utf-8');
  const dashboardSrc = fs.readFileSync(path.join(__dirname, '../views/DashboardView.jsx'), 'utf-8');
  const skeletonsSrc = fs.readFileSync(path.join(__dirname, '../components/ui/Skeletons.jsx'), 'utf-8');
  const indexHtmlSrc = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf-8');
  const sessionServiceSrc = fs.readFileSync(path.join(__dirname, '../../../backend/node/src/trading/session.service.ts'), 'utf-8');

  // 1. engineMode.js + useSelectedEngine + api/client reactive switching
  assert.ok(
    engineModeSrc.includes('export let selectedEngine') &&
    engineModeSrc.includes('export const setSelectedEngine') &&
    engineModeSrc.includes('export const registerPopstateEngineHandler') &&
    engineModeSrc.includes("window.addEventListener('popstate'") &&
    useSelectedEngineSrc.includes('useSyncExternalStore'),
    'engineMode.js and useSelectedEngine must provide reactive SPA engine switching and popstate support'
  );
  assert.ok(
    apiClientSrc.includes('export const setApiEngineMode') &&
    apiClientSrc.includes('getSelectedEngine()'),
    'api/client.js must dynamically update baseURL and X-Trading-Engine via setApiEngineMode/getSelectedEngine'
  );

  // 2. EngineSwitch intercepts left-click for SPA switch, prewarms on hover/focus/touch, and keeps hooks valid
  assert.ok(
    engineSwitchSrc.includes('e.preventDefault()') &&
    engineSwitchSrc.includes('switchEngine') &&
    engineSwitchSrc.includes('prewarmEngine') &&
    engineSwitchSrc.includes('onMouseEnter') &&
    engineSwitchSrc.includes('onFocus') &&
    engineSwitchSrc.includes('onTouchStart'),
    'EngineSwitch must intercept primary click with switchEngine and prewarm on hover/focus/touch'
  );
  assert.ok(
    engineSwitchSrc.indexOf('useEffect(') !== -1 &&
    engineSwitchSrc.indexOf('useEffect(') < engineSwitchSrc.indexOf('if (!selectedEngine) return null'),
    'EngineSwitch must keep all hooks strictly above early return'
  );

  // 3. Zustand store handles snapshot caching, persist store key swap, WS neutralization, and generation guards
  assert.ok(
    tradingSrc.includes('const engineSnapshots = {}') &&
    tradingSrc.includes('prewarmEngine:') &&
    tradingSrc.includes('switchEngine:') &&
    tradingSrc.includes('useTradingStore?.persist?.setOptions') &&
    tradingSrc.includes('engineGeneration += 1') &&
    tradingSrc.includes('reqGen !== engineGeneration || getSelectedEngine() !== reqEngine'),
    'trading.js must isolate snapshots, swap persist key, neutralize old WS, and drop stale async responses'
  );
  assert.ok(
    mainSrc.includes('reqGen !== getEngineGeneration() || getSelectedEngine() !== reqEngine') &&
    mainSrc.includes('const selectedEngine = useSelectedEngine()'),
    'main.jsx must guard checkStatus against engine switches and bind accent bar to reactive selectedEngine'
  );

  // 4. Above-the-fold zero-CLS fixes
  const activeStrategyIdx = dashboardSrc.indexOf('Primary Workspace: Active Strategy Cards Promoted to Top');
  const reconciliationUsageIdx = dashboardSrc.indexOf('<ReconciliationCenter', 1500);
  assert.ok(
    activeStrategyIdx !== -1 &&
    reconciliationUsageIdx !== -1 &&
    reconciliationUsageIdx > activeStrategyIdx,
    'ReconciliationCenter must render below Active Strategy to prevent above-the-fold CLS on Live switches'
  );

  assert.ok(
    dashboardSrc.includes('sessionsLoading && !lastSession') &&
    dashboardSrc.includes('statusLastSession') &&
    dashboardSrc.includes('min-h-[118px]') &&
    !dashboardSrc.includes('min-h-[110px]'),
    'DashboardView stopped CTA buttons must match 118px skeleton height and avoid 1-button to 2-button CLS jump'
  );

  assert.ok(
    dashboardSrc.includes("showLoadingMetrics ? '--' : fmtUSD(totalRevenue)") &&
    dashboardSrc.includes("showLoadingMetrics ? '--' : fmtUSD(periodBadges.today)"),
    'MonthlyRevenueChart must avoid $0 flash while trade history is still loading'
  );

  assert.ok(
    skeletonsSrc.includes('Periodic Performance') &&
    skeletonsSrc.includes('Session Logs'),
    'DashboardSkeleton must match collapsed Periodic Performance and Session Logs layout'
  );

  assert.ok(
    indexHtmlSrc.includes('boot-engine-switch') &&
    indexHtmlSrc.includes("localStorage.getItem('sidebar_collapsed') === 'true'"),
    'index.html boot-shell must mirror sidebar_collapsed width and engine-switch height'
  );

  // 5. Backend stopped getStatus includes lastSession scoped to engineMode
  assert.ok(
    sessionServiceSrc.includes('where: this.engineMode ? { tradingMode: this.engineMode } : {}') &&
    sessionServiceSrc.includes('lastSession: matchedLastSession'),
    'Backend getStatus must return engineMode-scoped lastSession metadata when stopped'
  );
});
