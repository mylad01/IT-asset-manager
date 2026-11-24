import React, { useState, useEffect, useCallback } from 'react';
import { Monitor, ArchiveRestore, Users, Activity, BarChart3, LifeBuoy, Server, RefreshCw, AlertCircle, PieChart } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import TicketKPIs from '../components/analytics/TicketKPIs';
import GlassRechartsTooltip from '../components/glass/GlassRechartsTooltip';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { ChartSkeleton, CardSkeleton } from '../components/loaders/SkeletonLoader';

const COLORS = ['rgba(96,165,250,0.7)', 'rgba(168,85,247,0.7)', 'rgba(52,211,153,0.7)', 'rgba(251,146,60,0.7)', 'rgba(236,72,153,0.7)'];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [ticketStats, setTicketStats] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { token } = useAuth();
  const { fetchData, isLoading, error } = useApi();

  const loadTelemetry = useCallback(async (isSilentRefresh = false) => {
    if (!token) return;
    if (!isSilentRefresh) setIsRefreshing(true);

    try {
      const [hardwareRes, ticketRes] = await Promise.all([
        fetchData('/api/dashboard/stats', {}, { showToast: !isSilentRefresh }),
        fetchData('/api/analytics/tickets', {}, { showToast: !isSilentRefresh })
      ]);

      if (hardwareRes && hardwareRes.success) setStats(hardwareRes.data);
      if (ticketRes && ticketRes.success) setTicketStats(ticketRes.data);
    } catch (err) {
      console.error('Telemetry fetch failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [token, fetchData]);

  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  if (isLoading || !stats) {
    return (
      <div className="space-y-8 pb-10">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h1 className="text-3xl font-bold tt text-glow">Studio Analytics Engine</h1>
            <p className="tt-label mt-1">Loading telemetry data...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[...Array(4)].map((_, i) => (<CardSkeleton key={i} />))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton /><ChartSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="glass-card p-6 max-w-md w-full">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 text-[color:var(--status-danger-hi)] shrink-0">
              <AlertCircle size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold tt">Failed to load dashboard</h3>
              <p className="tt-label mt-2 text-sm">{error.message || 'Something went wrong while loading dashboard data.'}</p>
              <button onClick={() => loadTelemetry(true)} className="glass-btn glass-btn-primary mt-4 text-xs px-4 py-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const kpiCards = [
    { icon: Monitor, label: 'Total Assets', value: stats?.kpis?.totalAssets || 0, color: 'from-[color:var(--status-info-strong)]/30 to-[color:var(--status-info-deep)]/20', iconColor: 'text-[color:var(--status-info-hi)]' },
    { icon: Activity, label: 'Active Deployed', value: stats?.kpis?.deployed || 0, color: 'from-[color:var(--status-success-strong)]/30 to-[color:var(--status-success-deep)]/20', iconColor: 'text-[color:var(--status-success-hi)]' },
    { icon: ArchiveRestore, label: 'In Storage', value: stats?.kpis?.storage || 0, color: 'from-[color:var(--status-warning-strong)]/30 to-[color:var(--status-warning-deep)]/20', iconColor: 'text-[color:var(--status-warning-hi)]' },
    { icon: Users, label: 'Total Staff', value: stats?.kpis?.users || 0, color: 'from-[color:var(--ui-purple-strong)]/30 to-[color:var(--ui-purple-deep)]/20', iconColor: 'text-[color:var(--ui-purple-hi)]' },
  ];

  return (
    <motion.div
      className="space-y-8 pb-10"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-3xl font-bold tt text-glow">Studio Analytics Engine</h1>
          <p className="tt-label mt-1">Live telemetry for IT service management and hardware allocation.</p>
        </div>
        <button
          onClick={() => loadTelemetry(true)}
          disabled={isRefreshing}
          className="glass-btn flex items-center gap-2 text-xs"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin text-[color:var(--status-info-hi)]" : ""} />
          {isRefreshing ? 'Polling...' : 'Sync Data'}
        </button>
      </motion.div>

      <motion.section variants={itemVariants}>
        <h2 className="text-lg font-bold tt mb-4 flex items-center gap-2">
          <LifeBuoy className="text-[color:var(--ui-indigo)]" size={20} /> Ticketing & Support Queue
        </h2>
        <TicketKPIs data={ticketStats} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <h2 className="text-lg font-bold tt mb-4 flex items-center gap-2 mt-4">
          <Server className="text-[color:var(--status-info)]" size={20} /> Hardware & Personnel Overview
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {kpiCards.map((card, i) => (
            <motion.div
              key={i}
              variants={itemVariants}
              whileHover={{ y: -2, transition: { duration: 0.2 } }}
              className="glass-card p-5 flex items-center gap-4"
            >
              <div className={`p-3 rounded-xl bg-gradient-to-br ${card.color}`}>
                <card.icon size={22} className={card.iconColor} />
              </div>
              <div>
                <p className="text-[10px] font-bold tt-muted uppercase tracking-widest">{card.label}</p>
                <h3 className="text-2xl font-black tt">{card.value}</h3>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div variants={itemVariants} className="glass-card p-6">
            <h2 className="text-lg font-bold tt mb-6 flex items-center gap-2">
              <PieChart size={20} className="text-[color:var(--status-info)]" /> Hardware Distribution
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={Array.isArray(stats?.charts?.byType) ? stats.charts.byType : []}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={800}
                    animationEasing="ease-out"
                  >
                    {Array.isArray(stats?.charts?.byType) && stats.charts.byType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<GlassRechartsTooltip />}
                    wrapperStyle={{ outline: 'none' }}
                  />
                </RePieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {Array.isArray(stats?.charts?.byType) && stats.charts.byType.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm tt-sec font-medium">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  {entry.name} ({entry.value})
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="glass-card p-6">
            <h2 className="text-lg font-bold tt mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-[color:var(--status-info)]" /> Assets by Department
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={Array.isArray(stats?.charts?.byDept) ? stats.charts.byDept : []}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-label)" }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-label)" }} />
                  <Tooltip
                    content={<GlassRechartsTooltip />}
                    wrapperStyle={{ outline: 'none' }}
                    cursor={{ fill: "var(--nav-hover)" }}
                  />
                  <Bar
                    dataKey="count"
                    fill="rgba(96,165,250,0.6)"
                    radius={[6, 6, 0, 0]}
                    animationDuration={800}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </motion.section>
    </motion.div>
  );
}
