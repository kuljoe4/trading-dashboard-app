import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

export const SMOOTH_EASE = [0.22, 1, 0.36, 1];

/**
 * Smoothly expands and collapses dynamic sections without sudden vertical layout jumps.
 */
export const SmoothCollapse = ({
  isOpen,
  children,
  className = '',
  innerClassName = '',
  duration = 0.22,
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
            height: { duration: effectiveDuration, ease: SMOOTH_EASE },
            opacity: { duration: Math.max(0.12, effectiveDuration * 0.8), ease: 'easeOut' },
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
          ? { height: { duration, ease: SMOOTH_EASE } }
          : { duration: 0 }
      }
      className={`overflow-hidden ${className}`}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
};

/**
 * Smooth crossfade + subtle vertical settle for mode/tab/view swaps.
 */
export const SmoothSwap = ({
  contentKey,
  children,
  className = '',
  duration = 0.16,
  yOffset = 4,
}) => {
  const prefersReduced = useReducedMotion();
  const effectiveDuration = prefersReduced ? 0 : duration;
  const effectiveY = prefersReduced ? 0 : yOffset;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={contentKey}
        initial={{ opacity: 0, y: effectiveY }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -Math.min(3, effectiveY) }}
        transition={{ duration: effectiveDuration, ease: SMOOTH_EASE }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
