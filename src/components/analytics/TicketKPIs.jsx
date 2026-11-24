import React from 'react';
import { Activity, AlertTriangle, MessageCircle, CheckCircle2 } from 'lucide-react';

export default function TicketKPIs({ data }) {
  if (!data) return <div className="animate-pulse h-24 glass-subtle w-full"></div>;

  const resolvedCount = data.statusBreakdown?.find(s => s.status === 'Resolved')?.count || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      {[
        { label: 'Active Queue', value: data.activeTickets, icon: Activity, color: 'text-[color:var(--ui-indigo-hi)]', bg: 'from-[color:var(--ui-indigo-strong)]/25 to-[color:var(--ui-indigo-deep)]/15' },
        { label: 'Urgent Requests', value: data.urgentRequests, icon: AlertTriangle, color: 'text-[color:var(--status-danger-hi)]', bg: 'from-[color:var(--status-danger-strong)]/25 to-[color:var(--status-danger-deep)]/15', pulse: data.urgentRequests > 0 },
        { label: 'Unread Threads', value: data.unreadMessages, icon: MessageCircle, color: 'text-[color:var(--status-warning-hi)]', bg: 'from-[color:var(--status-warning-strong)]/25 to-[color:var(--status-warning-deep)]/15' },
        { label: 'Resolved Log', value: resolvedCount, icon: CheckCircle2, color: 'text-[color:var(--status-success-hi)]', bg: 'from-[color:var(--status-success-strong)]/25 to-[color:var(--status-success-deep)]/15' },
      ].map((card, i) => (
        <div key={i} className="glass-card p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tt-muted uppercase tracking-widest mb-1">{card.label}</p>
            <h3 className={`text-3xl font-black ${card.color}`}>{card.value}</h3>
          </div>
          <div className={`p-3 rounded-full bg-gradient-to-br ${card.bg} ${card.pulse ? 'animate-glow-pulse' : ''}`}>
            <card.icon size={24} className={card.color} />
          </div>
        </div>
      ))}
    </div>
  );
}
