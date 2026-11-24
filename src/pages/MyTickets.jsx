import React, { useState, useEffect } from 'react';
import DataTable from '../components/DataTable';
import CreateTicketModal from '../components/CreateTicketModal';
import TicketDetailModal from '../components/TicketDetailModal';
import { LifeBuoy, AlertCircle, Clock, MessageSquare, RefreshCw } from 'lucide-react';
import { formatId } from '../utils/formatId';
import { useAuth } from '../context/AuthContext';
import { useHighlight } from '../hooks/useHighlight';
import api from '../utils/apiClient';
import { TableSkeleton } from '../components/loaders/SkeletonLoader';

export default function MyTickets() {
  const [tickets, setTickets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const { token } = useAuth();
  const { highlightedId } = useHighlight();

  const fetchTickets = async () => {
    setIsLoading(true);
    setError('');
    const { ok, data, error: err } = await api.get('/api/tickets/my-tickets');
    if (ok && Array.isArray(data)) {
      setTickets(data);
    } else {
      setTickets([]);
      setError(err || 'Failed to load tickets');
    }
    setIsLoading(false);
  };

  useEffect(() => { if (token) fetchTickets(); }, [token]);

  useEffect(() => {
    if (highlightedId && tickets.length > 0) {
      const ticket = tickets.find(t => String(t.id) === String(highlightedId));
      if (ticket) {
        setSelectedTicket(ticket);
      }
    }
  }, [highlightedId, tickets]);

  const handleOpenModal = (ticketData, event) => { if (event) { event.preventDefault(); event.stopPropagation(); } setSelectedTicket(ticketData); };

  const statusColors = { 'Submitted to Manager': 'glass-badge-blue', 'Submitted to Helpdesk Administrator': 'glass-badge-purple', 'In Progress': 'glass-badge-orange', 'Waiting on User': 'glass-badge-amber', 'Resolved': 'glass-badge-green' };

  const columns = [
    { header: 'Ticket ID', accessor: 'id', render: (row, i) => <span className="font-bold tt-label">{formatId(i + 1)}</span> },
    { header: 'Status', accessor: 'status', render: (row) => <span className={`glass-badge ${statusColors[row.status] || 'glass-badge-gray'}`}>{row.status}</span> },
    { header: 'Priority', accessor: 'priority', render: (row) => <span className={`flex items-center gap-1 font-bold text-xs ${row.priority === 'Critical' ? 'text-[color:var(--status-danger)]' : 'tt-sec'}`}>{row.priority === 'Critical' && <AlertCircle size={12} />} {row.priority}</span> },
    { header: 'Summary', accessor: 'title', render: (row) => (<div className="flex items-center gap-2"><span className="font-bold tt">{row.title}</span>{row.unread_count > 0 ? (<span className="glass-badge glass-badge-red text-[10px] px-1.5 py-0.5"><MessageSquare size={10} /> {row.unread_count}</span>) : null}</div>) },
    { header: 'Submitted', accessor: 'created_at', render: (row) => <span className="text-sm tt-muted flex items-center gap-1"><Clock size={12}/> {new Date(row.created_at).toLocaleDateString()}</span> },
    { header: 'Action', render: (row) => (<button type="button" onClick={(e) => handleOpenModal(row, e)} className="glass-btn glass-btn-indigo text-[11px] px-3 py-1.5 cursor-pointer">View Details</button>) }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-white/10 pb-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-[color:var(--ui-indigo-strong)]/30 to-[color:var(--ui-purple-strong)]/20"><LifeBuoy size={28} className="text-[color:var(--ui-indigo-hi)]" /></div>
          <div><h1 className="text-3xl font-bold tt text-glow">Support Tickets</h1><p className="tt-label mt-1">Submit and track your requests for IT support.</p></div>
        </div>
        <button type="button" onClick={() => setIsCreateOpen(true)} className="glass-btn glass-btn-indigo px-4 py-2 text-xs cursor-pointer">+ New Ticket</button>
      </div>
      {isLoading ? <TableSkeleton rows={5} columns={5} /> : error ? (
        <div className="glass-card p-6"><div className="flex items-start gap-4"><div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)]"><AlertCircle size={24} /></div><div><h3 className="text-lg font-bold tt">Failed to load tickets</h3><p className="tt-label mt-2 text-sm">{error}</p><button onClick={fetchTickets} className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2"><RefreshCw size={14} /> Retry</button></div></div></div>
      ) : (
        <div className="glass-card p-2">
          <DataTable columns={columns} data={tickets} searchPlaceholder="Search your tickets..." highlightId={highlightedId} sortBy="id" />
        </div>
      )}
      <CreateTicketModal isOpen={isCreateOpen} onClose={() => { setIsCreateOpen(false); fetchTickets(); }} />
      {selectedTicket && (<TicketDetailModal isOpen={true} ticket={selectedTicket} onClose={() => { setSelectedTicket(null); fetchTickets(); }} readOnlyStatus={true} />)}
    </div>
  );
}
