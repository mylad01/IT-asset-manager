/**
 * P2MotionConfig — PLAN.MD §13 P2.
 *
 * Wraps the app tree in framer-motion's MotionConfig and derives its
 * configuration from the `motion` preference:
 *   full     → MotionConfig defaults (today's behavior, nothing forced)
 *   reduced  → reducedMotion: 'always' (framer switches transform animations
 *              off tree-wide; opacity fades continue) + a single snappy
 *              default transition so per-component springs don't fight it
 *   off      → reducedMotion: 'always' + duration-0 transition — every
 *              motion component lands in its final state immediately
 *
 * CSS-side, data-motion on <html> (set by applyPreferences) stops the
 * keyframe classes framer doesn't own (animate-float, shimmer, pulse).
 * The two layers are complementary: MotionConfig owns motion.* components,
 * the data attribute owns CSS animations.
 *
 * Verified against framer-motion v13: MotionConfigProps extends
 * Partial<MotionConfigContext> — `transition` + `reducedMotion`
 * ('always' | 'never' | 'user') are the supported knobs.
 */
import React from 'react';
import { MotionConfig } from 'framer-motion';

const CONFIG_BY_LEVEL = {
  full: {
    transition: undefined,
    reducedMotion: 'never',
  },
  reduced: {
    transition: { duration: 0.15, ease: 'easeOut' },
    reducedMotion: 'always',
  },
  off: {
    transition: { duration: 0 },
    reducedMotion: 'always',
  },
};

export default function P2MotionConfig({ motionLevel = 'full', children }) {
  const cfg = CONFIG_BY_LEVEL[motionLevel] || CONFIG_BY_LEVEL.full;
  return (
    <MotionConfig transition={cfg.transition} reducedMotion={cfg.reducedMotion}>
      {children}
    </MotionConfig>
  );
}
