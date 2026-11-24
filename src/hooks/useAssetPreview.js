import { useState, useCallback } from 'react';

/**
 * Manages open/close state for the AssetPreviewPanel.
 *
 * Usage:
 *   const { previewAssetId, openPreview, closePreview, isOpen } = useAssetPreview();
 *   // In table: <button onClick={() => openPreview(row.id)}>Preview</button>
 *   // Manual lookup: <button onClick={() => openPreview(null)}>Look Up</button>
 *   // In JSX: <AssetPreviewPanel assetId={previewAssetId} isOpen={isOpen} onClose={closePreview} />
 */
export function useAssetPreview() {
  const [previewAssetId, setPreviewAssetId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const openPreview = useCallback((id) => {
    setPreviewAssetId(id || null);
    setIsOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewAssetId(null);
    setIsOpen(false);
  }, []);

  return {
    previewAssetId,
    openPreview,
    closePreview,
    isOpen,
  };
}
