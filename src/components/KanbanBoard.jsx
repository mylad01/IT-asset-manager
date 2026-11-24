import React, { useState, useRef, useCallback } from 'react';
import { Clock, ShieldCheck, AlertCircle, MessageSquare, GripVertical } from 'lucide-react';
import { formatId } from '../utils/formatId';
import ScrollArea from './glass/ScrollArea';

/**
 * KanbanBoard with glass-styled drag-and-drop visual feedback.
 *
 * Features:
 * - Dragged card gets lifted glass effect (scale, deep shadow, reduced opacity)
 * - Drop zone highlights with glowing glass border when card hovers
 * - Subtle placeholder pulse animation in empty columns
 * - Smooth CSS transitions on all state changes
 * - Prevents dropping onto the same column (no-op, no visual flash)
 */
export default function KanbanBoard({ tickets, onTicketDrop, onOpenModal }) {
  const columns = ['Submitted to Manager', 'Submitted to Helpdesk Administrator', 'In Progress', 'Waiting on User', 'Resolved'];

  // Track which ticket is being dragged and which column is the drop target
  const [draggedId, setDraggedId] = useState(null);
  const [hoveredCol, setHoveredCol] = useState(null);
  const dragRef = useRef(null);

  const handleDragStart = useCallback((e, ticketId) => {
    setDraggedId(ticketId);
    dragRef.current = ticketId;
    e.dataTransfer.setData('ticketId', ticketId);
    e.dataTransfer.effectAllowed = 'move';

    // Set a custom drag image: transparent 1px pixel so the browser default ghost is hidden,
    // and we render our own via CSS on the source element
    const ghost = document.createElement('div');
    ghost.style.width = '1px';
    ghost.style.height = '1px';
    ghost.style.opacity = '0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setHoveredCol(null);
    dragRef.current = null;
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((e, status) => {
    e.preventDefault();
    setHoveredCol(status);
  }, []);

  const handleDragLeave = useCallback((e, status) => {
    // Only clear if we're actually leaving the column, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setHoveredCol(prev => prev === status ? null : prev);
    }
  }, []);

  const handleDrop = useCallback((e, newStatus) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    setDraggedId(null);
    setHoveredCol(null);
    dragRef.current = null;
    if (ticketId) onTicketDrop(ticketId, newStatus);
  }, [onTicketDrop]);

  const columnColors = {
    'Submitted to Manager': { accent: 'blue', glow: 'rgba(59,130,246,0.30)' },
    'Submitted to Helpdesk Administrator': { accent: 'violet', glow: 'rgba(139,92,246,0.30)' },
    'In Progress': { accent: 'amber', glow: 'rgba(245,158,11,0.30)' },
    'Waiting on User': { accent: 'purple', glow: 'rgba(168,85,247,0.30)' },
    'Resolved': { accent: 'emerald', glow: 'rgba(16,185,129,0.30)' },
  };

  const columnCounts = {};
  columns.forEach(s => { columnCounts[s] = tickets.filter(t => t.status === s).length; });

  return (
    <ScrollArea className="h-[calc(100vh-220px)]" contentClassName="flex gap-4 pb-4 h-full">
      {columns.map(status => {
        const isHovered = hoveredCol === status;
        const colInfo = columnColors[status];
        const count = columnCounts[status];

        return (
          <div
            key={status}
            className={`flex-1 min-w-[260px] sm:min-w-[300px] flex flex-col rounded-2xl transition-all duration-300 ${
              isHovered
                ? 'border-2 border-dashed bg-white/[0.08]'
                : 'border-2 border-transparent bg-white/[0.03]'
            }`}
            style={isHovered ? {
              borderColor: colInfo.glow,
              boxShadow: `0 0 24px ${colInfo.glow}, inset 0 0 16px ${colInfo.glow.replace('0.30', '0.08')}`,
              background: `linear-gradient(135deg, ${colInfo.glow.replace('0.30', '0.06')}, rgba(255,255,255,0.04))`,
            } : {
              backdropFilter: 'blur(12px) saturate(150%)',
            }}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, status)}
            onDragLeave={(e) => handleDragLeave(e, status)}
            onDrop={(e) => handleDrop(e, status)}
          >
            {/* Column Header */}
            <div className={`p-3 border-b flex justify-between items-center shrink-0 rounded-t-2xl transition-all duration-300 ${
              isHovered ? 'bg-white/[0.08]' : 'bg-white/[0.04]'
            }`} style={{ borderColor: isHovered ? `${colInfo.glow.replace('0.30', '0.15')}` : 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: colInfo.glow.replace('0.30', '0.70') }} />
                <h3 className="font-bold tt-sec text-sm">{status}</h3>
              </div>
              <span className="glass-badge glass-badge-gray text-[10px] px-2 py-0.5">{count}</span>
            </div>

            {/* Cards Container */}
            <ScrollArea className="flex-1" contentClassName="p-3 space-y-2.5">
              {tickets.filter(t => t.status === status).length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-10 text-center rounded-xl border-2 border-dashed transition-all duration-300 ${
                  isHovered ? 'border-white/20 bg-white/[0.04]' : 'border-white/[0.06]'
                }`}>
                  <div className={`text-2xl mb-2 transition-all duration-300 ${isHovered ? 'scale-110 opacity-60' : 'opacity-20'}`}>
                    📋
                  </div>
                  <p className="text-xs tt-muted font-medium">
                    {isHovered ? 'Drop here' : 'No tickets'}
                  </p>
                </div>
              ) : (
                tickets.filter(t => t.status === status).sort((a, b) => a.id - b.id).map((ticket, i) => {
                  const isDragging = draggedId === ticket.id;

                  return (
                    <div
                      key={ticket.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, ticket.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => !isDragging && onOpenModal(ticket)}
                      className={`group relative rounded-2xl transition-all duration-200 ${
                        isDragging
                          ? 'opacity-40 scale-[0.97] rotate-[0.5deg] shadow-none'
                          : 'hover:translate-y-[-2px] hover:shadow-lg cursor-grab active:cursor-grabbing'
                      }`}
                      style={!isDragging ? {
                        background: 'var(--glass-bg)',
                        backdropFilter: 'blur(16px) saturate(180%)',
                        border: '1px solid var(--glass-border)',
                        boxShadow: 'var(--glass-shadow), var(--glass-highlight)',
                        borderRadius: '16px',
                      } : {}}
                    >
                      {/* Drag Handle Indicator */}
                      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity">
                        <GripVertical size={12} className="tt-muted" />
                      </div>

                      <div className="p-4">
                        {/* Ticket ID + Badges */}
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-bold tt-muted pl-4">{formatId(i + 1)}</span>
                          <div className="flex items-center gap-2">
                            {ticket.unread_count > 0 ? (
                              <span className="glass-badge glass-badge-red text-[10px] px-1.5 py-0.5">
                                <MessageSquare size={10} /> {ticket.unread_count}
                              </span>
                            ) : ticket.comment_count > 0 ? (
                              <span className="glass-badge glass-badge-gray text-[10px] px-1.5 py-0.5">
                                <MessageSquare size={10} />
                              </span>
                            ) : null}
                            {ticket.priority === 'Critical' && (
                              <AlertCircle size={14} className="text-[color:var(--status-danger)] animate-pulse" />
                            )}
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="font-bold tt text-sm mb-3 leading-snug group-hover:text-[color:var(--status-info-hi)] transition-colors pl-4">
                          {ticket.title}
                        </h4>

                        {/* Footer: Date + Assignee */}
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-white/5 pl-4">
                          <span className="flex items-center gap-1 text-[10px] font-bold tt-muted uppercase">
                            <Clock size={10}/> {new Date(ticket.created_at).toLocaleDateString()}
                          </span>
                          {ticket.admin_name && (
                            <span className="flex items-center gap-1 text-[10px] font-bold glass-badge glass-badge-purple px-1.5 py-0.5" title={`Assigned to ${ticket.admin_name}`}>
                              <ShieldCheck size={10}/> {ticket.admin_name.split(' ')[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </ScrollArea>
          </div>
        );
      })}
    </ScrollArea>
  );
}
