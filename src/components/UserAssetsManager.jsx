import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import toast from 'react-hot-toast';

export default function UserAssetsManager({ userId, deptId, onUpdate }) {
  const [assignedAssets, setAssignedAssets] = useState([]);
  const [unassignedAssets, setUnassignedAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (userId) { fetchAssets(); }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- fetchAssets re-creates every render

  const fetchAssets = async () => {
    const [allRes, unassignedRes] = await Promise.all([
      api.get('/api/assets', { showToast: false }),
      api.get('/api/assets/unassigned', { showToast: false }),
    ]);
    const safeAllData = allRes.ok && Array.isArray(allRes.data) ? allRes.data : [];
    setAssignedAssets(safeAllData.filter(asset => asset.assigned_to_user_id === userId));
    const safeUnassigned = unassignedRes.ok && Array.isArray(unassignedRes.data) ? unassignedRes.data : [];
    setUnassignedAssets(safeUnassigned);
    if (safeUnassigned.length > 0) setSelectedAssetId(safeUnassigned[0].id);
    else setSelectedAssetId('');
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!selectedAssetId) return;
    setIsSubmitting(true);
    const { ok, error: err } = await api.put(`/api/assets/${selectedAssetId}/assign`, { user_id: userId, dept_id: deptId });
    setIsSubmitting(false);
    if (ok) {
      toast.success('Asset assigned');
      fetchAssets();
      if (onUpdate) onUpdate();
    } else {
      toast.error(err || 'Failed to assign asset');
    }
  };

  const handleUnassign = async (assetId) => {
    setIsSubmitting(true);
    const { ok, error: err } = await api.put(`/api/assets/${assetId}/unassign`);
    setIsSubmitting(false);
    if (ok) {
      toast.success('Asset returned to storage');
      fetchAssets();
      if (onUpdate) onUpdate();
    } else {
      toast.error(err || 'Failed to return asset');
    }
  };

  if (!userId) {
    return <div className="tt-muted text-center py-12 italic">Select a user to view and manage their assigned properties.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold tt mb-2">Check Out Property</h3>
        {unassignedAssets.length === 0 ? (
          <p className="text-sm tt-muted italic">No equipment is currently available in storage.</p>
        ) : (
          <form onSubmit={handleAssign} className="flex gap-2">
            <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} className="glass-select flex-grow">
              {unassignedAssets.map(asset => (
                <option key={asset.id} value={asset.id}>{asset.id} - {asset.model} ({asset.type})</option>
              ))}
            </select>
            <button type="submit" disabled={isSubmitting || !selectedAssetId} className="glass-btn glass-btn-primary px-4 py-2 text-xs disabled:opacity-50">
              {isSubmitting ? 'Assigning...' : 'Check Out'}
            </button>
          </form>
        )}
      </div>

      <div className="border-t border-white/10 pt-4">
        <h3 className="text-lg font-bold tt mb-3">Assigned Gear</h3>
        {assignedAssets.length === 0 ? (
          <p className="text-sm tt-muted italic">No assets are currently assigned to this user.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {assignedAssets.map(asset => (
              <div key={asset.id} className="flex justify-between items-center p-3 glass-card text-sm">
                <div>
                  <div className="font-bold tt">{asset.id}</div>
                  <div className="tt-muted text-xs">{asset.model} ({asset.type})</div>
                </div>
                <button type="button" onClick={() => handleUnassign(asset.id)} disabled={isSubmitting} className="glass-btn glass-btn-danger px-3 py-1 text-xs disabled:opacity-50">
                  Return to Storage
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
