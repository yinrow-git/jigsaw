const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Track user progress: { oderId: { oderedPuzzles: [...], currentIndex: 0 } }
const userProgress = new Map();

// Cookie parser middleware
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Serve static files
app.use(express.static(__dirname));

// Get puzzles sorted by creation time
function getPuzzlesSortedByTime() {
  const puzzlesDir = path.join(__dirname, 'puzzles');
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

// API endpoint to get next puzzle for user
app.get('/api/puzzles', (req, res) => {
  const puzzles = getPuzzlesSortedByTime();
  res.json(puzzles);
});

// API endpoint to get next unseen puzzle for user
app.get('/api/next-puzzle', (req, res) => {
  let userId = req.cookies.puzzleUserId;
  // Use index to avoid Unicode encoding issues with filenames
  const currentIndex = req.query.currentIndex !== undefined ? parseInt(req.query.currentIndex) : -1;

  // Create new user ID if not exists
  if (!userId) {
    userId = crypto.randomUUID();
    res.cookie('puzzleUserId', userId, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true
    });
  }

  const puzzles = getPuzzlesSortedByTime();

  if (puzzles.length === 0) {
    return res.json({ puzzle: null, index: -1, total: 0 });
  }

  // Get or create user progress
  if (!userProgress.has(userId)) {
    userProgress.set(userId, { seenPuzzles: new Set(), currentIndex: 0 });
  }

  const progress = userProgress.get(userId);

  // Find unseen puzzles (excluding current by index)
  let unseenPuzzles = puzzles
    .map((p, i) => ({ puzzle: p, index: i }))
    .filter(item => !progress.seenPuzzles.has(item.puzzle) && item.index !== currentIndex);

  // If no unseen puzzles, reset and get all except current
  if (unseenPuzzles.length === 0) {
    progress.seenPuzzles.clear();
    unseenPuzzles = puzzles
      .map((p, i) => ({ puzzle: p, index: i }))
      .filter(item => item.index !== currentIndex);
  }

  // If still no puzzles (only one puzzle exists), return current
  if (unseenPuzzles.length === 0) {
    return res.json({
      puzzle: puzzles[currentIndex] || puzzles[0],
      index: currentIndex >= 0 ? currentIndex : 0,
      total: puzzles.length
    });
  }

  // Pick a random puzzle from unseen
  const randomChoice = unseenPuzzles[Math.floor(Math.random() * unseenPuzzles.length)];

  res.json({
    puzzle: randomChoice.puzzle,
    index: randomChoice.index,
    total: puzzles.length
  });
});

// API endpoint to mark puzzle as seen
app.post('/api/mark-seen/:index', express.json(), (req, res) => {
  const userId = req.cookies.puzzleUserId;
  const puzzleIndex = parseInt(req.params.index);
  const puzzles = getPuzzlesSortedByTime();

  if (userId && userProgress.has(userId) && puzzleIndex >= 0 && puzzleIndex < puzzles.length) {
    userProgress.get(userId).seenPuzzles.add(puzzles[puzzleIndex]);
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Puzzle server running at http://localhost:${PORT}`);
});
