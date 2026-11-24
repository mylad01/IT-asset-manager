import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, FileImage, FileText, File, AlertCircle } from 'lucide-react';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const MIME_LABEL = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'application/pdf': 'PDF',
};

export default function LeaveDropzone({
  files = [],
  onFilesChange,
  maxFiles = 3,
  maxSize = 10 * 1024 * 1024,
  disabled = false,
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileLabel = (file) => {
    if (file.type === 'application/pdf') return <FileText size={14} className="text-[color:var(--status-danger)]" />;
    if (file.type.startsWith('image/')) return <FileImage size={14} className="text-[color:var(--status-info)]" />;
    return <File size={14} className="text-[color:var(--ui-neutral)]" />;
  };

  const validateFile = useCallback((file) => {
    if (!ALLOWED_MIME.has(file.type)) return 'Unsupported file type. Allowed: JPG, PNG, WebP, GIF, PDF.';
    if (file.size > maxSize) return `File too large — max ${formatSize(maxSize)} each.`;
    return '';
  }, [maxSize]);

  const addFiles = useCallback((added) => {
    const existing = files.slice();
    const next = [];
    const errs = [];

    for (const file of added) {
      const err = validateFile(file);
      if (err) { errs.push({ file, error: err }); continue; }
      if (next.length >= maxFiles) { errs.push({ file, error: `Too many attachments (max ${maxFiles}).` }); continue; }
      if (existing.some(e => e.name === file.name && e.size === file.size && e.type === file.type)) continue;
      next.push(file);
    }

    if (errs.length) {
      onFilesChange([...existing, ...next]);
      return errs;
    }
    onFilesChange([...existing, ...next]);
    return [];
  }, [files, maxFiles, onFilesChange, validateFile]);

  const removeFile = useCallback((idx) => {
    onFilesChange(files.filter((_, i) => i !== idx));
  }, [files, onFilesChange]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (disabled) return;
    setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const added = Array.from(e.dataTransfer.files || []);
    addFiles(added);
  }, [disabled, addFiles]);

  const handleInputChange = useCallback((e) => {
    const added = Array.from(e.target.files || []);
    addFiles(added);
    if (inputRef.current) inputRef.current.value = '';
  }, [addFiles]);

  const remaining = maxFiles - files.length;
  const canAcceptMore = remaining > 0 && !disabled;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold tt-label uppercase tracking-wider">Attachments <span className="text-[color:var(--status-danger)]">*</span></label>
        <span className="text-[10px] tt-muted">Up to {maxFiles} files, {maxSize === 10 * 1024 * 1024 ? '10 MB' : maxSize} each · JPG, PNG, WebP, GIF, PDF</span>
      </div>

      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          disabled
            ? 'border-white/10 bg-white/[0.02] cursor-not-allowed'
            : dragOver
              ? 'border-[color:var(--status-info-strong)] bg-[color:var(--status-info-strong)]/10'
              : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={disabled ? undefined : () => inputRef.current?.click()}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={disabled ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        aria-label={disabled ? undefined : 'Drop leave attachments here, or click to browse'}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.gif,.pdf"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
          aria-hidden="true"
        />
        <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-3 ${disabled ? 'bg-white/5' : 'bg-[color:var(--status-info)]/20'}`}>
          {disabled ? <Upload size={20} className="text-white/20" /> : <Upload size={20} className="text-[color:var(--status-info)]" />}
        </div>
        <p className="text-sm font-semibold tt">{dragOver ? 'Drop files here' : canAcceptMore ? 'Drop files here, or click to browse' : 'Attachment limit reached'}</p>
        <p className="text-xs tt-muted mt-1">Supported: JPG, PNG, WebP, GIF, PDF · max {maxFiles} files</p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, idx) => {
            const err = validateFile(file);
            return (
              <li key={idx} className={`flex items-center gap-3 p-3 rounded-xl border ${err ? 'border-[color:var(--status-danger)]/40 bg-[color:var(--status-danger)]/5' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="shrink-0">{getFileLabel(file)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium tt truncate">{file.name}</p>
                  <p className="text-[10px] tt-muted">{formatSize(file.size)} · {MIME_LABEL[file.type] || file.type}</p>
                </div>
                {err && <div className="shrink-0"><AlertCircle size={14} className="text-[color:var(--status-danger)]" /></div>}
                {!err && (
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="p-1.5 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {files.length > 0 && remaining > 0 && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full text-xs tt-muted hover:tt-sec transition-colors cursor-pointer py-2 rounded-lg border border-dashed border-white/10 hover:border-white/20 disabled:opacity-40"
        >
          + Add another file
        </button>
      )}

      {files.length === 0 && !disabled && (
        <p className="text-[10px] tt-muted italic">Optional — attach supporting docs (photos, PDFs) up to {maxFiles} files.</p>
      )}
    </div>
  );
}
