import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { TraktImportDialog } from '../components/TraktImportDialog';
import { BulkUpdateDialog } from '../components/BulkUpdateDialog';
import { TIMELINE_CONTENT_TYPE } from '../contentTypes';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useParams, Link } from 'react-router-dom';
import { deleteTimeline } from '../services/timelineService';
import { timelinesPath } from '../projectPaths';
import { repository } from '../services/sensenet';
import { TimelineEntryService } from '../services/timelineEntryService';
import type { Timeline } from '../services/timelineService';
import type { TimelineEntry } from '../services/timelineEntryService';
// Type definitions for react-beautiful-dnd to avoid TypeScript any warnings
interface DropResult {
  source: { index: number; droppableId: string };
  destination?: { index: number; droppableId: string } | null;
  draggableId: string;
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
// import { MediaLibraryService } from '../services/mediaLibraryService';
// import type { MediaItem } from '../services/mediaLibraryService';

export const TimelineViewPage: React.FC = () => {
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSortOrder, setEditSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const { oidcUser } = useOidcAuthentication();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<TimelineEntry[] | null>(null);
  // const [mediaMap, setMediaMap] = useState<Record<number, MediaItem>>({});
  const [entriesLoading, setEntriesLoading] = useState(true);
  const { id: timelineName } = useParams();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);

  useEffect(() => {
    if (!timelineName) return;
    const loadTimeline = async () => {
      try {
        setLoading(true);
        // Load the specific timeline by name (path segment)
        const parentPath = `${timelinesPath}/${timelineName}`;
        const result = await repository.load({
          idOrPath: parentPath,
          oDataOptions: {
            select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
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
          name: result.d.Name,
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
        const entries = await TimelineEntryService.listTimelineEntries(Number(result.d.Id), parentPath);
        setEntries(entries);
        setEntriesLoading(false);
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

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}>Loading timeline...</div>;
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none' }}>← Back to timelines</Link>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ marginBottom: 16 }}>Timeline not found</div>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none' }}>← Back to timelines</Link>
      </div>
    );
  }

  // Handle drag end
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (!pendingOrder) return;
    const reordered = Array.from(pendingOrder);
    const [removed] = reordered.splice(sourceIdx, 1);
    reordered.splice(destIdx, 0, removed);
    setPendingOrder(reordered);
  };

  // Save new order to backend
  const saveOrder = async () => {
    if (!pendingOrder) return;
    // Only update if order changed
    const changed = pendingOrder.some((entry, idx) => entry.position !== idx + 1);
    if (!changed) {
      setReorderMode(false);
      setPendingOrder(null);
      return;
    }
    // Prepare updates
    try {
      // Call a new service method to update positions in bulk
      await TimelineEntryService.updateEntryPositions(
        pendingOrder.map((entry, idx) => ({ ...entry, position: idx + 1 }))
      );
      setEntries(pendingOrder.map((entry, idx) => ({ ...entry, position: idx + 1 })));
      setReorderMode(false);
      setPendingOrder(null);
    } catch {
      alert('Failed to save new order.');
    }
  };

  // Toggle reorder mode
  const toggleReorderMode = () => {
    if (!reorderMode) {
      setPendingOrder([...entries]);
      setReorderMode(true);
    } else {
      saveOrder();
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none', fontSize: 14 }}>
          ← Back to timelines
        </Link>
      </div>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 12px #0001',
        padding: 32
      }}>
        {/* Move Trakt Import inside admin buttons below */}
        {editMode ? (
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
            style={{ marginBottom: 24 }}
          >
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500 }}>Title</label>
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                required
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc', fontSize: 16 }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <ReactQuill
                value={editDescription}
                onChange={setEditDescription}
                theme="snow"
                style={{ background: '#fff', borderRadius: 6 }}
                modules={{
                  toolbar: [
                    [{ header: [1, 2, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['link', 'clean']
                  ]
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500 }}>Sort Order</label>
              <select
                value={editSortOrder}
                onChange={e => setEditSortOrder(e.target.value as 'chronological' | 'release')}
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc', fontSize: 16 }}
              >
                <option value="chronological">Chronological Order</option>
                <option value="release">Release Order</option>
              </select>
            </div>
            {editError && <div style={{ color: '#dc3545', marginBottom: 8 }}>{editError}</div>}
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" disabled={editLoading} style={{ background: '#2a4d8f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 16, cursor: editLoading ? 'not-allowed' : 'pointer' }}>
                {editLoading ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditMode(false)} style={{ background: '#ccc', color: '#333', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <h1 style={{ marginBottom: 16, color: '#2a4d8f' }}>{timeline.displayName}</h1>
            {timeline.description && (
              <div style={{ color: '#666', marginBottom: 24, lineHeight: 1.6, fontSize: 16 }}>
                <div
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      showFullDescription || timeline.description.length <= 600
                        ? timeline.description
                        : timeline.description.slice(0, 600) + '...'
                    )
                  }}
                />
                {timeline.description.length > 300 && (
                  <button
                    onClick={() => setShowFullDescription(v => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2a4d8f',
                      cursor: 'pointer',
                      fontWeight: 500,
                      marginTop: 4,
                      padding: 0,
                      fontSize: 15
                    }}
                  >
                    {showFullDescription ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 24, marginBottom: 32, fontSize: 14, color: '#888' }}>
          <div>
            <strong>Sort Order:</strong> {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
          </div>
          {timeline.created_at && (
            <div>
              <strong>Created:</strong> {new Date(timeline.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
        {oidcUser && (
          <div style={{ marginBottom: 32, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                background: reorderMode ? '#28a745' : '#ffc107',
                color: reorderMode ? '#fff' : '#333',
                padding: '12px',
                borderRadius: 8,
                border: 'none',
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
              title="Update Media Data"
              style={{
                background: '#17a2b8',
                color: '#fff',
                padding: '12px',
                borderRadius: 8,
                border: 'none',
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
            <button
              onClick={async () => {
                if (!timelineName) return;
                if (window.confirm('Are you sure you want to delete this timeline? This action cannot be undone.')) {
                  try {
                    await deleteTimeline(timelineName);
                    window.location.href = '/timelines';
                  } catch {
                    alert('Failed to delete timeline. Please try again.');
                  }
                }
              }}
              title="Delete Timeline"
              style={{ 
                background: '#dc3545', 
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
        <h3 style={{ marginBottom: 24, color: '#2a4d8f', fontSize: 24, fontWeight: 600 }}>Timeline Entries</h3>
        {entriesLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading entries...</div>
        ) : entries.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: 60, 
            color: '#888', 
            fontStyle: 'italic',
            background: '#f8f9fa',
            borderRadius: 12,
            border: '2px dashed #dee2e6'
          }}>
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginBottom: 16, opacity: 0.5 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div style={{ fontSize: 18, marginBottom: 8 }}>No entries yet</div>
            <div style={{ fontSize: 14 }}>Start building your timeline by adding media entries</div>
          </div>
        ) : reorderMode && pendingOrder ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="timeline-entries">
              {(provided: DroppableProvided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ display: 'grid', gap: 16 }}
                >
                  {pendingOrder.map((entry, idx) => {
                    const media = entry.mediaItem;
                    const isBroken = !media || !media.Id;
                    const displayName = entry?.displayName || 'Unknown';
                    const coverUrl = !isBroken ? (media?.CoverImageUrl || '') : '';
                    return (
                      <Draggable key={entry.id} draggableId={entry.id} index={idx}>
                        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              background: snapshot.isDragging ? '#e3f2fd' : isBroken ? '#fff3cd' : '#fff',
                              borderRadius: 12,
                              padding: 20,
                              border: `2px solid ${snapshot.isDragging ? '#2196f3' : isBroken ? '#ffc107' : '#e9ecef'}`,
                              boxShadow: snapshot.isDragging ? '0 8px 24px rgba(0,0,0,0.15)' : '0 2px 8px rgba(0,0,0,0.1)',
                              cursor: 'grab',
                              transition: 'all 0.2s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 20,
                              ...(provided.draggableProps.style as React.CSSProperties || {})
                            }}
                          >
                            <div style={{ 
                              fontSize: 18, 
                              fontWeight: 600, 
                              color: '#2a4d8f',
                              minWidth: 40,
                              textAlign: 'center',
                              background: '#f8f9fa',
                              borderRadius: 8,
                              padding: '8px 12px'
                            }}>
                              {idx + 1}
                            </div>
                            <div style={{ flexShrink: 0 }}>
                              {isBroken ? (
                                <div style={{ 
                                  width: 80, 
                                  height: 120, 
                                  background: '#f8d7da', 
                                  borderRadius: 8, 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  color: '#721c24', 
                                  fontWeight: 600, 
                                  fontSize: 24, 
                                  border: '2px solid #f5c6cb' 
                                }}>
                                  !
                                </div>
                              ) : coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={displayName}
                                  style={{ 
                                    width: 80, 
                                    height: 120, 
                                    objectFit: 'cover', 
                                    borderRadius: 8, 
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)' 
                                  }}
                                />
                              ) : (
                                <div style={{ 
                                  width: 80, 
                                  height: 120, 
                                  background: '#e9ecef', 
                                  borderRadius: 8,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#6c757d'
                                }}>
                                  <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h4 style={{ 
                                fontSize: 18, 
                                fontWeight: 600, 
                                color: isBroken ? '#b94a48' : '#2a4d8f',
                                margin: '0 0 8px 0',
                                wordBreak: 'break-word'
                              }}>
                                {displayName}
                                {isBroken && (
                                  <span style={{ 
                                    marginLeft: 8, 
                                    fontSize: 12, 
                                    background: '#f8d7da', 
                                    color: '#721c24', 
                                    padding: '2px 6px', 
                                    borderRadius: 4,
                                    fontWeight: 500
                                  }}>
                                    Missing Media
                                  </span>
                                )}
                              </h4>
                              {entry.notes && (
                                <p style={{ 
                                  color: '#666', 
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
                            <div style={{ 
                              padding: '8px 12px',
                              background: '#f8f9fa',
                              borderRadius: 8,
                              fontSize: 24,
                              color: '#6c757d',
                              cursor: 'grab'
                            }}>
                              ⋮⋮
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
          <div style={{ display: 'grid', gap: 16 }}>
            {entries.map((entry) => {
              const media = entry.mediaItem;
              const isBroken = !media || !media.Id;
              const displayName = entry?.displayName || 'Unknown';
              const coverUrl = !isBroken ? (media?.CoverImageUrl || '') : '';
              return (
                <div
                  key={entry.id}
                  style={{
                    background: isBroken ? '#fff3cd' : '#fff',
                    borderRadius: 12,
                    padding: 20,
                    border: `2px solid ${isBroken ? '#ffc107' : '#e9ecef'}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20
                  }}
                  onMouseEnter={(e) => {
                    if (!isBroken) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                      e.currentTarget.style.borderColor = '#2196f3';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    e.currentTarget.style.borderColor = isBroken ? '#ffc107' : '#e9ecef';
                  }}
                >
                  <div style={{ 
                    fontSize: 18, 
                    fontWeight: 600, 
                    color: '#2a4d8f',
                    minWidth: 40,
                    textAlign: 'center',
                    background: '#f8f9fa',
                    borderRadius: 8,
                    padding: '8px 12px'
                  }}>
                    {entry.position}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {isBroken ? (
                      <div style={{ 
                        width: 80, 
                        height: 120, 
                        background: '#f8d7da', 
                        borderRadius: 8, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        color: '#721c24', 
                        fontWeight: 600, 
                        fontSize: 24, 
                        border: '2px solid #f5c6cb' 
                      }}>
                        !
                      </div>
                    ) : coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={displayName}
                        style={{ 
                          width: 80, 
                          height: 120, 
                          objectFit: 'cover', 
                          borderRadius: 8, 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)' 
                        }}
                      />
                    ) : (
                      <div style={{ 
                        width: 80, 
                        height: 120, 
                        background: '#e9ecef', 
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6c757d'
                      }}>
                        <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ 
                      fontSize: 18, 
                      fontWeight: 600, 
                      color: isBroken ? '#b94a48' : '#2a4d8f',
                      margin: '0 0 8px 0',
                      wordBreak: 'break-word'
                    }}>
                      {displayName}
                      {isBroken && (
                        <span style={{ 
                          marginLeft: 8, 
                          fontSize: 12, 
                          background: '#f8d7da', 
                          color: '#721c24', 
                          padding: '2px 6px', 
                          borderRadius: 4,
                          fontWeight: 500
                        }}>
                          Missing Media
                        </span>
                      )}
                    </h4>
                    {entry.notes && (
                      <p style={{ 
                        color: '#666', 
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
    </div>
  );
};
