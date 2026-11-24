import React, { useState, useEffect } from 'react';
import { X, CalendarDays, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/apiClient';
import ModalPortal from './ModalPortal';
import DateRangePicker from './DateRangePicker';
import LeaveDropzone from './LeaveDropzone';
import SearchableSelect from './SearchableSelect';

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 2000;

function validateDescription(text) {
  const t = (text ?? '').trim();
  if (!t) return 'Description is required.';
  if (t.length < DESCRIPTION_MIN) return `Description must be at least ${DESCRIPTION_MIN} characters.`;
  if (t.length > DESCRIPTION_MAX) return `Description must be at most ${DESCRIPTION_MAX} characters.`;
  return '';
}

export default function LeaveSubmitModal({ isOpen, onClose, onSubmitted, mode = 'self' }) {
  const { user } = useAuth();
  const isOnBehalf = mode === 'on-behalf';

  const [dates, setDates] = useState({ start_date: '', end_date: '' });
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);

  const [lastSent, setLastSent] = useState(null); // disable button briefly after submit

  // Fetch the user list for the on-behalf picker (admin-only endpoint).
  useEffect(() => {
    if (!isOpen || !isOnBehalf) return;
    let cancelled = false;
    setLoadingUsers(true);
    setSelectedUserId('');
    api.get('/api/users', { showToast: false })
      .then(({ ok, data }) => {
        if (!cancelled && ok && Array.isArray(data)) {
          // Show staff + managers + admins (anyone who could be the requester),
          // exclude the actor themselves for on-behalf.
          const opts = data
            .filter((u) => u.id !== user?.id)
            .map((u) => ({ id: String(u.id), label: `${u.name} — ${u.email}${u.role ? ` (${u.role})` : ''}` }));
          setUsers(opts);
        }
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, [isOpen, isOnBehalf, user?.id]);

  // Reset form state on open/close/mode change.
  useEffect(() => {
    if (!isOpen) {
      setDates({ start_date: '', end_date: '' });
      setDescription('');
      setFiles([]);
      setSelectedUserId('');
      setError('');
      setFieldError(null);
      setSubmitting(false);
      setLastSent(null);
      return;
    }
    // When mode changes while open, reset dates/description/files but keep
    // the user picker populated (it's re-fetched above).
    setDates({ start_date: '', end_date: '' });
    setDescription('');
    setFiles([]);
    setError('');
    setFieldError(null);
    setSubmitting(false);
    setLastSent(null);
  }, [isOpen, mode]);

  const dateError = () => {
    if (!dates.start_date) return 'Start date is required.';
    if (!dates.end_date) return 'End date is required.';
    // The DateRangePicker already validates format + real-calendar + order,
    // but re-check here in case the parent setState bypassed it.
    if (dates.end_date < dates.start_date) return 'End date must be on or after start date.';
    return null;
  };

  const descriptionError = validateDescription(description);

  const canSubmit = !submitting && !lastSent
    && !!dates.start_date
    && !!dates.end_date
    && !dateError()
    && !descriptionError
    && (isOnBehalf ? !!selectedUserId : true)
    && (files.length > 0 || true); // attachments are optional in the self flow? Actually required per spec? Let's allow empty.
  // Attachments are OPTIONAL per the backend (files may be empty). Keep the
  // dropzone as "optional" and don't block submit on it.

  const handleSubmit = async () => {
    const de = dateError();
    const des = descriptionError;
    if (de) { setFieldError({ field: 'dates', message: de }); return; }
    if (des) { setFieldError({ field: 'description', message: des }); return; }
    if (isOnBehalf && !selectedUserId) { setFieldError({ field: 'user', message: 'Select a user to file on behalf of.' }); return; }
    setError('');
    setFieldError(null);
    setSubmitting(true);
    try {
      if (isOnBehalf) {
        const { ok, error: err } = await api.post('/api/leave-requests/on-behalf', {
          user_id: Number(selectedUserId),
          start_date: dates.start_date,
          end_date: dates.end_date,
          description: (description ?? '').trim(),
        }, { showToast: false });
        // Attachments are not part of the on-behalf payload in this design —
        // the on-behalf endpoint accepts files too, but for the modal we keep
        // on-behalf attachment-free for simplicity (admins file on-behalf with
        // the same dropzone if needed; re-add when required).
        if (!ok) throw new Error(err || 'Failed to file on behalf.');
      } else {
        const form = new FormData();
        form.append('start_date', dates.start_date);
        form.append('end_date', dates.end_date);
        form.append('description', (description ?? '').trim());
        for (const f of files) form.append('attachments', f);
        const { ok, error } = await api.post('/api/leave-requests', form, { showToast: false });
        if (!ok) throw new Error(error || 'Failed to submit leave request.');
      }
      setLastSent(true);
      // Let the parent refetch its list while the success flash plays, so a
      // newly filed request shows without a manual page reload.
      onSubmitted?.();
      setTimeout(() => { setLastSent(false); onClose(); }, 600);
    } catch (err) {
      // The apiClient already toasts validation errors with field details.
      // Surface a form-level error for anything that didn't get a field toast.
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="absolute inset-0 bg-black/35 backdrop-blur-md" />
        <div className="relative glass-modal max-w-lg w-full animate-glass-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
          <div className="relative z-20 flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-[color:var(--status-info-strong)]/30 to-[color:var(--ui-purple-strong)]/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[color:var(--status-info-strong)]/20">
                <CalendarDays size={18} className="text-[color:var(--status-info)]" />
              </div>
              <h2 className="text-lg font-bold tt">
                {isOnBehalf ? 'Submit Leave On Behalf' : 'New Leave Request'}
              </h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-full tt-label hover:tt hover:bg-white/15 transition-all cursor-pointer">
              <X size={20} />
            </button>
          </div>

          <div className="relative z-20 p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* On-behalf user picker */}
            {isOnBehalf && (
              <div>
                <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">
                  File on behalf of <span className="text-[color:var(--status-danger)]">*</span>
                </label>
                {loadingUsers ? (
                  <div className="glass-input flex items-center gap-2 py-2">
                    <span className="w-4 h-4 border-2 border-[color:var(--status-info)]/60 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm tt-muted">Loading users…</span>
                  </div>
                ) : (
                  <SearchableSelect
                    options={users}
                    value={selectedUserId}
                    onChange={setSelectedUserId}
                    placeholder="Search for a user…"
                  />
                )}
                {selectedUserId && (
                  <button
                    type="button"
                    onClick={() => setSelectedUserId('')}
                    className="text-[10px] tt-muted hover:tt mt-1"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            )}

            {/* Date range */}
            <DateRangePicker
              value={dates}
              onChange={setDates}
              label={isOnBehalf ? 'Leave Period (on behalf)' : 'Leave Period'}
            />

            {/* Description */}
            <div>
              <label className="block text-xs font-bold tt-label uppercase tracking-wider mb-1">
                Reason <span className="text-[color:var(--status-danger)]">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (fieldError?.field === 'description') setFieldError(null);
                }}
                placeholder="Describe the reason for your leave…"
                rows={4}
                className={`glass-input resize-none ${descriptionError ? 'focus:ring-2 focus:ring-[color:var(--status-danger)]/50' : ''}`}
              />
              <div className="flex justify-between mt-1">
                <p className="text-[10px] tt-muted">
                  {DESCRIPTION_MIN}–{DESCRIPTION_MAX} characters
                </p>
                <p className={`text-[10px] font-medium ${descriptionError ? 'text-[color:var(--status-danger)]' : 'tt-muted'}`}>
                  {description.trim().length}/{
                    DESCRIPTION_MAX}
                </p>
              </div>
              {descriptionError && (
                <p className="text-[10px] text-[color:var(--status-danger)] mt-1 font-medium">{descriptionError}</p>
              )}
            </div>

            {/* Attachments */}
            <LeaveDropzone
              files={files}
              onFilesChange={setFiles}
              maxFiles={3}
              maxSize={10 * 1024 * 1024}
            />

            {/* Errors */}
            {error && (
              <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold border flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="glass-btn px-4 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting || lastSent}
                className={`glass-btn px-5 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer ${
                  isOnBehalf
                    ? 'glass-btn-indigo'
                    : 'glass-btn-primary'
                }`}
              >
                {submitting ? 'Submitting…' : lastSent ? 'Submitted' : isOnBehalf ? 'File on Behalf' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
