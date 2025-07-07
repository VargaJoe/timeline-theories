import { Router } from 'express';
import { pool } from '../db';

const router = Router();

// Create timeline
router.post('/', async (req, res) => {
  const { name, description, sortOrder } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO timelines (name, description, sort_order) VALUES ($1, $2, $3) RETURNING *',
      [name, description, sortOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// List timelines
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM timelines ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
