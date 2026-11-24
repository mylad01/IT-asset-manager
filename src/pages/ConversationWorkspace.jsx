import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, PanelLeftOpen, Plus, Paperclip, AtSign } from 'lucide-react';
import api from '../utils/apiClient';
import { GlassDrawer, GlassButton } from '../components/glass';
import { useAuth } from '../context/AuthContext';
import ConversationSidebar from '../components/conversations/ConversationSidebar';
import ChatPanel from '../components/conversations/ChatPanel';
import CreateConversationModal from '../components/conversations/CreateConversationModal';
import ArchiveBrowser from '../components/conversations/ArchiveBrowser';
import OversightPanel from '../components/conversations/OversightPanel';
import toast from 'react-hot-toast';

export default function ConversationWorkspace() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ archived: false });
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  // v2 root panels: archive browser + oversight (mutually exclusive with the
  // normal chat view while open).
  const [showArchive, setShowArchive] = useState(false);
  const [showOversight, setShowOversight] = useState(false);
  // One-shot deep-link target: /conversations?c=<id>&m=<msgId> highlights
  // that message inside the opened chat. Cleared once consumed so later
  // conversation switches don't re-trigger the highlight.
  const [highlightMessageId, setHighlightMessageId] = useState(null);
  const sidebarRef = useRef(null);

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.archived) params.set('archived', 'true');
    if (filters.search) params.set('search', filters.search);

    const { ok, data } = await api.get(`/api/conversations?${params.toString()}`, { showToast: false });
    if (ok && data) {
      setConversations(data.conversations || []);
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Deep link support: /conversations?c=<id> selects that conversation.
  // If it isn't in the current (unarchived) list, fetch it individually —
  // e.g. a ticket-linked conversation opened from TicketDetailModal.
  // An optional &m=<msgId> also captures a message to scroll+highlight.
  useEffect(() => {
    const deepLinkId = searchParams.get('c');
    if (!deepLinkId || loading) return;

    const deepLinkIdMessage = searchParams.get('m');

    const selectDeepLink = async () => {
      const exists = conversations.some((c) => String(c.id) === deepLinkId);
      if (exists) {
        setSelectedId(Number(deepLinkId));
      } else {
        const { ok, data } = await api.get(`/api/conversations/${deepLinkId}`, { showToast: false });
        if (ok && data?.id) {
          setConversations((prev) => (prev.some((c) => c.id === data.id) ? prev : [data, ...prev]));
          setSelectedId(Number(data.id));
        }
      }
      if (deepLinkIdMessage) {
        setHighlightMessageId(Number(deepLinkIdMessage));
      }
      // Clean the params so refreshes and filter changes keep the selection
      // but the message highlight never re-fires.
      setSearchParams({}, { replace: true });
    };

    selectDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the ?c= value changes
  }, [searchParams, loading]);

  const handleSelect = (id) => {
    setSelectedId(id);
    // A manual selection cancels any pending deep-link message highlight —
    // otherwise paging for a message of a DIFFERENT conversation could kick
    // off inside the newly selected chat.
    setHighlightMessageId(null);
    setSidebarOpen(false); // close the mobile drawer after picking a chat
    if (searchParams.get('c')) setSearchParams({}, { replace: true });
  };

  const handleCreated = (conv) => {
    setShowCreate(false);
    fetchConversations();
    setSelectedId(conv.id);
    toast.success('Conversation created');
  };

  // Keyboard shortcuts (deferred 7.4):
  // - Ctrl+F focuses the conversation search (Esc then clears/blurs it)
  // - ArrowUp/ArrowDown/Enter navigate the conversation list; the sidebar
  //   consumes these via its handleNavKey (it owns the visible order, incl.
  //   search filter + archived section) and reports whether it handled the key
  // - Esc closes the "New conversation" modal, else clears search, else
  //   collapses the mobile sidebar drawer
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        const el = document.activeElement;
        const typingInField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        if (!typingInField) {
          e.preventDefault();
          sidebarRef.current?.focusSearch();
        }
        return;
      }

      // Skip list navigation while the create modal is up so Enter/arrows
      // can't drive the list from underneath it.
      if (
        !showCreate &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') &&
        sidebarRef.current?.handleNavKey?.(e)
      ) return;

      if (e.key === 'Escape' && sidebarRef.current?.isSearchActive?.()) {
        // preventDefault signals GlassDrawer that Esc was consumed here, so
        // clearing the search does not also close the mobile drawer.
        e.preventDefault();
        sidebarRef.current?.clearSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreate]);

  const selected = conversations.find((c) => String(c.id) === String(selectedId));

  const sidebar = (
    <ConversationSidebar
      ref={sidebarRef}
      conversations={conversations}
      selectedId={selectedId}
      onSelect={(id) => { setShowArchive(false); setShowOversight(false); handleSelect(id); }}
      loading={loading}
      filters={filters}
      onFilterChange={setFilters}
      onNew={() => setShowCreate(true)}
      isRoot={!!user?.isRoot}
      onOpenArchive={() => { setShowOversight(false); setShowArchive(true); }}
      onOpenOversight={() => { setShowArchive(false); setShowOversight(true); }}
    />
  );

  // h-full fills main's content box (padding already excluded), so the
  // workspace fits under the mobile top bar without magic offsets.
  return (
    <div className="h-full flex gap-0 overflow-hidden rounded-2xl glass-card relative">
      {/* One sidebar instance: static on desktop, slide-in drawer on mobile.
          A single mount keeps its ref (shortcuts) and state intact. */}
      <GlassDrawer
        open={sidebarOpen}
        onClose={() => { if (!showCreate) setSidebarOpen(false); }}
        className="shrink-0"
        label="Conversations"
      >
        {sidebar}
      </GlassDrawer>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar: toggle + selected chat title / placeholder */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-white/10 tt-muted hover:tt"
            aria-label="Show conversations"
          >
            <PanelLeftOpen size={18} />
          </button>
          <span className="font-bold tt truncate text-sm">
            {selected ? selected.title : 'Conversations'}
          </span>
        </div>

        {/* No AnimatePresence/mode="wait" here: serializing on exit animations
            blocks the chat from mounting whenever frames are throttled (heavy
            load, background windows). Mounting directly with a fade-in keeps
            selection instant in every environment. */}
        {showArchive && user?.isRoot ? (
          <ArchiveBrowser
            onClose={() => setShowArchive(false)}
            onConversationRestored={fetchConversations}
          />
        ) : showOversight && user?.isRoot ? (
          <OversightPanel
            onClose={() => setShowOversight(false)}
            onRefreshSidebar={fetchConversations}
          />
        ) : selected ? (
          <ChatPanel
            key={selected.id}
            conversation={selected}
            onRefresh={fetchConversations}
            highlightMessageId={highlightMessageId}
            onHighlightDone={() => setHighlightMessageId(null)}
          />
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex-1 flex items-center justify-center p-6"
          >
            <div className="text-center max-w-sm">
              <div className="relative p-6 rounded-2xl bg-white/5 mb-4 inline-block">
                {/* Subtle ping on the icon frame draws the eye without motion noise */}
                <span className="absolute inset-0 rounded-2xl bg-[color:var(--ui-violet-strong)]/10 animate-ping-slow" aria-hidden="true" />
                <MessageSquare size={48} className="relative text-[color:var(--ui-violet-hi)]/70" />
              </div>
              {conversations.length === 0 && !loading ? (
                <>
                  <h3 className="text-lg font-semibold tt mb-1">Welcome to Conversations</h3>
                  <p className="text-sm tt-sec mb-1">
                    This is your team's space for quick questions, coordination and file sharing —
                    separate from formal tickets.
                  </p>
                  <p className="text-xs tt-muted mb-5">
                    Create your first conversation and invite colleagues with the @mention.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold tt-sec mb-2">No conversation selected</h3>
                  <p className="text-sm tt-muted mb-5">Pick a conversation from the list, or start a new one.</p>
                </>
              )}
              <GlassButton onClick={() => setShowCreate(true)} className="mb-6">
                <Plus size={15} className="mr-2" />
                New conversation
              </GlassButton>
              <div className="flex items-center justify-center gap-4 text-[11px] tt-muted">
                <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> Chat in real time</span>
                <span className="inline-flex items-center gap-1"><Paperclip size={12} /> Share photos &amp; files</span>
                <span className="inline-flex items-center gap-1"><AtSign size={12} /> @mention teammates</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {showCreate && (
        <CreateConversationModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
