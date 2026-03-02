import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3444;

const DATA_DIR = path.join(process.cwd(), 'data');

// Helper to read JSON files
const readJsonFile = (filename: string) => {
  try {
    const filepath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) { console.error(e); }
  return null;
};

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/status', (req, res) => {
  res.json({ status: 'running', service: 'clawdwatch-lobster-edition', port: PORT, version: '1.0.0-lobster' });
});

app.get('/status', (req, res) => {
  const data = readJsonFile('status.json') || { message: 'No data available for status' };
  res.json(data);
}); app.get('/osint', (req, res) => {
  const data = readJsonFile('osint.json') || { message: 'No data available for osint' };
  res.json(data);
}); app.get('/conflict', (req, res) => {
  const data = readJsonFile('conflict.json') || { message: 'No data available for conflict' };
  res.json(data);
}); app.get('/flights', (req, res) => {
  const data = readJsonFile('flights.json') || { message: 'No data available for flights' };
  res.json(data);
}); app.get('/ships', (req, res) => {
  const data = readJsonFile('ships.json') || { message: 'No data available for ships' };
  res.json(data);
}); app.get('/snapshot', (req, res) => {
  const data = readJsonFile('snapshot.json') || { message: 'No data available for snapshot' };
  res.json(data);
}); app.get('/regions', (req, res) => {
  const data = readJsonFile('regions.json') || { message: 'No data available for regions' };
  res.json(data);
}); -join "
"

app.listen(PORT, () => {
  console.log(Clawdwatch HTTP API running on port 3444);
});
