import express from 'express';
import cors from 'cors';
import timelinesRouter from './routes/timelines';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('TimelineVerse backend running!');
});

app.use('/api/timelines', timelinesRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
