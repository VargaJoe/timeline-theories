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
    <form onSubmit={handleSubmit}>
      <h2>Create New Timeline</h2>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Title"
        required
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description"
      />
      <select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'chronological' | 'release')}>
        <option value="chronological">Chronological</option>
        <option value="release">Release Order</option>
      </select>
      <button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Timeline'}</button>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </form>
  );
};
