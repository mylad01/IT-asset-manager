// MediaGallery.jsx — renders a message's attachments as a modern mini-grid.
//
// 1 attachment → full-width card; 2 → two-up; 3+ → 2-column grid. All media
// items in the message are registered with the chat-level lightbox context
// so arrow-key navigation flows across messages.

import React from 'react';
import AttachmentCard from './AttachmentCard';

export default function MediaGallery({ attachments, onOpenMedia }) {
  if (!attachments?.length) return null;
  const count = attachments.length;

  if (count === 1) {
    return (
      <div className="mt-2">
        <AttachmentCard attachment={attachments[0]} onOpenMedia={onOpenMedia} />
      </div>
    );
  }

  return (
    <div className={`mt-2 grid gap-1.5 ${count === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
      {attachments.map((att) => (
        <AttachmentCard key={att.id} attachment={att} onOpenMedia={onOpenMedia} size="grid" />
      ))}
    </div>
  );
}
