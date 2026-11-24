import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, ChevronDown, ChevronRight, Archive, MessageSquare, Shield, HardDrive } from 'lucide-react';
import ConversationItem from './ConversationItem';
import ScrollArea from '../glass/ScrollArea';

const ConversationSidebar = forwardRef(function ConversationSidebar({
  conversations,
  selectedId,
  onSelect,
  loading,
  onNew,
  isRoot = false,
  onOpenArchive,
  onOpenOversight,
}, ref) {
  const [searchQuery, setSearchQuery] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  // Index into the *visible* list (active + expanded archived). -1 = none.
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const active = conversations.filter(c => !c.is_archived);
  const archived = conversations.filter(c => c.is_archived);

  const filtered = searchQuery
    ? active.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.last_message?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : active;

  const filteredArchived = searchQuery
    ? archived.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.last_message?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : archived;

  // Visible conversation ids in document order — the order the arrow keys
  // walk (active first, then archived only while its section is expanded).
  const visible = archivedOpen ? [...filtered, ...filteredArchived] : filtered;

  // Ordered ids joined so reorders/search/archive toggles change the key,
  // while background refreshes (new last_message, same order) keep it —
  // preserving the highlight across data updates.
  const visibleKey = visible.map(c => c.id).join('|');

  // Reset the highlight when the visible list changes identity.
  useEffect(() => {
    setHighlightIndex(-1);
  }, [visibleKey]);

  // Keep the highlighted item in view without stealing focus.
  useLayoutEffect(() => {
    if (highlightIndex < 0) return;
    const node = listRef.current?.querySelector('[data-kbd-nav="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  // Arrow keys move the highlight (Slack-style: Enter then opens it); they
  // never change the selection themselves. Starting from nothing continues
  // from the currently selected conversation when it is visible.
  const moveHighlight = (key) => {
    if (visible.length === 0) return;
    setHighlightIndex((prev) => {
      if (prev < 0) {
        const sel = visible.findIndex(c => String(c.id) === String(selectedId));
        if (sel >= 0) {
          return key === 'ArrowDown'
            ? Math.min(sel + 1, visible.length - 1)
            : Math.max(sel - 1, 0);
        }
        return key === 'ArrowDown' ? 0 : visible.length - 1;
      }
      const dir = key === 'ArrowDown' ? 1 : -1;
      return (prev + dir + visible.length) % visible.length;
    });
  };

  const openHighlighted = () => {
    if (highlightIndex < 0 || highlightIndex >= visible.length) return;
    onSelect(visible[highlightIndex].id);
  };

  // Exposed for the workspace-level keyboard shortcuts (Ctrl+F / Esc / arrows).
  useImperativeHandle(ref, () => ({
    focusSearch: () => searchInputRef.current?.focus(),
    clearSearch: () => {
      setSearchQuery('');
      searchInputRef.current?.blur();
    },
    isSearchActive: () => document.activeElement === searchInputRef.current,
    // Returns true when the event was consumed; false lets the workspace
    // ignore it (typing fields, search active with other keys, empty list).
    handleNavKey: (e) => {
      const activeEl = document.activeElement;
      const isSearch = activeEl === searchInputRef.current;
      // Textareas / inputs keep native handling (caret, mention nav in the
      // chat composer). The sidebar's own search is the exception: arrows
      // and Enter walk/open results from there — but never during IME
      // composition, where those keys pick candidates.
      if (!isSearch) {
        const typingInField = activeEl &&
          (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (typingInField) return false;
      } else if (e.isComposing) {
        return false;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (visible.length === 0) return false;
        e.preventDefault();
        moveHighlight(e.key);
        return true;
      }
      if (e.key === 'Enter') {
        if (highlightIndex < 0) return false; // nothing highlighted yet
        e.preventDefault();
        openHighlighted();
        return true;
      }
      return false;
    },
  }));

  return (
    <>
    <div className="w-80 border-r border-white/10 flex flex-col bg-white/5">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold tt flex items-center gap-2">
            <MessageSquare size={18} className="text-[color:var(--ui-violet)]" />
            Conversations
          </h2>
          <div className="flex items-center gap-1">
            {isRoot && (
              <>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onOpenArchive}
                  className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                  title="Conversation archive"
                >
                  <HardDrive size={15} />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onOpenOversight}
                  className="p-2 rounded-lg bg-[color:var(--status-warning-strong)]/10 text-[color:var(--status-warning-hi)]/80 hover:bg-[color:var(--status-warning-strong)]/20 hover:text-[color:var(--status-warning-hi)] transition-colors"
                  title="Root oversight — all conversations"
                >
                  <Shield size={15} />
                </motion.button>
              </>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onNew}
              className="p-2 rounded-lg bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)] hover:bg-[color:var(--ui-violet-strong)]/30 transition-colors"
            >
              <Plus size={16} />
            </motion.button>
          </div>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search conversations…  (Ctrl+F)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10 tt placeholder-white/30 focus:outline-none focus:border-[color:var(--ui-violet)]/50"
          />
        </div>
      </div>

      <ScrollArea ref={listRef} className="flex-1">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="p-2">
              <div className="px-2 py-1 text-xs font-semibold tt-muted uppercase tracking-wider">
                Active ({filtered.length})
              </div>
              <AnimatePresence>
                {filtered.map((conv, i) => (
                  <motion.div
                    key={conv.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <ConversationItem
                      conversation={conv}
                      selected={conv.id === selectedId}
                      highlighted={i === highlightIndex}
                      onClick={() => onSelect(conv.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {filtered.length === 0 && !searchQuery && (
                <div className="text-center py-8 px-3">
                  <p className="text-sm tt-muted mb-3">
                    {loading ? 'Loading conversations…' : 'No conversations yet'}
                  </p>
                  {!loading && (
                    <button
                      onClick={onNew}
                      className="glass-btn glass-btn-primary text-xs px-4 py-2 inline-flex items-center gap-1.5"
                    >
                      <Plus size={13} /> Start one
                    </button>
                  )}
                </div>
              )}
            </div>

            {filteredArchived.length > 0 && (
              <div className="p-2 border-t border-white/5">
                <button
                  onClick={() => setArchivedOpen(!archivedOpen)}
                  className="flex items-center gap-2 px-2 py-1 text-xs font-semibold tt-muted uppercase tracking-wider hover:tt-sec transition-colors w-full"
                >
                  {archivedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Archive size={12} />
                  Archived ({filteredArchived.length})
                </button>
                <AnimatePresence>
                  {archivedOpen && filteredArchived.map((conv, i) => {
                    const idx = filtered.length + i;
                    return (
                      <motion.div
                        key={conv.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <ConversationItem
                          conversation={conv}
                          selected={conv.id === selectedId}
                          highlighted={idx === highlightIndex}
                          onClick={() => onSelect(conv.id)}
                          archived
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
    </>
  );
})

export default ConversationSidebar;
