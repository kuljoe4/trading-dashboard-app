import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * Curated cubic-bezier easing tokens for precision SaaS telemetry interfaces.
 * Zero rubbery springs — fast immediate response with silky deceleration.
 */
export const MOTION_EASE = {
  /** Crisp settle for segmented indicators, focus sweeps, card arrivals, and tabs */
  outExpo: [0.16, 1, 0.3, 1],
  /** Balanced architectural glide for drawers, height interpolation, and view swaps */
  glide: [0.22, 1, 0.36, 1],
  /** Calm attention decay for subtle spotlight highlights and color transitions */
  focus: [0.25, 1, 0.5, 1],
  /** Tactile micro-interaction curve for compact controls and progress rails */
  snappy: [0.2, 0.8, 0.2, 1],
};

export const SMOOTH_EASE = MOTION_EASE.glide;

/**
 * Smoothly expands and collapses dynamic sections without sudden vertical layout jumps.
 */
export const SmoothCollapse = ({
  isOpen,
  children,
  className = '',
  innerClassName = '',
  duration = 0.24,
  id,
}) => {
  const prefersReduced = useReducedMotion();
  const effectiveDuration = prefersReduced ? 0 : duration;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: effectiveDuration, ease: MOTION_EASE.glide },
            opacity: { duration: Math.max(0.12, effectiveDuration * 0.78), ease: MOTION_EASE.outExpo },
          }}
          className={`overflow-hidden ${className}`}
        >
          <div className={innerClassName}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Smoothly interpolates container height via ResizeObserver whenever child content
 * changes dimensions (e.g., transitioning Entry Conditions <-> Exit Conditions or
 * switching between candidates/snapshots with different condition counts).
 */
export const SmoothHeightContainer = ({
  children,
  className = '',
  duration = 0.26,
}) => {
  const prefersReduced = useReducedMotion();
  const contentRef = useRef(null);
  const [measuredHeight, setMeasuredHeight] = useState('auto');
  const hasMeasuredRef = useRef(false);

  const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const updateHeight = () => {
      const next = el.getBoundingClientRect().height;
      if (Number.isFinite(next) && next >= 0) {
        setMeasuredHeight((prev) => {
          if (typeof prev === 'number' && Math.abs(prev - next) < 0.5) return prev;
          return next;
        });
        hasMeasuredRef.current = true;
      }
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      animate={{ height: measuredHeight }}
      initial={false}
      transition={
        hasMeasuredRef.current
          ? { height: { duration, ease: MOTION_EASE.glide } }
          : { duration: 0 }
      }
      className={`overflow-hidden ${className}`}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
};

/**
 * Smooth cross-settle without exit-to-blank gaps for route/tab/view swaps.
 * Mounts incoming content immediately on frame 1 (no `mode="wait"` blank void).
 */
export const SmoothSwap = ({
  contentKey,
  children,
  className = '',
  duration = 0.14,
  yOffset = 3,
}) => {
  const prefersReduced = useReducedMotion();
  const effectiveDuration = prefersReduced ? 0 : duration;
  const effectiveY = prefersReduced ? 0 : yOffset;

  return (
    <motion.div
      key={contentKey}
      initial={prefersReduced ? false : { opacity: 0.92, y: effectiveY }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: effectiveDuration, ease: MOTION_EASE.outExpo }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Cubic-bezier sliding indicator plate for segmented controls, tabs, and active stage markers.
 * Uses GPU-composited layout projection with outExpo deceleration (no bouncy spring overshoot).
 */
export const MotionSegmentedPill = ({
  layoutId,
  className = '',
  duration = 0.2,
}) => {
  const prefersReduced = useReducedMotion();
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      transition={{
        duration: prefersReduced ? 0 : duration,
        ease: MOTION_EASE.outExpo,
      }}
      className={`pointer-events-none absolute inset-0 ${className}`}
    />
  );
};

const FOCUS_TONE_CLASS = {
  accent: 'bg-gradient-to-r from-accent/90 via-accent-light/70 to-transparent',
  green: 'bg-gradient-to-r from-green/90 via-green/60 to-transparent',
  amber: 'bg-gradient-to-r from-amber/90 via-amber/60 to-transparent',
};

/**
 * Clean 1.5px compositor-only hairline sweep that guides user attention to an updated panel
 * (e.g., Inspect Live dials or Risk checks) without layout shift or intrusive glow.
 */
export const FocusCueBar = ({
  triggerKey,
  tone = 'accent',
  className = '',
}) => {
  const prefersReduced = useReducedMotion();
  const initialKeyRef = useRef(triggerKey);
  const [pulseSeq, setPulseSeq] = useState(0);

  useEffect(() => {
    if (prefersReduced || !triggerKey) return;
    if (initialKeyRef.current === triggerKey) return;
    initialKeyRef.current = triggerKey;
    setPulseSeq((n) => n + 1);
  }, [triggerKey, prefersReduced]);

  if (prefersReduced || pulseSeq === 0) return null;

  return (
    <span
      key={pulseSeq}
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 left-0 right-0 h-[1.5px] z-10 animate-focus-sweep ${FOCUS_TONE_CLASS[tone] || FOCUS_TONE_CLASS.accent} ${className}`}
    />
  );
};
