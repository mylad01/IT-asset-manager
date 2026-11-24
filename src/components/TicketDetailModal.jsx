import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Wrench, User, MessageSquare, Send, Lock, LifeBuoy, MessageCirclePlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import { formatId } from '../utils/formatId';
import ModalPortal from './ModalPortal';
import ScrollArea from './glass/ScrollArea';
import toast from 'react-hot-toast';

export default function TicketDetailModal({ isOpen, ticket, onClose, readOnlyStatus = false }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(ticket?.status || 'Submitted to Manager');
  const [assignedAdminId, setAssignedAdminId] = useState(ticket?.assigned_admin_id || '');
  const [admins, setAdmins] = useState([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [startingConvo, setStartingConvo] = useState(false);
  const { user } = useAuth();
  const isRootAdmin = user?.isRoot || user?.email === 'admin@studio.com';

  useEffect(() => {
    if (!isOpen || !ticket?.id) return;
    setStatus(ticket.status || 'Submitted to Manager');
    setAssignedAdminId(ticket.assigned_admin_id || '');
    setIsInternalNote(false);
    api.get(`/api/tickets/${ticket.id}/comments`, { showToast: false }).then(({ ok, data }) => { if (ok && Array.isArray(data)) setComments(data); });
    if (isRootAdmin) api.get('/api/users/admins', { showToast: false }).then(({ ok, data }) => { if (ok && Array.isArray(data)) setAdmins(data); });
  }, [isOpen, ticket, isRootAdmin]);

  if (!isOpen || !ticket) return null;

  const handleUpdate = async () => {
    setIsUpdating(true);
    let hasError = false;
    if (status !== ticket.status) {
      const { ok, error: err } = await api.put(`/api/tickets/${ticket.id}`, { status });
      if (!ok) { toast.error(err || 'Failed to update ticket status'); hasError = true; }
    }
    if (isRootAdmin && String(assignedAdminId) !== String(ticket.assigned_admin_id || '')) {
      const { ok, error: err } = await api.put(`/api/tickets/${ticket.id}/assign`, { assigned_admin_id: assignedAdminId });
      if (!ok) { toast.error(err || 'Failed to assign admin'); hasError = true; }
    }
    setIsUpdating(false);
    if (!hasError) {
      toast.success('Ticket updated');
      if (typeof onClose === 'function') onClose();
    }
  };

  const handleStartConversation = async () => {
    setStartingConvo(true);
    const { ok, data, error: err } = await api.post(`/api/conversations/ticket/${ticket.id}`, {}, { showToast: false });
    setStartingConvo(false);
    if (ok && data?.id) {
      toast.success('Conversation opened');
      onClose();
      navigate(`/conversations?c=${data.id}`);
    } else {
      toast.error(err || 'Failed to start conversation');
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    const { ok, error: err } = await api.post(`/api/tickets/${ticket.id}/comments`, { text: newComment, is_internal: isInternalNote });
    if (ok) {
      setNewComment('');
      setIsInternalNote(false);
      const { ok: fetchOk, data } = await api.get(`/api/tickets/${ticket.id}/comments`, { showToast: false });
      if (fetchOk && Array.isArray(data)) setComments(data);
    } else {
      toast.error(err || 'Failed to post comment');
    }
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
      <div className="relative glass-modal max-w-4xl w-full animate-glass-in flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 bg-gradient-to-r from-[color:var(--ui-indigo-strong)]/30 to-[color:var(--ui-purple-strong)]/20 p-5 flex items-center justify-between shrink-0 border-b border-white/10">
          <div className="flex items-center gap-3">
            {readOnlyStatus ? <LifeBuoy size={22} className="tt" /> : <Wrench size={22} className="tt" />}
            <div>
              <h2 className="text-lg font-bold tt">{readOnlyStatus ? 'Ticket Details' : 'Ticket Management'}</h2>
              <p className="tt-label text-sm mt-0.5">{formatId(ticket.id)} {ticket.admin_name ? `- ${ticket.admin_name}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user?.role === 'IT Admin' && (
              <button
                onClick={handleStartConversation}
                disabled={startingConvo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)] hover:bg-[color:var(--ui-violet-strong)]/30 transition-all cursor-pointer disabled:opacity-50"
                title="Open in Conversation Workspace"
              >
                <MessageCirclePlus size={14} />
                {startingConvo ? 'Opening...' : 'Open Conversation'}
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer"><X size={20} /></button>
          </div>
        </div>

        <div className="relative z-20 flex flex-col md:flex-row flex-1 overflow-hidden">
          <ScrollArea className="w-full md:w-5/12" contentClassName="p-6 bg-white/5 border-r border-white/10 space-y-4">
            <h3 className="text-xl font-black tt leading-tight mb-2">{ticket.title}</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="glass-badge glass-badge-blue">{ticket.category || 'General'}</span>
              <span className={`glass-badge ${ticket.priority === 'Critical' ? 'glass-badge-red' : 'glass-badge-gray'}`}>{ticket.priority || 'Medium'}</span>
            </div>
            <div className="glass-card p-4 tt-sec text-sm whitespace-pre-wrap">{ticket.description || 'No description.'}</div>
            <div className="glass-card p-3">
              <h4 className="text-[10px] font-bold tt-muted uppercase tracking-widest mb-1 flex items-center gap-1"><User size={12}/> Submitter</h4>
              <p className="font-bold tt text-sm">{ticket.user_name || 'Staff'}</p>
            </div>
          </ScrollArea>

          <div className="w-full md:w-7/12 flex flex-col">
            <div className="p-4 border-b border-white/10 flex items-center gap-2 text-sm font-bold tt-sec bg-white/5">
              <MessageSquare size={14} className="text-[color:var(--ui-indigo)]"/> Conversation
            </div>
            <ScrollArea className="flex-1" contentClassName="p-4 space-y-3 bg-white/[0.02]">
              {comments.length === 0 ? (
                <div className="text-center mt-10 space-y-3">
                  <p className="tt-muted text-sm italic">No messages yet.</p>
                  {user?.role === 'IT Admin' && (
                    <button
                      onClick={handleStartConversation}
                      disabled={startingConvo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[color:var(--ui-violet-strong)]/20 text-[color:var(--ui-violet-hi)] hover:bg-[color:var(--ui-violet-strong)]/30 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <MessageCirclePlus size={14} />
                      {startingConvo ? 'Opening...' : 'Start Conversation'}
                    </button>
                  )}
                </div>
              ) : comments.map(c => (
                <div key={c.id || Math.random()} className={`flex flex-col ${c.author_role === 'IT Admin' ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] tt-muted mb-1 font-medium">
                    {c.author_name} {c.is_internal === 1 ? '(Internal)' : ''}
                  </span>
                  <div className={`p-3 rounded-xl max-w-[85%] text-sm border ${
                    c.is_internal === 1 ? 'bg-[color:var(--status-warning-strong)]/15 border-[color:var(--status-warning)]/20 text-[color:var(--status-warning-hi)] rounded-tr-none' :
                    c.author_role === 'IT Admin' ? 'bg-[color:var(--ui-indigo-strong)]/25 border-[color:var(--ui-indigo)]/25 tt rounded-tr-none' :
                    'bg-white/10 border-white/10 tt rounded-tl-none'
                  }`}>{c.text}</div>
                </div>
              ))}
            </ScrollArea>
            <div className="p-4 border-t border-white/10 bg-white/5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) handlePostComment(); }}
                  placeholder={isInternalNote ? "Private note..." : "Type a reply..."}
                  className={`glass-input flex-1 ${isInternalNote ? 'border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning-strong)]/10' : ''}`}
                />
                <button onClick={handlePostComment} disabled={!newComment.trim()} className="glass-btn glass-btn-indigo p-2 rounded-xl disabled:opacity-50 cursor-pointer">
                  <Send size={16} />
                </button>
              </div>
              {isRootAdmin && (
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input type="checkbox" checked={isInternalNote} onChange={e => setIsInternalNote(e.target.checked)} className="rounded" />
                  <span className="text-[10px] font-bold tt-muted flex items-center gap-1"><Lock size={10}/> Private Note</span>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="relative z-20 p-4 border-t border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            {!readOnlyStatus && (
              <>
                <select value={status} onChange={e => setStatus(e.target.value)} className="glass-select text-xs py-1.5 w-44">
                  <option>Submitted to Manager</option><option>Submitted to Helpdesk Administrator</option><option>In Progress</option><option>Waiting on User</option><option>Resolved</option>
                </select>
                {isRootAdmin && (
                  <select value={assignedAdminId} onChange={e => setAssignedAdminId(e.target.value)} className="glass-select text-xs py-1.5 w-36">
                    <option value="">Unassigned</option>
                    {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </>
            )}
            {readOnlyStatus && <span className="text-sm tt-muted">Status: <span className="glass-badge glass-badge-gray">{ticket.status}</span></span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="glass-btn px-4 py-2 text-xs">Close</button>
            {!readOnlyStatus && (
              <button onClick={handleUpdate} disabled={isUpdating} className="glass-btn glass-btn-primary px-5 py-2 text-xs disabled:opacity-50 cursor-pointer">
                {isUpdating ? 'Saving...' : 'Save & Dispatch'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
