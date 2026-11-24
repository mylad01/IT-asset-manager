import React, { useState, useEffect } from 'react';
import { Scan, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useApi } from '../hooks/useApi';

export default function ScanStation() {
  const { fetchData, isLoading } = useApi();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadUsers = async () => {
      const result = await fetchData('/api/users', {}, { showToast: false });
      if (result && result.success) {
        setUsers(Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []));
      } else if (Array.isArray(result)) {
        setUsers(result);
      } else {
        setUsers([]);
      }
    };
    loadUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- fetchData from useApi re-creates every render

  const handleScan = async (e) => {
    e.preventDefault();
    setError('');
    setScanResult(null);

    if (!selectedUser) { setError('Please select a user/technician before scanning.'); return; }
    if (!assetTag.trim()) { setError('Please enter or scan an asset tag.'); return; }

    try {
      const result = await fetchData('/api/kits/deploy', {
        method: 'POST',
        body: { assetTag, userId: selectedUser }
      }, { successMessage: 'Asset scanned and assigned successfully!' });

      if (result && result.success) {
        setScanResult('Asset successfully processed!');
        setAssetTag('');
      } else {
        setError(result?.error?.message || 'Failed to process scan.');
      }
    } catch (err) {
      setError(err.message || 'Network error during scan.');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center space-x-3 border-b border-white/10 pb-4">
        <div className="p-2 rounded-xl bg-gradient-to-br from-[color:var(--status-success-strong)]/30 to-[color:var(--ui-cyan-strong)]/20">
          <Scan className="text-[color:var(--status-success-hi)]" size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tt text-glow">Asset Scan Station</h1>
          <p className="tt-label text-sm mt-0.5">Quick scan and deploy hardware to staff</p>
        </div>
      </div>

      {error && (
        <div className="glass-card border-l-4 border-[color:var(--status-danger-strong)]/50 p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-[color:var(--status-danger-hi)] shrink-0" />
          <span className="text-[color:var(--status-danger-hi)] text-sm font-medium">{error}</span>
        </div>
      )}

      {scanResult && (
        <div className="glass-card border-l-4 border-[color:var(--status-success-strong)]/50 p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-[color:var(--status-success-hi)] shrink-0" />
          <span className="text-[color:var(--status-success-hi)] text-sm font-medium">{scanResult}</span>
        </div>
      )}

      <form onSubmit={handleScan} className="glass-card p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1.5">Select Technician / User</label>
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="glass-select"
          >
            <option value="">-- Choose User --</option>
            {Array.isArray(users) && users.map((user) => (
              <option key={user.id || user._id} value={user.id || user._id}>
                {user.name || user.username}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1.5">Asset Tag / Barcode</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
              placeholder="Scan or type asset tag..."
              className="glass-input flex-1"
              autoFocus
            />
            <button type="submit" disabled={isLoading} className="glass-btn glass-btn-primary flex items-center gap-2 px-5">
              {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <Scan size={16} />}
              <span>Process Scan</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
