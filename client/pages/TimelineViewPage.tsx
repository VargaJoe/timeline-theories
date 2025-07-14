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
// DropResult and other types are not exported as types in some versions, so use 'any' as a workaround for build compatibility
type DropResult = any;
type DraggableProvided = any;
type DraggableStateSnapshot = any;
type DroppableProvided = any;
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
        {/* Trakt Import Button/Modal */}
        <TraktImportDialog
          timelineName={timeline.name}
          onImportComplete={() => {
            // Optionally reload entries after import
            setEntriesLoading(true);
            TimelineEntryService.listTimelineEntries(Number(timeline.id), `${timelinesPath}/${timeline.name}`)
              .then(setEntries)
              .finally(() => setEntriesLoading(false));
          }}
        />
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
          <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={() => setEditMode(m => !m)}
              style={{ background: '#007bff', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 500, fontSize: 16, cursor: 'pointer' }}
            >
              {editMode ? 'Cancel Edit' : 'Edit'}
            </button>
            <Link to={`/timelines/${timelineName}/add-entry`} style={{ background: '#2a4d8f', color: '#fff', padding: '8px 16px', borderRadius: 6, textDecoration: 'none', fontWeight: 500, fontSize: 16 }}>
              + Add Media Entry
            </Link>
            <button
              onClick={toggleReorderMode}
              style={{
                background: reorderMode ? '#28a745' : '#ffc107',
                color: reorderMode ? '#fff' : '#333',
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                fontWeight: 500,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              {reorderMode ? 'Save Order' : 'Reorder Entries'}
            </button>
            <button
              onClick={() => setShowBulkUpdateDialog(true)}
              style={{
                background: '#17a2b8',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                fontWeight: 500,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              Update Media Data
            </button>
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
              style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 500, fontSize: 16, cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        )}
        <h3 style={{ marginBottom: 16 }}>Timeline Entries</h3>
        {entriesLoading ? (
          <div>Loading entries...</div>
        ) : entries.length === 0 ? (
          <div style={{ color: '#888', fontStyle: 'italic' }}>No entries yet.</div>
        ) : reorderMode && pendingOrder ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="timeline-entries">
              {(provided: DroppableProvided) => (
                <table
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ width: '100%', borderCollapse: 'collapse', background: '#f8f9fa', borderRadius: 8 }}
                >
                  <thead>
                    <tr style={{ background: '#e9ecef' }}>
                      <th style={{ padding: 8, textAlign: 'left' }}>#</th>
                      <th style={{ padding: 8, textAlign: 'left' }}>Media</th>
                      <th style={{ padding: 8, textAlign: 'left' }}>Title</th>
                      <th style={{ padding: 8, textAlign: 'left' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingOrder.map((entry, idx) => {
                      const media = entry.mediaItem;
                      const isBroken = !media || !media.Id;
                      const displayName = entry?.displayName || 'Unknown';
                      const coverUrl = !isBroken ? (media?.CoverImageUrl || '') : '';
                      return (
                        <Draggable key={entry.id} draggableId={entry.id} index={idx}>
                          {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                            <tr
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{
                                borderBottom: '1px solid #e9ecef',
                                background: snapshot.isDragging ? '#d1ecf1' : isBroken ? '#fff3cd' : undefined,
                                ...provided.draggableProps.style
                              }}
                            >
                              <td style={{ padding: 8 }}>{idx + 1}</td>
                              <td style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                                {isBroken ? (
                                  <div style={{ width: 48, height: 72, background: '#f8d7da', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#721c24', fontWeight: 600, fontSize: 12, border: '1px solid #f5c6cb' }}>
                                    !
                                  </div>
                                ) : coverUrl ? (
                                  <img
                                    src={coverUrl}
                                    alt={displayName}
                                    style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px #0002' }}
                                  />
                                ) : (
                                  <div style={{ width: 48, height: 72, background: '#ddd', borderRadius: 4 }} />
                                )}
                              </td>
                              <td style={{ padding: 8 }}>
                                <span style={{ fontWeight: 500, color: isBroken ? '#b94a48' : undefined }}>
                                  {displayName}
                                </span>
                              </td>
                              <td style={{ padding: 8 }}>{entry.notes || ''}</td>
                            </tr>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </tbody>
                </table>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#f8f9fa', borderRadius: 8 }}>
            <thead>
              <tr style={{ background: '#e9ecef' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>#</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Media</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Title</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const media = entry.mediaItem;
                const isBroken = !media || !media.Id;
                const displayName = entry?.displayName || 'Unknown';
                const coverUrl = !isBroken ? (media?.CoverImageUrl || '') : '';
                return (
                  <tr
                    key={entry.id}
                    style={{ borderBottom: '1px solid #e9ecef', background: isBroken ? '#fff3cd' : undefined }}
                  >
                    <td style={{ padding: 8 }}>{entry.position}</td>
                    <td style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      {isBroken ? (
                        <div style={{ width: 48, height: 72, background: '#f8d7da', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#721c24', fontWeight: 600, fontSize: 12, border: '1px solid #f5c6cb' }}>
                          !
                        </div>
                      ) : coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={displayName}
                          style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px #0002' }}
                        />
                      ) : (
                        <div style={{ width: 48, height: 72, background: '#ddd', borderRadius: 4 }} />
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <span style={{ fontWeight: 500, color: isBroken ? '#b94a48' : undefined }}>
                        {displayName}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>{entry.notes || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
