import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Edit2, Trash2, SmilePlus } from 'lucide-react';
import api from '../../utils/apiClient';
import toast from 'react-hot-toast';
import MediaGallery from './MediaGallery';
import { getStoredUser } from '../../utils/appStorage';

const EMOJI_OPTIONS = ['👍', '❤️', '🔥', '✅', '👀', '🎉'];

export default function ChatMessage({ message, isOwn, conversationId, highlighted = false, onOpenMedia, readOnly = false }) {
  const [showActions, setShowActions] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const { id, content, user_name, is_internal, is_edited, created_at, attachments, reactions, deleted_at } = message;
  const time = new Date(created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Toggle: decide from the current props FIRST, then issue exactly one
  // request. (The previous version always POSTed and then conditionally
  // DELETEd off a stale prop, which could add-then-remove in a single click.)
  // The UI updates via the server's reaction broadcast, not local mutation.
  const handleReaction = async (emoji) => {
    setShowEmoji(false);
    const currentUserId = getStoredUser({})?.id;
    const alreadyReacted = reactions?.find(r => r.emoji === emoji)?.users.some(u => u.id === currentUserId);
    if (alreadyReacted) {
      await api.delete(`/api/conversations/${conversationId}/messages/${id}/reactions/${encodeURIComponent(emoji)}`, { showToast: false });
    } else {
      await api.post(`/api/conversations/${conversationId}/messages/${id}/reactions`, { emoji }, { showToast: false });
    }
  };

  const handleEdit = async () => {
    if (!editContent.trim() || editContent === content) {
      setEditing(false);
      return;
    }
    const { ok } = await api.put(`/api/conversations/${conversationId}/messages/${id}`, { content: editContent }, { showToast: false });
    if (ok) {
      message.content = editContent;
      message.is_edited = 1;
      toast.success('Message edited');
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this message?')) return;
    const { ok } = await api.delete(`/api/conversations/${conversationId}/messages/${id}`, { showToast: false });
    if (ok) {
      toast.success('Message deleted');
    }
  };

  // Tombstone (root oversight view): the message was soft-deleted. Regular
  // users never receive these rows from the API.
  if (deleted_at) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
        <div className="max-w-[70%]">
          <div className="rounded-2xl px-4 py-2.5 bg-white/[0.03] border border-dashed border-white/15">
            <p className="text-xs tt-muted italic">Message deleted</p>
            <p className="text-[10px] tt-muted mt-0.5">{time} · visible to Root only</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3 group`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmoji(false); }}
    >
      <div className={`max-w-[70%] ${isOwn ? 'order-1' : 'order-1'}`}>
        {!isOwn && (
          <p className="text-xs font-semibold tt-muted mb-1 ml-1">{user_name}</p>
        )}

        <div
          className={`
            relative rounded-2xl px-4 py-2.5 transition-all duration-300
            ${highlighted
              ? 'ring-2 ring-[color:var(--ui-violet)]/80 shadow-[0_0_28px_rgba(139,92,246,0.35)]'
              : ''
            }
            ${is_internal
              ? 'bg-[color:var(--status-warning-strong)]/10 border border-[color:var(--status-warning)]/20'
              : isOwn
                ? 'bg-[color:var(--ui-violet-strong)]/20 border border-[color:var(--ui-violet)]/20'
                : 'bg-white/5 border border-white/10'
            }
          `}
        >
          {/* Ternary, not `&&`: SQLite returns is_internal as 0/1 and React
              renders a numeric 0 literally — `{0 && x}` shows a stray "0". */}
          {is_internal ? (
            <div className="flex items-center gap-1 text-[10px] text-[color:var(--status-warning)] mb-1 font-semibold">
              <Lock size={10} />
              Internal Note
            </div>
          ) : null}

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-sm tt resize-none focus:outline-none focus:border-[color:var(--ui-violet)]/50"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(false)} className="text-xs tt-muted hover:tt">Cancel</button>
                <button onClick={handleEdit} className="text-xs text-[color:var(--ui-violet)] hover:text-[color:var(--ui-violet-hi)] font-semibold">Save</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm tt whitespace-pre-wrap break-words">{content}</p>
              {is_edited ? (
                <p className="text-[10px] tt-muted mt-1 italic">edited</p>
              ) : null}
            </>
          )}

          {attachments?.length > 0 && (
            <MediaGallery attachments={attachments} onOpenMedia={onOpenMedia} />
          )}
        </div>

        {reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 ml-1">
            {reactions.map(r => {
              const currentUserId = getStoredUser({})?.id;
              const hasReacted = r.users.some(u => u.id === currentUserId);
              return (
                <motion.button
                  key={r.emoji}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleReaction(r.emoji)}
                  className={`
                    inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                    ${hasReacted ? 'bg-[color:var(--ui-violet-strong)]/20 border border-[color:var(--ui-violet)]/30' : 'bg-white/5 border border-white/10 hover:bg-white/10'}
                  `}
                >
                  <span>{r.emoji}</span>
                  <span className="tt-muted">{r.count}</span>
                </motion.button>
              );
            })}
          </div>
        )}

        <p className={`text-[10px] tt-muted mt-1 ${isOwn ? 'text-right' : 'text-left'} ml-1`}>
          {time}
        </p>
      </div>

      {showActions && !editing && (
        <div className={`flex items-start gap-1 mt-6 ${isOwn ? 'mr-2 order-0' : 'ml-2 order-2'}`}>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowEmoji(!showEmoji)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors tt-muted hover:tt"
          >
            <SmilePlus size={12} />
          </motion.button>
          {isOwn && !readOnly && (
            <>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors tt-muted hover:tt"
              >
                <Edit2 size={12} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleDelete}
                className="p-1.5 rounded-lg hover:bg-[color:var(--status-danger-strong)]/10 transition-colors text-[color:var(--status-danger)]"
              >
                <Trash2 size={12} />
              </motion.button>
            </>
          )}

          {showEmoji && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowEmoji(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute top-full mt-1 left-0 flex gap-1 p-2 rounded-xl glass-card border border-white/15 shadow-xl z-50"
              >
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="text-lg hover:scale-125 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
