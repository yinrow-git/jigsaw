const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Puzzles directory — can be overridden by env var to point at a mounted volume
const PUZZLES_DIR = process.env.PUZZLES_DIR || path.join(__dirname, 'puzzles');
const PUZZLES_PAGE_SIZE = 30;
app.use('/puzzles', express.static(PUZZLES_DIR));

// Daily puzzles directory — separate mounted volume, populated directly on
// Railway rather than via git/upload-puzzles.sh.
const DAILY_PUZZLES_DIR = process.env.DAILY_PUZZLES_DIR || path.join(__dirname, 'daily_puzzles');
app.use('/daily_puzzles', express.static(DAILY_PUZZLES_DIR));

// Get image files in `dir` sorted by filename — puzzle images are named
// with embedded numbers (1.jpg, 2.jpg, ... or d01.jpeg, d02.jpeg, ...), so
// this sorts by that numeric value rather than lexicographically.
// Returned paths are prefixed with `routePrefix` to match the static mount.
function getPuzzlesSortedByName(dir, routePrefix) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

  try {
    const files = fs.readdirSync(dir);
    const puzzles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(file => `${routePrefix}/${file}`);

    return puzzles;
  } catch (err) {
    console.error(`Error reading puzzles from ${dir}:`, err);
    return [];
  }
}

// Tracks which daily_puzzles/ filenames have already been served, so a
// puzzle never repeats even if it's never manually deleted. Stored on the
// same volume as the images so it survives restarts/redeploys.
const DAILY_SERVED_STATE_FILE = path.join(DAILY_PUZZLES_DIR, '.daily-served.json');

function loadDailyServedState() {
  try {
    return JSON.parse(fs.readFileSync(DAILY_SERVED_STATE_FILE, 'utf8'));
  } catch (err) {
    return { servedFiles: [], lastPickedFile: null, lastServedDate: null };
  }
}

function saveDailyServedState(state) {
  try {
    fs.writeFileSync(DAILY_SERVED_STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error('Error saving daily-served state:', err);
  }
}

// Today's puzzle is the lowest-numbered file in daily_puzzles/ that hasn't
// been served on a previous day, in filename order (d01, d02, ...). The
// pick stays stable for the whole UTC day (repeat calls return the same
// puzzle); once the day rolls over — or the current pick disappears
// because it was manually deleted — it advances to the next unserved file.
// Appending new images with higher numbers extends the queue; deleting
// served ones is optional cleanup, not required for correctness.
function getDailyPuzzle() {
  const puzzles = getPuzzlesSortedByName(DAILY_PUZZLES_DIR, 'daily_puzzles');
  const filenames = puzzles.map(p => path.basename(p));
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  const state = loadDailyServedState();

  if (state.lastServedDate === date) {
    const index = filenames.indexOf(state.lastPickedFile);
    if (index !== -1) {
      return { path: `daily_puzzles/${state.lastPickedFile}`, date, index };
    }
  }

  const servedFiles = new Set(state.servedFiles);
  const index = filenames.findIndex(f => !servedFiles.has(f));
  if (index === -1) return null;

  const picked = filenames[index];
  state.servedFiles.push(picked);
  state.lastPickedFile = picked;
  state.lastServedDate = date;
  saveDailyServedState(state);

  return { path: `daily_puzzles/${picked}`, date, index };
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

// Extracts the leading number embedded in a puzzle's filename (e.g.
// "puzzles/030.jpg" -> 30). Pagination is keyed off this number rather than
// array position, since puzzle filenames aren't guaranteed to start at 0/1.
function getPuzzleNumber(puzzlePath) {
  return parseInt(path.basename(puzzlePath), 10);
}

// API endpoint to grant a purchased pack: returns puzzle paths whose
// filename number falls in [start, start + count), so clients can page
// through the catalog by requesting fixed-size number ranges.
app.get('/api/more-puzzles', (req, res) => {
  // GET + no custom request headers keeps this a CORS "simple request" —
  // like /api/daily-puzzle, avoids needing to handle an OPTIONS preflight.
  res.header('Access-Control-Allow-Origin', '*');
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const start = Math.max(parseInt(req.query.start, 10) || 0, 0);
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 30, 1), 100);

  console.log(`more-puzzles: deviceId=${deviceId} start=${start} count=${count}`);

  const puzzles = getPuzzlesSortedByName(PUZZLES_DIR, 'puzzles');
  const inRange = puzzles.filter(p => {
    const num = getPuzzleNumber(p);
    return num >= start && num < start + count;
  });
  res.json({ puzzles: inRange });
});

// API endpoint to check whether a puzzle numbered >= start + page size exists
app.get('/api/has-more-puzzles', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const start = Math.max(parseInt(req.query.start, 10) || 0, 0);

  console.log(`has-more-puzzles: deviceId=${deviceId} start=${start}`);

  const puzzles = getPuzzlesSortedByName(PUZZLES_DIR, 'puzzles');
  const hasMore = puzzles.some(p => getPuzzleNumber(p) >= start + PUZZLES_PAGE_SIZE);
  res.json({ hasMore: hasMore ? 'TRUE' : 'FALSE' });
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

// List endpoint — GET /admin/puzzles
// Protected by UPLOAD_SECRET env var; used by delete-remote-puzzles.sh to
// find remote files that no longer exist locally. Not public, since it's
// only needed by admin tooling.
app.get('/admin/puzzles', (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(getPuzzlesSortedByName(PUZZLES_DIR, 'puzzles'));
});

// Upload endpoint — PUT /admin/daily-puzzles/:filename
// Protected by UPLOAD_SECRET env var
app.put('/admin/daily-puzzles/:filename', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const filename = path.basename(req.params.filename);
  const dest = path.join(DAILY_PUZZLES_DIR, filename);
  try {
    fs.mkdirSync(DAILY_PUZZLES_DIR, { recursive: true });
    fs.writeFileSync(dest, req.body);
    res.json({ ok: true, file: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete endpoint — DELETE /admin/daily-puzzles/:filename
// Protected by UPLOAD_SECRET env var
app.delete('/admin/daily-puzzles/:filename', (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const filename = path.basename(req.params.filename);
  const dest = path.join(DAILY_PUZZLES_DIR, filename);
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

// List endpoint — GET /admin/daily-puzzles
// Protected by UPLOAD_SECRET env var; used by delete-remote-puzzles.sh.
app.get('/admin/daily-puzzles', (req, res) => {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret || req.headers['x-upload-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(getPuzzlesSortedByName(DAILY_PUZZLES_DIR, 'daily_puzzles'));
});

app.listen(PORT, () => {
  console.log(`Puzzle server running at http://localhost:${PORT}`);
});
