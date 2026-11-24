import React, { useState, useEffect, useCallback } from 'react';
import DataTable from '../components/DataTable';
import KanbanBoard from '../components/KanbanBoard';
import TicketDetailModal from '../components/TicketDetailModal';
import DispatchModal from '../components/DispatchModal';
import { Wrench, AlertCircle, Clock, ShieldCheck, Columns, List, Activity, ArchiveRestore, MessageSquare, Eye, Send } from 'lucide-react';
import { formatId } from '../utils/formatId';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import AssetPreviewPanel from '../components/AssetPreviewPanel';
import { useAssetPreview } from '../hooks/useAssetPreview';
import { useHighlight } from '../hooks/useHighlight';
import toast from 'react-hot-toast';

export default function Helpdesk() {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [dispatchTicket, setDispatchTicket] = useState(null);
  const [viewFormat, setViewFormat] = useState('Kanban');
  const [viewMode, setViewMode] = useState('Active');
  const { previewAssetId, openPreview, closePreview, isOpen: isPreviewOpen } = useAssetPreview();
  const { user } = useAuth();
  const { highlightedId } = useHighlight();

  const fetchGlobalTickets = useCallback(async () => {
    const { ok, data } = await api.get('/api/tickets', { showToast: false });
    setTickets(ok && Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { fetchGlobalTickets(); }, [fetchGlobalTickets]);

  useEffect(() => {
    if (highlightedId && tickets.length > 0) {
      const ticket = tickets.find(t => String(t.id) === String(highlightedId));
      if (ticket) {
        setSelectedTicket(ticket);
      }
    }
  }, [highlightedId, tickets]);

  const isRootAdmin = user?.isRoot || user?.email === 'admin@studio.com';
  const filteredTickets = tickets.filter(ticket => viewMode === 'Active' ? ticket.status !== 'Resolved' : ticket.status === 'Resolved');

  const handleKanbanDrop = async (ticketId, newStatus) => {
    const { ok, error: err } = await api.put(`/api/tickets/${ticketId}`, { status: newStatus });
    if (ok) {
      toast.success('Ticket status updated');
      fetchGlobalTickets();
    } else {
      toast.error(err || 'Failed to update ticket status');
    }
  };

  const handleOpenModal = (ticketData, event) => { if (event) { event.preventDefault(); event.stopPropagation(); } setSelectedTicket(ticketData); };

  const statusColors = { 'Submitted to Manager': 'glass-badge-blue', 'Submitted to Helpdesk Administrator': 'glass-badge-purple', 'In Progress': 'glass-badge-orange', 'Waiting on User': 'glass-badge-amber', 'Resolved': 'glass-badge-green' };

  const columns = [
    { header: 'ID', accessor: 'id', render: (row, i) => <span className="font-bold tt-label">{formatId(i + 1)}</span> },
    { header: 'Status', accessor: 'status', render: (row) => <span className={`glass-badge ${statusColors[row.status] || 'glass-badge-gray'}`}>{row.status}</span> },
    { header: 'Priority', accessor: 'priority', render: (row) => <span className={`flex items-center gap-1 font-bold text-xs ${row.priority === 'Critical' ? 'text-[color:var(--status-danger)]' : 'tt-sec'}`}>{row.priority === 'Critical' && <AlertCircle size={12} />} {row.priority}</span> },
    { header: 'Submitted By', accessor: 'user_name', render: (row) => <span className="font-bold tt">{row.user_name}</span> },
    { header: 'Assigned Admin', accessor: 'admin_name', render: (row) => row.admin_name ? <span className="glass-badge glass-badge-purple"><ShieldCheck size={10}/> {row.admin_name}</span> : <span className="glass-badge glass-badge-amber">Unassigned</span> },
    { header: 'Summary', accessor: 'title', render: (row) => (<div className="flex items-center gap-2"><span className="font-medium tt">{row.title}</span>{row.unread_count > 0 ? (<span className="glass-badge glass-badge-red text-[10px] px-1.5 py-0.5"><MessageSquare size={10} /> {row.unread_count}</span>) : row.comment_count > 0 ? (<span className="glass-badge glass-badge-gray text-[10px] px-1.5 py-0.5"><MessageSquare size={10} /></span>) : null}</div>) },
    { header: 'Submitted', accessor: 'created_at', render: (row) => <span className="text-sm tt-muted flex items-center gap-1"><Clock size={12}/> {new Date(row.created_at).toLocaleString()}</span> },
    { header: 'Action', render: (row) => (
      <div className="flex items-center gap-1.5">
        {isRootAdmin && (
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDispatchTicket(row); }} className="glass-btn text-[11px] px-3 py-1.5 cursor-pointer flex items-center gap-1 bg-[color:var(--ui-violet-strong)]/15 border-[color:var(--ui-violet)]/25 text-[color:var(--ui-violet-hi)] hover:bg-[color:var(--ui-violet-strong)]/25 transition-all">
            <Send size={11} /> Dispatch
          </button>
        )}
        <button type="button" onClick={(e) => handleOpenModal(row, e)} className="glass-btn glass-btn-indigo text-[11px] px-3 py-1.5 cursor-pointer">Manage</button>
      </div>
    ) }
  ];

  const ToggleBtn = ({ active, onClick, icon: Icon, label }) => (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${active ? `bg-white/15 tt border border-white/15` : 'tt-muted hover:tt-sec'}`}><Icon size={14} /> {label}</button>
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-white/10 pb-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[color:var(--ui-indigo-strong)]/30 to-[color:var(--ui-purple-strong)]/20"><Wrench size={24} className="text-[color:var(--ui-indigo-hi)]" /></div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tt text-glow">IT Helpdesk Dispatcher</h1>
              <p className="tt-label mt-0.5 text-xs sm:text-sm">{isRootAdmin ? 'Global Dispatcher Console.' : 'Your Assigned Tickets Queue.'}</p>
            </div>
          </div>
          <button onClick={() => openPreview(null)} className="glass-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold cursor-pointer self-start sm:self-auto"><Eye size={14} /> Asset Lookup</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 gap-1">
            <ToggleBtn active={viewMode === 'Active'} onClick={() => setViewMode('Active')} icon={Activity} label="Active" />
            <ToggleBtn active={viewMode === 'Archived'} onClick={() => setViewMode('Archived')} icon={ArchiveRestore} label="Resolved" />
          </div>
          {viewMode === 'Active' && (
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 gap-1">
              <ToggleBtn active={viewFormat === 'Kanban'} onClick={() => setViewFormat('Kanban')} icon={Columns} label="Board" />
              <ToggleBtn active={viewFormat === 'Table'} onClick={() => setViewFormat('Table')} icon={List} label="Table" />
            </div>
          )}
        </div>
      </div>

      {viewFormat === 'Kanban' && viewMode === 'Active' ? (
        <KanbanBoard tickets={filteredTickets} onTicketDrop={handleKanbanDrop} onOpenModal={(ticket) => handleOpenModal(ticket)} />
      ) : (
        <div className="glass-card p-2">
          <DataTable columns={columns} data={filteredTickets} searchPlaceholder="Search tickets by user, ID, or summary..." highlightId={highlightedId} sortBy="id" />
        </div>
      )}

      <AssetPreviewPanel assetId={previewAssetId} isOpen={isPreviewOpen} onClose={closePreview} />
      {selectedTicket && (<TicketDetailModal isOpen={true} ticket={selectedTicket} onClose={() => { setSelectedTicket(null); fetchGlobalTickets(); }} />)}
      {dispatchTicket && (<DispatchModal isOpen={true} ticket={dispatchTicket} onClose={() => setDispatchTicket(null)} onDispatched={fetchGlobalTickets} />)}
    </div>
  );
}
