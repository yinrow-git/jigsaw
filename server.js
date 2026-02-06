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

  // Find next unseen puzzle
  let nextPuzzle = null;
  let nextIndex = -1;

  for (let i = 0; i < puzzles.length; i++) {
    if (!progress.seenPuzzles.has(puzzles[i])) {
      nextPuzzle = puzzles[i];
      nextIndex = i;
      break;
    }
  }

  // If all puzzles seen, reset and start over
  if (nextPuzzle === null) {
    progress.seenPuzzles.clear();
    nextPuzzle = puzzles[0];
    nextIndex = 0;
  }

  res.json({
    puzzle: nextPuzzle,
    index: nextIndex,
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
