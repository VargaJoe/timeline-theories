import { useState, useEffect } from 'react';
import { BulkUpdateDialog } from '../components/BulkUpdateDialog';
import { TraktImportDialog } from '../components/TraktImportDialog';
import { PageHeader } from '../components/PageHeader';
import { TIMELINE_CONTENT_TYPE } from '../contentTypes';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useParams, Link } from 'react-router-dom';
import { LazyImage } from '../components/LazyImage';
import { timelinesPath } from '../projectPaths';
import { repository } from '../services/sensenet';
import { TimelineEntryService } from '../services/timelineEntryService';
import { loadBackgroundImage } from '../services/sensenet';
import { siteConfig, repositoryUrl } from '../configuration';
import type { Timeline } from '../services/timelineService';
import type { TimelineEntry, MediaItemRef } from '../services/timelineEntryService';

// Helper function to get cover image URL from MediaItemRef
function getCoverImageUrl(mediaItem: MediaItemRef): string | null {
  // If URL is set, use it
  // Temporary off to avoid use images from other sites
  // if (mediaItem.CoverImageUrl) {
  //   return mediaItem.CoverImageUrl;
  // }
  
  // Otherwise, check if we have a binary image
  if (mediaItem.CoverImageBin && mediaItem.CoverImageBin.__mediaresource) {
    const relativePath = mediaItem.CoverImageBin.__mediaresource.media_src;
    return `${repositoryUrl}${relativePath}`;
  }
  
  return null;
}

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

interface DraggableProvided {
  innerRef: (element: HTMLElement | null) => void;
  draggableProps: Record<string, unknown>;
  dragHandleProps: Record<string, unknown>;
}

interface DraggableStateSnapshot {
  isDragging: boolean;
}

interface DroppableProvided {
  innerRef: (element: HTMLElement | null) => void;
  droppableProps: Record<string, unknown>;
  placeholder: React.ReactElement;
}

export const TimelineViewPage: React.FC = () => {
  const DESCRIPTION_ROW_LIMIT = 3;
  const [showFullDescription, setShowFullDescription] = useState(false);
  const { id: timelineName } = useParams<{ id: string }>();
  const { oidcUser } = useOidcAuthentication();

  console.log('[TimelineViewPage] Component mounted with timelineName:', timelineName);

  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<TimelineEntry[] | null>(null);
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSortOrder, setEditSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Load timeline data
  useEffect(() => {
    console.log('[TimelineViewPage] useEffect triggered, timelineName:', timelineName);
    if (!timelineName) {
      console.log('[TimelineViewPage] No timelineName, returning early');
      return;
    }
    
    const loadTimeline = async () => {
      try {
        setLoading(true);
        const decodedTimelineName = decodeURIComponent(timelineName);
        console.log(`[TimelineViewPage] Loading timeline: ${timelineName} -> ${decodedTimelineName}`);
        // Load the specific timeline by name (path segment)
        const parentPath = `${timelinesPath}/${decodedTimelineName}`;
        console.log(`[TimelineViewPage] Parent path: ${parentPath}`);
        const result = await repository.load({
          idOrPath: parentPath,
          oDataOptions: {
            select: ['Id', 'Name', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
          },
        });
        // Handle SortOrder as array or string, use first element if array, else default to 'chronological'
        let sortOrder: 'chronological' | 'release' = 'chronological';
        let sortOrderRaw: string | undefined = undefined;
        if (Array.isArray(result.d.SortOrder) && result.d.SortOrder.length > 0) {
          sortOrderRaw = result.d.SortOrder[0];
        } else if (typeof result.d.SortOrder === 'string') {
          sortOrderRaw = result.d.SortOrder;
        }
        if (typeof sortOrderRaw === 'string') {
          const val = sortOrderRaw.trim().toLowerCase();
          if (val === 'release') sortOrder = 'release';
          else if (val === 'chronological') sortOrder = 'chronological';
        }
        setTimeline({
          id: String(result.d.Id),
          name: decodedTimelineName, // Use the decoded timeline name
          displayName: result.d.DisplayName,
          description: result.d.Description || '',
          sort_order: sortOrder,
          created_at: result.d.CreationDate,
        });
        setEditTitle(result.d.DisplayName);
        setEditDescription(result.d.Description || '');
        setEditSortOrder(sortOrder);
        // Load timeline entries and media items
        setEntriesLoading(true);
        try {
          const entries = await TimelineEntryService.listTimelineEntries(Number(result.d.Id), parentPath);
          setEntries(entries);
          console.log(`[TimelineViewPage] Successfully loaded ${entries.length} entries`);
        } catch (entriesError) {
          console.error('[TimelineViewPage] Error loading entries:', entriesError);
          setError('Failed to load timeline entries: ' + (entriesError instanceof Error ? entriesError.message : String(entriesError)));
        } finally {
          setEntriesLoading(false);
        }
      } catch (err) {
        let message = 'Failed to load timeline';
        if (err && typeof err === 'object') {
          if ('message' in err && typeof err.message === 'string') {
            message += ': ' + err.message;
          } else if ('toString' in err && typeof err.toString === 'function') {
            message += ': ' + err.toString();
          }
        }
        console.error('Failed to load timeline:', err);
        setError(message);
        setEntriesLoading(false);
      } finally {
        setLoading(false);
      }
    };
    loadTimeline();
  }, [timelineName]);

  // Load background image from SenseNet
  useEffect(() => {
    const loadBackground = async () => {
      try {
        const imageUrl = await loadBackgroundImage(siteConfig.headerBackgroundImagePath);
        if (imageUrl) {
          console.log('[TimelineViewPage] Background image loaded:', imageUrl);
          
          // Test if the image can be loaded by creating an Image object
          const testImage = new Image();
          testImage.onload = () => {
            console.log('[TimelineViewPage] Background image successfully tested');
            setBackgroundImageUrl(imageUrl);
          };
          testImage.onerror = (error) => {
            console.error('[TimelineViewPage] Background image failed to load:', error);
            console.log('[TimelineViewPage] Falling back to gradient background');
            setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
          };
          testImage.src = imageUrl;
        } else {
          console.warn('[TimelineViewPage] No background image URL received, using gradient fallback');
          setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
        }
      } catch (error) {
        console.error('[TimelineViewPage] Error loading background image:', error);
        console.log('[TimelineViewPage] Using gradient fallback due to error');
        setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
      }
    };

    loadBackground();
  }, []);

  const toggleReorderMode = async () => {
    if (reorderMode && pendingOrder) {
      // Save the new order
      const updates = pendingOrder.map((entry, index) => ({
        id: entry.id,
        position: index + 1
      }));
      
      try {
        await Promise.all(
          updates.map(update =>
            repository.patch({
              idOrPath: update.id,
              content: { Position: update.position }
            })
          )
        );
        setEntries(pendingOrder);
        setPendingOrder(null);
      } catch (error) {
        console.error('Error saving display order:', error);
      }
    } else {
      setPendingOrder([...entries]);
    }
    setReorderMode(!reorderMode);
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !pendingOrder) return;

    const newEntries = Array.from(pendingOrder);
    const [reorderedEntry] = newEntries.splice(result.source.index, 1);
    newEntries.splice(result.destination.index, 0, reorderedEntry);

    setPendingOrder(newEntries);
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#666' }}>Loading timeline...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#dc3545', marginBottom: 16 }}>{error}</div>
        <Link 
          to="/timelines" 
          style={{ 
            color: '#007bff', 
            textDecoration: 'none' 
          }}
        >
          ← Back to Timelines
        </Link>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#666' }}>Timeline not found</div>
        <Link 
          to="/timelines" 
          style={{ 
            color: '#007bff', 
            textDecoration: 'none' 
          }}
        >
          ← Back to Timelines
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader 
        title={timeline.displayName || timeline.name || 'Timeline'}
        subtitle="Timeline Entries"
        backgroundImage={backgroundImageUrl || undefined}
        overlayOpacity={siteConfig.headerOverlayOpacity}
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
            <div title="Import from Trakt List" style={{ display: 'inline-block' }}>
              <TraktImportDialog
                timelineName={timeline.name}
                onImportComplete={() => {
                  setEntriesLoading(true);
                  TimelineEntryService.listTimelineEntries(Number(timeline.id), `${timelinesPath}/${timeline.name}`)
                    .then(setEntries)
                    .finally(() => setEntriesLoading(false));
                }}
              />
            </div>
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
        padding: '0 20px 24px 20px'
      }}>
        {/* Debug Info */}
        <div className='hidden' style={{ background: '#f8f9fa', padding: 12, marginBottom: 16, fontSize: 12, fontFamily: 'monospace' }}>
          <strong>Debug:</strong> timelineName={timelineName}, timeline.name={timeline?.name}, entries.length={entries.length}, entriesLoading={entriesLoading.toString()}, error={error}
        </div>
        {/* Navigation */}
        <div>
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

        {/* Timeline Description */}
        {timeline?.description && !editMode && (
        (() => {
          // Create a temporary element to count lines
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = timeline.description;
          tempDiv.style.position = 'absolute';
          tempDiv.style.visibility = 'hidden';
          tempDiv.style.fontSize = '16px';
          tempDiv.style.lineHeight = '1.6';
          tempDiv.style.width = '900px';
          document.body.appendChild(tempDiv);
          const lineHeight = parseFloat(getComputedStyle(tempDiv).lineHeight);
          const totalHeight = tempDiv.offsetHeight;
          const numLines = Math.round(totalHeight / lineHeight);
          document.body.removeChild(tempDiv);
          const isDescriptionLong = numLines > DESCRIPTION_ROW_LIMIT;
          return (
            <div style={{
              // maxWidth: '900px',
              margin: '0 auto 32px auto',
              padding: '0'
            }}>
              <div style={{
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: 12,
                padding: 24,
                fontSize: 16,
                lineHeight: 1.6,
                color: '#374151',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                backdropFilter: 'blur(10px)'
              }}>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#6b7280',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Description
                </div>
                <div
                  style={
                    showFullDescription || !isDescriptionLong
                      ? {}
                      : {
                          display: '-webkit-box',
                          WebkitLineClamp: DESCRIPTION_ROW_LIMIT,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }
                  }
                  dangerouslySetInnerHTML={{ __html: timeline.description }}
                />
                {isDescriptionLong && (
                  <button
                    type="button"
                    onClick={() => setShowFullDescription(v => !v)}
                    style={{
                      marginTop: 12,
                      background: '#e5e7eb',
                      color: '#374151',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 16px',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 500
                    }}
                  >
                    {showFullDescription ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>
          );
        })()
        )}

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
        ) : entries.length === 0 ? (
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
        ) : reorderMode && pendingOrder ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="timeline-entries">
              {(provided: DroppableProvided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 16,
                    maxWidth: '1200px',
                    margin: '0 auto',
                    padding: '0'
                  }}
                >
                  {pendingOrder.map((entry, idx) => {
                    return (
                      <Draggable key={entry.id} draggableId={entry.id} index={idx}>
                        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              background: snapshot.isDragging ? 'rgba(229, 246, 253, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                              borderRadius: 12,
                              border: `2px solid ${snapshot.isDragging ? '#3b82f6' : 'rgba(0, 0, 0, 0.1)'}`,
                              boxShadow: snapshot.isDragging ? '0 8px 24px rgba(59, 130, 246, 0.25)' : '0 1px 3px rgba(0, 0, 0, 0.1)',
                              cursor: 'grab',
                              transition: 'all 0.2s ease',
                              overflow: 'hidden',
                              backdropFilter: 'blur(10px)',
                              position: 'relative',
                              ...(provided.draggableProps.style as React.CSSProperties || {})
                            }}
                          >
                            {/* Drag Handle */}
                            <div style={{
                              position: 'absolute',
                              top: 12,
                              right: 12,
                              background: snapshot.isDragging ? '#3b82f6' : '#9ca3af',
                              color: '#fff',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 16,
                              zIndex: 1,
                              cursor: 'grab'
                            }}>
                              ⋮⋮
                            </div>

                            {/* Position Badge */}
                            <div style={{
                              position: 'absolute',
                              top: 12,
                              left: 12,
                              background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
                              color: '#fff',
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '4px 8px',
                              borderRadius: 6,
                              minWidth: 24,
                              textAlign: 'center',
                              zIndex: 1,
                              boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)'
                            }}>
                              {idx + 1}
                            </div>

                            {/* Cover Image */}
                            <div style={{
                              height: 160,
                              position: 'relative',
                              overflow: 'hidden'
                            }}>
                              {entry.mediaItem && getCoverImageUrl(entry.mediaItem) ? (
                                <Link
                                  to={`/media-library/${entry.mediaItem.Name}`}
                                  style={{ display: 'block', width: '100%', height: '100%' }}
                                  title={entry.mediaItem.DisplayName}
                                >
                                  <LazyImage
                                    src={getCoverImageUrl(entry.mediaItem)!}
                                    alt={entry.mediaItem.DisplayName || 'Media cover'}
                                    style={{ 
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover'
                                    }}
                                  />
                                </Link>
                              ) : (
                                <div style={{ 
                                  width: '100%',
                                  height: '100%',
                                  background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#9ca3af'
                                }}>
                                  <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div style={{ padding: 16 }}>
                              <h4 style={{ 
                                fontSize: 16, 
                                fontWeight: 600, 
                                color: '#1f2937',
                                margin: '0 0 8px 0',
                                lineHeight: '1.4',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}>
                                {entry.mediaItem ? (
                                  <Link
                                    to={`/media-library/${entry.mediaItem.Name}`}
                                    style={{ color: '#1f2937', textDecoration: 'none' }}
                                    title={entry.mediaItem.DisplayName}
                                  >
                                    {entry.mediaItem.DisplayName}
                                  </Link>
                                ) : 'Unknown Media'}
                              </h4>
                              {entry.notes && (
                                <p style={{ 
                                  color: '#6b7280', 
                                  margin: 0, 
                                  fontSize: 14,
                                  lineHeight: 1.5,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden'
                                }}>
                                  {entry.notes}
                                </p>
                              )}
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
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0'
          }}>
            {entries.map((entry) => {
              return (
                <div
                  key={entry.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: 12,
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                    backdropFilter: 'blur(10px)',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.1)';
                  }}
                >
                  {/* Position Badge */}
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '4px 8px',
                    borderRadius: 6,
                    minWidth: 24,
                    textAlign: 'center',
                    zIndex: 1,
                    boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)'
                  }}>
                    {entry.position}
                  </div>

                  {/* Cover Image */}
                  <div style={{
                    height: 200,
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    {entry.mediaItem && getCoverImageUrl(entry.mediaItem) ? (
                      <Link
                        to={`/media-library/${entry.mediaItem.Name}`}
                        style={{ display: 'block', width: '100%', height: '100%' }}
                        title={entry.mediaItem.DisplayName}
                      >
                        <LazyImage
                          src={getCoverImageUrl(entry.mediaItem)!}
                          alt={entry.mediaItem.DisplayName}
                          style={{ 
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transition: 'transform 0.3s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.05)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                          }}
                        />
                      </Link>
                    ) : (
                      <div style={{ 
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af'
                      }}>
                        <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ padding: 16 }}>
                    <h3 style={{ 
                      fontSize: 16, 
                      fontWeight: 600, 
                      color: '#1f2937',
                      margin: '0 0 8px 0',
                      lineHeight: '1.4',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}>
                      {entry.mediaItem ? (
                        <Link
                          to={`/media-library/${entry.mediaItem.Name}`}
                          style={{ color: '#1f2937', textDecoration: 'none' }}
                          title={entry.mediaItem.DisplayName}
                        >
                          {entry.mediaItem.DisplayName}
                        </Link>
                      ) : 'Unknown Media'}
                    </h3>
                    
                    {entry.notes && (
                      <p style={{ 
                        color: '#6b7280', 
                        margin: 0, 
                        fontSize: 14,
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk Update Dialog */}
      <BulkUpdateDialog
        mediaItems={entries
          .map(entry => entry.mediaItem)
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map(ref => ({
            Id: ref.Id,
            Name: ref.Name || '',
            DisplayName: ref.DisplayName || ref.Name || '',
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
            if (timeline) {
              TimelineEntryService.listTimelineEntries(Number(timeline.id), `${timelinesPath}/${timeline.name}`)
                .then(setEntries)
                .finally(() => setEntriesLoading(false));
            }
          }
        }}
      />
    </>
  );
};
