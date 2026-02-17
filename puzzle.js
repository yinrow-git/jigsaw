(function () {
  let GRID = 4;
  function getMaxBoard() {
    const vw = window.innerWidth;
    if (vw < 500) return 390;
    if (vw < 768) return 600;
    // Leave room for tray on desktop
    return Math.min(800, vw - 300);
  }
  let boardW = 0;
  let boardH = 0;
  let cellW = 0;
  let cellH = 0;
  const TRAY_SCALE = 0.5;

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
  const puzzleTray = document.getElementById("puzzle-tray");

  // Tray data: each entry { canvas, pieceIndex, groupId, rowOff, colOff }
  // groupId links grouped pieces, rowOff/colOff are grid offsets from group anchor
  let trayPieces = [];
  let nextTrayGroupId = 0;

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

  // Cached grid cells array — invalidated by buildGrid
  let cachedCells = null;
  function getCells() {
    if (!cachedCells) cachedCells = Array.from(document.querySelectorAll(".grid-cell"));
    return cachedCells;
  }

  // Drag state
  let dragGroup = null; // array of { cellIndex, canvas, rowOff, colOff }
  let dragAnchorCell = null; // cell index of the clicked piece
  let dragSourceCells = null; // Map: cellIndex -> canvas (original positions)
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragCellW = 0;
  let dragCellH = 0;
  let groupsBefore = null; // group count before drag, to detect new connections
  let dragCellRects = null; // cached cell bounding rects during drag
  let dragFromTray = false; // whether drag originated from tray
  let dragTrayEntry = null; // the anchor tray entry being dragged (if from tray)
  let dragTrayGroup = null; // all tray entries in the dragged group (for returnToSource)

  // --- Tray helpers ---

  function addToTray(canvas, groupId, rowOff, colOff) {
    const pieceIndex = parseInt(canvas.dataset.index);
    if (groupId === undefined) { groupId = nextTrayGroupId++; }
    if (rowOff === undefined) rowOff = 0;
    if (colOff === undefined) colOff = 0;

    canvas.classList.remove("dragging", "correct", "grouped");
    canvas.style.position = "absolute";
    canvas.style.width = cellW + "px";
    canvas.style.height = cellH + "px";
    canvas.style.transform = "scale(" + TRAY_SCALE + ")";
    canvas.style.transformOrigin = "top left";
    canvas.style.boxShadow = "";
    puzzleTray.appendChild(canvas);
    trayPieces.push({ canvas, pieceIndex, groupId, rowOff, colOff });
  }

  // Build tray group data in a single pass (shared by layout and capacity check)
  function buildTrayGroups() {
    const scaledCellW = cellW * TRAY_SCALE;
    const scaledCellH = cellH * TRAY_SCALE;
    const groupMap = new Map();
    for (const tp of trayPieces) {
      let g = groupMap.get(tp.groupId);
      if (!g) {
        g = { members: [], minRow: tp.rowOff, maxRow: tp.rowOff, minCol: tp.colOff, maxCol: tp.colOff };
        groupMap.set(tp.groupId, g);
      }
      g.members.push(tp);
      if (tp.rowOff < g.minRow) g.minRow = tp.rowOff;
      if (tp.rowOff > g.maxRow) g.maxRow = tp.rowOff;
      if (tp.colOff < g.minCol) g.minCol = tp.colOff;
      if (tp.colOff > g.maxCol) g.maxCol = tp.colOff;
    }
    const groups = [];
    for (const [, g] of groupMap) {
      g.width = (g.maxCol - g.minCol + 1) * scaledCellW;
      g.height = (g.maxRow - g.minRow + 1) * scaledCellH;
      groups.push(g);
    }
    return groups;
  }

  function layoutTrayPieces() {
    if (trayPieces.length === 0) return;
    const trayW = puzzleTray.clientWidth;
    const scaledCellW = cellW * TRAY_SCALE;
    const scaledCellH = cellH * TRAY_SCALE;
    const pad = 6;
    const groups = buildTrayGroups();

    let curX = pad;
    let curY = pad;
    let rowHeight = 0;

    for (const g of groups) {
      if (curX + g.width > trayW - pad && curX > pad) {
        curX = pad;
        curY += rowHeight + pad;
        rowHeight = 0;
      }
      for (const m of g.members) {
        m.canvas.style.left = (curX + (m.colOff - g.minCol) * scaledCellW) + "px";
        m.canvas.style.top = (curY + (m.rowOff - g.minRow) * scaledCellH) + "px";
      }
      curX += g.width + pad;
      rowHeight = Math.max(rowHeight, g.height);
    }
  }

  function canFitInTray(newGroup) {
    const trayW = puzzleTray.clientWidth;
    const trayH = puzzleTray.getBoundingClientRect().height;
    const scaledCellW = cellW * TRAY_SCALE;
    const scaledCellH = cellH * TRAY_SCALE;
    const pad = 6;
    const groups = buildTrayGroups();

    // Add the new group
    let minRow = newGroup[0].rowOff, maxRow = minRow;
    let minCol = newGroup[0].colOff, maxCol = minCol;
    for (let i = 1; i < newGroup.length; i++) {
      const r = newGroup[i].rowOff, c = newGroup[i].colOff;
      if (r < minRow) minRow = r; if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c; if (c > maxCol) maxCol = c;
    }
    groups.push({
      width: (maxCol - minCol + 1) * scaledCellW,
      height: (maxRow - minRow + 1) * scaledCellH,
    });

    // Simulate flow layout
    let curX = pad;
    let curY = pad;
    let rowHeight = 0;

    for (const g of groups) {
      if (curX + g.width > trayW - pad && curX > pad) {
        curX = pad;
        curY += rowHeight + pad;
        rowHeight = 0;
      }
      curX += g.width + pad;
      rowHeight = Math.max(rowHeight, g.height);
    }
    return curY + rowHeight + pad <= trayH;
  }

  function removeFromTray(canvas) {
    trayPieces = trayPieces.filter(tp => tp.canvas !== canvas);
    if (canvas.parentElement === puzzleTray) {
      puzzleTray.removeChild(canvas);
    }
  }

  function clearTray() {
    for (const tp of trayPieces) {
      if (tp.canvas.parentElement === puzzleTray) {
        puzzleTray.removeChild(tp.canvas);
      }
    }
    trayPieces = [];
  }

  function syncTrayHeight() {
    if (window.innerWidth >= 768) {
      puzzleTray.style.height = boardH + "px";
    } else {
      puzzleTray.style.height = "";
    }
  }

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
    const cells = getCells();
    // Build a map: cellIndex -> pieceIndex (the piece's correct index)
    const cellToPiece = new Map();
    for (let i = 0; i < cells.length; i++) {
      const canvas = cells[i].firstElementChild;
      if (canvas && canvas.classList.contains("puzzle-piece")) {
        cellToPiece.set(i, parseInt(canvas.dataset.index));
      }
    }

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

  function getGroup(cellIndex, cellToGroup) {
    if (!cellToGroup) cellToGroup = computeGroups();
    const myGroup = cellToGroup.get(cellIndex);
    if (myGroup === undefined) return [cellIndex];
    const members = [];
    for (const [ci, gid] of cellToGroup) {
      if (gid === myGroup) members.push(ci);
    }
    return members;
  }

  function updateGroupVisuals() {
    updateGroupVisualsWithGroups(computeGroups());
  }

  function updateGroupVisualsWithGroups(cellToGroup) {
    const cells = getCells();

    // Count group sizes
    const groupSizes = new Map();
    for (const [, gid] of cellToGroup) {
      groupSizes.set(gid, (groupSizes.get(gid) || 0) + 1);
    }

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const canvas = cell.firstElementChild;
      const hasPiece = canvas && canvas.classList.contains("puzzle-piece");
      const row = Math.floor(ci / GRID);
      const col = ci % GRID;

      if (hasPiece) {
        canvas.classList.remove("grouped", "correct");
        canvas.style.boxShadow = "";

        // Mark correct position
        if (parseInt(canvas.dataset.index) === ci) {
          canvas.classList.add("correct");
        }
      }

      const myGroup = cellToGroup.get(ci);
      if (myGroup === undefined || groupSizes.get(myGroup) < 2) continue;

      // This cell is part of a multi-piece group
      if (hasPiece) canvas.classList.add("grouped");

      // Compute per-side grouped highlight using box-shadow (no layout impact)
      if (hasPiece) {
        const groupRight = col < GRID - 1 && cellToGroup.get(ci + 1) === myGroup;
        const groupBottom = row < GRID - 1 && cellToGroup.get(ci + GRID) === myGroup;
        const groupLeft = col > 0 && cellToGroup.get(ci - 1) === myGroup;
        const groupTop = row > 0 && cellToGroup.get(ci - GRID) === myGroup;

        const shadows = [];
        if (!groupTop) shadows.push("inset 0 2px 0 #81b29a");
        if (!groupRight) shadows.push("inset -2px 0 0 #81b29a");
        if (!groupBottom) shadows.push("inset 0 -2px 0 #81b29a");
        if (!groupLeft) shadows.push("inset 2px 0 0 #81b29a");
        canvas.style.boxShadow = shadows.join(", ");
      }
    }
  }

  // --- Grid building ---

  function getBoardDimensions(imgW, imgH) {
    var ratio = imgW / imgH;
    var maxW = Math.min(getMaxBoard(), window.innerWidth - 40);
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
    cachedCells = null; // invalidate cell cache
    var dim = getBoardDimensions(currentImg.width, currentImg.height);
    // Account for board's 4px border (box-sizing: border-box)
    var boardBorder = 8;
    // Ensure content area is evenly divisible by GRID for pixel-perfect tracks
    cellW = Math.floor((dim.w - boardBorder) / GRID);
    cellH = Math.floor((dim.h - boardBorder) / GRID);
    boardW = cellW * GRID + boardBorder;
    boardH = cellH * GRID + boardBorder;

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
    puzzleBoard.style.gridTemplateColumns = "repeat(" + n + ", " + cellW + "px)";
    puzzleBoard.style.gridTemplateRows = "repeat(" + n + ", " + cellH + "px)";
    cachedCells = Array.from(document.querySelectorAll(".grid-cell"));
    syncTrayHeight();
  }

  // --- Game setup ---

  function startGame(img, dataUrl) {
    currentImg = img;
    currentDataUrl = dataUrl;
    puzzleBoard.classList.remove("win");
    winOverlay.classList.add("hidden");
    hintContainer.classList.add("hidden");
    solved = false;
    clearTray();

    buildGrid(GRID);
    generatePieces(img);
    shufflePieces();
    playStartSound();
  }

  function generatePieces(img) {
    const cells = getCells();
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
    clearTray();

    // Create shuffled index order (ensure it's not already solved)
    const order = Array.from({ length: GRID * GRID }, (_, i) => i);
    do {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order.every((v, i) => v === i));

    const cells = getCells();
    for (let i = 0; i < cells.length; i++) {
      cells[i].innerHTML = "";
    }

    for (let cellIdx = 0; cellIdx < order.length; cellIdx++) {
      const p = pieces[order[cellIdx]];
      p.canvas.classList.remove("dragging", "correct", "grouped", "shuffle-in");
      p.canvas.style.position = "";
      p.canvas.style.left = "";
      p.canvas.style.top = "";
      p.canvas.style.width = "100%";
      p.canvas.style.height = "100%";
      p.canvas.style.boxShadow = "";

      // Add shuffle animation with staggered delay
      p.canvas.style.animationDelay = (cellIdx * 0.02) + "s";
      p.canvas.classList.add("shuffle-in");

      cells[cellIdx].appendChild(p.canvas);
    }

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
    canvas.style.boxShadow = "";
    canvas.style.transform = "";
    canvas.style.transformOrigin = "";
  }

  function onDragStart(e) {
    if (solved) return;
    e.preventDefault();

    const canvas = e.currentTarget;
    const parent = canvas.parentElement;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const boardRect = puzzleBoard.getBoundingClientRect();
    dragCellW = (boardRect.width - 8) / GRID;
    dragCellH = (boardRect.height - 8) / GRID;

    const cells = getCells();
    dragCellRects = cells.map((c) => c.getBoundingClientRect());

    // Determine if drag is from tray or board
    if (parent === puzzleTray) {
      // Dragging from tray — lift entire tray group
      dragFromTray = true;
      const clickedEntry = trayPieces.find(tp => tp.canvas === canvas);
      dragTrayEntry = clickedEntry;
      dragSourceCells = null;
      dragAnchorCell = -1;

      // Find all pieces in the same tray group
      const gid = clickedEntry ? clickedEntry.groupId : -1;
      const groupMembers = trayPieces.filter(tp => tp.groupId === gid);

      dragGroup = groupMembers.map(tp => ({
        cellIndex: -1,
        canvas: tp.canvas,
        rowOff: tp.rowOff,
        colOff: tp.colOff,
      }));

      // Compute group count so snap sound works when dropping tray piece onto board
      const cellToGroupMap = computeGroups();
      const groupIdsBefore = new Set(cellToGroupMap.values());
      groupsBefore = groupIdsBefore.size;

      const anchorRect = canvas.getBoundingClientRect();
      dragOffsetX = (clientX - anchorRect.left) / TRAY_SCALE;
      dragOffsetY = (clientY - anchorRect.top) / TRAY_SCALE;

      // Save all group entries for returnToSource, then remove from tray tracking
      dragTrayGroup = groupMembers.map(tp => ({ ...tp }));
      trayPieces = trayPieces.filter(tp => tp.groupId !== gid);

      // Lift all group pieces out of tray (remove scale, go to full size)
      for (const item of dragGroup) {
        const rect = item.canvas.getBoundingClientRect();
        item.canvas.style.transform = "";
        item.canvas.style.transformOrigin = "";
        item.canvas.classList.add("dragging");
        item.canvas.style.left = rect.left + "px";
        item.canvas.style.top = rect.top + "px";
        item.canvas.style.width = dragCellW + "px";
        item.canvas.style.height = dragCellH + "px";
        document.body.appendChild(item.canvas);
      }
      layoutTrayPieces();
    } else if (parent && parent.classList.contains("grid-cell")) {
      // Dragging from board
      dragFromTray = false;
      dragTrayEntry = null;
      dragTrayGroup = null;

      const anchorCellIndex = parseInt(parent.dataset.index);
      const anchorRow = Math.floor(anchorCellIndex / GRID);
      const anchorCol = anchorCellIndex % GRID;

      const cellToGroupMap = computeGroups();
      const groupCellIndices = getGroup(anchorCellIndex, cellToGroupMap);

      const groupIdsBefore = new Set(cellToGroupMap.values());
      groupsBefore = groupIdsBefore.size;

      dragSourceCells = new Map();
      dragGroup = [];

      for (const ci of groupCellIndices) {
        const groupCanvas = cells[ci].firstElementChild;
        if (!groupCanvas || !groupCanvas.classList.contains("puzzle-piece")) continue;
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

      const anchorRect = canvas.getBoundingClientRect();
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
    } else {
      return;
    }

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
  }

  function isCursorOverTray(x, y) {
    const trayRect = puzzleTray.getBoundingClientRect();
    return x >= trayRect.left && x <= trayRect.right && y >= trayRect.top && y <= trayRect.bottom;
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

    // Tray hover highlight
    if (isCursorOverTray(clientX, clientY)) {
      puzzleTray.classList.add("tray-hover");
    } else {
      puzzleTray.classList.remove("tray-hover");
    }

    // Highlight the cell under the cursor (anchor target)
    const cells = getCells();
    cells.forEach((cell) => cell.classList.remove("highlight"));
    const targetIdx = findCellIndexUnder(clientX, clientY);
    if (targetIdx >= 0) {
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

  function tryDropOnBoard(clientX, clientY, cells) {
    const targetIdx = findCellIndexUnder(clientX, clientY);
    if (targetIdx < 0) return false;

    const targetRow = Math.floor(targetIdx / GRID);
    const targetCol = targetIdx % GRID;

    const targetCells = [];
    let valid = true;

    const draggedCellIndices = new Set(
      dragGroup.filter(item => item.cellIndex >= 0).map(item => item.cellIndex)
    );

    for (const item of dragGroup) {
      const tRow = targetRow + item.rowOff;
      const tCol = targetCol + item.colOff;

      if (tRow < 0 || tRow >= GRID || tCol < 0 || tCol >= GRID) {
        valid = false;
        break;
      }

      const tci = tRow * GRID + tCol;
      targetCells.push({ cellIndex: tci, canvas: item.canvas });
    }

    if (!valid) return false;

    const targetCellIndices = new Set(targetCells.map(t => t.cellIndex));

    // Collect displaced pieces
    const displaced = [];
    for (const tci of targetCellIndices) {
      if (draggedCellIndices.has(tci)) continue;
      const child = cells[tci].firstElementChild;
      if (child && child.classList.contains("puzzle-piece")) displaced.push(child);
    }

    // Collect vacated cells: source cells that aren't also target cells
    const vacatedCells = [];
    for (const sci of draggedCellIndices) {
      if (!targetCellIndices.has(sci)) {
        vacatedCells.push(sci);
      }
    }

    // If dragging from tray, find empty board cells for displaced pieces
    if (dragFromTray) {
      // Find empty cells on the board (excluding target cells)
      const emptyCells = [];
      for (let i = 0; i < cells.length; i++) {
        if (targetCellIndices.has(i)) continue;
        const child = cells[i].firstElementChild;
        if (!child || !child.classList.contains("puzzle-piece")) {
          emptyCells.push(i);
        }
      }

      // Not enough empty cells to absorb displaced pieces — reject drop
      if (emptyCells.length < displaced.length) return false;

      // Remove displaced pieces from cells
      for (const canvas of displaced) {
        if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      }
      // Place group pieces into target cells
      for (const tc of targetCells) {
        removeFromTray(tc.canvas);
        resetCanvasStyle(tc.canvas);
        cells[tc.cellIndex].appendChild(tc.canvas);
      }
      // Shift displaced pieces into empty board cells
      for (let i = 0; i < displaced.length; i++) {
        resetCanvasStyle(displaced[i]);
        cells[emptyCells[i]].appendChild(displaced[i]);
      }
      return true;
    }

    // If dragging from board, need enough vacated cells for displaced pieces
    if (displaced.length > vacatedCells.length) return false;

    // Remove displaced pieces from their cells first
    for (const canvas of displaced) {
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
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

    return true;
  }

  function tryDropOnTray(clientX, clientY) {
    if (!isCursorOverTray(clientX, clientY)) return false;
    if (!canFitInTray(dragGroup)) return false;

    const gid = nextTrayGroupId++;
    for (const item of dragGroup) {
      removeFromTray(item.canvas);
      addToTray(item.canvas, gid, item.rowOff, item.colOff);
    }
    layoutTrayPieces();
    return true;
  }

  function returnToSource(cells) {
    if (dragFromTray && dragTrayGroup) {
      const gid = nextTrayGroupId++;
      for (const entry of dragTrayGroup) {
        const dgItem = dragGroup.find(item => parseInt(item.canvas.dataset.index) === entry.pieceIndex);
        if (dgItem) {
          addToTray(dgItem.canvas, gid, entry.rowOff, entry.colOff);
        }
      }
      layoutTrayPieces();
    } else if (dragSourceCells) {
      for (const [ci, canvas] of dragSourceCells) {
        resetCanvasStyle(canvas);
        cells[ci].appendChild(canvas);
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
    const cells = getCells();
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.remove("highlight");
    }
    puzzleTray.classList.remove("tray-hover");

    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

    // Try board first, then tray, then return to source
    let dropped = tryDropOnBoard(clientX, clientY, cells);
    if (!dropped) {
      dropped = tryDropOnTray(clientX, clientY);
    }
    if (!dropped) {
      returnToSource(cells);
    }

    // Compute groups once, use for both snap detection and visuals
    const cellToGroupAfter = computeGroups();
    const groupIdsAfter = new Set(cellToGroupAfter.values());
    if (dropped && groupsBefore !== null && groupIdsAfter.size < groupsBefore) {
      playSnapSound();
    }

    dragGroup = null;
    dragAnchorCell = null;
    dragSourceCells = null;
    groupsBefore = null;
    dragCellRects = null;
    dragFromTray = false;
    dragTrayEntry = null;
    dragTrayGroup = null;

    updateGroupVisualsWithGroups(cellToGroupAfter);
    checkWin();
  }

  function findCellIndexUnder(x, y) {
    if (dragCellRects) {
      for (let i = 0; i < dragCellRects.length; i++) {
        const rect = dragCellRects[i];
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return i;
        }
      }
      return -1;
    }
    // Fallback: compute from board position
    const boardRect = puzzleBoard.getBoundingClientRect();
    const col = Math.floor((x - boardRect.left) / (boardRect.width / GRID));
    const row = Math.floor((y - boardRect.top) / (boardRect.height / GRID));
    if (col >= 0 && col < GRID && row >= 0 && row < GRID) {
      return row * GRID + col;
    }
    return -1;
  }

  function checkWin() {
    if (trayPieces.length > 0) return;
    const cells = getCells();
    let allCorrect = true;
    for (let i = 0; i < cells.length; i++) {
      const canvas = cells[i].firstElementChild;
      if (!canvas || parseInt(canvas.dataset.index) !== i) {
        allCorrect = false;
        break;
      }
    }

    if (allCorrect) {
      solved = true;
      markPuzzleSolved(lastPuzzleIndex);
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

  // --- Service Worker & Offline Support ---

  // Returns a promise that resolves when the SW is active and controlling the page
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .catch((err) => {
        console.error('SW registration failed:', err);
      });
  }

  function preCachePuzzles(count) {
    const solvedPaths = getSolvedPuzzles();
    const cachedPaths = JSON.parse(localStorage.getItem('cachedPuzzlePaths') || '[]');
    const cachedSet = new Set(cachedPaths);

    // Pick unsolved, not-yet-cached puzzles
    const toCacheList = [];
    for (let i = 0; i < defaultPuzzles.length; i++) {
      if (toCacheList.length >= count) break;
      const p = defaultPuzzles[i];
      if (!solvedPaths.includes(p) && !cachedSet.has(p)) {
        toCacheList.push(p);
      }
    }

    // If not enough unsolved ones, fill with any uncached puzzles
    if (toCacheList.length < count) {
      for (let i = 0; i < defaultPuzzles.length; i++) {
        if (toCacheList.length >= count) break;
        const p = defaultPuzzles[i];
        if (!cachedSet.has(p) && !toCacheList.includes(p)) {
          toCacheList.push(p);
        }
      }
    }

    if (toCacheList.length === 0) return;

    // Fetch each image (goes through SW -> gets cached automatically)
    const fetches = toCacheList.map((p) => fetch(p).then(() => p).catch(() => null));
    Promise.allSettled(fetches).then((results) => {
      const newlyCached = results
        .filter((r) => r.status === 'fulfilled' && r.value)
        .map((r) => r.value);
      const updatedSet = new Set([...cachedPaths, ...newlyCached]);
      localStorage.setItem('cachedPuzzlePaths', JSON.stringify([...updatedSet]));
    });
  }

  // --- Auto-start with random puzzle ---

  let defaultPuzzles = [];
  let lastPuzzleIndex = -1;

  // Track solved puzzles in localStorage by path (stable across puzzle list changes)
  function getSolvedPuzzles() {
    const data = localStorage.getItem("solvedPuzzles");
    if (!data) return [];
    const parsed = JSON.parse(data);
    // Migrate from index-based to path-based if needed
    if (parsed.length > 0 && typeof parsed[0] === "number") {
      const paths = parsed
        .filter(i => i >= 0 && i < defaultPuzzles.length)
        .map(i => defaultPuzzles[i]);
      localStorage.setItem("solvedPuzzles", JSON.stringify(paths));
      return paths;
    }
    return parsed;
  }

  function markPuzzleSolved(index) {
    const path = defaultPuzzles[index];
    if (!path) return;
    const solvedPaths = getSolvedPuzzles();
    if (!solvedPaths.includes(path)) {
      solvedPaths.push(path);
      localStorage.setItem("solvedPuzzles", JSON.stringify(solvedPaths));
    }
    // Top-up cache when online
    if (navigator.onLine) {
      preCachePuzzles(1);
    }
  }

  function getUnsolvedPuzzles() {
    const solvedPaths = getSolvedPuzzles();
    const unsolved = [];
    for (let i = 0; i < defaultPuzzles.length; i++) {
      if (!solvedPaths.includes(defaultPuzzles[i])) {
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
    if (gridSize === 6) return 5;
    if (gridSize === 7) return 8;
    if (gridSize === 8) return 12;
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
      // Track this puzzle as cached (SW will have stored it)
      const cached = JSON.parse(localStorage.getItem('cachedPuzzlePaths') || '[]');
      if (!cached.includes(url)) {
        cached.push(url);
        localStorage.setItem('cachedPuzzlePaths', JSON.stringify(cached));
      }
      startGame(img, url);
    };
    img.onerror = () => {
      console.error('Failed to load puzzle image:', url);
      // Remove from cached paths since it's not actually available
      const cached = JSON.parse(localStorage.getItem('cachedPuzzlePaths') || '[]');
      const filtered = cached.filter((p) => p !== url);
      localStorage.setItem('cachedPuzzlePaths', JSON.stringify(filtered));
      // Try another puzzle if possible
      if (defaultPuzzles.length > 1) {
        loadNextPuzzle();
      }
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
    // Start SW registration (don't block first puzzle load)
    const swReady = registerServiceWorker();

    try {
      const listResponse = await fetch('/api/puzzles');
      defaultPuzzles = await listResponse.json();

      if (defaultPuzzles.length === 0) {
        console.error('No puzzles available');
        return;
      }

      // Save puzzle list for offline use
      localStorage.setItem('cachedPuzzleList', JSON.stringify(defaultPuzzles));

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

      // Pre-cache only after SW is active so fetches go through it
      swReady.then(() => preCachePuzzles(25));
    } catch (err) {
      console.error('Failed to fetch puzzles:', err);
      // Offline fallback: use cached puzzle list
      const cached = localStorage.getItem('cachedPuzzleList');
      if (cached) {
        defaultPuzzles = JSON.parse(cached);
        loadNextPuzzle();
      }
    }
  }

  // Pick a random unsolved puzzle client-side
  function loadNextPuzzle() {
    const solvedPaths = getSolvedPuzzles();
    const offline = !navigator.onLine;
    const cachedPaths = offline
      ? new Set(JSON.parse(localStorage.getItem('cachedPuzzlePaths') || '[]'))
      : null;

    // Build candidates: unsolved puzzles, excluding current
    let candidates = [];
    for (let i = 0; i < defaultPuzzles.length; i++) {
      if (i !== lastPuzzleIndex && !solvedPaths.includes(defaultPuzzles[i])) {
        if (!offline || cachedPaths.has(defaultPuzzles[i])) {
          candidates.push(i);
        }
      }
    }

    // If all solved (or none cached unsolved), clear and pick from all (excluding current)
    if (candidates.length === 0) {
      localStorage.setItem("solvedPuzzles", JSON.stringify([]));
      for (let i = 0; i < defaultPuzzles.length; i++) {
        if (i !== lastPuzzleIndex) {
          if (!offline || cachedPaths.has(defaultPuzzles[i])) {
            candidates.push(i);
          }
        }
      }
    }

    // Fallback: if still empty (only one puzzle exists), use current
    if (candidates.length === 0) {
      candidates.push(lastPuzzleIndex >= 0 ? lastPuzzleIndex : 0);
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    loadPuzzle(pick);
  }

  // Recalculate board on window resize (e.g. iPad rotation)
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentImg && !solved) {
        // Capture current piece order before rebuilding
        const oldCells = getCells();
        const currentOrder = [];
        for (let i = 0; i < oldCells.length; i++) {
          const canvas = oldCells[i].firstElementChild;
          currentOrder.push(canvas && canvas.classList.contains("puzzle-piece") ? parseInt(canvas.dataset.index) : -1);
        }

        // Capture tray piece data including group info
        const oldTrayData = trayPieces.map(tp => ({
          pieceIndex: tp.pieceIndex,
          groupId: tp.groupId,
          rowOff: tp.rowOff,
          colOff: tp.colOff,
        }));

        // Remove tray canvases before regenerating
        clearTray();

        buildGrid(GRID);
        generatePieces(currentImg);

        // Restore board pieces in their previous order
        const newCells = getCells();
        for (let cellIdx = 0; cellIdx < currentOrder.length; cellIdx++) {
          const pieceIdx = currentOrder[cellIdx];
          if (pieceIdx >= 0 && pieces[pieceIdx]) {
            const p = pieces[pieceIdx];
            p.canvas.style.width = "100%";
            p.canvas.style.height = "100%";
            newCells[cellIdx].appendChild(p.canvas);
          }
        }

        // Restore tray pieces with new canvases, preserving groups
        const groupIdRemap = new Map();
        for (const td of oldTrayData) {
          if (pieces[td.pieceIndex]) {
            const canvas = pieces[td.pieceIndex].canvas;
            if (canvas.parentElement && canvas.parentElement.classList.contains("grid-cell")) continue;
            if (!groupIdRemap.has(td.groupId)) {
              groupIdRemap.set(td.groupId, nextTrayGroupId++);
            }
            addToTray(canvas, groupIdRemap.get(td.groupId), td.rowOff, td.colOff);
          }
        }
        layoutTrayPieces();

        updateGroupVisuals();
      }
    }, 250);
  });

  initGame();
})();
