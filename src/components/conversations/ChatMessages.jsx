import React, { useLayoutEffect, useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import ChatMessage from './ChatMessage';
import ScrollArea from '../glass/ScrollArea';
import { getStoredUser } from '../../utils/appStorage';

// How close to the top (px) triggers fetching the next older page.
const LOAD_MORE_THRESHOLD = 60;

// How long the deep-link highlight ring stays on the target message.
const HIGHLIGHT_MS = 4000;
// Max attempts waiting for a freshly-paged message node to exist in the DOM.
const SCROLL_RETRY_MAX = 10;
const SCROLL_RETRY_DELAY_MS = 80;

export default function ChatMessages({
  messages,
  loading,
  conversationId,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  highlightMessageId = null,
  onHighlightDone,
  onOpenMedia,
  readOnly = false,
}) {
  const containerRef = useRef(null);
  // Scroll anchoring: when an older page is requested we record the viewport Y
  // of the currently-first message node; after the prepend renders we shift
  // scrollTop by that node's exact pixel delta. Measuring the real DOM node
  // (instead of diffing scrollHeight) compensates for any layout settling,
  // and useLayoutEffect applies it before the browser paints — no jump, no
  // flicker, history just "grows upward".
  const anchorRef = useRef(null); // { id, top } | null
  const prevFirstIdRef = useRef(null);
  const shouldStickBottomRef = useRef(true);
  // Reactive mirror of the stick flag — refs don't re-render, but the
  // "jump to latest" pill does.
  const [atBottom, setAtBottom] = useState(true);
  // Message currently wearing the highlight ring (set after it is on screen).
  const [highlightedId, setHighlightedId] = useState(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const anchor = anchorRef.current;
    const prevFirstId = prevFirstIdRef.current;
    const currentFirstId = messages[0]?.id;

    if (anchor && currentFirstId !== anchor.id && prevFirstId === anchor.id) {
      // An older page was prepended: keep the previously-top message exactly
      // where it was on screen.
      const node = el.querySelector(`[data-msg-id="${anchor.id}"]`);
      if (node) {
        const delta = node.getBoundingClientRect().top - anchor.top;
        el.scrollTop += delta;
      }
      anchorRef.current = null;
      prevFirstIdRef.current = currentFirstId;
      return;
    }
    anchorRef.current = null;

    if (prevFirstId !== null && currentFirstId !== prevFirstId) {
      // Conversation switched (list replaced): jump to the newest end.
      shouldStickBottomRef.current = true;
    }
    if (shouldStickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    }
    prevFirstIdRef.current = currentFirstId;
  }, [messages]);

  /* Deep-link highlight: page back through history until the target message
     is loaded (reusing the same loadOlder pagination as manual scrolls),
     scroll it to viewport center, then ring-highlight it for a few seconds.
     Runs as an effect keyed on `messages`, so each prepended page naturally
     re-evaluates; ChatPanel's in-flight guard prevents overlapping fetches. */
  useEffect(() => {
    if (!highlightMessageId || loading) return;
    if (highlightedId === highlightMessageId) return; // ring already showing

    const target = messages.find((m) => m.id === highlightMessageId);
    if (target) {
      // The node may not exist in the DOM until React commits — retry briefly.
      let tries = 0;
      let cancelled = false;
      const tryScroll = () => {
        if (cancelled) return;
        const node = containerRef.current?.querySelector(`[data-msg-id="${highlightMessageId}"]`);
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setHighlightedId(highlightMessageId);
        } else if (tries++ < SCROLL_RETRY_MAX) {
          setTimeout(tryScroll, SCROLL_RETRY_DELAY_MS);
        } else {
          onHighlightDone?.(); // gave up finding the node
        }
      };
      tryScroll();
      return () => { cancelled = true; };
    }

    if (hasMore && !loadingMore) {
      onLoadMore?.(); // fetch the next older page and let this effect re-run
    } else if (!hasMore && !loadingMore) {
      onHighlightDone?.(); // entire history loaded, message not present
    }
  }, [highlightMessageId, messages, loading, hasMore, loadingMore, highlightedId, onLoadMore, onHighlightDone]);

  /* Ring lifetime: clear it (and the one-shot deep-link target in the
     workspace) after HIGHLIGHT_MS. Kept as a separate effect keyed on
     highlightedId so unrelated re-renders never reset the timer. */
  useEffect(() => {
    if (highlightedId == null) return;
    const t = setTimeout(() => {
      setHighlightedId(null);
      onHighlightDone?.();
    }, HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightedId, onHighlightDone]);

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    const firstId = messages[0]?.id;
    const node = firstId != null
      ? containerRef.current?.querySelector(`[data-msg-id="${firstId}"]`)
      : null;
    if (node) {
      anchorRef.current = { id: firstId, top: node.getBoundingClientRect().top };
    }
    onLoadMore?.();
  }, [hasMore, loadingMore, messages, onLoadMore]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    shouldStickBottomRef.current = at;
    setAtBottom(at);
    if (el.scrollTop <= LOAD_MORE_THRESHOLD) {
      triggerLoadMore();
    }
  };

  /* Jump-to-latest pill: shows whenever the user has scrolled up from the
     bottom (handleScroll owns that state). Clicking hands the stick flag to
     the glide, so a message arriving mid-animation doesn't yank the view —
     scroll events keep feeding atBottom, and the pill disappears on arrival. */
  const jumpToLatest = () => {
    const el = containerRef.current;
    if (!el) return;
    shouldStickBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
            <div className="h-16 w-64 rounded-xl bg-white/5 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm tt-muted">No messages yet. Start the conversation!</p>
        </div>
      </div>
    );
  }

  const grouped = groupMessagesByDate(messages);

  return (
    <ScrollArea
      ref={containerRef}
      className="flex-1"
      contentClassName="p-4 space-y-4"
      onScroll={handleScroll}
      // overflow-anchor:none — Chrome's native scroll anchoring would otherwise
      // double-adjust on prepend, fighting the JS anchoring in the layout
      // effect below (manifesting as ~100px drift after loading older pages).
      style={{ overflowAnchor: 'none' }}
      overlay={(
        <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center pointer-events-none">
          <AnimatePresence initial={false}>
            {!atBottom && (
              <motion.button
                key="jump-to-latest"
                type="button"
                onClick={jumpToLatest}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold glass-btn glass-btn-primary shadow-xl cursor-pointer"
                aria-label="Jump to latest messages"
              >
                <ChevronDown size={14} />
                Jump to latest
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    >
      {hasMore && (
        <div className="flex justify-center pb-1">
          <button
            onClick={triggerLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 border border-white/10 tt-muted hover:tt hover:bg-white/10 transition-colors disabled:opacity-60"
          >
            {loadingMore ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <ChevronUp size={12} />
                Load older messages
              </>
            )}
          </button>
        </div>
      )}

      {grouped.map((group, gi) => (
        <div key={gi}>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] font-semibold tt-muted uppercase">{group.date}</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <AnimatePresence initial={false}>
            {group.messages.map((msg) => (
              <motion.div
                key={msg.id}
                data-msg-id={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <ChatMessage
                  message={msg}
                  isOwn={msg.user_id === getStoredUser({})?.id}
                  conversationId={conversationId}
                  highlighted={highlightedId === msg.id}
                  onOpenMedia={onOpenMedia}
                  readOnly={readOnly}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ))}
    </ScrollArea>
  );
}

function groupMessagesByDate(messages) {
  const groups = [];
  let currentDate = null;

  for (const msg of messages) {
    const date = new Date(msg.created_at).toLocaleDateString();
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date, messages: [] });
    }
    groups[groups.length - 1].messages.push(msg);
  }

  return groups;
}
