import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Timeline } from '../services/timelineService';
import { repository } from '../services/sensenet';

export const TimelineViewPage: React.FC = () => {
  const { id } = useParams();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    
    const loadTimeline = async () => {
      try {
        setLoading(true);
        // Load the specific timeline by ID
        const result = await repository.load({
          idOrPath: Number(id),
          oDataOptions: {
            select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
          },
        });
        
        setTimeline({
          id: String(result.d.Id),
          name: result.d.DisplayName,
          description: result.d.Description || '',
          sort_order: result.d.SortOrder || 'chronological',
          created_at: result.d.CreationDate,
        });
      } catch (err) {
        console.error('Failed to load timeline:', err);
        setError('Failed to load timeline');
      } finally {
        setLoading(false);
      }
    };

    loadTimeline();
  }, [id]);

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
        <h1 style={{ marginBottom: 16, color: '#2a4d8f' }}>{timeline.name}</h1>
        
        {timeline.description && (
          <p style={{ 
            color: '#666', 
            marginBottom: 24, 
            lineHeight: 1.6,
            fontSize: 16 
          }}>
            {timeline.description}
          </p>
        )}
        
        <div style={{ 
          display: 'flex', 
          gap: 24, 
          marginBottom: 32,
          fontSize: 14,
          color: '#888'
        }}>
          <div>
            <strong>Sort Order:</strong> {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
          </div>
          {timeline.created_at && (
            <div>
              <strong>Created:</strong> {new Date(timeline.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
        
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          color: '#666'
        }}>
          <p style={{ margin: 0, fontSize: 16 }}>
            This timeline is ready for media entries!
          </p>
          <p style={{ margin: '8px 0 0 0', fontSize: 14 }}>
            Media entry management will be available in the next development phase.
          </p>
        </div>
      </div>
    </div>
  );
};
