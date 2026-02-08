(function () {
  let GRID = 3;
  const MAX_BOARD = 390;
  let boardW = 0;
  let boardH = 0;
  let cellW = 0;
  let cellH = 0;

  const gameSection = document.getElementById("game-section");
  const puzzleBoard = document.getElementById("puzzle-board");
  const newGameBtn = document.getElementById("new-game-btn");
  const shareBtn = document.getElementById("share-btn");
  const winOverlay = document.getElementById("win-overlay");
  const playAgainBtn = document.getElementById("play-again-btn");
  const pointsDisplay = document.getElementById("points-display");
  const hintBtn = document.getElementById("hint-btn");
  const hintContainer = document.getElementById("hint-container");
  const hintImage = document.getElementById("hint-image");

  // Config panel elements
  const configOverlay = document.getElementById("config-overlay");
  const configBtn = document.getElementById("config-btn");
  const configApplyBtn = document.getElementById("config-apply-btn");
  const sizeOptions = document.getElementById("size-options");

  let pieces = []; // { canvas, index }
  let solved = false;
  let audioCtx = null;
  let currentImg = null;
  let currentDataUrl = null;

  // Drag state
  let dragGroup = null; // array of { cellIndex, canvas, rowOff, colOff }
  let dragAnchorCell = null; // cell index of the clicked piece
  let dragSourceCells = null; // Map: cellIndex -> canvas (original positions)
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragCellW = 0;
  let dragCellH = 0;
  let groupsBefore = null; // group count before drag, to detect new connections

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (required by browsers after user interaction)
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Initialize audio context on first user interaction
  function initAudio() {
    getAudioCtx();
    document.removeEventListener('mousedown', initAudio);
    document.removeEventListener('touchstart', initAudio);
  }
  document.addEventListener('mousedown', initAudio);
  document.addEventListener('touchstart', initAudio);

  function playSnapSound() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(587, ctx.currentTime);      // D5
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08); // G5
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  }

  function playStartSound() {
    const ctx = getAudioCtx();
    // Gentle ascending chime
    const notes = [392, 440, 494]; // G4, A4, B4
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  function playDiamondSound() {
    const ctx = getAudioCtx();
    // Sparkly coin-like sound
    const notes = [1318, 1568, 2093]; // E6, G6, C7
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  function playClickSound() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.value = 600;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  }

  function playWinSound() {
    const ctx = getAudioCtx();
    // Triumphant fanfare melody
    const melody = [
      { freq: 523, time: 0, duration: 0.15 },     // C5
      { freq: 523, time: 0.15, duration: 0.15 },  // C5
      { freq: 523, time: 0.3, duration: 0.15 },   // C5
      { freq: 659, time: 0.45, duration: 0.4 },   // E5
      { freq: 523, time: 0.9, duration: 0.15 },   // C5
      { freq: 659, time: 1.05, duration: 0.15 },  // E5
      { freq: 784, time: 1.2, duration: 0.6 },    // G5
    ];

    melody.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "triangle";
      osc.frequency.value = note.freq;
      const t = ctx.currentTime + note.time;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
      gain.gain.setValueAtTime(0.35, t + note.duration * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.duration);

      osc.start(t);
      osc.stop(t + note.duration);
    });

    // Add harmony
    const harmony = [
      { freq: 392, time: 0.45, duration: 0.4 },   // G4
      { freq: 392, time: 1.05, duration: 0.15 },  // G4
      { freq: 523, time: 1.2, duration: 0.6 },    // C5
    ];

    harmony.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = note.freq;
      const t = ctx.currentTime + note.time;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
      gain.gain.setValueAtTime(0.2, t + note.duration * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.duration);

      osc.start(t);
      osc.stop(t + note.duration);
    });
  }

  // Fireworks celebration
  function createFireworks() {
    const container = document.createElement("div");
    container.className = "fireworks-container";
    document.body.appendChild(container);

    const colors = ["#e07a5f", "#81b29a", "#f4e4ba", "#d4a373", "#f2cc8f"];

    function launchFirework() {
      const x = Math.random() * window.innerWidth;
      const y = Math.random() * window.innerHeight * 0.6;
      const particleCount = 40 + Math.floor(Math.random() * 20);

      for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement("div");
        particle.className = "firework-particle";
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

        const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.3;
        const velocity = 60 + Math.random() * 100;
        const dx = Math.cos(angle) * velocity;
        const dy = Math.sin(angle) * velocity;
        const size = 4 + Math.random() * 6;

        particle.style.width = size + "px";
        particle.style.height = size + "px";
        particle.style.setProperty("--dx", dx + "px");
        particle.style.setProperty("--dy", dy + "px");

        container.appendChild(particle);

        setTimeout(() => particle.remove(), 1200);
      }
    }

    // Launch multiple fireworks in waves
    for (let i = 0; i < 15; i++) {
      setTimeout(launchFirework, i * 200);
    }

    // Second wave
    for (let i = 0; i < 10; i++) {
      setTimeout(launchFirework, 3000 + i * 150);
    }

    // Clean up container
    setTimeout(() => container.remove(), 6000);
  }

  // --- Group logic ---

  function computeGroups() {
    const cells = document.querySelectorAll(".grid-cell");
    // Build a map: cellIndex -> pieceIndex (the piece's correct index)
    const cellToPiece = new Map();
    cells.forEach((cell) => {
      const canvas = cell.querySelector(".puzzle-piece");
      if (canvas) {
        cellToPiece.set(parseInt(cell.dataset.index), parseInt(canvas.dataset.index));
      }
    });

    // For each piece, compute offset = currentPos - correctPos
    // Two adjacent pieces connect if they have the same offset
    function getOffset(cellIndex) {
      const pieceIndex = cellToPiece.get(cellIndex);
      if (pieceIndex === undefined) return null;
      const currentRow = Math.floor(cellIndex / GRID);
      const currentCol = cellIndex % GRID;
      const correctRow = Math.floor(pieceIndex / GRID);
      const correctCol = pieceIndex % GRID;
      return { dr: currentRow - correctRow, dc: currentCol - correctCol };
    }

    // Adjacent pairs (right and down neighbors)
    const adjacentPairs = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        if (c < GRID - 1) adjacentPairs.push([idx, idx + 1]); // right
        if (r < GRID - 1) adjacentPairs.push([idx, idx + GRID]); // down
      }
    }

    // Build adjacency for connected pieces
    const connected = new Map(); // cellIndex -> Set of connected cellIndices
    for (let i = 0; i < GRID * GRID; i++) {
      if (cellToPiece.has(i)) connected.set(i, new Set());
    }

    for (const [a, b] of adjacentPairs) {
      const offA = getOffset(a);
      const offB = getOffset(b);
      if (offA && offB && offA.dr === offB.dr && offA.dc === offB.dc) {
        connected.get(a).add(b);
        connected.get(b).add(a);
      }
    }

    // BFS to find connected components
    const visited = new Set();
    const cellToGroup = new Map();
    let groupId = 0;

    for (const cellIndex of connected.keys()) {
      if (visited.has(cellIndex)) continue;
      const queue = [cellIndex];
      visited.add(cellIndex);
      const component = [];
      while (queue.length > 0) {
        const curr = queue.shift();
        component.push(curr);
        for (const neighbor of connected.get(curr)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      for (const ci of component) {
        cellToGroup.set(ci, groupId);
      }
      groupId++;
    }

    return cellToGroup;
  }

  function getGroup(cellIndex) {
    const cellToGroup = computeGroups();
    const myGroup = cellToGroup.get(cellIndex);
    if (myGroup === undefined) return [cellIndex];
    const members = [];
    for (const [ci, gid] of cellToGroup) {
      if (gid === myGroup) members.push(ci);
    }
    return members;
  }

  function updateGroupVisuals() {
    const cells = document.querySelectorAll(".grid-cell");
    const cellToGroup = computeGroups();

    // Count group sizes
    const groupSizes = new Map();
    for (const [, gid] of cellToGroup) {
      groupSizes.set(gid, (groupSizes.get(gid) || 0) + 1);
    }

    cells.forEach((cell) => {
      const ci = parseInt(cell.dataset.index);
      const canvas = cell.querySelector(".puzzle-piece");
      const row = Math.floor(ci / GRID);
      const col = ci % GRID;

      // Clear group classes
      cell.classList.remove("group-right", "group-bottom", "group-left", "group-top");
      if (canvas) {
        canvas.classList.remove("grouped", "correct");

        // Mark correct position
        if (parseInt(canvas.dataset.index) === ci) {
          canvas.classList.add("correct");
        }
      }

      const myGroup = cellToGroup.get(ci);
      if (myGroup === undefined || groupSizes.get(myGroup) < 2) return;

      // This cell is part of a multi-piece group
      if (canvas) canvas.classList.add("grouped");

      // Check neighbors and hide internal borders
      // Right neighbor
      if (col < GRID - 1) {
        const rightIdx = ci + 1;
        if (cellToGroup.get(rightIdx) === myGroup) {
          cell.classList.add("group-right");
        }
      }
      // Bottom neighbor
      if (row < GRID - 1) {
        const bottomIdx = ci + GRID;
        if (cellToGroup.get(bottomIdx) === myGroup) {
          cell.classList.add("group-bottom");
        }
      }
      // Left neighbor
      if (col > 0) {
        const leftIdx = ci - 1;
        if (cellToGroup.get(leftIdx) === myGroup) {
          cell.classList.add("group-left");
        }
      }
      // Top neighbor
      if (row > 0) {
        const topIdx = ci - GRID;
        if (cellToGroup.get(topIdx) === myGroup) {
          cell.classList.add("group-top");
        }
      }
    });
  }

  // --- Grid building ---

  function getBoardDimensions(imgW, imgH) {
    var ratio = imgW / imgH;
    var maxW = Math.min(MAX_BOARD, window.innerWidth - 40);
    var maxH = window.innerHeight - 160;
    var w = maxW;
    var h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w: Math.floor(w), h: Math.floor(h) };
  }

  function buildGrid(n) {
    GRID = n;
    var dim = getBoardDimensions(currentImg.width, currentImg.height);
    boardW = dim.w;
    boardH = dim.h;
    cellW = Math.floor(boardW / GRID);
    cellH = Math.floor(boardH / GRID);

    puzzleBoard.style.width = boardW + "px";
    puzzleBoard.style.height = boardH + "px";
    puzzleBoard.innerHTML = "";

    for (let i = 0; i < n * n; i++) {
      const row = Math.floor(i / n);
      const col = i % n;
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.index = i;
      if (row === 0) cell.style.borderTopWidth = "0";
      if (row === n - 1) cell.style.borderBottomWidth = "0";
      if (col === 0) cell.style.borderLeftWidth = "0";
      if (col === n - 1) cell.style.borderRightWidth = "0";
      puzzleBoard.appendChild(cell);
    }
    puzzleBoard.style.gridTemplateColumns = "repeat(" + n + ", 1fr)";
    puzzleBoard.style.gridTemplateRows = "repeat(" + n + ", 1fr)";
  }

  // --- Game setup ---

  function startGame(img, dataUrl) {
    currentImg = img;
    currentDataUrl = dataUrl;
    puzzleBoard.classList.remove("win");
    winOverlay.classList.add("hidden");
    hintContainer.classList.add("hidden");
    solved = false;

    buildGrid(GRID);
    generatePieces(img);
    shufflePieces();
    playStartSound();
  }

  function generatePieces(img) {
    const cells = document.querySelectorAll(".grid-cell");
    cells.forEach((cell) => {
      cell.innerHTML = "";
    });
    pieces = [];

    const srcW = img.width / GRID;
    const srcH = img.height / GRID;

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const index = row * GRID + col;
        const canvas = document.createElement("canvas");
        canvas.width = cellW;
        canvas.height = cellH;
        canvas.classList.add("puzzle-piece");
        canvas.dataset.index = index;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          img,
          col * srcW,
          row * srcH,
          srcW,
          srcH,
          0,
          0,
          cellW,
          cellH
        );

        attachDragEvents(canvas);
        pieces.push({ canvas, index });
      }
    }
  }

  function shufflePieces() {
    puzzleBoard.classList.remove("win");
    winOverlay.classList.add("hidden");
    solved = false;

    // Create shuffled index order (ensure it's not already solved)
    const order = Array.from({ length: GRID * GRID }, (_, i) => i);
    do {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order.every((v, i) => v === i));

    const cells = document.querySelectorAll(".grid-cell");
    cells.forEach((cell) => {
      cell.innerHTML = "";
      cell.classList.remove("group-right", "group-bottom", "group-left", "group-top");
    });

    order.forEach((pieceIdx, cellIdx) => {
      const p = pieces[pieceIdx];
      p.canvas.classList.remove("dragging", "correct", "grouped", "shuffle-in");
      p.canvas.style.position = "";
      p.canvas.style.left = "";
      p.canvas.style.top = "";
      p.canvas.style.width = "100%";
      p.canvas.style.height = "100%";

      // Add shuffle animation with staggered delay
      p.canvas.style.animationDelay = (cellIdx * 0.02) + "s";
      p.canvas.classList.add("shuffle-in");

      cells[cellIdx].appendChild(p.canvas);
    });

    updateGroupVisuals();
  }

  // --- Drag and drop ---

  function attachDragEvents(canvas) {
    canvas.addEventListener("mousedown", onDragStart);
    canvas.addEventListener("touchstart", onDragStart, { passive: false });
  }

  function resetCanvasStyle(canvas) {
    canvas.classList.remove("dragging");
    canvas.style.position = "";
    canvas.style.left = "";
    canvas.style.top = "";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  function onDragStart(e) {
    if (solved) return;
    e.preventDefault();

    const canvas = e.currentTarget;
    const cell = canvas.parentElement;
    if (!cell || !cell.classList.contains("grid-cell")) return;

    const anchorCellIndex = parseInt(cell.dataset.index);
    const anchorRow = Math.floor(anchorCellIndex / GRID);
    const anchorCol = anchorCellIndex % GRID;

    // Get all cells in the same group
    const groupCellIndices = getGroup(anchorCellIndex);

    const cells = document.querySelectorAll(".grid-cell");

    // Count groups before the drag (to detect new connections after drop)
    const cellToGroupBefore = computeGroups();
    const groupIdsBefore = new Set(cellToGroupBefore.values());
    groupsBefore = groupIdsBefore.size;

    // Store source positions
    dragSourceCells = new Map();
    dragGroup = [];

    for (const ci of groupCellIndices) {
      const groupCanvas = cells[ci].querySelector(".puzzle-piece");
      if (!groupCanvas) continue;
      const ciRow = Math.floor(ci / GRID);
      const ciCol = ci % GRID;
      dragSourceCells.set(ci, groupCanvas);
      dragGroup.push({
        cellIndex: ci,
        canvas: groupCanvas,
        rowOff: ciRow - anchorRow,
        colOff: ciCol - anchorCol,
      });
    }

    dragAnchorCell = anchorCellIndex;
    const boardRect = puzzleBoard.getBoundingClientRect();
    dragCellW = boardRect.width / GRID;
    dragCellH = boardRect.height / GRID;

    // Compute cursor offset from the anchor piece
    const anchorRect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragOffsetX = clientX - anchorRect.left;
    dragOffsetY = clientY - anchorRect.top;

    // Lift all group pieces out of their cells
    for (const item of dragGroup) {
      const rect = item.canvas.getBoundingClientRect();
      item.canvas.classList.add("dragging");
      item.canvas.style.left = rect.left + "px";
      item.canvas.style.top = rect.top + "px";
      item.canvas.style.width = dragCellW + "px";
      item.canvas.style.height = dragCellH + "px";
      document.body.appendChild(item.canvas);
    }

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
  }

  function onDragMove(e) {
    if (!dragGroup) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Position each piece relative to cursor
    for (const item of dragGroup) {
      const left = clientX - dragOffsetX + item.colOff * dragCellW;
      const top = clientY - dragOffsetY + item.rowOff * dragCellH;
      item.canvas.style.left = left + "px";
      item.canvas.style.top = top + "px";
    }

    // Highlight the cell under the cursor (anchor target)
    const cells = document.querySelectorAll(".grid-cell");
    cells.forEach((cell) => cell.classList.remove("highlight"));
    const target = findCellUnder(clientX, clientY);
    if (target) {
      const targetIdx = parseInt(target.dataset.index);
      // Highlight all target cells for the group
      for (const item of dragGroup) {
        const targetRow = Math.floor(targetIdx / GRID) + item.rowOff;
        const targetCol = (targetIdx % GRID) + item.colOff;
        if (targetRow >= 0 && targetRow < GRID && targetCol >= 0 && targetCol < GRID) {
          const tci = targetRow * GRID + targetCol;
          cells[tci].classList.add("highlight");
        }
      }
    }
  }

  function onDragEnd(e) {
    if (!dragGroup) return;

    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.removeEventListener("touchmove", onDragMove);
    document.removeEventListener("touchend", onDragEnd);

    // Clear highlights
    document.querySelectorAll(".grid-cell").forEach((cell) => {
      cell.classList.remove("highlight");
    });

    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

    const targetCell = findCellUnder(clientX, clientY);
    const cells = document.querySelectorAll(".grid-cell");

    let dropped = false;

    if (targetCell) {
      const targetIdx = parseInt(targetCell.dataset.index);
      const targetRow = Math.floor(targetIdx / GRID);
      const targetCol = targetIdx % GRID;

      // Compute all target cells for the group
      const targetCells = []; // { cellIndex, canvas }
      let valid = true;

      const draggedCellIndices = new Set(dragGroup.map((item) => item.cellIndex));

      for (const item of dragGroup) {
        const tRow = targetRow + item.rowOff;
        const tCol = targetCol + item.colOff;

        // Check bounds
        if (tRow < 0 || tRow >= GRID || tCol < 0 || tCol >= GRID) {
          valid = false;
          break;
        }

        const tci = tRow * GRID + tCol;
        targetCells.push({ cellIndex: tci, canvas: item.canvas });
      }

      if (valid) {
        const targetCellIndices = new Set(targetCells.map((t) => t.cellIndex));

        // Collect displaced pieces (only pieces directly in target cells)
        const displaced = [];
        for (const tci of targetCellIndices) {
          if (draggedCellIndices.has(tci)) continue;
          const canvas = cells[tci].querySelector(".puzzle-piece");
          if (canvas) displaced.push(canvas);
        }

        // Collect vacated cells: source cells that aren't also target cells
        const vacatedCells = [];
        for (const sci of draggedCellIndices) {
          if (!targetCellIndices.has(sci)) {
            vacatedCells.push(sci);
          }
        }

        // Check if there's room for displaced pieces
        if (displaced.length > vacatedCells.length) {
          valid = false;
        }

        if (valid) {
          // Remove displaced pieces from their cells first
          for (const canvas of displaced) {
            if (canvas.parentElement) {
              canvas.parentElement.removeChild(canvas);
            }
          }

          // Place group pieces into target cells
          for (const tc of targetCells) {
            resetCanvasStyle(tc.canvas);
            cells[tc.cellIndex].appendChild(tc.canvas);
          }

          // Place displaced pieces into vacated cells
          for (let i = 0; i < displaced.length; i++) {
            resetCanvasStyle(displaced[i]);
            cells[vacatedCells[i]].appendChild(displaced[i]);
          }

          dropped = true;
        }
      }
    }

    if (!dropped) {
      // Return all pieces to original cells
      for (const [ci, canvas] of dragSourceCells) {
        resetCanvasStyle(canvas);
        cells[ci].appendChild(canvas);
      }
    }

    // Update visuals and check for new connections
    const cellToGroupAfter = computeGroups();
    const groupIdsAfter = new Set(cellToGroupAfter.values());
    if (dropped && groupsBefore !== null && groupIdsAfter.size < groupsBefore) {
      playSnapSound();
    }

    dragGroup = null;
    dragAnchorCell = null;
    dragSourceCells = null;
    groupsBefore = null;

    updateGroupVisuals();
    checkWin();
  }

  function findCellUnder(x, y) {
    const cells = document.querySelectorAll(".grid-cell");
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return cell;
      }
    }
    return null;
  }

  function checkWin() {
    const cells = document.querySelectorAll(".grid-cell");
    const allCorrect = Array.from(cells).every((cell) => {
      const canvas = cell.querySelector(".puzzle-piece");
      if (!canvas) return false;
      return parseInt(canvas.dataset.index) === parseInt(cell.dataset.index);
    });

    if (allCorrect) {
      solved = true;
      markPuzzleSolved(lastPuzzleIndex);
      markPuzzleSeen(lastPuzzleIndex);
      addPoints(getPointsForGrid(GRID));
      puzzleBoard.classList.add("win");
      playWinSound();
      createFireworks();

      // Delay showing the overlay so user can view the solved image
      setTimeout(() => {
        winOverlay.classList.remove("hidden");
      }, 1500);
    }
  }

  // --- Controls ---

  newGameBtn.addEventListener("click", () => {
    playClickSound();
    loadRandomPuzzle();
  });

  playAgainBtn.addEventListener("click", (e) => {
    e.preventDefault();
    playClickSound();
    loadRandomPuzzle();
  });

  // Config panel handlers
  configBtn.addEventListener("click", () => {
    playClickSound();
    // Sync current settings to UI
    sizeOptions.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.size) === GRID);
    });
    configOverlay.classList.remove("hidden");
  });

  sizeOptions.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      playClickSound();
      sizeOptions.querySelectorAll("button").forEach((btn) => btn.classList.remove("active"));
      e.target.classList.add("active");
    }
  });

  configOverlay.addEventListener("click", (e) => {
    if (e.target === configOverlay) {
      configOverlay.classList.add("hidden");
    }
  });

  configApplyBtn.addEventListener("click", () => {
    playClickSound();
    const selectedSize = sizeOptions.querySelector("button.active");
    const newSize = selectedSize ? parseInt(selectedSize.dataset.size) : GRID;
    GRID = newSize;

    if (currentImg) {
      buildGrid(GRID);
      generatePieces(currentImg);
      shufflePieces();
      playStartSound();
    }

    configOverlay.classList.add("hidden");
  });

  shareBtn.addEventListener("click", () => {
    playClickSound();
    const url = new URL(window.location.href);
    url.searchParams.set("puzzle", lastPuzzleIndex);
    navigator.clipboard.writeText(url.toString()).then(() => {
      showToast("Link copied to clipboard!");
    }).catch(() => {
      prompt("Share this URL:", url.toString());
    });
  });

  function showToast(message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  hintBtn.addEventListener("click", () => {
    playClickSound();
    if (hintContainer.classList.contains("hidden")) {
      hintImage.src = currentDataUrl;
      hintContainer.classList.remove("hidden");
    } else {
      hintContainer.classList.add("hidden");
    }
  });

  // --- Auto-start with random puzzle ---

  let defaultPuzzles = [];
  let lastPuzzleIndex = -1;

  // Track solved puzzles in localStorage
  function getSolvedPuzzles() {
    const data = localStorage.getItem("solvedPuzzles");
    return data ? JSON.parse(data) : [];
  }

  function markPuzzleSolved(index) {
    const solved = getSolvedPuzzles();
    if (!solved.includes(index)) {
      solved.push(index);
      localStorage.setItem("solvedPuzzles", JSON.stringify(solved));
    }
  }

  function getUnsolvedPuzzles() {
    const solved = getSolvedPuzzles();
    const unsolved = [];
    for (let i = 0; i < defaultPuzzles.length; i++) {
      if (!solved.includes(i)) {
        unsolved.push(i);
      }
    }
    return unsolved;
  }

  // Points system
  function getPoints() {
    return parseInt(localStorage.getItem("puzzlePoints") || "0");
  }

  function addPoints(amount) {
    const current = getPoints();
    const newTotal = current + amount;
    localStorage.setItem("puzzlePoints", newTotal.toString());
    updatePointsDisplay();

    // Play diamond sound
    playDiamondSound();

    // Animate the points display
    pointsDisplay.classList.remove("points-added");
    void pointsDisplay.offsetWidth; // Trigger reflow
    pointsDisplay.classList.add("points-added");

    // Create sparkles around the diamond
    createDiamondSparkles();
  }

  function createDiamondSparkles() {
    const rect = pointsDisplay.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    for (let i = 0; i < 12; i++) {
      const sparkle = document.createElement("div");
      sparkle.className = "diamond-sparkle";
      sparkle.textContent = "✦";

      const angle = (Math.PI * 2 * i) / 12;
      const distance = 40 + Math.random() * 30;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;

      sparkle.style.left = centerX + "px";
      sparkle.style.top = centerY + "px";
      sparkle.style.setProperty("--dx", dx + "px");
      sparkle.style.setProperty("--dy", dy + "px");
      sparkle.style.animationDelay = (Math.random() * 0.2) + "s";

      document.body.appendChild(sparkle);

      setTimeout(() => sparkle.remove(), 800);
    }
  }

  function getPointsForGrid(gridSize) {
    if (gridSize === 3) return 1;
    if (gridSize === 4) return 2;
    if (gridSize === 5) return 3;
    return 1;
  }

  function updatePointsDisplay() {
    pointsDisplay.textContent = `💎 ${getPoints()}`;
  }


  function loadPuzzle(index) {
    lastPuzzleIndex = index;
    const url = defaultPuzzles[index];
    const img = new Image();
    img.onload = () => {
      currentImg = img;
      currentDataUrl = url;
      startGame(img, url);
    };
    img.src = url;
  }

  function loadRandomPuzzle() {
    loadNextPuzzle();
  }

  // Initialize points display
  updatePointsDisplay();

  // Fetch puzzles from server and initialize
  async function initGame() {
    try {
      // First get the full puzzle list for sharing functionality
      const listResponse = await fetch('/api/puzzles');
      defaultPuzzles = await listResponse.json();

      if (defaultPuzzles.length === 0) {
        console.error('No puzzles available');
        return;
      }

      // Check for shared puzzle URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const sharedPuzzle = urlParams.get("puzzle");
      if (sharedPuzzle !== null) {
        const index = parseInt(sharedPuzzle);
        if (index >= 0 && index < defaultPuzzles.length) {
          loadPuzzle(index);
        } else {
          loadNextPuzzle();
        }
      } else {
        loadNextPuzzle();
      }
    } catch (err) {
      console.error('Failed to fetch puzzles:', err);
    }
  }

  // Load next unseen puzzle from server
  async function loadNextPuzzle() {
    try {
      const url = currentDataUrl
        ? `/api/next-puzzle?current=${encodeURIComponent(currentDataUrl)}`
        : '/api/next-puzzle';
      const response = await fetch(url);
      const data = await response.json();

      if (!data.puzzle) {
        console.error('No puzzle available');
        return;
      }

      lastPuzzleIndex = data.index;
      const img = new Image();
      img.onload = () => {
        currentImg = img;
        currentDataUrl = data.puzzle;
        startGame(img, data.puzzle);
      };
      img.src = data.puzzle;
    } catch (err) {
      console.error('Failed to load next puzzle:', err);
    }
  }

  // Mark current puzzle as seen when solved
  async function markPuzzleSeen(index) {
    try {
      await fetch(`/api/mark-seen/${index}`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to mark puzzle as seen:', err);
    }
  }

  initGame();
})();
