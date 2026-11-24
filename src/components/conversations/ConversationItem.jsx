import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Ticket, MessageSquare } from 'lucide-react';

// forwardRef so keyboard navigation can querySelector for the highlighted row.
const ConversationItem = forwardRef(function ConversationItem(
  { conversation, selected, highlighted, onClick, archived },
  ref
) {
  const { title, last_message, unread_count, type, updated_at } = conversation;

  const timeAgo = formatTimeAgo(updated_at);

  return (
    <motion.button
      ref={ref}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      data-kbd-nav={highlighted ? 'true' : undefined}
      className={`
        w-full text-left p-3 rounded-xl mb-1 transition-all
        ${selected
          ? 'bg-[color:var(--ui-violet-strong)]/20 border border-[color:var(--ui-violet)]/30'
          : 'hover:bg-white/5 border border-transparent'
        }
        ${highlighted
          ? 'ring-2 ring-[color:var(--ui-violet)]/60 bg-[color:var(--ui-violet-strong)]/10'
          : ''
        }
        ${archived ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`
          p-2 rounded-lg shrink-0
          ${type === 'ticket-linked' ? 'bg-[color:var(--status-warning-strong)]/15' : 'bg-[color:var(--ui-violet-strong)]/15'}
        `}>
          {type === 'ticket-linked' ? (
            <Ticket size={14} className="text-[color:var(--status-warning)]" />
          ) : (
            <MessageSquare size={14} className="text-[color:var(--ui-violet)]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm tt truncate">{title}</span>
            {unread_count > 0 && (
              <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[color:var(--ui-violet-strong)] text-white text-[10px] font-bold flex items-center justify-center">
                {unread_count}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 mt-1">
            <p className="text-xs tt-muted truncate">
              {last_message || 'No messages yet'}
            </p>
            <span className="text-[10px] tt-muted shrink-0">{timeAgo}</span>
          </div>
        </div>
      </div>
    </motion.button>
  );
});

export default ConversationItem;

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}
