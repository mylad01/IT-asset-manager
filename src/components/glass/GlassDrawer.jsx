import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue } from 'framer-motion';

/**
 * GlassDrawer — the app-wide responsive drawer pattern, with native-app
 * swipe-to-close on touch devices.
 *
 * One component that renders a sidebar-like panel as static on desktop and a
 * slide-in drawer (with overlay) on mobile, so pages stop copying the
 * overlay/wrapper markup. Consumers keep only the open/close state and pass
 * their panel as children:
 *
 *   const [drawerOpen, setDrawerOpen] = useState(false);
 *   ...
 *   <MobileTopBar onOpen={() => setDrawerOpen(true)} />   // md:hidden bar
 *   <GlassDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
 *     <MySidebarContent />
 *   </GlassDrawer>
 *
 * Originally extracted from App.jsx (nav drawer) and ConversationWorkspace
 * (conversations drawer), which duplicated this exact structure.
 *
 * Layout design notes:
 * - The panel is always mounted: a single mount keeps component state, refs
 *   and scroll position alive across open/close and viewport changes. On
 *   mobile the closed panel is translated off-screen (and pointer-events-none
 *   + aria-hidden) rather than display:none, so open/close can animate.
 * - Breakpoint classes are literal `md:` strings — Tailwind's JIT only
 *   generates classes it can see in source, so dynamic prefixes would break.
 * - Esc closes via the latest onClose (a ref), so consumers can pass inline
 *   closures without resubscribing. Page-level Esc handlers keep working.
 * - Focus returns to the previously focused element on close. Focus is
 *   deliberately NOT moved on open: on mobile that would pop the keyboard
 *   for inputs like the conversations search.
 * - Not portaled: the desktop state must be a real flex child of the page
 *   layout (a portal would break the static sidebar positioning).
 *
 * Swipe-to-close design notes (mobile only, left-positioned drawers):
 * - drag="x" with measured object constraints: the drawer follows the finger
 *   1:1 leftward and never rightward past its resting spot. Release past
 *   SWIPE_CLOSE_RATIO of its width, or a SWIPE_FLICK_VELOCITY flick, fires
 *   onClose and the panel slides out; anything else springs back via
 *   dragSnapToOrigin. Esc/overlay/programmatic closes are untouched.
 *   (A self-referencing constraints ref would clamp the panel to zero
 *   movement — the constraints object is measured while open instead.)
 * - touch-action is pan-y on mobile: the browser keeps vertical panning
 *   (chat lists, message history scroll natively); horizontal swipes belong
 *   to the drawer. Do NOT use touch-none here — it would kill list scrolling.
 * - Desktop (md+) disables the drag entirely via matchMedia, so the static
 *   panel never captures mouse input and stays pixel-identical to before.
 * - The overlay dims deeper proportionally to the drag through a Motion
 *   value — no per-frame React re-renders.
 * - State stays the source of truth: onClose only notifies. If a consumer
 *   keeps its state true after a swipe, dragSnapToOrigin restores the panel —
 *   the same contract as every other close path.
 * - Honors prefers-reduced-motion: open/close/snap transitions become
 *   instant. The drag itself stays — it is user-driven, not decorative.
 */
const SWIPE_CLOSE_RATIO = 0.3;    // drag past 30% of panel width → close
const SWIPE_FLICK_VELOCITY = 500; // px/s leftward flick → close
const DRAWER_EASE = [0.32, 0.72, 0, 1]; // iOS-like drawer curve
// Off-screen guess before the real width is measured (generous overshoot;
// leftward-fixed overflow never creates scrollbars).
const FALLBACK_DRAWER_WIDTH = 480;

function useIsDesktop() {
  // SSR-safe: assume mobile-first, matching the CSS defaults.
  const query = typeof window !== 'undefined'
    && window.matchMedia?.('(min-width: 768px)');
  const [isDesktop, setIsDesktop] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return undefined;
    const onChange = (e) => setIsDesktop(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return isDesktop;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function GlassDrawer({
  open,
  onClose,
  children,
  className = '',
  panelClassName = '',
  overlayClassName = '',
  zIndexOverlay = 'z-40',
  zIndexPanel = 'z-50',
  overlayBlur = false,
  closeOnOverlayClick = true,
  label,
}) {
  const isDesktop = useIsDesktop();
  const reducedMotion = usePrefersReducedMotion();

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const panelRef = useRef(null);

  // Extra overlay dimming while dragging: 0 (rest) → 0.5 (panel fully off).
  const dragDim = useMotionValue(0);

  // Drag bounds in px relative to the panel's resting transform: left = full
  // panel width so the drawer can travel completely off-screen, right = 0 so
  // it can never be dragged rightward past its resting spot. The closed
  // panel keeps its layout width (never display:none), so it measures
  // reliably even before the first open.
  const [dragBounds, setDragBounds] = useState({
    left: -FALLBACK_DRAWER_WIDTH,
    right: 0,
  });
  useEffect(() => {
    if (isDesktop) return undefined;
    const measure = () => {
      const width = panelRef.current?.offsetWidth;
      if (width) {
        setDragBounds((bounds) => (bounds.left === -width
          ? bounds
          : { ...bounds, left: -width }));
      }
    };
    measure();
    // Re-measure on resize (phone rotation changes both viewport and width).
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isDesktop, open]);

  // Esc closes the drawer while open — unless an earlier handler already
  // consumed the event (e.g. a page clears its search field first). Pair this
  // with pages calling e.preventDefault() in their own Esc branches.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Restore focus to the opener when the drawer closes.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    return () => { try { previouslyFocused?.focus?.(); } catch { /* unmounted */ } };
  }, [open]);

  // Reset the drag dimming whenever the drawer closes by any path.
  useEffect(() => {
    if (!open) dragDim.set(0);
  }, [open, dragDim]);

  const handleDrag = (_event, info) => {
    const width = panelRef.current?.offsetWidth || 320;
    const progress = Math.min(1, Math.max(0, -info.offset.x / width));
    dragDim.set(progress * 0.5);
  };

  const handleDragEnd = (_event, info) => {
    dragDim.set(0);
    const width = panelRef.current?.offsetWidth || 320;
    const dismissed = info.offset.x <= -width * SWIPE_CLOSE_RATIO
      || info.velocity.x <= -SWIPE_FLICK_VELOCITY;
    if (dismissed) onCloseRef.current?.();
  };

  const drawerTransition = { duration: reducedMotion ? 0 : 0.3, ease: DRAWER_EASE };

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="glass-drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: reducedMotion ? 0 : 0.18 } }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            onClick={closeOnOverlayClick ? onClose : undefined}
            aria-hidden="true"
            className={`md:hidden fixed inset-0 ${zIndexOverlay} bg-black/50 ${overlayBlur ? 'backdrop-blur-sm' : ''} ${overlayClassName}`}
          >
            {/* Drag-proportional dimming layer (rest: fully transparent) */}
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-black"
              style={{ opacity: dragDim }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        ref={panelRef}
        initial={false}
        // Measured px (not '-100%') so framer never interpolates across
        // mismatched units.
        animate={{ x: open || isDesktop ? 0 : dragBounds.left }}
        transition={drawerTransition}
        drag={isDesktop ? false : 'x'}
        dragConstraints={dragBounds}
        dragElastic={0.08}
        dragMomentum={false}
        dragSnapToOrigin
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        className={[
          'h-full overflow-hidden flex',
          // Mobile: fixed drawer; closed = off-screen via the x animation, so
          // never display:none — that would cut the open/close animation.
          // `inert` below removes the closed panel from tab order and blocks
          // pointer interaction while it slides out.
          'fixed inset-y-0 left-0 shadow-2xl',
          // Literal breakpoint classes — see design notes above. Desktop is a
          // static flex child, pixel-identical to the pre-drawer layout.
          'md:static md:flex md:shadow-none md:z-40',
          zIndexPanel,
          className,
          panelClassName,
        ].filter(Boolean).join(' ')}
        aria-hidden={isDesktop ? undefined : !open}
        inert={isDesktop ? false : !open}
        style={{
          // pan-y: browser owns vertical scrolling (lists), the drawer owns
          // horizontal swipes. framer respects an explicitly-set touchAction.
          touchAction: isDesktop ? 'auto' : 'pan-y',
        }}
        {...(label ? { 'aria-label': label } : {})}
      >
        {children}
      </motion.div>
    </>
  );
}
