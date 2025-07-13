import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTimeline } from '../services/timelineService';

export const TimelineCreateForm: React.FC = () => {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');  
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    
    if (!name.trim()) {
      setError('Title is required');
      return;
    }
    
    if (name.trim().length < 3) {
      setError('Title must be at least 3 characters long');
      return;
    }
    
    setLoading(true);
    try {
      console.log('Creating timeline with data:', { name: name.trim(), displayName: displayName.trim(), description: description.trim(), sortOrder });
      const timeline = await createTimeline({ 
        name: name.trim(), 
        displayName: displayName.trim(),
        description: description.trim() || undefined, 
        sortOrder 
      });
      console.log('Timeline created successfully:', timeline);
      setSuccess(true);
      setLoading(false);
      
      // Show success message briefly, then redirect
      setTimeout(() => {
        navigate(`/timelines/${timeline.name}`);
      }, 1500);
    } catch (err) {
      console.error('Timeline creation error:', err);
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to create timeline');
    }
  };

  if (success) {
    return (
      <div style={{
        maxWidth: 400,
        margin: '0 auto',
        background: '#d4edda',
        borderRadius: 12,
        border: '1px solid #c3e6cb',
        padding: 32,
        textAlign: 'center'
      }}>
        <h2 style={{ color: '#155724', marginBottom: 16 }}>Timeline Created!</h2>
        <p style={{ color: '#155724', margin: 0 }}>
          Redirecting you to your new timeline...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{
      maxWidth: 400,
      margin: '0 auto',
      background: '#fff',
      borderRadius: 12,
      boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      padding: 32,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: 24, color: '#2a4d8f' }}>Create New Timeline</h2>
      
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Title *</label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Enter timeline title..."
          required
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 6,
            border: '1px solid #ccc',
            fontSize: 16,
            boxSizing: 'border-box'
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Url *</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter timeline url slug..."
          required
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 6,
            border: '1px solid #ccc',
            fontSize: 16,
            boxSizing: 'border-box'
          }}
        />
      </div>
      
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe your timeline..."
          rows={3}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 6,
            border: '1px solid #ccc',
            fontSize: 16,
            resize: 'vertical',
            boxSizing: 'border-box'
          }}
        />
      </div>
      
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Sort Order</label>
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value as 'chronological' | 'release')}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 6,
            border: '1px solid #ccc',
            fontSize: 16,
            boxSizing: 'border-box'
          }}
        >
          <option value="chronological">Chronological Order</option>
          <option value="release">Release Order</option>
        </select>
      </div>
      
      <button
        type="submit"
        disabled={loading}
        style={{
          background: loading ? '#6c757d' : '#2a4d8f',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '14px 0',
          fontSize: 16,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          marginTop: 8,
          transition: 'background-color 0.2s'
        }}
      >
        {loading ? 'Creating Timeline...' : 'Create Timeline'}
      </button>
      
      {error && (
        <div style={{ 
          color: '#721c24', 
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: 4,
          padding: '12px',
          textAlign: 'center',
          fontSize: 14
        }}>
          {error}
        </div>
      )}
    </form>
  );
};
