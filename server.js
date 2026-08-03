const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Puzzles directory — can be overridden by env var to point at a mounted volume
const PUZZLES_DIR = process.env.PUZZLES_DIR || path.join(__dirname, 'puzzles');
app.use('/puzzles', express.static(PUZZLES_DIR));

// Get puzzles sorted by creation time
function getPuzzlesSortedByTime() {
  const puzzlesDir = PUZZLES_DIR;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

  try {
    const files = fs.readdirSync(puzzlesDir);
    const puzzles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
      })
      .map(file => {
        const filePath = path.join(puzzlesDir, file);
        const stats = fs.statSync(filePath);
        return {
          path: `puzzles/${file}`,
          created: stats.birthtime.getTime()
        };
      })
      .sort((a, b) => a.created - b.created)
      .map(p => p.path);

    return puzzles;
  } catch (err) {
    console.error('Error reading puzzles:', err);
    return [];
  }
}

// Deterministically pick today's puzzle: same image for everyone on a
// given UTC day, changes the next day. Hashing the date (rather than e.g.
// a sequential day count) keeps the rotation from being trivially
// predictable while still being stable for the whole day.
function getDailyPuzzle() {
  const puzzles = getPuzzlesSortedByTime();
  if (puzzles.length === 0) return null;

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const hash = crypto.createHash('sha256').update(date).digest();
  const index = hash.readUInt32BE(0) % puzzles.length;

  return { path: puzzles[index], date, index };
}

// API endpoint to get today's puzzle image
app.get('/api/daily-puzzle', (req, res) => {
  // The app's WKWebView loads its page from a file:// origin, so this needs
  // an explicit CORS header or the fetch() response gets blocked client-side.
  res.header('Access-Control-Allow-Origin', '*');
  const daily = getDailyPuzzle();
  if (!daily) {
    return res.status(404).json({ error: 'No puzzles available' });
  }
  res.json(daily);
});

// Upload endpoint — PUT /admin/puzzles/:filename
// Protected by UPLOAD_SECRET env var; used by upload-puzzles.sh
app.put('/admin/puzzles/:filename', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const filename = path.basename(req.params.filename);
  const dest = path.join(PUZZLES_DIR, filename);
  try {
    fs.mkdirSync(PUZZLES_DIR, { recursive: true });
    fs.writeFileSync(dest, req.body);
    res.json({ ok: true, file: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete endpoint — DELETE /admin/puzzles/:filename
// Protected by UPLOAD_SECRET env var; used by delete-puzzles.sh
app.delete('/admin/puzzles/:filename', (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const filename = path.basename(req.params.filename);
  const dest = path.join(PUZZLES_DIR, filename);
  try {
    fs.unlinkSync(dest);
    res.json({ ok: true, file: filename });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Puzzle server running at http://localhost:${PORT}`);
});
