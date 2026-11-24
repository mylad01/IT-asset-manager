import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';

/**
 * ScrollArea — the shared glass scroll container (src/components/glass/).
 *
 * Every scrollable region used to hand-roll `overflow-y-auto` plus an opt-in
 * styling class — and half the app forgot it and got raw OS scrollbars. The
 * LOOK now lives in a global layer (index.css): slim 6px thumb in both axes
 * for WebKit, standard `scrollbar-width`/`scrollbar-color` for Firefox,
 * colors derived from each theme's own text palette. This component owns
 * the four things that still must be per-container:
 *
 *  1. Container policy rides on `.glass-scrollarea` (index.css): the global
 *     look plus a reserved gutter — nothing to remember per component.
 *  2. Scroll shadows: frosted edge strips that fade in only while there is
 *     hidden content on that edge. They are children of the non-scrolling
 *     WRAPPER, so they stay pinned while content slides underneath —
 *     pseudo-elements and absolute children of the scroller itself would
 *     scroll away with the content they are meant to shade.
 *  3. Keyboard scrolling (WCAG 2.1.1): the viewport takes `tabIndex=0`
 *     exactly while it overflows, so keyboard users can scroll it. The
 *     global `*:focus-visible` rule draws the ring (and the focus-rings
 *     preference forces it on).
 *  4. Overscroll containment + a reserved scrollbar gutter: a modal body
 *     can't chain-scroll the page behind it, and content appearing or
 *     disappearing never shifts the layout sideways.
 *
 * Structure: wrapper (`className` — layout, position:relative) holds the
 * viewport (`contentClassName` — padding/content styling; receives the
 * forwarded ref, all scroll state lives here) plus the edge strips and the
 * optional `overlay` slot (floating pills/buttons rendered above them).
 *
 * Drop-in for <div className="flex-1 overflow-y-auto p-4">:
 *   <ScrollArea className="flex-1 min-h-0" contentClassName="p-4">…
 */
const EDGE_GAP = 4; // px of hidden content before an edge shadow arms

const ScrollArea = forwardRef(function ScrollArea({
  className = '',
  contentClassName = '',
  children,
  overlay = null,
  shadows = true,
  focusable = true,
  onScroll,
  style,
  ...props
}, forwardedRef) {
  const viewportRef = useRef(null);
  const [edges, setEdges] = useState({ top: false, bottom: false, left: false, right: false });
  const [scrollable, setScrollable] = useState(false);

  const setRefs = useCallback((node) => {
    viewportRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  // Measure hidden content per edge. Called on scroll, on viewport resize
  // (ResizeObserver) and after every render (content may have changed
  // without any scroll). setState calls bail out when nothing moved.
  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const next = {
      top: el.scrollTop > 0,
      bottom: el.scrollHeight - el.scrollTop - el.clientHeight > EDGE_GAP,
      left: el.scrollLeft > 0,
      right: el.scrollWidth - el.scrollLeft - el.clientWidth > EDGE_GAP,
    };
    const any = next.top || next.bottom || next.left || next.right;
    setEdges((prev) => (
      prev.top === next.top && prev.bottom === next.bottom
      && prev.left === next.left && prev.right === next.right ? prev : next
    ));
    setScrollable((prev) => (prev === any ? prev : any));
  }, []);

  // Content changes (new messages, toggles, images loading) re-render this
  // component — re-measure after every commit, cheap and equality-guarded.
  useEffect(() => {
    measure();
  });

  // The viewport itself resizing (window resize, flex layout changes)
  // changes which edges are armed.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const handleScroll = (event) => {
    measure();
    onScroll?.(event);
  };

  return (
    <div className={`relative min-h-0 ${className}`}>
      <div
        ref={setRefs}
        onScroll={handleScroll}
        tabIndex={focusable && scrollable ? 0 : undefined}
        style={style}
        className={`h-full overflow-y-auto glass-scrollarea ${contentClassName}`}
        {...props}
      >
        {children}
      </div>
      {shadows && ['top', 'bottom', 'left', 'right'].map((side) => (
        <div
          key={side}
          aria-hidden="true"
          className={`glass-scroll-fade glass-scroll-fade--${side}`}
          style={{ opacity: edges[side] ? 1 : 0 }}
        />
      ))}
      {overlay}
    </div>
  );
});

export default ScrollArea;
