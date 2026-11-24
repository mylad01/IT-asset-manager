import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Paperclip, Lock, X, Image as ImageIcon, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import formatBytes from '../../utils/formatBytes';

// Client-side caps mirroring server config (server re-validates).
const CAPS = { image: 25 * 1024 * 1024, video: 50 * 1024 * 1024, doc: 10 * 1024 * 1024 };
const MAX_FILES = 5;
const ACCEPTED = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,text/plain';

function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'doc';
}


export default function ChatInput({ onSend, onTyping, archived, participants = [], uploadProgress = null }) {
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [previews, setPreviews] = useState({}); // file.name -> objectURL (images/videos)
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const filteredParticipants = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return participants.filter(p =>
      p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [mentionQuery, participants]);

  const showMentionDropdown = mentionQuery !== null && filteredParticipants.length > 0;

  useEffect(() => { setMentionIndex(0); }, [mentionQuery]);

  // Generate local preview URLs for image/video chips; revoke on cleanup.
  useEffect(() => {
    const next = {};
    for (const f of attachments) {
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
        next[f.name] = URL.createObjectURL(f);
      }
    }
    setPreviews((prev) => {
      for (const url of Object.values(prev)) URL.revokeObjectURL(url);
      return next;
    });
    return () => { for (const url of Object.values(next)) URL.revokeObjectURL(url); };
  }, [attachments]);

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming || []);
    setAttachments((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        toast.error(`Max ${MAX_FILES} attachments per message`);
        return prev;
      }
      const accepted = [];
      for (const file of list.slice(0, room)) {
        const kind = kindOf(file);
        if (file.size > CAPS[kind]) {
          toast.error(`"${file.name}" is too large (${formatBytes(file.size)}) — ${kind === 'video' ? 'videos max 50 MB' : kind === 'image' ? 'images max 25 MB' : 'files max 10 MB'}`);
          continue;
        }
        accepted.push(file);
      }
      return [...prev, ...accepted];
    });
  }, []);

  // Drag & drop onto the whole composer area.
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); setDragOver(false); };

  const insertMention = (participant) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = content.slice(0, cursorPos);
    const textAfter = content.slice(cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const mentionText = `@${participant.name} `;
    const newContent = textBefore.slice(0, atIndex) + mentionText + textAfter;
    setContent(newContent);
    setMentionQuery(null);

    setTimeout(() => {
      const newPos = atIndex + mentionText.length;
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
      textarea.focus();
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (showMentionDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => Math.min(prev + 1, filteredParticipants.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredParticipants[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e) => {
    const value = e.target.value;
    setContent(value);
    onTyping?.();

    const cursorPos = e.target.selectionStart;
    const textBefore = cursorPos > 0 ? value.slice(0, cursorPos) : '';
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex >= 0) {
      const charBeforeAt = atIndex > 0 ? textBefore[atIndex - 1] : ' ';
      const query = textBefore.slice(atIndex + 1);
      if ((charBeforeAt === ' ' || charBeforeAt === '\n' || atIndex === 0) && !/\s/.test(query)) {
        setMentionQuery(query);
      } else {
        setMentionQuery(null);
      }
    } else {
      setMentionQuery(null);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if ((!content.trim() && attachments.length === 0) || sending) return;

    setSending(true);
    const result = await onSend(content, isInternal, attachments.length > 0 ? attachments : undefined);
    setSending(false);

    if (result?.ok) {
      // Only clear on success — a failed send must keep the draft so the
      // user doesn't lose their message (with a toast explaining why).
      setContent('');
      setAttachments([]);
      setIsInternal(false);
      setMentionQuery(null);
      textareaRef.current?.focus();
    } else {
      toast.error(result?.error || 'Failed to send message — your draft is kept, try again');
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  if (archived) {
    return (
      <div className="px-4 py-3 border-t border-white/10 bg-white/5">
        <p className="text-sm tt-muted text-center">This conversation is archived and read-only</p>
      </div>
    );
  }

  return (
    <div
      className="px-4 py-3 border-t border-white/10 bg-white/5"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Drag-over hint */}
      {dragOver && (
        <div className="mb-2 rounded-lg border-2 border-dashed border-[color:var(--ui-violet)]/50 bg-[color:var(--ui-violet-strong)]/10 py-3 text-center text-xs text-[color:var(--ui-violet-hi)]">
          Drop files to attach
        </div>
      )}

      {/* Attachment chips with previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((file, i) => {
            const kind = kindOf(file);
            const preview = previews[file.name];
            return (
              <div key={`${file.name}-${i}`} className="relative group">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs">
                  {preview && kind === 'image' ? (
                    <img src={preview} alt="" className="w-9 h-9 rounded object-cover" />
                  ) : preview && kind === 'video' ? (
                    <video src={preview} className="w-9 h-9 rounded object-cover" muted />
                  ) : (
                    <div className="w-9 h-9 rounded bg-white/5 flex items-center justify-center">
                      {kind === 'doc' ? <FileText size={14} className="tt-muted" /> : <ImageIcon size={14} className="tt-muted" />}
                    </div>
                  )}
                  <div className="max-w-[110px]">
                    <p className="tt truncate">{file.name}</p>
                    <p className="text-[10px] tt-muted">{formatBytes(file.size)}</p>
                  </div>
                  <button onClick={() => removeAttachment(i)} className="text-white/40 hover:text-[color:var(--status-danger)] ml-1" aria-label={`Remove ${file.name}`}>
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress != null && (
        <div className="mb-2">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full bg-[color:var(--ui-violet-strong)]"
              animate={{ width: `${uploadProgress}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>
          <p className="text-[10px] tt-muted mt-1 text-right">{uploadProgress}%</p>
        </div>
      )}

      <div className="relative">
        <AnimatePresence>
          {showMentionDropdown && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-full left-0 mb-2 w-72 max-h-48 overflow-y-auto rounded-xl bg-[#1a1a2e]/95 border border-white/15 shadow-xl z-50 backdrop-blur-md"
            >
              {filteredParticipants.map((p, i) => (
                <button
                  key={p.user_id || p.id}
                  onClick={() => insertMention(p)}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2 transition-colors text-sm ${
                    i === mentionIndex ? 'bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)]' : 'hover:bg-white/5 tt'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-[color:var(--ui-violet-strong)]/20 flex items-center justify-center text-[10px] font-bold text-[color:var(--ui-violet-hi)] shrink-0">
                    {(p.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-[10px] tt-muted truncate">{p.email}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                // Clipboard paste of images (screenshot workflow).
                const files = Array.from(e.clipboardData?.files || []);
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              placeholder="Type a message... (@ to mention, paste or drop files)"
              rows={1}
              className="w-full px-4 py-2.5 pr-10 text-sm rounded-xl bg-white/5 border border-white/15 tt placeholder-white/30 focus:outline-none focus:border-[color:var(--ui-violet)]/50 resize-none min-h-[40px] max-h-[120px]"
              style={{ height: 'auto' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
          </div>

          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED}
              onChange={(e) => { addFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className="hidden"
            />

            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl hover:bg-white/10 transition-colors tt-muted hover:tt"
              title="Attach files"
            >
              <Paperclip size={16} />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsInternal(!isInternal)}
              className={`p-2.5 rounded-xl transition-colors ${isInternal ? 'bg-[color:var(--status-warning-strong)]/20 text-[color:var(--status-warning)]' : 'hover:bg-white/10 tt-muted hover:tt'}`}
              title="Internal note"
            >
              <Lock size={16} />
            </motion.button>

            <motion.button
              type="submit"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={(!content.trim() && attachments.length === 0) || sending}
              className="p-2.5 rounded-xl bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)] hover:bg-[color:var(--ui-violet-strong)]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={16} className={sending ? 'animate-pulse' : ''} />
            </motion.button>
          </div>
        </form>
      </div>
    </div>
  );
}
