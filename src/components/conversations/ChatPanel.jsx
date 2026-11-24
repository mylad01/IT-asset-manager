import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, X, ShieldAlert } from 'lucide-react';
import api from '../../utils/apiClient';
import { getWebSocketUrl } from '../../utils/wsUrl';
import { getStoredToken, getStoredUser } from '../../utils/appStorage';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import Lightbox from './Lightbox';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const PAGE_SIZE = 50;

export default function ChatPanel({ conversation, onRefresh, highlightMessageId, onHighlightDone, oversight = false, onJoin }) {
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { items, index }
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const [seenBy, setSeenBy] = useState([]);
  const wsRef = useRef(null);
  const searchInputRef = useRef(null);

  const readOnly = oversight || !!conversation.is_archived;

  const fetchMessages = useCallback(async () => {
    const { ok, data } = await api.get(`/api/conversations/${conversation.id}/messages?limit=${PAGE_SIZE}`, { showToast: false });
    if (ok && Array.isArray(data)) {
      setMessages(data);
      setHasMore(data.length === PAGE_SIZE);
      // Opening a conversation marks it read; the server pushes the fresh
      // unread count so the sidebar nav badge decrements.
      api.put(`/api/conversations/${conversation.id}/read`, {}, { showToast: false });
    }
    setLoading(false);
  }, [conversation.id]);

  // Scroll-up pagination: fetch the page older than the oldest loaded message.
  const loadOlderInFlight = useRef(false);
  const loadOlder = useCallback(async () => {
    if (loadOlderInFlight.current) return;
    if (loading || loadingMore || !hasMore || messages.length === 0) return;
    loadOlderInFlight.current = true;
    setLoadingMore(true);
    try {
      const before = messages[0].id;
      const { ok, data } = await api.get(
        `/api/conversations/${conversation.id}/messages?before=${before}&limit=${PAGE_SIZE}`,
        { showToast: false }
      );
      if (ok && Array.isArray(data)) {
        setMessages((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const fresh = data.filter((m) => !have.has(m.id));
          return [...fresh, ...prev];
        });
        setHasMore(data.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } finally {
      loadOlderInFlight.current = false;
      setLoadingMore(false);
    }
  }, [conversation.id, messages, loading, loadingMore, hasMore]);

  const fetchParticipants = useCallback(async () => {
    const { ok, data } = await api.get(`/api/conversations/${conversation.id}/participants`, { showToast: false });
    if (ok && Array.isArray(data)) {
      setParticipants(data);
    }
  }, [conversation.id]);

  useEffect(() => {
    fetchMessages();
    fetchParticipants();
  }, [fetchMessages, fetchParticipants]);


  useEffect(() => {
    // Reconnect with backoff: without this, a single dropped socket (server
    // restart, network blip) silently kills all realtime delivery — messages,
    // reactions, typing — until the user manually reloads the page.
    let ws = null;
    let reconnectTimer = null;
    let disposed = false;
    const sockets = new Set();

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(getWebSocketUrl('/ws'));
      sockets.add(ws);
      wsRef.current = ws;

      ws.onopen = () => {
        const token = getStoredToken();
        if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        }
      };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'auth:ok') {
          ws.send(JSON.stringify({ type: 'conversation:join', conversationId: conversation.id }));
        } else if (data.type === 'conversation:message' && data.conversationId === conversation.id) {
          setMessages(prev => {
            if (prev.some(m => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
          api.put(`/api/conversations/${conversation.id}/read`, {});
        // Broadcast a read receipt so other members' Seen-by updates live.
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'conversation:read', conversationId: conversation.id, lastReadAt: new Date().toISOString() }));
        }
        } else if (data.type === 'conversation:typing' && data.conversationId === conversation.id) {
          setTypingUsers(prev => {
            if (prev.some(u => u.userId === data.userId)) return prev;
            return [...prev, { userId: data.userId, userName: data.userName }];
          });
          setTimeout(() => {
            setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
          }, 3000);
        } else if (data.type === 'conversation:reaction-added' && data.conversationId === conversation.id) {
          setMessages(prev => prev.map(m => {
            if (m.id !== data.messageId) return m;
            const existing = m.reactions?.find(r => r.emoji === data.emoji);
            if (existing) {
              if (existing.users.some(u => u.id === data.userId)) return m;
              return { ...m, reactions: m.reactions.map(r =>
                r.emoji === data.emoji
                  ? { ...r, users: [...r.users, { id: data.userId, name: data.userName }], count: r.count + 1 }
                  : r
              )};
            }
            return { ...m, reactions: [...(m.reactions || []), { emoji: data.emoji, users: [{ id: data.userId, name: data.userName }], count: 1 }] };
          }));
        } else if (data.type === 'conversation:reaction-removed' && data.conversationId === conversation.id) {
          setMessages(prev => prev.map(m => {
            if (m.id !== data.messageId) return m;
            return { ...m, reactions: (m.reactions || [])
              .map(r => r.emoji === data.emoji ? { ...r, users: r.users.filter(u => u.id !== data.userId), count: r.count - 1 } : r)
              .filter(r => r.count > 0)
            };
          }));
        } else if (data.type === 'conversation:message-edited' && data.conversationId === conversation.id) {
          setMessages(prev => prev.map(m => (m.id === data.message.id ? { ...m, ...data.message } : m)));
        } else if (data.type === 'conversation:message-deleted' && data.conversationId === conversation.id) {
          setMessages(prev => prev.filter(m => m.id !== data.messageId));
        } else if (data.type === 'conversation:read' && data.conversationId === conversation.id) {
          // Read receipt: someone read up to data.lastReadAt — track for the
          // Seen-by indicator.
          setSeenBy(prev => {
            const next = prev.filter(u => u.userId !== data.userId);
            return [...next, { userId: data.userId, userName: data.userName, lastReadAt: data.lastReadAt }];
          });
        }
      } catch {}
    };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (!disposed) reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      for (const s of sockets) {
        s.onopen = s.onmessage = s.onclose = s.onerror = null;
        if (s.readyState === WebSocket.OPEN) {
          try { s.send(JSON.stringify({ type: 'conversation:leave', conversationId: conversation.id })); } catch {}
          try { s.close(); } catch {}
        }
      }
      sockets.clear();
    };
  }, [conversation.id]);

  // XHR-based send with upload progress (fetch cannot report progress).
  const handleSend = useCallback((content, isInternal, attachments) => {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append('content', content);
      formData.append('isInternal', String(isInternal));
      if (attachments) {
        for (const file of attachments) formData.append('attachments', file);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}/api/conversations/${conversation.id}/messages`);
      xhr.setRequestHeader('Authorization', `Bearer ${getStoredToken()}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(pct);
          if (pct >= 100) setTimeout(() => setUploadProgress(null), 800);
        }
      };

      xhr.onload = () => {
        setUploadProgress(null);
        try {
          const data = JSON.parse(xhr.responseText || 'null');
          if (xhr.status >= 200 && xhr.status < 300 && data?.message) {
            setMessages(prev => [...prev, data.message]);
            onRefresh?.();
            resolve({ ok: true });
            return;
          }
          resolve({ ok: false, error: data?.error });
        } catch {
          resolve({ ok: false, error: `Upload failed (HTTP ${xhr.status})` });
        }
      };

      xhr.onerror = () => {
        setUploadProgress(null);
        resolve({ ok: false, error: 'Network error during upload' });
      };

      xhr.send(formData);
    });
  }, [conversation.id, onRefresh]);

  const handleTyping = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'conversation:typing', conversationId: conversation.id }));
    }
  };

  // ── In-chat search (client-side over loaded messages) ──
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages
      .map((m, i) => ({ msg: m, i }))
      .filter(({ msg }) => (msg.content || '').toLowerCase().includes(q))
      .map(({ i }) => i);
  }, [messages, searchQuery]);

  useEffect(() => { setSearchIndex(searchMatches.length ? 0 : -1); }, [searchQuery, searchMatches.length]);

  const jumpToMatch = (idx) => {
    if (!searchMatches.length) return;
    const next = (idx + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    const msgIndex = searchMatches[next];
    document.querySelector(`[data-msg-id="${messages[msgIndex].id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // All media currently loaded — lightbox navigation flows across messages.
  const mediaItems = useMemo(() => {
    const items = [];
    for (const m of messages) {
      for (const att of m.attachments || []) {
        if (att.kind === 'image' || att.kind === 'video') items.push(att);
      }
    }
    return items;
  }, [messages]);

  const openLightbox = (attachment) => {
    const idx = mediaItems.findIndex(a => a.id === attachment.id);
    setLightbox({ items: mediaItems, index: Math.max(0, idx) });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col min-h-0"
    >
      {oversight && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-[color:var(--status-warning-strong)]/10 border-b border-[color:var(--status-warning)]/20 text-[11px] text-[color:var(--status-warning-hi)]">
          <ShieldAlert size={12} />
          Viewing as Root — this access is logged
          {onJoin && (
            <button onClick={onJoin} className="ml-2 px-2 py-0.5 rounded-md bg-[color:var(--status-warning-strong)]/20 hover:bg-[color:var(--status-warning-strong)]/30 font-semibold">
              Join conversation
            </button>
          )}
        </div>
      )}

      <ChatHeader conversation={conversation} participants={participants} onRefresh={onRefresh} />

      {/* In-chat search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-white/5">
          <Search size={13} className="text-white/40" />
          <input
            ref={searchInputRef}
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); jumpToMatch(searchIndex + 1); }
              if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
            }}
            placeholder="Search in conversation…"
            className="flex-1 bg-transparent text-sm tt placeholder-white/30 focus:outline-none"
          />
          <span className="text-[10px] tt-muted whitespace-nowrap">
            {searchQuery ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : ''}
          </span>
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="p-1 rounded hover:bg-white/10 tt-muted" aria-label="Close search">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="relative flex-1 flex flex-col min-h-0">
        {/* Floating search toggle */}
        {!searchOpen && !readOnly && (
          <button
            onClick={() => setSearchOpen(true)}
            className="absolute top-2 right-3 z-10 p-1.5 rounded-lg glass border border-white/10 bg-black/20 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Search in conversation (Ctrl+Shift+F)"
            aria-label="Search in conversation"
          >
            <Search size={13} />
          </button>
        )}

        <ChatMessages
          messages={messages}
          loading={loading}
          conversationId={conversation.id}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadOlder}
          highlightMessageId={highlightMessageId}
          onHighlightDone={onHighlightDone}
          onOpenMedia={openLightbox}
          readOnly={readOnly}
        />
      </div>

      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs tt-muted">
          {typingUsers.map(u => u.userName).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {seenBy.length > 0 && !readOnly && (
        <SeenByIndicator seenBy={seenBy} participants={participants} messages={messages} />
      )}

      <ChatInput
        onSend={handleSend}
        onTyping={handleTyping}
        archived={readOnly}
        participants={participants}
        uploadProgress={uploadProgress}
      />

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => ({ ...lb, index }))}
        />
      )}
    </motion.div>
  );
}

// SQLite CURRENT_TIMESTAMP strings are UTC without a zone marker; a plain
// new Date() parses them as LOCAL time. Appending 'Z' forces the correct
// interpretation — otherwise the Seen-by comparison skews by the timezone
// offset and receipts show up hours late/early.
function parseDbTime(ts) {
  if (!ts) return 0;
  const s = String(ts);
  const looksUtc = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(s);
  return new Date(looksUtc ? `${s}Z` : s).getTime() || 0;
}

function SeenByIndicator({ seenBy, participants, messages }) {
  if (!messages.length) return null;
  const myId = getStoredUser({})?.id;
  const newestOwn = [...messages].reverse().find(m => m.user_id === myId && !m.deleted_at);
  if (!newestOwn) return null;

  const readers = seenBy.filter(s =>
    s.userId !== myId &&
    parseDbTime(s.lastReadAt) >= parseDbTime(newestOwn.created_at)
  );
  if (!readers.length) return null;

  return (
    <div className="px-4 pb-1 flex justify-end items-center gap-1">
      <span className="text-[10px] tt-muted">Seen by</span>
      {readers.slice(0, 5).map((r) => {
        const p = participants.find(x => x.user_id === r.userId);
        return (
          <div
            key={r.userId}
            title={p?.name || r.userName || 'Participant'}
            className="w-4 h-4 rounded-full bg-[color:var(--status-success-strong)]/20 border border-[color:var(--status-success)]/40 flex items-center justify-center text-[8px] font-bold text-[color:var(--status-success-hi)]"
          >
            {(p?.name || r.userName || '?')[0]?.toUpperCase()}
          </div>
        );
      })}
      {readers.length > 5 && <span className="text-[10px] tt-muted">+{readers.length - 5}</span>}
    </div>
  );
}
