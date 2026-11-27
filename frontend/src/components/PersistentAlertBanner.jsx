import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { shallow } from 'zustand/shallow';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Leaf,
  Pause,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useTradingStore } from '../store/trading';
import { sessionAPI } from '../api/client';
import { formatDuration } from '../lib/formatters';
import { useNow } from '../hooks/useNow';
import { cn } from './ui/primitives';
import { MOTION_EASE, SmoothCollapse } from './ui/SmoothMotion';

const TONE_STYLES = {
  red: {
    strip: 'border-red/30 bg-red/[0.08] from-red/[0.11] via-red/[0.06] to-red/[0.03]',
    iconWrap: 'bg-red/15 text-red ring-1 ring-red/25',
    title: 'text-red',
    badge: 'text-red',
    primaryBtn: 'bg-red/15 hover:bg-red/25 active:bg-red/30 border-red/35 text-red focus-visible:ring-red/50',
    pillBtn: 'bg-red/10 hover:bg-red/20 border-red/25 text-red',
    progress: 'bg-red/75',
  },
  amber: {
    strip: 'border-amber/30 bg-amber/[0.08] from-amber/[0.11] via-amber/[0.06] to-amber/[0.03]',
    iconWrap: 'bg-amber/15 text-amber ring-1 ring-amber/25',
    title: 'text-amber',
    badge: 'text-amber',
    primaryBtn: 'bg-amber/15 hover:bg-amber/25 active:bg-amber/30 border-amber/35 text-amber focus-visible:ring-amber/50',
    pillBtn: 'bg-amber/10 hover:bg-amber/20 border-amber/25 text-amber',
    progress: 'bg-amber/80',
  },
  accent: {
    strip: 'border-border/70 bg-surface/90 from-accent/[0.08] via-surface/90 to-surface/90',
    iconWrap: 'bg-accent/15 text-accent ring-1 ring-accent/25',
    title: 'text-text',
    badge: 'text-accent',
    primaryBtn: 'bg-accent/15 hover:bg-accent/25 active:bg-accent/30 border-accent/35 text-accent focus-visible:ring-accent/50',
    pillBtn: 'bg-accent/10 hover:bg-accent/20 border-accent/25 text-accent',
    progress: 'bg-accent/80',
  },
};

const GATE_COPY = {
  max_trades: {
    title: 'All trade slots in use',
    detail: 'New entries open automatically once an active position closes.',
  },
  max_trades_period: {
    title: 'Trade pace limit reached',
    detail: 'Waiting for the next trading window before opening new trades.',
  },
  sl_guard: {
    title: 'Loss protection active',
    detail: 'New entries are paused to protect your remaining capital.',
  },
  risk_pct: {
    title: 'Risk budget is full',
    detail: 'New entries resume once active risk drops below your cap.',
  },
  tod_risk: {
    title: 'Quiet-hour guard active',
    detail: 'New entries are paused during this lower-performing hour.',
  },
  sleeping: {
    title: 'Outside trading hours',
    detail: 'Monitoring is idling until your next scheduled window.',
  },
  risk: {
    title: 'Safety guard active',
    detail: 'Monitoring open positions — new entries are temporarily paused.',
  },
};

export const PersistentAlertBanner = () => {
  // All hooks unconditionally at the top (Rules of Hooks)
  const {
    wsError,
    wsStatus,
    connectWS,
    apiError,
    setApiError,
    clearApiError,
    sync,
    apiStatus,
    agreementRequired,
    tradfiAgreementRequired,
    gateState,
    gateReason,
    scannerPaused,
    nextSlotTs,
    hibernating,
    hibernationMode,
    activeTradesCount,
    config,
    isSyncingOnResume,
  } = useTradingStore(
    (s) => ({
      wsError: s.wsError,
      wsStatus: s.wsStatus,
      connectWS: s.connectWS,
      apiError: s.apiError,
      setApiError: s.setApiError,
      clearApiError: s.clearApiError,
      sync: s.sync,
      apiStatus: s.apiStatus,
      agreementRequired: s.agreementRequired,
      tradfiAgreementRequired: s.tradfiAgreementRequired,
      gateState: s.gateState,
      gateReason: s.gateReason,
      scannerPaused: s.scannerPaused,
      nextSlotTs: s.nextSlotTs,
      hibernating: s.hibernating,
      hibernationMode: s.hibernationMode,
      activeTradesCount: Array.isArray(s.activeTrades) ? s.activeTrades.length : 0,
      config: s.config,
      isSyncingOnResume: s.isSyncingOnResume,
    }),
    shallow
  );

  const now = useNow();
  const prefersReduced = useReducedMotion();

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isRetryingApi, setIsRetryingApi] = useState(false);
  const [showReconnectingPill, setShowReconnectingPill] = useState(false);
  const [tradfiBusy, setTradfiBusy] = useState(null);
  const [tradfiFeedback, setTradfiFeedback] = useState(null);
  const [isClearingBan, setIsClearingBan] = useState(false);
  const [isResettingAgreement, setIsResettingAgreement] = useState(false);
  const [selectedNoticeId, setSelectedNoticeId] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Listen to global API error/resolved events
  useEffect(() => {
    const handleSystemApiError = (event) => {
      if (event.detail) {
        setApiError(event.detail);
      }
    };

    const handleSystemApiResolved = (event) => {
      if (apiError && (!event.detail?.url || event.detail.url === apiError.url)) {
        clearApiError();
      }
    };

    window.addEventListener('system-api-error', handleSystemApiError);
    window.addEventListener('system-api-resolved', handleSystemApiResolved);
    return () => {
      window.removeEventListener('system-api-error', handleSystemApiError);
      window.removeEventListener('system-api-resolved', handleSystemApiResolved);
    };
  }, [setApiError, clearApiError, apiError]);

  const hasWsFailure = wsStatus === 'error' && !!wsError;
  const hasApiFailure = !!apiError;

  // SRE: Only show ambient bar if reconnection takes longer than 1.2s.
  // Sub-second wakeups resolve silently without layout shifts or alarms.
  useEffect(() => {
    let timer;
    if (wsStatus === 'reconnecting') {
      timer = setTimeout(() => {
        setShowReconnectingPill(true);
      }, 1200);
    } else {
      setShowReconnectingPill(false);
    }
    return () => clearTimeout(timer);
  }, [wsStatus]);

  // SRE: Auto-heal API status in background so transient 502/restart clears automatically
  useEffect(() => {
    if (!hasApiFailure) return;
    const timer = setInterval(async () => {
      try {
        await sync();
        clearApiError();
      } catch (_) {}
    }, 5000);
    return () => clearInterval(timer);
  }, [hasApiFailure, sync, clearApiError]);

  // Clear stale TradFi feedback once agreement is resolved
  useEffect(() => {
    if (!tradfiAgreementRequired && tradfiFeedback) {
      setTradfiFeedback(null);
    }
  }, [tradfiAgreementRequired, tradfiFeedback]);

  const handleReconnectWs = useCallback(() => {
    setIsReconnecting(true);
    connectWS();
    setTimeout(() => {
      setIsReconnecting(false);
    }, 1500);
  }, [connectWS]);

  const handleRetryApi = useCallback(async () => {
    setIsRetryingApi(true);
    try {
      await sync();
      clearApiError();
    } catch {
      // Keep notice displayed if retry still fails
    } finally {
      setIsRetryingApi(false);
    }
  }, [sync, clearApiError]);

  const handleClearBan = useCallback(async () => {
    if (isClearingBan) return;
    setIsClearingBan(true);
    try {
      await sessionAPI.clearBan();
      useTradingStore.setState((st) => ({
        apiStatus: {
          ...st.apiStatus,
          isBanned: false,
          isRateLimited: false,
          isGeoBlocked: false,
          banUntil: null,
          lastErrorMessage: null,
        },
      }));
    } catch (e) {
      console.error('Failed to clear ban:', e);
    } finally {
      setIsClearingBan(false);
    }
  }, [isClearingBan]);

  const handleResetAgreement = useCallback(async () => {
    if (isResettingAgreement) return;
    setIsResettingAgreement(true);
    try {
      await sessionAPI.resetAgreementRequirement();
      useTradingStore.setState({ agreementRequired: false, tradfiAgreementRequired: false });
    } catch (e) {
      console.error('Failed to reset agreement requirement:', e);
    } finally {
      setIsResettingAgreement(false);
    }
  }, [isResettingAgreement]);

  const runTradfiAction = useCallback(async (kind) => {
    if (tradfiBusy) return;
    setTradfiBusy(kind);
    setTradfiFeedback(null);
    try {
      const res =
        kind === 'sign'
          ? await sessionAPI.signTradFiAgreement()
          : await sessionAPI.checkAgreementStatus();
      const data = res?.data;
      if (data?.signed === true) {
        useTradingStore.setState({ tradfiAgreementRequired: false });
      } else if (data?.signed === false) {
        setTradfiFeedback('Still waiting for your signature on Binance.');
      } else if (data?.status === 'error') {
        setTradfiFeedback(data.message || 'Could not verify status — please try again.');
      }
    } catch (e) {
      setTradfiFeedback(e?.response?.data?.message || e?.message || 'Could not complete that request.');
    } finally {
      setTradfiBusy(null);
    }
  }, [tradfiBusy]);

  const handleOpenPowerSettings = useCallback(() => {
    const hash = window.location.hash || '#/';
    const onCockpit = hash === '' || hash === '#' || hash === '#/';
    if (!onCockpit) {
      window.location.hash = '#/';
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-strategy-settings'));
      }, 120);
    } else {
      window.dispatchEvent(new CustomEvent('open-strategy-settings'));
    }
  }, []);

  // Build unified, priority-ordered list of active notices so everything renders inside ONE small strip
  const notices = useMemo(() => {
    const list = [];

    // 1. Live updates paused (WebSocket hard error)
    if (hasWsFailure) {
      const rawWsMsg = wsError?.message || '';
      const wsMsg =
        rawWsMsg && !/websocket|socket|err_|econn/i.test(rawWsMsg)
          ? rawWsMsg
          : 'Live market prices paused. Tap Reconnect to restore real-time updates.';
      list.push({
        id: 'ws-error',
        tone: 'red',
        role: 'alert',
        ariaLive: 'assertive',
        icon: WifiOff,
        title: 'Live updates paused',
        detail: wsMsg,
        tooltip: rawWsMsg || wsMsg,
        primaryAction: {
          label: isReconnecting ? 'Reconnecting…' : 'Reconnect',
          ariaLabel: 'Reconnect live market updates',
          onClick: handleReconnectWs,
          disabled: isReconnecting,
          spinning: isReconnecting,
          icon: RefreshCw,
        },
      });
    }

    // 2. Exchange region restriction / IP cooldown / rate-limit pacing
    const hasBanNotice = Boolean(apiStatus?.isBanned || apiStatus?.isRateLimited || apiStatus?.isGeoBlocked);
    if (hasBanNotice) {
      const isGeo = !!apiStatus.isGeoBlocked;
      const isBan = !!apiStatus.isBanned && !isGeo;
      const banUntilMs = apiStatus?.banUntil ? new Date(apiStatus.banUntil).getTime() : 0;
      const timeLeft = banUntilMs > 0 ? Math.max(0, banUntilMs - now) : 0;
      const hasBanCountdown = !!apiStatus?.banUntil && timeLeft > 0;
      const cooldownEnd = apiStatus?.banUntil
        ? new Date(apiStatus.banUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'shortly';
      const detailText = isGeo
        ? 'Live orders are unavailable from this server region. Switch to Paper/Testnet or set a proxy in Settings.'
        : isBan
          ? `Binance paused requests to keep your account safe. Normal updates resume around ${cooldownEnd}.`
          : 'Approaching Binance request limits — pacing requests automatically to protect your account.';

      list.push({
        id: 'ban',
        tone: isBan || isGeo ? 'red' : 'amber',
        role: 'alert',
        ariaLive: 'polite',
        icon: ShieldAlert,
        title: isGeo
          ? 'Region restricted by Binance'
          : isBan
            ? 'Temporary exchange cooldown'
            : 'Pacing exchange requests',
        detail: detailText,
        tooltip: apiStatus?.lastErrorMessage || detailText,
        counterText: isGeo
          ? 'Action needed'
          : hasBanCountdown
            ? `Resumes in ${formatDuration(timeLeft)}`
            : isBan
              ? 'Paused'
              : 'Active',
        counterMinWidth: 'min-w-[16ch]',
        primaryAction:
          isBan || isGeo
            ? {
                label: isClearingBan ? 'Clearing…' : 'Clear Notice',
                ariaLabel: 'Clear exchange cooldown notice',
                onClick: handleClearBan,
                disabled: isClearingBan,
              }
            : null,
      });
    }

    // 3. Binance Futures terms agreement
    if (agreementRequired) {
      list.push({
        id: 'futures-agreement',
        tone: 'red',
        role: 'alert',
        ariaLive: 'polite',
        icon: AlertCircle,
        title: 'Action needed: Futures terms',
        detail: 'Accept Binance Futures terms on Binance to start placing live orders.',
        primaryAction: {
          label: 'Open Binance',
          href: 'https://www.binance.com/en/futures/BTCUSDT',
          icon: ExternalLink,
        },
        secondaryActions: [
          {
            label: isResettingAgreement ? 'Checking…' : 'Check Again',
            onClick: handleResetAgreement,
            disabled: isResettingAgreement,
          },
        ],
      });
    }

    // 4. Temporary connection hiccup (API error)
    if (hasApiFailure) {
      const rawApiMsg = apiError?.message || '';
      const apiMsg =
        rawApiMsg && !/non-json|unexpected token|502|503|html/i.test(rawApiMsg)
          ? rawApiMsg
          : 'We could not refresh your latest account data right now. Retrying automatically.';
      list.push({
        id: 'api-error',
        tone: 'amber',
        role: 'alert',
        ariaLive: 'assertive',
        icon: AlertTriangle,
        title: 'Connection hiccup',
        detail: apiMsg,
        tooltip: rawApiMsg || apiMsg,
        primaryAction: {
          label: isRetryingApi ? 'Retrying…' : 'Try Again',
          ariaLabel: 'Retry refreshing account data',
          onClick: handleRetryApi,
          disabled: isRetryingApi,
          spinning: isRetryingApi,
          icon: RefreshCw,
        },
        dismissAction: clearApiError,
      });
    }

    // 5. Reconnecting to live prices (grace-period elapsed)
    const showReconnecting = showReconnectingPill && !hasWsFailure;
    if (showReconnecting) {
      list.push({
        id: 'ws-reconnecting',
        tone: 'amber',
        role: 'status',
        ariaLive: 'polite',
        icon: RefreshCw,
        iconSpin: true,
        title: 'Reconnecting to live prices…',
        detail: 'Updates will resume automatically.',
        tooltip: 'Re-establishing live WebSocket stream',
        statusTag: 'Reconnecting',
      });
    }

    // 6. Stock & ETF / TradFi agreement (only when main Futures agreement isn't blocking)
    if (!agreementRequired && tradfiAgreementRequired) {
      list.push({
        id: 'tradfi-agreement',
        tone: 'amber',
        role: 'status',
        ariaLive: 'polite',
        icon: AlertCircle,
        title: 'Stock & ETF futures paused',
        detail:
          tradfiFeedback ||
          'Accept Binance TradFi terms to enable stock/ETF pairs (crypto pairs keep trading).',
        primaryAction: {
          label: tradfiBusy === 'sign' ? 'Signing…' : 'Sign Now',
          onClick: () => runTradfiAction('sign'),
          disabled: Boolean(tradfiBusy),
        },
        secondaryActions: [
          {
            label: tradfiBusy === 'check' ? 'Checking…' : 'Check Status',
            onClick: () => runTradfiAction('check'),
            disabled: Boolean(tradfiBusy),
          },
          {
            label: 'Open Binance',
            href: 'https://www.binance.com/en/futures/BTCUSDT',
            icon: ExternalLink,
          },
        ],
      });
    }

    // 7. Trading gates, pause & power saver (never mounts solely for transient background resume)
    if (gateState || scannerPaused) {
      const nextSlotSec = nextSlotTs ? Math.max(0, Math.ceil((nextSlotTs - now) / 1000)) : null;
      const waitTimeStr =
        nextSlotSec !== null
          ? nextSlotSec > 60
            ? `${Math.ceil(nextSlotSec / 60)}m`
            : `${nextSlotSec}s`
          : '';
      const totalPeriodSec = Math.max(1, (config?.trades_period_min || 60) * 60);
      const progressPct =
        nextSlotSec !== null && nextSlotSec > 0
          ? Math.min(100, Math.max(0, (nextSlotSec / totalPeriodSec) * 100))
          : 0;

      const isGatedIdle =
        (gateState === 'sleeping' || gateState === 'max_trades_period' || gateState === 'sl_guard') &&
        activeTradesCount === 0;

      const activeCopy = hibernating
        ? {
            title: hibernationMode === 'light' ? 'Light power-saving mode' : 'Deep power-saving mode',
            detail: 'Pausing extra scans while idle — open positions stay monitored.',
          }
        : gateState === 'max_trades_period'
          ? {
              title: 'Trade pace limit reached',
              detail:
                nextSlotSec !== null
                  ? 'Waiting for the next trade slot to open.'
                  : 'Waiting for the next trading window before opening new trades.',
            }
          : GATE_COPY[gateState] ||
            (scannerPaused
              ? { title: 'Scanner paused', detail: 'New entries are on hold until you resume.' }
              : GATE_COPY.risk);

      const friendlyReason =
        gateReason &&
        gateReason !== 'OK' &&
        !/^(max_trades|sl_guard|risk_pct|tod_risk|sleeping|paused)$/i.test(String(gateReason).trim())
          ? String(gateReason)
          : '';

      const tone =
        scannerPaused || gateState === 'sl_guard'
          ? 'red'
          : hibernating || isGatedIdle
            ? 'accent'
            : 'amber';

      const GateIcon = hibernating
        ? Zap
        : gateState === 'sleeping'
          ? Pause
          : scannerPaused
            ? XCircle
            : isGatedIdle
              ? Leaf
              : AlertTriangle;

      list.push({
        id: 'gate',
        tone,
        role: 'status',
        ariaLive: 'polite',
        icon: GateIcon,
        title: activeCopy.title,
        detail: activeCopy.detail,
        tooltip: friendlyReason || activeCopy.detail,
        counterText: nextSlotSec !== null && nextSlotSec > 0 ? waitTimeStr : null,
        counterMinWidth: 'min-w-[4.5ch]',
        progressPct,
        statusTag:
          isSyncingOnResume
            ? 'Updating'
            : !hibernating && isGatedIdle && !(nextSlotSec > 0)
              ? 'Power Saver'
              : null,
        primaryAction: hibernating
          ? {
              label: 'Settings',
              ariaLabel: 'Adjust power-saving sleep settings',
              onClick: handleOpenPowerSettings,
              icon: SettingsIcon,
            }
          : null,
      });
    }

    return list;
  }, [
    hasWsFailure,
    wsError,
    isReconnecting,
    handleReconnectWs,
    apiStatus,
    now,
    isClearingBan,
    handleClearBan,
    agreementRequired,
    isResettingAgreement,
    handleResetAgreement,
    hasApiFailure,
    apiError,
    isRetryingApi,
    handleRetryApi,
    clearApiError,
    showReconnectingPill,
    tradfiAgreementRequired,
    tradfiFeedback,
    tradfiBusy,
    runTradfiAction,
    gateState,
    scannerPaused,
    nextSlotTs,
    config?.trades_period_min,
    activeTradesCount,
    hibernating,
    hibernationMode,
    gateReason,
    isSyncingOnResume,
    handleOpenPowerSettings,
  ]);

  // Keep selected notice valid and auto-collapse when everything clears
  useEffect(() => {
    if (notices.length === 0) {
      setIsExpanded(false);
      setSelectedNoticeId(null);
      return;
    }
    if (selectedNoticeId && !notices.some((n) => n.id === selectedNoticeId)) {
      setSelectedNoticeId(null);
    }
  }, [notices, selectedNoticeId]);

  const activeIndex = useMemo(() => {
    if (notices.length === 0) return -1;
    if (!selectedNoticeId) return 0;
    const idx = notices.findIndex((n) => n.id === selectedNoticeId);
    return idx >= 0 ? idx : 0;
  }, [notices, selectedNoticeId]);

  const activeNotice = activeIndex >= 0 ? notices[activeIndex] : null;

  const handleCycleNotice = useCallback(
    (e) => {
      e.stopPropagation();
      if (notices.length <= 1) return;
      const nextIdx = (activeIndex + 1) % notices.length;
      setSelectedNoticeId(notices[nextIdx].id);
    },
    [notices, activeIndex]
  );

  const renderActionControl = (action, toneStyle, compact = false) => {
    if (!action) return null;
    const Icon = action.icon;
    const baseCls = cn(
      'inline-flex items-center justify-center gap-1 rounded-md border font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50',
      compact ? 'h-[22px] px-2 text-[10px]' : 'h-6 px-2.5 text-[10.5px]',
      action.secondary
        ? 'bg-surface/80 hover:bg-white/10 border-border/70 text-text/90 focus-visible:ring-accent/40'
        : toneStyle.primaryBtn
    );

    if (action.href) {
      return (
        <a
          key={action.label}
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={baseCls}
        >
          <span>{action.label}</span>
          {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
        </a>
      );
    }

    return (
      <button
        key={action.label}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          action.onClick?.();
        }}
        disabled={action.disabled}
        aria-label={action.ariaLabel || action.label}
        className={baseCls}
      >
        {Icon && (
          <Icon
            className={cn('w-3 h-3 shrink-0', action.spinning && 'animate-spin')}
            aria-hidden="true"
          />
        )}
        <span>{action.label}</span>
      </button>
    );
  };

  const activeTone = activeNotice ? TONE_STYLES[activeNotice.tone] || TONE_STYLES.amber : TONE_STYLES.amber;
  const ActiveIcon = activeNotice?.icon || AlertCircle;
  const hasSecondaryActions = Boolean(activeNotice?.secondaryActions?.length);
  const canExpand = Boolean(activeNotice && (notices.length > 1 || hasSecondaryActions || activeNotice.detail));

  return (
    <aside
      aria-label="Live Status and Trading Notifications"
      role="status"
      aria-live="polite"
      data-banner-layout="inline"
      data-banner-style="top-slide-strip"
      data-banner-unified="single-strip"
      className="w-full"
    >
      <AnimatePresence initial={false}>
        {activeNotice && (
          <motion.div
            key="unified-top-strip"
            role={activeNotice.role}
            aria-live={activeNotice.ariaLive}
            title={activeNotice.tooltip || activeNotice.detail}
            initial={prefersReduced ? false : { opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: 'auto',
              transition: {
                height: { duration: prefersReduced ? 0 : 0.24, ease: MOTION_EASE.glide },
                opacity: { duration: prefersReduced ? 0 : 0.2, ease: MOTION_EASE.outExpo },
              },
            }}
            exit={{
              opacity: 0,
              height: 0,
              transition: {
                height: { duration: prefersReduced ? 0 : 0.2, ease: MOTION_EASE.glide },
                opacity: { duration: prefersReduced ? 0 : 0.14, ease: MOTION_EASE.snappy },
              },
            }}
            className={cn(
              'relative overflow-hidden [contain:layout_style] border-b bg-gradient-to-r backdrop-blur-md transition-colors duration-200',
              activeTone.strip
            )}
          >
            {/* Sleek single-row mobile-first connection & gate slide strip (~28-30px) */}
            <div className="w-full max-w-[1600px] mx-auto px-2.5 sm:px-4 lg:px-5 min-h-[28px] py-0.5 flex items-center justify-between gap-2">
              {/* Left interactive headline + inline detail (sm+) */}
              <button
                type="button"
                onClick={() => canExpand && setIsExpanded((v) => !v)}
                aria-expanded={canExpand ? isExpanded : undefined}
                className={cn(
                  'flex items-center gap-1.5 min-w-0 flex-1 text-left rounded-md py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                  canExpand ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 sm:w-[18px] sm:h-[18px] rounded flex items-center justify-center shrink-0',
                    activeTone.iconWrap
                  )}
                >
                  <ActiveIcon
                    className={cn('w-2.5 h-2.5', activeNotice.iconSpin && 'animate-spin')}
                    aria-hidden="true"
                  />
                </span>

                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-[11px] font-semibold leading-tight truncate sm:shrink-0',
                      activeTone.title
                    )}
                  >
                    {activeNotice.title}
                  </span>
                  {activeNotice.detail && (
                    <>
                      <span className="text-dim/40 hidden sm:inline shrink-0" aria-hidden="true">
                        ·
                      </span>
                      <span className="hidden sm:inline text-[10.5px] text-text/75 leading-tight truncate min-w-0">
                        {activeNotice.detail}
                      </span>
                    </>
                  )}
                </div>
              </button>

              {/* Right single-line status, primary CTA, multi-notice switcher & expand toggle */}
              <div className="flex items-center gap-1 shrink-0">
                {activeNotice.counterText && (
                  <span
                    className={cn(
                      'font-mono text-[10px] font-semibold tabular-nums whitespace-nowrap text-right shrink-0',
                      activeNotice.counterMinWidth || 'min-w-[4.5ch]',
                      activeTone.badge
                    )}
                  >
                    {activeNotice.counterText}
                  </span>
                )}

                {!activeNotice.counterText && activeNotice.statusTag && (
                  <span
                    className={cn(
                      'font-mono text-[9.5px] font-semibold whitespace-nowrap shrink-0 hidden xs:inline sm:inline',
                      activeTone.badge
                    )}
                  >
                    {activeNotice.statusTag}
                  </span>
                )}

                {renderActionControl(activeNotice.primaryAction, activeTone, true)}

                {activeNotice.dismissAction && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      activeNotice.dismissAction();
                    }}
                    aria-label="Dismiss notification"
                    className="h-[22px] w-[22px] inline-flex items-center justify-center rounded-md hover:bg-white/10 text-dim hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 cursor-pointer shrink-0"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}

                {notices.length > 1 && (
                  <button
                    type="button"
                    onClick={handleCycleNotice}
                    title={`Showing notice ${activeIndex + 1} of ${notices.length}. Tap to cycle.`}
                    aria-label={`Cycle notifications (${activeIndex + 1} of ${notices.length})`}
                    className={cn(
                      'h-[22px] px-1.5 rounded-md border text-[9.5px] font-mono font-semibold tabular-nums whitespace-nowrap transition-colors cursor-pointer shrink-0',
                      activeTone.pillBtn
                    )}
                  >
                    {activeIndex + 1}/{notices.length}
                  </button>
                )}

                {canExpand && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded((v) => !v);
                    }}
                    aria-label={isExpanded ? 'Collapse notification details' : 'Expand notification details'}
                    aria-expanded={isExpanded}
                    className={cn(
                      'h-[22px] w-[22px] inline-flex items-center justify-center rounded-md hover:bg-white/10 text-dim hover:text-text transition-colors cursor-pointer shrink-0',
                      notices.length === 1 && !hasSecondaryActions && 'sm:hidden'
                    )}
                  >
                    <ChevronDown
                      className={cn(
                        'w-3 h-3 transition-transform duration-200',
                        isExpanded && 'rotate-180'
                      )}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>
            </div>

            {/* Razor-thin bottom progress track for timed gate slots (zero extra layout height) */}
            {activeNotice.progressPct > 0 && (
              <div
                aria-hidden="true"
                className="w-full h-[1.5px] bg-white/[0.06] overflow-hidden"
              >
                <div
                  className={cn(
                    'h-full w-full origin-left transition-transform duration-1000 ease-linear',
                    activeTone.progress
                  )}
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, activeNotice.progressPct / 100))})`,
                  }}
                />
              </div>
            )}

            {/* Smooth inline detail & multi-notice drawer inside the SAME strip */}
            <SmoothCollapse
              isOpen={isExpanded}
              duration={0.24}
              className="border-t border-white/[0.07] bg-background/55"
            >
              <div className="w-full max-w-[1160px] mx-auto px-2.5 sm:px-4 md:px-6 py-2.5 flex flex-col gap-2">
                    {/* Active notice full description & secondary actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <p className="text-[11.5px] text-text/85 leading-relaxed">
                        {activeNotice.detail}
                      </p>
                      {hasSecondaryActions && (
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {activeNotice.secondaryActions.map((act) =>
                            renderActionControl({ ...act, secondary: true }, activeTone, true)
                          )}
                        </div>
                      )}
                    </div>

                    {/* Additional active notices when more than 1 notice is live */}
                    {notices.length > 1 && (
                      <div className="pt-2 border-t border-white/[0.07] flex flex-col gap-1.5">
                        {notices
                          .filter((n) => n.id !== activeNotice.id)
                          .map((notice) => {
                            const rowTone = TONE_STYLES[notice.tone] || TONE_STYLES.amber;
                            const RowIcon = notice.icon || AlertCircle;
                            return (
                              <div
                                key={notice.id}
                                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 py-1 px-2 rounded-lg bg-surface/50 border border-white/[0.05]"
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedNoticeId(notice.id)}
                                  className="flex items-start sm:items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                                >
                                  <span
                                    className={cn(
                                      'w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 sm:mt-0',
                                      rowTone.iconWrap
                                    )}
                                  >
                                    <RowIcon
                                      className={cn('w-3 h-3', notice.iconSpin && 'animate-spin')}
                                      aria-hidden="true"
                                    />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className={cn('text-[11px] font-semibold leading-tight', rowTone.title)}>
                                      {notice.title}
                                    </div>
                                    <div className="text-[10.5px] text-text/75 leading-snug">
                                      {notice.detail}
                                    </div>
                                  </div>
                                </button>

                                <div className="flex items-center gap-1.5 shrink-0 ml-7 sm:ml-0">
                                  {notice.counterText && (
                                    <span
                                      className={cn(
                                        'font-mono text-[10px] font-semibold tabular-nums whitespace-nowrap text-right',
                                        notice.counterMinWidth || 'min-w-[4.5ch]',
                                        rowTone.badge
                                      )}
                                    >
                                      {notice.counterText}
                                    </span>
                                  )}
                                  {renderActionControl(notice.primaryAction, rowTone, true)}
                                  {notice.secondaryActions?.map((act) =>
                                    renderActionControl({ ...act, secondary: true }, rowTone, true)
                                  )}
                                  {notice.dismissAction && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        notice.dismissAction();
                                      }}
                                      aria-label="Dismiss notification"
                                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg hover:bg-white/10 text-dim hover:text-text transition-colors cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
              </div>
            </SmoothCollapse>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
};

export default PersistentAlertBanner;
