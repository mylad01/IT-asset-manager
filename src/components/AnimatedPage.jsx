import React from 'react';
import { motion } from 'framer-motion';

/**
 * Wraps page content with a smooth entrance/exit animation.
 * Uses framer-motion for GPU-accelerated spring-based transitions.
 * 
 * Entrance: slides up 12px + fades in (spring, fast)
 * Exit: slides down 8px + fades out (ease, snappy)
 */
const pageVariants = {
  initial: {
    opacity: 0,
    y: 12,
    scale: 0.995,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.998,
  },
};

const pageTransition = {
  type: 'tween',
  ease: [0.25, 0.46, 0.45, 0.94], // ease-out-quad
  duration: 0.3,
};

const springTransition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

export default function AnimatedPage({ children, className = '' }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
      className={className}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered container for child elements.
 * Each child animates in with a slight delay after the parent.
 */
export function AnimatedStagger({ children, className = '', staggerDelay = 0.04 }) {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={{
        initial: {},
        animate: {
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: 0.1,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Individual staggered item that fades + slides in.
 */
export function AnimatedItem({ children, className = '' }) {
  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 10 },
        animate: {
          opacity: 1,
          y: 0,
          transition: springTransition,
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
