import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTimeline } from '../services/timelineService';

export const TimelineCreateForm: React.FC = () => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) {
      setError('Title is required');
      return;
    }
    setLoading(true);
    try {
      const timeline = await createTimeline({ name, description, sortOrder });
      setLoading(false);
      navigate(`/timelines/${timeline.id}`); // Redirect to timeline view
    } catch (err) {
      setLoading(false);
      setError('Failed to create timeline');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{
      maxWidth: 400,
      margin: '0 auto',
      background: '#fff',
      borderRadius: 12,
      boxShadow: '0 2px 12px #0001',
      padding: 32,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: 24 }}>Create New Timeline</h2>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Title"
        required
        style={{
          padding: '10px 14px',
          borderRadius: 6,
          border: '1px solid #ccc',
          fontSize: 16
        }}
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description"
        rows={3}
        style={{
          padding: '10px 14px',
          borderRadius: 6,
          border: '1px solid #ccc',
          fontSize: 16,
          resize: 'vertical'
        }}
      />
      <select
        value={sortOrder}
        onChange={e => setSortOrder(e.target.value as 'chronological' | 'release')}
        style={{
          padding: '10px 14px',
          borderRadius: 6,
          border: '1px solid #ccc',
          fontSize: 16
        }}
      >
        <option value="chronological">Chronological</option>
        <option value="release">Release Order</option>
      </select>
      <button
        type="submit"
        disabled={loading}
        style={{
          background: '#2a4d8f',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '12px 0',
          fontSize: 16,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          marginTop: 8
        }}
      >
        {loading ? 'Creating...' : 'Create Timeline'}
      </button>
      {error && <div style={{ color: 'red', textAlign: 'center' }}>{error}</div>}
    </form>
  );
};
