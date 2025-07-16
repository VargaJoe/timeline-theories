import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { TimelineEntryService } from '../services/timelineEntryService';
import { deleteTimeline } from '../services/timelineService';
import { BulkUpdateDialog } from '../components/BulkUpdateDialog';
import { PageHeader } from '../components/PageHeader';
import { repository } from '../services/sensenet';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { timelinesPath } from '../projectPaths';
import { TIMELINE_CONTENT_TYPE } from '../contentTypes';
import type { Timeline } from '../services/timelineService';
import type { TimelineEntry } from '../services/timelineEntryService';

// Type definitions for react-beautiful-dnd to avoid TypeScript any warnings
interface DropResult {
  destination?: {
    index: number;
    droppableId: string;
  } | null;
  source: {
    index: number;
    droppableId: string;
  };
}

export const TimelineViewPage: React.FC = () => {
  const { name: timelineName } = useParams<{ name: string }>();
  const { isAuthenticated, oidcUser } = useOidcAuthentication();
  
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSortOrder, setEditSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [backgroundImages, setBackgroundImages] = useState<string[]>([]);

  const coverImagesRef = useRef<(string | null)[]>([]);

  useEffect(() => {
    if (!timelineName) return;
    
    const fetchTimeline = async () => {
      try {
        const timelineData = await TimelineService.getTimeline(timelineName);
        setTimeline(timelineData);
        setEditTitle(timelineData.displayName || timelineData.name || '');
        setEditDescription(timelineData.description || '');
        setEditSortOrder(timelineData.sort_order || 'chronological');
      } catch (error) {
        console.error('Error fetching timeline:', error);
      }
    };

    fetchTimeline();
  }, [timelineName]);

  const fetchTimeline = async () => {
    if (!timelineName) return;
    try {
      const timelineData = await TimelineService.getTimeline(timelineName);
      setTimeline(timelineData);
      setEditTitle(timelineData.displayName || timelineData.name || '');
      setEditDescription(timelineData.description || '');
      setEditSortOrder(timelineData.sort_order || 'chronological');
    } catch (error) {
      console.error('Error fetching timeline:', error);
    }
  };

  useEffect(() => {
    if (!timeline?.id) return;
    
    const fetchEntries = async () => {
      setEntriesLoading(true);
      setEntriesError(null);
      try {
        const entriesData = await TimelineEntryService.listTimelineEntries(Number(timeline.id), `${timelinesPath}/${timeline.name}`);
        setEntries(entriesData);
        
        // Extract cover images for background
        const images = entriesData
          .map(entry => entry.mediaItem?.CoverImageUrl)
          .filter((url): url is string => !!url)
          .slice(0, 10);
        setBackgroundImages(images);
        coverImagesRef.current = images;
      } catch (error: any) {
        setEntriesError(`Error loading timeline entries: ${error.message}`);
      } finally {
        setEntriesLoading(false);
      }
    };

    fetchEntries();
  }, [timeline]);

  const toggleReorderMode = async () => {
    if (reorderMode) {
      // Save the new order
      const updates = entries.map((entry, index) => ({
        Id: entry.Id,
        DisplayOrder: index + 1
      }));
      
      try {
        await Promise.all(
          updates.map(update =>
            repository.patch({
              idOrPath: update.Id,
              content: { DisplayOrder: update.DisplayOrder }
            })
          )
        );
      } catch (error) {
        console.error('Error saving display order:', error);
      }
    }
    setReorderMode(!reorderMode);
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;

    const newEntries = Array.from(entries);
    const [reorderedEntry] = newEntries.splice(result.source.index, 1);
    newEntries.splice(result.destination.index, 0, reorderedEntry);

    setEntries(newEntries);
  };

  const sortedEntries = useMemo(() => {
    if (!timeline) return entries;
    
    return [...entries].sort((a, b) => {
      if (reorderMode) {
        return (a.DisplayOrder || 0) - (b.DisplayOrder || 0);
      }
      
      if (timeline.sort_order === 'chronological') {
        const aYear = a.ChronologicalYear || (a.mediaItem?.ReleaseYear ? parseInt(a.mediaItem.ReleaseYear.toString()) : 0);
        const bYear = b.ChronologicalYear || (b.mediaItem?.ReleaseYear ? parseInt(b.mediaItem.ReleaseYear.toString()) : 0);
        return aYear - bYear;
      } else {
        const aReleaseYear = a.mediaItem?.ReleaseYear ? parseInt(a.mediaItem.ReleaseYear.toString()) : 0;
        const bReleaseYear = b.mediaItem?.ReleaseYear ? parseInt(b.mediaItem.ReleaseYear.toString()) : 0;
        return aReleaseYear - bReleaseYear;
      }
    });
  }, [entries, timeline, reorderMode]);

  if (!timeline) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#666' }}>Loading timeline...</div>
      </div>
    );
  }

  return (
    <>
      <PageHeader 
        title={timeline.DisplayName || timeline.Name || 'Timeline'}
        subtitle={timeline.Description}
        backgroundImages={backgroundImages}
        overlayOpacity={0.8}
      >
        {/* Header Actions */}
        {oidcUser && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setEditMode(m => !m)}
              title={editMode ? 'Cancel Edit' : 'Edit Timeline'}
              style={{ 
                background: '#007bff', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 8, 
                padding: '12px', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <Link 
              to={`/timelines/${timelineName}/add-entry`} 
              title="Add Timeline Entry"
              style={{ 
                background: '#28a745', 
                color: '#fff', 
                padding: '12px', 
                borderRadius: 8, 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
            <button
              onClick={toggleReorderMode}
              title={reorderMode ? 'Save New Order' : 'Reorder Entries'}
              style={{
                background: reorderMode ? '#dc3545' : '#6c757d',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
            <button
              onClick={() => setShowBulkUpdateDialog(true)}
              title="Bulk Update Media Items"
              style={{
                background: '#fd7e14',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        )}

        {/* Edit Form in Header */}
        {editMode && (
          <form
            onSubmit={async e => {
              e.preventDefault();
              setEditError('');
              setEditLoading(true);
              try {
                await repository.patch({
                  idOrPath: `${timelinesPath}/${timelineName}`,
                  contentType: TIMELINE_CONTENT_TYPE,
                  content: {
                    DisplayName: editTitle,
                    Description: editDescription,
                    SortOrder: editSortOrder,
                  },
                });
                setTimeline(t => t ? { ...t, displayName: editTitle, description: editDescription, sort_order: editSortOrder } : t);
                setEditMode(false);
              } catch {
                setEditError('Failed to update timeline.');
              } finally {
                setEditLoading(false);
              }
            }}
            style={{ marginTop: 24, background: 'rgba(255,255,255,0.95)', padding: 20, borderRadius: 12 }}
          >
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500, color: '#333', display: 'block', marginBottom: 4 }}>Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500, color: '#333', display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500, color: '#333', display: 'block', marginBottom: 4 }}>Sort Order</label>
              <select
                value={editSortOrder}
                onChange={e => setEditSortOrder(e.target.value as 'chronological' | 'release')}
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box'
                }}
              >
                <option value="chronological">Chronological</option>
                <option value="release">Release Order</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={editLoading} style={{
                background: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                cursor: editLoading ? 'not-allowed' : 'pointer',
                opacity: editLoading ? 0.6 : 1
              }}>
                {editLoading ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditMode(false)} style={{
                background: '#6c757d',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                cursor: 'pointer'
              }}>
                Cancel
              </button>
            </div>
            {editError && (
              <div style={{ color: '#dc3545', fontSize: 14, marginTop: 8 }}>
                {editError}
              </div>
            )}
          </form>
        )}

        {/* Timeline Metadata in Header */}
        <div style={{ marginTop: 24, display: 'flex', gap: 24, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
          <div>
            <strong>Sort Order:</strong> {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
          </div>
          {timeline.created_at && (
            <div>
              <strong>Created:</strong> {new Date(timeline.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </PageHeader>
      
      {/* Main Content */}
      <div style={{ 
        maxWidth: 1200, 
        margin: '0 auto', 
        padding: '24px'
      }}>
        {/* Navigation */}
        <div style={{ marginBottom: 24 }}>
          <Link 
            to="/timelines" 
            style={{ 
              color: '#007bff', 
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Timelines
          </Link>
        </div>

        {reorderMode && (
          <div style={{
            background: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 14
          }}>
            <strong>Reorder Mode:</strong> Drag and drop entries to reorder them, then click "Save New Order" in the header.
          </div>
        )}

        {/* Timeline Entries */}
        {entriesLoading ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#666' }}>
            Loading timeline entries...
          </div>
        ) : entriesError ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#dc3545' }}>
            {entriesError}
          </div>
        ) : sortedEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#666' }}>
            <p style={{ marginBottom: 16 }}>No entries in this timeline yet.</p>
            {oidcUser && (
              <Link 
                to={`/timelines/${timelineName}/add-entry`}
                style={{
                  background: '#007bff',
                  color: '#fff',
                  padding: '12px 24px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Add First Entry
              </Link>
            )}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="timeline-entries" isDropDisabled={!reorderMode}>
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                  {sortedEntries.map((entry, index) => {
                    const yearToShow = timeline.sort_order === 'chronological' 
                      ? (entry.ChronologicalYear || (entry.mediaItem?.ReleaseYear ? parseInt(entry.mediaItem.ReleaseYear.toString()) : null))
                      : (entry.mediaItem?.ReleaseYear ? parseInt(entry.mediaItem.ReleaseYear.toString()) : null);

                    return (
                      <Draggable 
                        key={entry.Id} 
                        draggableId={entry.Id.toString()} 
                        index={index}
                        isDragDisabled={!reorderMode}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={{
                              ...provided.draggableProps.style,
                              marginBottom: 24,
                              opacity: snapshot.isDragging ? 0.8 : 1,
                            }}
                          >
                            <div style={{
                              background: '#fff',
                              border: '1px solid #e0e0e0',
                              borderRadius: 12,
                              padding: 20,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                              display: 'flex',
                              gap: 20,
                              alignItems: 'flex-start',
                              position: 'relative'
                            }}>
                              {reorderMode && (
                                <div
                                  {...provided.dragHandleProps}
                                  style={{
                                    cursor: 'grab',
                                    color: '#999',
                                    padding: '4px 0'
                                  }}
                                >
                                  <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                                  </svg>
                                </div>
                              )}
                              
                              {entry.mediaItem?.CoverImageUrl && (
                                <img
                                  src={entry.mediaItem.CoverImageUrl}
                                  alt={entry.mediaItem.DisplayName}
                                  style={{
                                    width: 80,
                                    height: 120,
                                    objectFit: 'cover',
                                    borderRadius: 8,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                                  }}
                                />
                              )}
                              
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                                  <div>
                                    <h3 style={{ 
                                      margin: 0, 
                                      marginBottom: 4, 
                                      fontSize: 18, 
                                      fontWeight: 600,
                                      color: '#333'
                                    }}>
                                      {entry.mediaItem?.DisplayName || 'Unknown Media'}
                                    </h3>
                                    {yearToShow && (
                                      <div style={{ 
                                        color: '#666', 
                                        fontSize: 14,
                                        fontWeight: 500
                                      }}>
                                        {yearToShow}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                
                                {entry.mediaItem?.Description && (
                                  <p style={{ 
                                    margin: '0 0 12px 0', 
                                    color: '#666', 
                                    fontSize: 14,
                                    lineHeight: 1.5,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                  }}>
                                    {entry.mediaItem.Description}
                                  </p>
                                )}
                                
                                {entry.notes && (
                                  <div style={{ 
                                    background: '#f8f9fa', 
                                    border: '1px solid #e9ecef',
                                    borderRadius: 8, 
                                    padding: 12, 
                                    marginTop: 12 
                                  }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>
                                      NOTES
                                    </div>
                                    <p style={{ 
                                      margin: 0, 
                                      fontSize: 14, 
                                      color: '#555',
                                      lineHeight: 1.5,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 3,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden'
                                    }}>
                                      {entry.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {/* Bulk Update Dialog */}
      <BulkUpdateDialog
        mediaItems={entries
          .map(entry => entry.mediaItem)
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map(ref => ({
            Id: ref.Id,
            DisplayName: ref.DisplayName || ref.Name,
            Description: '',
            MediaType: '',
            CoverImageUrl: ref.CoverImageUrl,
            CreationDate: '',
            CreatedBy: { DisplayName: '' }
          }))}
        isOpen={showBulkUpdateDialog}
        onClose={() => setShowBulkUpdateDialog(false)}
        onUpdateComplete={(updatedCount) => {
          // Reload entries after update
          if (updatedCount > 0) {
            setEntriesLoading(true);
            TimelineEntryService.listTimelineEntries(Number(timeline?.id), `${timelinesPath}/${timeline?.name}`)
              .then(setEntries)
              .finally(() => setEntriesLoading(false));
          }
        }}
      />
    </>
  );
};
