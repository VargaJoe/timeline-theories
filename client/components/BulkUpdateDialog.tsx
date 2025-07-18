import React, { useState, useCallback } from 'react';
import { MediaUpdateService, DataSource } from '../services/mediaUpdateService';
import type { UpdateOptions, MediaUpdateResult, BulkUpdateProgress } from '../services/mediaUpdateService';
import type { MediaItem } from '../services/mediaLibraryService';

interface BulkUpdateDialogProps {
  mediaItems: MediaItem[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateComplete: (updatedCount: number) => void;
}

interface ValidatedUpdateResult extends MediaUpdateResult {
  approved?: boolean;
  similarityScore?: number;
  warningReason?: string;
}

export const BulkUpdateDialog: React.FC<BulkUpdateDialogProps> = ({
  mediaItems,
  isOpen,
  onClose,
  onUpdateComplete
}) => {
  const [step, setStep] = useState<'options' | 'preview' | 'processing' | 'results'>('options');
  const [options, setOptions] = useState<UpdateOptions & { coverImageMode?: 'url' | 'binary' }>({
    updateTitles: true,
    updateDescriptions: true,
    updateCoverImages: true,
    onlyMissing: true,
    preferredSources: [DataSource.OMDB, DataSource.TMDB, DataSource.TRAKT],
    coverImageMode: 'url' // default to url, admin can change to binary
  });
  const [previewResults, setPreviewResults] = useState<ValidatedUpdateResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<BulkUpdateProgress>({ current: 0, total: 0, currentItem: '' });
  const [finalResults, setFinalResults] = useState<{ success: number; failed: number; errors: string[] }>({
    success: 0,
    failed: 0,
    errors: []
  });

  // Calculate similarity between original and proposed titles
  const calculateSimilarity = (original: string, proposed: string): number => {
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const orig = normalize(original);
    const prop = normalize(proposed);
    
    // Simple similarity check - you could use a more sophisticated algorithm
    if (orig === prop) return 1.0;
    if (orig.includes(prop) || prop.includes(orig)) return 0.8;
    
    // Check common words
    const origWords = orig.split(' ').filter(w => w.length > 2);
    const propWords = prop.split(' ').filter(w => w.length > 2);
    const commonWords = origWords.filter(w => propWords.includes(w));
    
    if (origWords.length + propWords.length === 0) return 0;
    return (commonWords.length * 2) / (origWords.length + propWords.length);
  };

  // Validate and enhance results with similarity scores
  const validateResults = useCallback((results: MediaUpdateResult[]): ValidatedUpdateResult[] => {
    return results.map(result => {
      const validated: ValidatedUpdateResult = { 
        ...result, 
        approved: true, // Default to approved
        similarityScore: 1.0 
      };

      // Check for potential mismatches if title is being updated
      if (result.updateData?.title && result.mediaItem.DisplayName) {
        const similarity = calculateSimilarity(result.mediaItem.DisplayName, result.updateData.title);
        validated.similarityScore = similarity;
        
        // Flag potentially problematic matches
        if (similarity < 0.6) {
          validated.approved = false;
          validated.warningReason = `Low similarity (${Math.round(similarity * 100)}%) - titles may not match`;
        } else if (similarity < 0.8) {
          validated.warningReason = `Medium similarity (${Math.round(similarity * 100)}%) - please verify`;
        }
      }

      return validated;
    });
  }, []);

  // Toggle approval for a specific item
  const toggleApproval = (index: number) => {
    setPreviewResults(prev => prev.map((item, i) => 
      i === index ? { ...item, approved: !item.approved } : item
    ));
  };

  const handleOptionsSubmit = useCallback(async () => {
    setStep('preview');
    setProcessing(true);
    
    try {
      const results = await MediaUpdateService.processBulkUpdate(
        mediaItems,
        options,
        (progress) => {
          setProgress(progress);
        },
        true // isPreview = true
      );
      const validatedResults = validateResults(results);
      setPreviewResults(validatedResults);
    } catch (error) {
      console.error('Error during preview:', error);
      alert('Error generating preview. Please try again.');
      setStep('options');
    } finally {
      setProcessing(false);
    }
  }, [mediaItems, options, validateResults]);

  const handleConfirmUpdate = useCallback(async () => {
    setStep('processing');
    setProcessing(true);
    
    try {
      // Only process approved items
      const approvedItems = previewResults.filter(r => r.approved && r.hasChanges);
      
      let success = 0;
      let failed = 0;
      const errors: string[] = [];
      
      // Apply updates for approved items only
      for (const result of approvedItems) {
        try {
          if (result.updateData) {
            // Use MediaUpdateService to handle binary uploads properly
            await MediaUpdateService.processBulkUpdate(
              [result.mediaItem],
              options,
              undefined, // no progress callback for individual items
              false // isPreview = false (final processing)
            );
            success++;
          }
        } catch (error) {
          failed++;
          errors.push(`${result.mediaItem.DisplayName}: ${error instanceof Error ? error.message : 'Update failed'}`);
        }
      }
      
      setFinalResults({ success, failed, errors });
      setStep('results');
      onUpdateComplete(success);
    } catch (error) {
      console.error('Error during update:', error);
      alert('Error applying updates. Please try again.');
      setStep('preview');
    } finally {
      setProcessing(false);
    }
  }, [previewResults, onUpdateComplete, options]);

  const handleClose = useCallback(() => {
    setStep('options');
    setPreviewResults([]);
    setFinalResults({ success: 0, failed: 0, errors: [] });
    setProgress({ current: 0, total: 0, currentItem: '' });
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
              

              <label style={{ display: 'block', marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={options.updateCoverImages}
                  onChange={(e) => setOptions(prev => ({ ...prev, updateCoverImages: e.target.checked }))}
                  style={{ marginRight: 8 }}
                />
                Update Cover Images
              </label>
              {options.updateCoverImages && (
                <div style={{ marginLeft: 24, marginBottom: 12 }}>
                  <label style={{ marginRight: 16, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="coverImageMode"
                      checked={options.coverImageMode === 'url'}
                      onChange={() => setOptions(prev => ({ ...prev, coverImageMode: 'url' }))}
                      style={{ marginRight: 6 }}
                    />
                    Set Cover Image URL (default)
                  </label>
                  <label style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="coverImageMode"
                      checked={options.coverImageMode === 'binary'}
                      onChange={() => setOptions(prev => ({ ...prev, coverImageMode: 'binary' }))}
                      style={{ marginRight: 6 }}
                    />
                    Upload and store cover as binary (resized to site default)
                  </label>
                </div>
              )}
              
              <h4 style={{ marginBottom: 12, fontSize: 16 }}>Data Sources (in order of preference)</h4>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={options.preferredSources.includes(DataSource.OMDB)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: [...prev.preferredSources, DataSource.OMDB] 
                        }));
                      } else {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: prev.preferredSources.filter(s => s !== DataSource.OMDB) 
                        }));
                      }
                    }}
                    style={{ marginRight: 8 }}
                  />
                  OMDb (Free IMDb data, 1,000 requests/day)
                </label>
                
                <label style={{ display: 'block', marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={options.preferredSources.includes(DataSource.TMDB)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: [...prev.preferredSources, DataSource.TMDB] 
                        }));
                      } else {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: prev.preferredSources.filter(s => s !== DataSource.TMDB) 
                        }));
                      }
                    }}
                    style={{ marginRight: 8 }}
                  />
                  TMDB (Movie Database, 1,000 requests/day)
                </label>
                
                <label style={{ display: 'block', marginBottom: 16, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={options.preferredSources.includes(DataSource.TRAKT)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: [...prev.preferredSources, DataSource.TRAKT] 
                        }));
                      } else {
                        setOptions(prev => ({ 
                          ...prev, 
                          preferredSources: prev.preferredSources.filter(s => s !== DataSource.TRAKT) 
                        }));
                      }
                    }}
                    style={{ marginRight: 8 }}
                  />
                  Trakt (Production only)
                </label>
              </div>
              
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
                disabled={!options.updateTitles && !options.updateDescriptions && !options.updateCoverImages || options.preferredSources.length === 0}
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
                  {progress.currentItem}
                </div>
                {progress.apiStatus && (
                  <div style={{ 
                    marginBottom: 16, 
                    padding: 12, 
                    backgroundColor: progress.apiStatus.status === 'rate-limited' ? '#fff3cd' : '#d1ecf1',
                    border: '1px solid ' + (progress.apiStatus.status === 'rate-limited' ? '#ffeaa7' : '#bee5eb'),
                    borderRadius: 6,
                    fontSize: 14
                  }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>
                      API Status: {progress.apiStatus.source}
                    </div>
                    <div style={{ color: '#6c757d' }}>
                      {progress.apiStatus.message}
                      {progress.apiStatus.retryAfter && (
                        <span> (Retry in {progress.apiStatus.retryAfter}s)</span>
                      )}
                    </div>
                  </div>
                )}
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
                <h2 style={{ marginBottom: 24, color: '#2a4d8f' }}>Validate Changes</h2>
                <p style={{ marginBottom: 24, color: '#666' }}>
                  Review each proposed change and approve/reject updates. Items flagged with warnings require your attention.
                </p>
                
                <div style={{ marginBottom: 24 }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>{itemsWithChanges.filter(r => r.approved).length}</strong> of <strong>{itemsWithChanges.length}</strong> items approved
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>{itemsWithErrors.length}</strong> items had errors
                  </div>
                  <div>
                    <strong>{previewResults.filter(r => r.warningReason).length}</strong> items have warnings
                  </div>
                </div>

                {itemsWithChanges.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h3 style={{ marginBottom: 16, fontSize: 18 }}>Items for Review</h3>
                    <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
                      {itemsWithChanges.map((result, index) => (
                        <div key={index} style={{ 
                          padding: 16, 
                          borderBottom: index < itemsWithChanges.length - 1 ? '1px solid #eee' : 'none',
                          backgroundColor: result.warningReason ? '#fff3cd' : result.approved ? '#d4edda' : '#f8d7da'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 16 }}>
                                {result.mediaItem.DisplayName}
                              </div>
                              {result.warningReason && (
                                <div style={{ color: '#856404', fontSize: 14, marginBottom: 8, fontStyle: 'italic' }}>
                                  ⚠️ {result.warningReason}
                                </div>
                              )}
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginLeft: 16 }}>
                              <input
                                type="checkbox"
                                checked={result.approved || false}
                                onChange={() => toggleApproval(index)}
                                style={{ marginRight: 8, transform: 'scale(1.2)' }}
                              />
                              <span style={{ fontWeight: 500, color: result.approved ? '#155724' : '#721c24' }}>
                                {result.approved ? 'Approved' : 'Rejected'}
                              </span>
                            </label>
                          </div>
                          
                          {/* Show detailed changes */}
                          <div style={{ fontSize: 14 }}>
                            {result.updateData?.title && (
                              <div style={{ marginBottom: 8 }}>
                                <strong>Title:</strong>
                                <div style={{ marginLeft: 16, color: '#666' }}>
                                  <div>From: "{result.mediaItem.DisplayName}"</div>
                                  <div>To: "{result.updateData.title}"</div>
                                  {result.similarityScore !== undefined && (
                                    <div style={{ fontSize: 12, color: result.similarityScore < 0.6 ? '#dc3545' : result.similarityScore < 0.8 ? '#ffc107' : '#28a745' }}>
                                      Similarity: {Math.round(result.similarityScore * 100)}%
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {result.updateData?.description && (
                              <div style={{ marginBottom: 8 }}>
                                <strong>Description:</strong>
                                <div style={{ marginLeft: 16, color: '#666' }}>
                                  <div>From: "{result.mediaItem.Description?.substring(0, 100)}..."</div>
                                  <div>To: "{result.updateData.description.substring(0, 100)}..."</div>
                                </div>
                              </div>
                            )}
                            {result.updateData?.coverImageUrl && (
                              <div style={{ marginBottom: 8 }}>
                                <strong>Cover Image:</strong>
                                <div style={{ marginLeft: 16, color: '#666' }}>
                                  {result.mediaItem.CoverImageUrl ? 'Update existing image' : 'Add new image'}
                                </div>
                              </div>
                            )}
                            {result.updateData?.source && (
                              <div style={{ fontSize: 12, color: '#6c757d', marginTop: 8 }}>
                                Source: {result.updateData.source}
                              </div>
                            )}
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
                  {itemsWithChanges.filter(r => r.approved).length > 0 && (
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
                      Apply Approved Updates ({itemsWithChanges.filter(r => r.approved).length} items)
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
              {progress.currentItem}
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
