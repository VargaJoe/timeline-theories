import React, { useState, useCallback } from 'react';
import { MediaUpdateService } from '../services/mediaUpdateService';
import type { UpdateOptions, MediaUpdateResult } from '../services/mediaUpdateService';
import type { MediaItem } from '../services/mediaLibraryService';

interface BulkUpdateDialogProps {
  mediaItems: MediaItem[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateComplete: (updatedCount: number) => void;
}

export const BulkUpdateDialog: React.FC<BulkUpdateDialogProps> = ({
  mediaItems,
  isOpen,
  onClose,
  onUpdateComplete
}) => {
  const [step, setStep] = useState<'options' | 'preview' | 'processing' | 'results'>('options');
  const [options, setOptions] = useState<UpdateOptions>({
    updateTitles: true,
    updateDescriptions: true,
    updateCoverImages: true,
    onlyMissing: true
  });
  const [previewResults, setPreviewResults] = useState<MediaUpdateResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, item: '' });
  const [finalResults, setFinalResults] = useState<{ success: number; failed: number; errors: string[] }>({
    success: 0,
    failed: 0,
    errors: []
  });

  const handleOptionsSubmit = useCallback(async () => {
    setStep('preview');
    setProcessing(true);
    
    try {
      const results = await MediaUpdateService.processBulkUpdate(
        mediaItems,
        options,
        (current, total, item) => {
          setProgress({ current, total, item: item.DisplayName });
        }
      );
      setPreviewResults(results);
    } catch (error) {
      console.error('Error during preview:', error);
      alert('Error generating preview. Please try again.');
      setStep('options');
    } finally {
      setProcessing(false);
    }
  }, [mediaItems, options]);

  const handleConfirmUpdate = useCallback(async () => {
    setStep('processing');
    setProcessing(true);
    
    try {
      const results = await MediaUpdateService.applyBulkUpdates(
        previewResults,
        (current, total, item) => {
          setProgress({ current, total, item: item.DisplayName });
        }
      );
      setFinalResults(results);
      setStep('results');
      onUpdateComplete(results.success);
    } catch (error) {
      console.error('Error during update:', error);
      alert('Error applying updates. Please try again.');
      setStep('preview');
    } finally {
      setProcessing(false);
    }
  }, [previewResults, onUpdateComplete]);

  const handleClose = useCallback(() => {
    setStep('options');
    setPreviewResults([]);
    setFinalResults({ success: 0, failed: 0, errors: [] });
    setProgress({ current: 0, total: 0, item: '' });
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const itemsWithChanges = previewResults.filter(r => r.hasChanges);
  const itemsWithErrors = previewResults.filter(r => r.error);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 32,
        width: '90%',
        maxWidth: 800,
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      }}>
        {step === 'options' && (
          <>
            <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Update Media Data</h2>
            <p style={{ marginBottom: 24, color: '#666' }}>
              Select what information you want to update for {mediaItems.length} media items:
            </p>
            
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 16, fontSize: 18 }}>Update Options</h3>
              
              <label style={{ display: 'block', marginBottom: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={options.updateTitles}
                  onChange={(e) => setOptions(prev => ({ ...prev, updateTitles: e.target.checked }))}
                  style={{ marginRight: 8 }}
                />
                Update Titles
              </label>
              
              <label style={{ display: 'block', marginBottom: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={options.updateDescriptions}
                  onChange={(e) => setOptions(prev => ({ ...prev, updateDescriptions: e.target.checked }))}
                  style={{ marginRight: 8 }}
                />
                Update Descriptions
              </label>
              
              <label style={{ display: 'block', marginBottom: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={options.updateCoverImages}
                  onChange={(e) => setOptions(prev => ({ ...prev, updateCoverImages: e.target.checked }))}
                  style={{ marginRight: 8 }}
                />
                Update Cover Images
              </label>
              
              <h4 style={{ marginBottom: 12, fontSize: 16 }}>Update Strategy</h4>
              
              <label style={{ display: 'block', marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="strategy"
                  checked={options.onlyMissing}
                  onChange={() => setOptions(prev => ({ ...prev, onlyMissing: true }))}
                  style={{ marginRight: 8 }}
                />
                Only update missing/empty fields
              </label>
              
              <label style={{ display: 'block', marginBottom: 16, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="strategy"
                  checked={!options.onlyMissing}
                  onChange={() => setOptions(prev => ({ ...prev, onlyMissing: false }))}
                  style={{ marginRight: 8 }}
                />
                Overwrite all selected fields
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{
                  background: '#ccc',
                  color: '#333',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleOptionsSubmit}
                disabled={!options.updateTitles && !options.updateDescriptions && !options.updateCoverImages}
                style={{
                  background: '#2a4d8f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: (!options.updateTitles && !options.updateDescriptions && !options.updateCoverImages) ? 0.5 : 1
                }}
              >
                Preview Changes
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            {processing ? (
              <>
                <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Analyzing Changes...</h2>
                <div style={{ marginBottom: 16 }}>
                  Progress: {progress.current} / {progress.total}
                </div>
                <div style={{ marginBottom: 16, fontStyle: 'italic' }}>
                  {progress.item}
                </div>
                <div style={{
                  width: '100%',
                  height: 8,
                  backgroundColor: '#eee',
                  borderRadius: 4,
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                    height: '100%',
                    backgroundColor: '#2a4d8f',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Preview Changes</h2>
                
                <div style={{ marginBottom: 24 }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>{itemsWithChanges.length}</strong> items will be updated
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>{itemsWithErrors.length}</strong> items had errors
                  </div>
                  <div>
                    <strong>{previewResults.length - itemsWithChanges.length - itemsWithErrors.length}</strong> items have no changes
                  </div>
                </div>

                {itemsWithChanges.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h3 style={{ marginBottom: 16, fontSize: 18 }}>Items to Update</h3>
                    <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
                      {itemsWithChanges.map((result, index) => (
                        <div key={index} style={{ 
                          padding: 12, 
                          borderBottom: index < itemsWithChanges.length - 1 ? '1px solid #eee' : 'none'
                        }}>
                          <div style={{ fontWeight: 500, marginBottom: 4 }}>
                            {result.mediaItem.DisplayName}
                          </div>
                          <div style={{ fontSize: 14, color: '#666' }}>
                            {Object.keys(result.updateData || {}).join(', ')} will be updated
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {itemsWithErrors.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h3 style={{ marginBottom: 16, fontSize: 18, color: '#dc3545' }}>Items with Errors</h3>
                    <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
                      {itemsWithErrors.map((result, index) => (
                        <div key={index} style={{ 
                          padding: 12, 
                          borderBottom: index < itemsWithErrors.length - 1 ? '1px solid #eee' : 'none'
                        }}>
                          <div style={{ fontWeight: 500, marginBottom: 4 }}>
                            {result.mediaItem.DisplayName}
                          </div>
                          <div style={{ fontSize: 14, color: '#dc3545' }}>
                            {result.error}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setStep('options')}
                    style={{
                      background: '#ccc',
                      color: '#333',
                      border: 'none',
                      borderRadius: 6,
                      padding: '10px 20px',
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleClose}
                    style={{
                      background: '#6c757d',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '10px 20px',
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  {itemsWithChanges.length > 0 && (
                    <button
                      onClick={handleConfirmUpdate}
                      style={{
                        background: '#28a745',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '10px 20px',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      Apply Updates ({itemsWithChanges.length} items)
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {step === 'processing' && (
          <>
            <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Applying Updates...</h2>
            <div style={{ marginBottom: 16 }}>
              Progress: {progress.current} / {progress.total}
            </div>
            <div style={{ marginBottom: 16, fontStyle: 'italic' }}>
              {progress.item}
            </div>
            <div style={{
              width: '100%',
              height: 8,
              backgroundColor: '#eee',
              borderRadius: 4,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                height: '100%',
                backgroundColor: '#28a745',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </>
        )}

        {step === 'results' && (
          <>
            <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Update Complete</h2>
            
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, color: '#28a745' }}>
                <strong>{finalResults.success}</strong> items updated successfully
              </div>
              {finalResults.failed > 0 && (
                <div style={{ marginBottom: 8, color: '#dc3545' }}>
                  <strong>{finalResults.failed}</strong> items failed to update
                </div>
              )}
            </div>

            {finalResults.errors.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ marginBottom: 16, fontSize: 18, color: '#dc3545' }}>Errors</h3>
                <div style={{ 
                  maxHeight: 200, 
                  overflow: 'auto', 
                  border: '1px solid #ddd', 
                  borderRadius: 6,
                  padding: 12,
                  backgroundColor: '#f8f9fa'
                }}>
                  {finalResults.errors.map((error, index) => (
                    <div key={index} style={{ 
                      marginBottom: index < finalResults.errors.length - 1 ? 8 : 0,
                      fontSize: 14,
                      color: '#dc3545'
                    }}>
                      {error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{
                  background: '#2a4d8f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
