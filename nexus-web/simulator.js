// ─── NEXUS SIMULATOR ──────────────────────────────────────────────────────────
// Integrates with the existing STL/OBJ viewer pattern in app.js.
// Uses the same Three.js scene setup, CSS variables, and electronAPI bridge.

const SIM = {
  // Three.js
  scene: null, camera: null, renderer: null,
  animId: null, group: null, fieldGroup: null, gameObjectsGroup: null,

  // Camera orbit (same pattern as STL viewer)
  spherical: { theta: 0, phi: 0.4, radius: 22 },
  target: null,
  mouse: { down: false, right: false, lastX: 0, lastY: 0 },

  // Robot state (all in field inches, 0–144)
  robot: {
    x: 72, y: 72,        // world position in inches
    angle: 0,             // degrees, 0 = facing +Y
    vx: 0, vy: 0,        // velocity in/s
    omega: 0,             // angular velocity deg/s
    width: 15, height: 15,
    snapTarget: null,     // nearest 90° snap angle set on wall contact
  },

  // Simulation config (loaded from simulation.json)
  config: null,

  // Motor states keyed by motor id
  motors: {},

  // Piston states keyed by piston id
  pistons: {},

  // Mechanism states keyed by mechanism id
  mechanisms: {},

  // Sensor readings
  sensors: {
    imu: 0,
    odomX: 72, odomY: 72,
    encFwd: 0,
    imuDrift: 0,
  },

  // PID state
  pid: {
    kP: 1.5, kI: 0.01, kD: 0.8,
    target: 90,
    current: 0,
    integral: 0,
    prevError: 0,
    history: [],
    running: false,
  },

  // Match state
  match: {
    mode: 'driver',       // 'driver' | 'auton' | 'pid'
    elapsed: 0,
    duration: 105,        // default driver duration; auton overrides to 15s
    running: false,
    rafId: null,
    lastTs: null,
  },

  // Input
  keys: {},
  gamepad: null,

  // Loaded OBJ meshes keyed by meshName from config
  meshMap: {},

  // Game objects (rings, goals, etc.)
  gameObjects: [],

  // AI robots (1 teammate blue, 2 opponents red)
  aiRobots: [],

  // Annotation / auton
  autonRunning: false,

  // Mechanics visualization (chains, gear rings, spec sprites)
  chainLines: [],        // {line, mat, linkedMotor}
  gearRings: [],         // THREE.Object3D[] added to SIM.group
  annotationSprites: [], // THREE.Sprite[] added to SIM.group
  showAnnotations: false,

  // Telemetry recording
  telemetry: { recording: false, buffer: [], sessionId: null, mode: null, _tick: 0 },

  // Match score (recalculated each tick from goal state)
  score: { player: 0, opponent: 0 },

  // Override game state
  override: { heldPieces: [] },
  toggleOwner: { left: null, right: null, top: null, bottom: null },
  goals: [],   // populated by loadDefaultGameObjects

  // Runtime-only visuals attached to the player robot group
  playerOverlayGroup: null,
};

// Field dimensions: 12ft × 12ft = 144in × 144in
const FIELD_IN = 144;
const FIELD_SCALE = 0.1; // 1 inch = 0.1 Three.js units → field = 14.4 units

// V5RC Override — field layout
// 8 short goals arranged in an octagonal ring (r≈38") centred on (72,72),
// two per X-diagonal quadrant; blue=left, red=right, neutral=top/bottom.
const OVERRIDE_GOALS = [
  { x: 72,  y: 72,  type: 'tall',  team: 'neutral' }, // center tall goal
  { x: 37,  y: 87,  type: 'short', team: 'blue'    }, // left quadrant (NW)
  { x: 37,  y: 57,  type: 'short', team: 'blue'    }, // left quadrant (SW)
  { x: 107, y: 87,  type: 'short', team: 'red'     }, // right quadrant (NE)
  { x: 107, y: 57,  type: 'short', team: 'red'     }, // right quadrant (SE)
  { x: 57,  y: 107, type: 'short', team: 'neutral' }, // top quadrant (NW)
  { x: 87,  y: 107, type: 'short', team: 'neutral' }, // top quadrant (NE)
  { x: 57,  y: 37,  type: 'short', team: 'neutral' }, // bottom quadrant (SW)
  { x: 87,  y: 37,  type: 'short', team: 'neutral' }, // bottom quadrant (SE)
];
const OVERRIDE_TOGGLES = [
  { id: 'left',   x: 3,   y: 72,  quad: 'left'   },
  { id: 'right',  x: 141, y: 72,  quad: 'right'  },
  { id: 'top',    x: 72,  y: 141, quad: 'top'    },
  { id: 'bottom', x: 72,  y: 3,   quad: 'bottom' },
];

// V5RC Override — gameplay constants
const PLAYER_PICKUP_RANGE      = 14;
const PLAYER_PICKUP_FRONT_BIAS = 10;
const PIECE_PUSH_DIST          = 10;
const GOAL_SCORE_RADIUS        = 14;
const GOAL_SOLID_RADIUS        = 7;
const GOAL_APPROACH_OFFSET     = GOAL_SOLID_RADIUS + 8;
const TOGGLE_CAPTURE_RADIUS    = 10;
const MIDFIELD_RADIUS          = 20;
const MIDFIELD_BONUS           = 10;
const SIM_AUTON_BONUS          = 12;
const PIN_SCORE_ALLIANCE       = 5;
const PIN_SCORE_YELLOW         = 10;
const CUP_SCORE_VALUE          = 2;
const PIN_HEIGHT               = 5;    // inches (cone)
const CUP_HEIGHT               = 2.5;  // inches (cylinder)

function getQuadrant(x, y) {
  if (x < y && x < FIELD_IN - y) return 'left';
  if (x > y && x > FIELD_IN - y) return 'right';
  if (y < x && y < FIELD_IN - x) return 'bottom';
  return 'top';
}

function inToWorld(inches) { return inches * FIELD_SCALE; }
function worldToIn(world)  { return world / FIELD_SCALE; }

// ─── OPEN / CLOSE ─────────────────────────────────────────────────────────────
function openSimulator() {
  const page = document.getElementById('simPage');
  if (!page) return;
  page.style.display = 'flex';
  if (!SIM.renderer) initSimRenderer();
  else if (!SIM.animId) simRenderLoop();
  if (!SIM.gameObjects.length || !SIM.gameObjectsGroup?.children?.length) loadDefaultGameObjects();
  simResetRobot();
  simUpdateSidebar();
  // Deferred resize: if the canvas was 0×0 at init time (display:none → flex
  // transition hasn't reflowed yet), correct the renderer size on the next frame.
  requestAnimationFrame(() => {
    const vp = document.getElementById('simViewport');
    if (SIM.renderer && vp && vp.offsetWidth > 0 && vp.offsetHeight > 0) {
      SIM.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
      if (SIM.camera) {
        SIM.camera.aspect = vp.offsetWidth / vp.offsetHeight;
        SIM.camera.updateProjectionMatrix();
      }
    }
  });
}

function closeSimulator() {
  const page = document.getElementById('simPage');
  if (page) page.style.display = 'none';
  simStopMatch();
  if (SIM.animId) { cancelAnimationFrame(SIM.animId); SIM.animId = null; }
  // Stop any autonomous routine
  SIM.autonRunning = false;
  const hp = document.getElementById('homePage'); if (hp) hp.style.display = 'flex';
}

// ─── RENDERER INIT ────────────────────────────────────────────────────────────
function _simDiag(msg) {
  const el = document.getElementById('simDiagMsg');
  if (el) el.textContent = msg;
}
function _simDiagHide() {
  const el = document.getElementById('simDiag');
  if (el) el.style.display = 'none';
}

function initSimRenderer() {
  _simDiag('Checking Three.js…');
  if (typeof THREE === 'undefined') {
    _simDiag('⚠ Three.js failed to load.\nCheck internet connection or open DevTools console.');
    simSetStatus('⚠ Three.js not loaded — check network/console');
    return;
  }

  const canvas = document.getElementById('simCanvas');
  const vp     = document.getElementById('simViewport');
  _simDiag('Creating renderer… (viewport ' + vp.offsetWidth + '×' + vp.offsetHeight + ')');

  SIM.scene = new THREE.Scene();
  SIM.scene.background = new THREE.Color(0x0a0a10);
  SIM.target = new THREE.Vector3(inToWorld(72), 0, inToWorld(72));

  // Camera — use a safe fallback aspect ratio if the viewport hasn't laid out yet
  const initAspect = vp.offsetHeight > 0 ? vp.offsetWidth / vp.offsetHeight : 16 / 9;
  SIM.camera = new THREE.PerspectiveCamera(50, initAspect, 0.01, 500);
  simUpdateCamera();

  // Renderer
  SIM.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  SIM.renderer.setPixelRatio(window.devicePixelRatio);
  SIM.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
  SIM.renderer.shadowMap.enabled = true;
  _simDiag('Renderer OK (' + vp.offsetWidth + '×' + vp.offsetHeight + ')\nBuilding scene…');

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
  dir1.position.set(8, 16, 8); dir1.castShadow = true;
  const dir2 = new THREE.DirectionalLight(0x8888ff, 0.2);
  dir2.position.set(-8, -4, -8);
  SIM.scene.add(ambient, dir1, dir2);

  // Groups
  SIM.fieldGroup       = new THREE.Group(); // field geometry (procedural or OBJ)
  SIM.group            = new THREE.Group(); // robot meshes
  SIM.gameObjectsGroup = new THREE.Group();
  SIM.scene.add(SIM.fieldGroup, SIM.group, SIM.gameObjectsGroup);

  // Build procedural field
  try { buildField(); } catch (e) { console.error('buildField failed:', e); _simDiag('⚠ buildField error:\n' + e.message); simSetStatus('⚠ Field error: ' + e.message); }

  // Default robot placeholder (blue box) — replaced when OBJ is loaded
  try { buildDefaultRobot(); } catch (e) { console.error('buildDefaultRobot failed:', e); _simDiag('⚠ buildDefaultRobot error:\n' + e.message); }

  // AI robots
  try { buildAIRobots(); } catch (e) { console.error('buildAIRobots failed:', e); _simDiag('⚠ buildAIRobots error:\n' + e.message); }

  // Field game elements
  try { loadDefaultGameObjects(); } catch (e) { console.error('loadDefaultGameObjects failed:', e); _simDiag('⚠ loadDefaultGameObjects error:\n' + e.message); simSetStatus('⚠ Game objects error: ' + e.message); }

  // Controls
  canvas.addEventListener('mousedown', e => {
    SIM.mouse.down = true;
    SIM.mouse.right = e.button === 2;
    SIM.mouse.lastX = e.clientX; SIM.mouse.lastY = e.clientY;
    canvas.focus();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mouseup', () => { SIM.mouse.down = false; });
  window.addEventListener('mousemove', e => {
    if (!SIM.mouse.down) return;
    const dx = e.clientX - SIM.mouse.lastX, dy = e.clientY - SIM.mouse.lastY;
    SIM.mouse.lastX = e.clientX; SIM.mouse.lastY = e.clientY;
    if (SIM.mouse.right) {
      const ps = SIM.spherical.radius * 0.001;
      SIM.target.x -= dx * ps; SIM.target.z += dy * ps;
    } else {
      SIM.spherical.theta -= dx * 0.006;
      SIM.spherical.phi = Math.max(0.1, Math.min(1.4, SIM.spherical.phi - dy * 0.006));
    }
    simUpdateCamera();
  });
  canvas.addEventListener('wheel', e => {
    SIM.spherical.radius = Math.max(3, Math.min(40, SIM.spherical.radius * (1 + e.deltaY * 0.001)));
    simUpdateCamera(); e.preventDefault();
  }, { passive: false });

  // Keyboard — listen on document so keys work regardless of canvas focus
  canvas.setAttribute('tabindex', '0');
  const _simKeyPage = document.getElementById('simPage');
  document.addEventListener('keydown', e => {
    if (!_simKeyPage || _simKeyPage.style.display === 'none') return;
    SIM.keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { simKeyTogglePistons(); e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (!_simKeyPage || _simKeyPage.style.display === 'none') return;
    SIM.keys[e.key.toLowerCase()] = false;
  });

  // Gamepad
  window.addEventListener('gamepadconnected',    e => { SIM.gamepad = e.gamepad.index; simSetStatus('Controller connected'); if (typeof showToast === 'function') showToast('Controller connected', 'ok'); });
  window.addEventListener('gamepaddisconnected', e => { if (SIM.gamepad === e.gamepad.index) SIM.gamepad = null; });

  // Resize
  new ResizeObserver(() => {
    if (!SIM.renderer) return;
    SIM.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
    SIM.camera.aspect = vp.offsetWidth / vp.offsetHeight;
    SIM.camera.updateProjectionMatrix();
  }).observe(vp);

  // Start render + physics loop
  simRenderLoop();
  setInterval(simPhysicsTick, 16); // ~60fps physics
  simSetStatus('No config loaded');
  _simDiagHide(); // hide diagnostic overlay — renderer is live
}

function simUpdateCamera() {
  if (!SIM.camera) return;
  const { theta, phi, radius } = SIM.spherical;
  SIM.camera.position.set(
    SIM.target.x + radius * Math.sin(phi) * Math.sin(theta),
    SIM.target.y + radius * Math.cos(phi),
    SIM.target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  SIM.camera.lookAt(SIM.target);
}

function simRenderLoop() {
  SIM.animId = requestAnimationFrame(simRenderLoop);
  if (SIM.renderer && SIM.scene && SIM.camera) {
    SIM.renderer.render(SIM.scene, SIM.camera);
  }
}

// ─── FIELD BUILD ──────────────────────────────────────────────────────────────
function buildField() {
  const FW = inToWorld(FIELD_IN);

  // Field floor — gray polycarbonate/tile look
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FW, FW),
    new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.85, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(FW / 2, 0, FW / 2);
  floor.receiveShadow = true;
  SIM.fieldGroup.add(floor);

  // Perimeter walls — white aluminium extrusion
  const wallMat   = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.4, metalness: 0.2 });
  const wallH     = inToWorld(3.5);
  const wallThick = inToWorld(1.5);
  [
    { pos: [FW/2, wallH/2, -wallThick/2],      size: [FW + wallThick*2, wallH, wallThick] },
    { pos: [FW/2, wallH/2, FW+wallThick/2],    size: [FW + wallThick*2, wallH, wallThick] },
    { pos: [-wallThick/2,  wallH/2, FW/2],     size: [wallThick, wallH, FW] },
    { pos: [FW+wallThick/2, wallH/2, FW/2],    size: [wallThick, wallH, FW] },
  ].forEach(w => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
    m.position.set(...w.pos);
    m.castShadow = true;
    SIM.fieldGroup.add(m);
  });

  // Override: blue (left) and red (right) alliance quadrant tints
  const blueQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(FW / 2, FW),
    new THREE.MeshBasicMaterial({ color: 0x1a4a8a, transparent: true, opacity: 0.14, depthWrite: false })
  );
  blueQuad.rotation.x = -Math.PI / 2;
  blueQuad.position.set(FW / 4, 0.003, FW / 2);
  SIM.fieldGroup.add(blueQuad);

  const redQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(FW / 2, FW),
    new THREE.MeshBasicMaterial({ color: 0x8a1a1a, transparent: true, opacity: 0.14, depthWrite: false })
  );
  redQuad.rotation.x = -Math.PI / 2;
  redQuad.position.set(FW * 3 / 4, 0.003, FW / 2);
  SIM.fieldGroup.add(redQuad);

  // X-pattern diagonal lines corner-to-corner
  const diagMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  SIM.fieldGroup.add(
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0.006, 0), new THREE.Vector3(FW, 0.006, FW)]), diagMat),
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(FW, 0.006, 0), new THREE.Vector3(0, 0.006, FW)]), diagMat)
  );

  // Tile grid — 24" squares, light contrast lines on gray floor
  const lineMat  = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.6 });
  const tileSize = inToWorld(24);
  for (let i = 0; i <= 6; i++) {
    const p = i * tileSize;
    SIM.fieldGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(0, 0.005, p), new THREE.Vector3(FW, 0.005, p)]), lineMat),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(p, 0.005, 0), new THREE.Vector3(p, 0.005, FW)]), lineMat)
    );
  }
}

// ─── DEFAULT ROBOT (placeholder before OBJ is loaded) ─────────────────────────
function buildDefaultRobot() {
  // Robot body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(inToWorld(15), inToWorld(6), inToWorld(15)),
    new THREE.MeshStandardMaterial({ color: 0x185FA5, metalness: 0.3, roughness: 0.6 })
  );
  body.position.y = inToWorld(3);
  body.castShadow = true;

  // Direction indicator (front arrow)
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(inToWorld(2.5), inToWorld(5), 8),
    new THREE.MeshStandardMaterial({ color: 0xe8f4ff })
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, inToWorld(3), inToWorld(-9));

  SIM.group.add(body, arrow);
  simPositionRobotMesh();
}

function simPositionRobotMesh() {
  if (!SIM.group) return;
  const wx = inToWorld(SIM.robot.x);
  const wz = inToWorld(SIM.robot.y); // Y in field = Z in world
  SIM.group.position.set(wx, 0, wz);
  SIM.group.rotation.y = -SIM.robot.angle * Math.PI / 180;
}

// ─── AI ROBOTS ────────────────────────────────────────────────────────────────
function buildAIRobot(color, arrowColor) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(inToWorld(15), inToWorld(6), inToWorld(15)),
    new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 })
  );
  body.position.y = inToWorld(3);
  body.castShadow = true;
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(inToWorld(2.5), inToWorld(5), 8),
    new THREE.MeshStandardMaterial({ color: arrowColor })
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, inToWorld(3), inToWorld(-9));
  group.add(body, arrow);
  SIM.scene.add(group);
  return group;
}

function buildAIRobots() {
  const margin = 12;
  // Blue AI: left side (player's alliance). Red AIs: right side.
  const defs = [
    { x: margin,             y: 90,             angle:  90, team: 'blue', color: 0x3B82F6, arrow: 0xdbeafe, role: 'scorer' },
    { x: FIELD_IN - margin,  y: 54,             angle: -90, team: 'red',  color: 0xEF4444, arrow: 0xfee2e2, role: 'scorer' },
    { x: FIELD_IN - margin,  y: 90,             angle: -90, team: 'red',  color: 0xB91C1C, arrow: 0xfca5a5, role: 'harass' },
  ];
  SIM.aiRobots = defs.map(d => {
    const group = buildAIRobot(d.color, d.arrow);
    const ai = {
      x: d.x, y: d.y, angle: d.angle,
      vx: 0, vy: 0, omega: 0,
      team: d.team,
      role: d.role,
      group,
      startX: d.x, startY: d.y, startAngle: d.angle,
      targetX: d.x, targetY: d.y,
      mlAction: null,
      _heldPieces: [],
      _targetPiece: null,
    };
    positionAIRobot(ai);
    return ai;
  });
}

function positionAIRobot(ai) {
  ai.group.position.set(inToWorld(ai.x), 0, inToWorld(ai.y));
  ai.group.rotation.y = -ai.angle * Math.PI / 180;
}

function simGetGoalApproachPoint(goal, entity) {
  let dx = (entity?.x ?? goal.x) - goal.x;
  let dy = (entity?.y ?? goal.y) - goal.y;
  const mag = Math.hypot(dx, dy) || 1;
  dx /= mag; dy /= mag;
  return {
    x: goal.x + dx * GOAL_APPROACH_OFFSET,
    y: goal.y + dy * GOAL_APPROACH_OFFSET,
  };
}

// ── Adaptive-AI weakness data (populated after 5+ sessions) ──────────────────
let SIM_AI_WEAKNESS = null;

async function simLoadAdaptiveData() {
  SIM_AI_WEAKNESS = null;
  if (!window.electronAPI?.simListSessions) return;
  const list = await window.electronAPI.simListSessions();
  const driverSessions = list.filter(s => s.mode === 'driver');
  if (driverSessions.length < 5) return;

  const raw = await Promise.all(
    driverSessions.slice(0, 8).map(s => window.electronAPI.simLoadSession(s.file))
  );
  const sessions = raw.filter(s => s?.frames?.length > 20);
  if (sessions.length < 5) return;

  // Build a coarse 12×12 heatmap of where the player has been across all sessions
  const GRID = 12;
  const heat = new Array(GRID * GRID).fill(0);
  sessions.forEach(s => s.frames.forEach(f => {
    const gx = Math.min(GRID - 1, Math.floor(f.p.x / FIELD_IN * GRID));
    const gy = Math.min(GRID - 1, Math.floor(f.p.y / FIELD_IN * GRID));
    heat[gy * GRID + gx]++;
  }));
  const maxH = Math.max(...heat, 1);

  // Weak zones: field cells the player rarely visits (ignoring outer-edge border cells)
  const weakZones = [];
  const hotZones = [];
  for (let gy = 1; gy < GRID - 1; gy++)
    for (let gx = 1; gx < GRID - 1; gx++)
      if (heat[gy * GRID + gx] / maxH < 0.15) {
        weakZones.push({ cx: (gx + 0.5) / GRID * FIELD_IN, cy: (gy + 0.5) / GRID * FIELD_IN });
      } else if (heat[gy * GRID + gx] / maxH > 0.55) {
        hotZones.push({ cx: (gx + 0.5) / GRID * FIELD_IN, cy: (gy + 0.5) / GRID * FIELD_IN });
      }

  const allSpeeds = sessions.flatMap(s => s.frames.map(f => Math.sqrt(f.p.vx ** 2 + f.p.vy ** 2)));
  const playerAvgSpeed = allSpeeds.reduce((a, b) => a + b, 0) / Math.max(allSpeeds.length, 1);

  SIM_AI_WEAKNESS = { weakZones, hotZones, playerAvgSpeed, analyzed: true };
}

// ── AI objective state machine ────────────────────────────────────────────────
function updateAIObjective(ai) {
  const timeLeft = SIM.match.duration - SIM.match.elapsed;
  const held = ai._heldPieces || (ai._heldPieces = []);

  // Last 15s: rush midfield
  if (timeLeft <= 15) {
    if (ai._state !== 'midfield') {
      ai._state = 'midfield';
      ai.targetX = FIELD_IN / 2;
      ai.targetY = FIELD_IN / 2;
    }
    return;
  }

  // Full or time pressure — go score
  const noPiecesLeft = !SIM.gameObjects.some(o => (o.type === 'pin' || o.type === 'cup') && !o.scored && !o.carriedBy);
  const shouldDeliver = held.length > 0 && (held.length >= 3 || timeLeft <= 30 || noPiecesLeft);
  if (shouldDeliver) {
    const teamGoals = SIM.goals.filter(g => g.team === ai.team || g.team === 'neutral');
    const nearestGoal = teamGoals
      .map(g => ({ g, d: Math.hypot(ai.x - g.x, ai.y - g.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearestGoal) {
      const approach = simGetGoalApproachPoint(nearestGoal.g, ai);
      ai._state = 'score';
      ai.targetX = approach.x;
      ai.targetY = approach.y;
    }
    return;
  }

  // Piece was taken while we were chasing it — reset
  if (ai._state === 'collect' && ai._targetPiece) {
    if (ai._targetPiece.scored || (ai._targetPiece.carriedBy && ai._targetPiece.carriedBy !== ai)) {
      ai._state = null; ai._targetPiece = null;
    }
  }

  // Tracking toward a piece — pick up when close
  if (ai._state === 'collect' && ai._targetPiece) {
    ai.targetX = ai._targetPiece.x;
    ai.targetY = ai._targetPiece.y;
    if (Math.hypot(ai._targetPiece.x - ai.x, ai._targetPiece.y - ai.y) < 14) {
      const piece = ai._targetPiece;
      piece.carriedBy = ai;
      piece.mesh.visible = false;
      held.push(piece);
      ai._targetPiece = null;
      ai._state = held.length >= 3 ? 'score' : null;
    }
    return;
  }

  // Harass: pressure player toward pieces they tend to ignore
  if (ai.role === 'harass' && SIM_AI_WEAKNESS?.analyzed && timeLeft > 30 && held.length === 0) {
    const player = SIM.robot;
    const hot = SIM_AI_WEAKNESS.hotZones?.length
      ? SIM_AI_WEAKNESS.hotZones.reduce((best, z) => {
          const d = Math.hypot(z.cx - player.x, z.cy - player.y);
          return d < best.d ? { z, d } : best;
        }, { z: null, d: Infinity }).z
      : null;
    ai._state = 'pressure';
    ai.targetX = hot ? (player.x + hot.cx) * 0.5 : player.x;
    ai.targetY = hot ? (player.y + hot.cy) * 0.5 : player.y;
    return;
  }

  // Acquire nearest unclaimed piece
  const pieces = SIM.gameObjects.filter(o =>
    (o.type === 'pin' || o.type === 'cup') && !o.scored && !o.carriedBy
  );
  if (!pieces.length) {
    ai._state = 'midfield';
    ai.targetX = FIELD_IN / 2;
    ai.targetY = FIELD_IN / 2;
    return;
  }

  let best = null;
  if (SIM_AI_WEAKNESS?.analyzed && SIM_AI_WEAKNESS.weakZones.length) {
    best = pieces.reduce((acc, o) => {
      const weakScore = SIM_AI_WEAKNESS.weakZones.reduce((s, wz) =>
        s + 1 / (1 + Math.hypot(o.x - wz.cx, o.y - wz.cy)), 0);
      const aiDist = Math.hypot(o.x - ai.x, o.y - ai.y);
      const score = weakScore / (aiDist * 0.008 + 1);
      return score > acc.score ? { o, score } : acc;
    }, { o: null, score: -Infinity }).o;
  }
  if (!best) {
    best = pieces.reduce((acc, o) => {
      const d = Math.hypot(o.x - ai.x, o.y - ai.y);
      return d < acc.d ? { o, d } : acc;
    }, { o: null, d: Infinity }).o;
  }

  ai._targetPiece = best;
  ai._state = 'collect';
  ai.targetX = best.x;
  ai.targetY = best.y;
}

function tickAIRobot(ai) {
  updateAIObjective(ai);

  const dx = ai.targetX - ai.x;
  const dy = ai.targetY - ai.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Stall detection
  ai._stallTimer = (ai._stallTimer || 0) + TICK_DT;
  const aiSpd = Math.sqrt(ai.vx * ai.vx + ai.vy * ai.vy);
  if (ai._stallTimer > 2.0 && dist > 20 && aiSpd < 2) {
    ai._state = null; ai._targetPiece = null; ai._stallTimer = 0;
  }

  // Speed boost when adaptive mode is active
  const adaptiveBoost = SIM_AI_WEAKNESS?.analyzed ? 1.15 : 1.0;

  const desiredAngle = Math.atan2(dx, -dy) * 180 / Math.PI;
  let angleDiff = desiredAngle - ai.angle;
  angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;

  const facingTarget = Math.abs(angleDiff) < 50;
  const speed        = Math.min(dist / 25, 1) * DRIVE_SPEED * adaptiveBoost * (facingTarget ? 0.90 : 0.35);
  const turnInput  = Math.max(-1, Math.min(1, angleDiff / 35));

  const rad = ai.angle * Math.PI / 180;
  const tVx = Math.sin(rad) * speed;
  const tVy = -Math.cos(rad) * speed;
  const tOm = turnInput * TURN_RATE * 0.90;

  const linAlpha  = TICK_DT / (speed > 0.1 ? DRIVE_TAU : COAST_TAU);
  const turnAlpha = TICK_DT / (Math.abs(tOm) > 0.1 ? TURN_TAU : COAST_TURN);
  ai.vx    += (tVx - ai.vx) * linAlpha;
  ai.vy    += (tVy - ai.vy) * linAlpha;
  ai.omega += (tOm - ai.omega) * turnAlpha;

  const spd = Math.sqrt(ai.vx ** 2 + ai.vy ** 2);
  if (spd > DRIVE_SPEED * adaptiveBoost) { const s = DRIVE_SPEED * adaptiveBoost / spd; ai.vx *= s; ai.vy *= s; }

  const a = ai.angle * Math.PI / 180;
  const cosA = Math.abs(Math.cos(a)), sinA = Math.abs(Math.sin(a));
  const hw = 8;
  const hx = hw * cosA + hw * sinA, hy = hw * sinA + hw * cosA;
  let nx = ai.x + ai.vx * TICK_DT, ny = ai.y + ai.vy * TICK_DT;
  let hitWall = false;
  if (nx < hx || nx > FIELD_IN - hx) { ai.vx = 0; nx = Math.max(hx, Math.min(FIELD_IN - hx, nx)); hitWall = true; }
  if (ny < hy || ny > FIELD_IN - hy) { ai.vy = 0; ny = Math.max(hy, Math.min(FIELD_IN - hy, ny)); hitWall = true; }
  ai.x = nx; ai.y = ny;
  if (hitWall) { ai._state = null; ai._targetPiece = null; }

  ai.angle += ai.omega * TICK_DT;
}

function resetAIRobots() {
  SIM.aiRobots.forEach(ai => {
    ai.x = ai.startX; ai.y = ai.startY; ai.angle = ai.startAngle;
    ai.vx = 0; ai.vy = 0; ai.omega = 0;
    ai.targetX = ai.startX; ai.targetY = ai.startY;
    ai._state = null; ai._targetPiece = null; ai._stallTimer = 0;
    ai._heldPieces = [];
    positionAIRobot(ai);
  });
}

// ─── GAME OBJECTS — V5RC OVERRIDE ────────────────────────────────────────────
function loadDefaultGameObjects() {
  if (typeof THREE === 'undefined' || !SIM.gameObjectsGroup) return;
  while (SIM.gameObjectsGroup.children.length)
    SIM.gameObjectsGroup.remove(SIM.gameObjectsGroup.children[0]);
  SIM.gameObjects = [];
  SIM.goals = [];
  SIM.score.player = 0;
  SIM.score.opponent = 0;
  SIM.override.heldPieces = [];
  SIM.toggleOwner = { left: null, right: null, top: null, bottom: null };

  // ── 9 Goals ───────────────────────────────────────────────────────────────
  const goalGeoShort = new THREE.CylinderGeometry(inToWorld(4.5), inToWorld(4.5), inToWorld(18), 16, 1, true);
  const goalGeoTall  = new THREE.CylinderGeometry(inToWorld(4.5), inToWorld(4.5), inToWorld(30), 16, 1, true);
  const goalBaseGeo  = new THREE.CylinderGeometry(inToWorld(5.5), inToWorld(5.5), inToWorld(1.5), 16);
  const goalRimGeo   = new THREE.TorusGeometry(inToWorld(4.5), inToWorld(0.7), 8, 24);

  OVERRIDE_GOALS.forEach(gDef => {
    const teamColor = gDef.team === 'blue' ? 0x2563eb : gDef.team === 'red' ? 0xdc2626 : 0x444444;
    const tubeMat   = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
    const baseMat   = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.35, metalness: 0.55 });
    const rimMat    = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 });

    const h = gDef.type === 'tall' ? 30 : 18;
    const tube = new THREE.Mesh(gDef.type === 'tall' ? goalGeoTall : goalGeoShort, tubeMat);
    tube.position.set(inToWorld(gDef.x), inToWorld(h / 2), inToWorld(gDef.y));
    tube.castShadow = true;

    const base = new THREE.Mesh(goalBaseGeo, baseMat);
    base.position.set(inToWorld(gDef.x), inToWorld(0.75), inToWorld(gDef.y));

    const rim = new THREE.Mesh(goalRimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(inToWorld(gDef.x), inToWorld(h), inToWorld(gDef.y));

    SIM.gameObjectsGroup.add(tube, base, rim);
    const goalEntry = { x: gDef.x, y: gDef.y, type: gDef.type, team: gDef.team, pieces: [] };
    SIM.goals.push(goalEntry);
  });

  // ── 4 Toggles (center of each wall) ──────────────────────────────────────
  const toggleGeo = new THREE.BoxGeometry(inToWorld(6), inToWorld(3), inToWorld(1.5));
  OVERRIDE_TOGGLES.forEach(tDef => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.3 });
    const mesh = new THREE.Mesh(toggleGeo, mat);
    const isHoriz = tDef.id === 'left' || tDef.id === 'right';
    if (!isHoriz) mesh.rotation.y = Math.PI / 2;
    mesh.position.set(inToWorld(tDef.x), inToWorld(3), inToWorld(tDef.y));
    mesh.castShadow = true;
    SIM.gameObjectsGroup.add(mesh);
    SIM.gameObjects.push({ type: 'toggle', id: tDef.id, quad: tDef.quad, x: tDef.x, y: tDef.y, mesh, _dirty: false });
  });

  // ── 63 Pins (21 red, 21 blue, 21 yellow) ─────────────────────────────────
  const pinGeo = new THREE.ConeGeometry(inToWorld(1.5), inToWorld(PIN_HEIGHT), 8);
  const pinColors = { red: 0xef4444, blue: 0x3b82f6, yellow: 0xfbbf24 };

  const redPinPos = [
    [88,12],[104,12],[120,12],[88,32],[104,32],[120,32],[88,52],[104,52],[120,52],
    [88,72],[104,72],[120,72],[88,92],[104,92],[120,92],[88,112],[104,112],[120,112],
    [88,132],[104,132],[120,132],
  ];
  const bluePinPos = [
    [24,12],[40,12],[56,12],[24,32],[40,32],[56,32],[24,52],[40,52],[56,52],
    [24,72],[40,72],[56,72],[24,92],[40,92],[56,92],[24,112],[40,112],[56,112],
    [24,132],[40,132],[56,132],
  ];
  const yellowPinPos = [
    [64,16],[72,16],[80,16],[64,42],[80,42],[72,44],[58,68],[86,68],[72,68],
    [64,100],[72,100],[80,100],[64,128],[72,128],[80,128],
    [52,72],[92,72],[72,56],[54,28],[90,28],[72,116],
  ];

  [['red', redPinPos], ['blue', bluePinPos], ['yellow', yellowPinPos]].forEach(([color, positions]) => {
    const mat = new THREE.MeshStandardMaterial({ color: pinColors[color], roughness: 0.55, metalness: 0.05 });
    positions.forEach(([px, py]) => {
      const mesh = new THREE.Mesh(pinGeo, mat.clone());
      mesh.position.set(inToWorld(px), inToWorld(PIN_HEIGHT / 2), inToWorld(py));
      mesh.castShadow = true;
      SIM.gameObjectsGroup.add(mesh);
      SIM.gameObjects.push({ type: 'pin', color, x: px, y: py, mesh, scored: false, carriedBy: null, scoredBy: null, _lastTouchedBy: null });
    });
  });

  // ── 56 Cups ───────────────────────────────────────────────────────────────
  const cupGeo = new THREE.CylinderGeometry(inToWorld(2), inToWorld(1.4), inToWorld(CUP_HEIGHT), 10);
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.05 });
  const cupXs  = [8, 28, 48, 68, 76, 96, 116, 136];
  const cupYs  = [10, 28, 46, 72, 98, 116, 134];
  cupYs.forEach(cy => cupXs.forEach(cx => {
    const mesh = new THREE.Mesh(cupGeo, cupMat.clone());
    mesh.position.set(inToWorld(cx), inToWorld(CUP_HEIGHT / 2), inToWorld(cy));
    mesh.castShadow = true;
    SIM.gameObjectsGroup.add(mesh);
    SIM.gameObjects.push({ type: 'cup', x: cx, y: cy, mesh, scored: false, carriedBy: null, scoredBy: null, _lastTouchedBy: null });
  }));
}

// ── Override player + AI mechanics ───────────────────────────────────────────

function simHasMechanismType(type) {
  return !!SIM.config?.mechanisms?.some(m => (m.type || '').toLowerCase() === type);
}

function simIsMechanismActive(type) {
  return !!SIM.config?.mechanisms?.some(m => (m.type || '').toLowerCase() === type && SIM.mechanisms[m.id]?.active);
}

function simGetPlayerPickupPoint() {
  const rad = SIM.robot.angle * Math.PI / 180;
  return {
    x: SIM.robot.x + Math.sin(rad) * PLAYER_PICKUP_FRONT_BIAS,
    y: SIM.robot.y - Math.cos(rad) * PLAYER_PICKUP_FRONT_BIAS,
  };
}

function simTickPlayerOverride() {
  const keyIntake  = !!SIM.keys['z'];
  const keyDeposit = !!SIM.keys['x'];
  const legacyIntake = !simHasMechanismType('intake') && !!SIM.config?.motors?.some(
    m => m.role === 'intake' && Math.abs(SIM.motors[m.id]?.voltage || 0) > 25
  );
  const intakeActive  = keyIntake  || simIsMechanismActive('intake') || simIsMechanismActive('conveyor') || legacyIntake;
  const depositActive = keyDeposit || simIsMechanismActive('hopper') || simIsMechanismActive('outtake');

  const held = SIM.override.heldPieces;
  const front = simGetPlayerPickupPoint();

  // Capture toggle when close
  SIM.gameObjects.filter(o => o.type === 'toggle').forEach(toggle => {
    if (Math.hypot(SIM.robot.x - toggle.x, SIM.robot.y - toggle.y) < TOGGLE_CAPTURE_RADIUS) {
      if (SIM.toggleOwner[toggle.quad] !== 'blue') {
        SIM.toggleOwner[toggle.quad] = 'blue';
        toggle._dirty = true;
      }
    }
  });

  // Pick up nearest piece
  if (intakeActive && held.length < 3) {
    const best = SIM.gameObjects
      .filter(o => (o.type === 'pin' || o.type === 'cup') && !o.scored && !o.carriedBy)
      .map(o => ({ o, d: Math.hypot(o.x - front.x, o.y - front.y) }))
      .filter(e => e.d < PLAYER_PICKUP_RANGE)
      .sort((a, b) => a.d - b.d)[0];
    if (best) {
      best.o.carriedBy = 'player';
      best.o.mesh.visible = false;
      held.push(best.o);
    }
  }

  // Deposit all held pieces into nearest goal
  if (depositActive && held.length > 0) {
    const near = SIM.goals
      .map(g => ({ g, d: Math.hypot(SIM.robot.x - g.x, SIM.robot.y - g.y) }))
      .filter(e => e.d < GOAL_SCORE_RADIUS)
      .sort((a, b) => a.d - b.d)[0];
    if (near) {
      while (held.length) {
        const piece = held.pop();
        piece.scored  = true;
        piece.carriedBy = null;
        piece.scoredBy  = 'blue';
        near.g.pieces.push(piece);
      }
    }
  }
}

function tickGameObjects() {
  simTickPlayerOverride();

  // AI piece pickup + deposit
  SIM.aiRobots.forEach(ai => {
    const held = ai._heldPieces || (ai._heldPieces = []);

    // Toggle capture
    SIM.gameObjects.filter(o => o.type === 'toggle').forEach(toggle => {
      if (Math.hypot(ai.x - toggle.x, ai.y - toggle.y) < TOGGLE_CAPTURE_RADIUS) {
        if (SIM.toggleOwner[toggle.quad] !== ai.team) {
          SIM.toggleOwner[toggle.quad] = ai.team;
          toggle._dirty = true;
        }
      }
    });

    // Pickup when collecting
    if (ai._state === 'collect' && held.length < 3) {
      const best = SIM.gameObjects
        .filter(o => (o.type === 'pin' || o.type === 'cup') && !o.scored && !o.carriedBy)
        .map(o => ({ o, d: Math.hypot(o.x - ai.x, o.y - ai.y) }))
        .filter(e => e.d < 14)
        .sort((a, b) => a.d - b.d)[0];
      if (best) {
        best.o.carriedBy = ai;
        best.o.mesh.visible = false;
        held.push(best.o);
        ai._targetPiece = null;
        if (held.length >= 3) ai._state = null;
      }
    }

    // Deposit when scoring
    if (ai._state === 'score' && held.length > 0) {
      const teamGoals = SIM.goals.filter(g => g.team === ai.team || g.team === 'neutral');
      const near = teamGoals
        .map(g => ({ g, d: Math.hypot(ai.x - g.x, ai.y - g.y) }))
        .filter(e => e.d < GOAL_SCORE_RADIUS)
        .sort((a, b) => a.d - b.d)[0];
      if (near) {
        while (held.length) {
          const piece = held.pop();
          piece.scored = true;
          piece.carriedBy = null;
          piece.scoredBy = ai.team;
          near.g.pieces.push(piece);
        }
        ai._state = null;
      }
    }
  });

  // Push loose pieces with robot contact + check if pushed into a goal
  const robots = [{ r: SIM.robot, tag: 'player' }, ...SIM.aiRobots.map(r => ({ r, tag: r.team }))];
  SIM.gameObjects.forEach(o => {
    if (o.type !== 'pin' && o.type !== 'cup') return;
    if (o.scored || o.carriedBy) return;

    robots.forEach(({ r, tag }) => {
      const dx = o.x - r.x, dy = o.y - r.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < PIECE_PUSH_DIST && d > 0.01) {
        const spd = Math.sqrt(r.vx ** 2 + r.vy ** 2);
        const impulse = (PIECE_PUSH_DIST - d) * 0.4 + spd * 0.25;
        o.x += (dx / d) * impulse * TICK_DT;
        o.y += (dy / d) * impulse * TICK_DT;
        o._lastTouchedBy = tag;
      }
    });

    o.x = Math.max(2, Math.min(FIELD_IN - 2, o.x));
    o.y = Math.max(2, Math.min(FIELD_IN - 2, o.y));

    const goal = SIM.goals.find(g => Math.hypot(g.x - o.x, g.y - o.y) < GOAL_SCORE_RADIUS * 0.55);
    if (goal) {
      o.scored = true;
      o.scoredBy = o._lastTouchedBy === 'player' ? 'blue'
                 : o._lastTouchedBy === 'red'    ? 'red'
                 : o._lastTouchedBy === 'blue'   ? 'blue' : null;
      goal.pieces.push(o);
      o.mesh.visible = false;
    } else {
      o.mesh.position.set(inToWorld(o.x), inToWorld(o.type === 'pin' ? PIN_HEIGHT / 2 : CUP_HEIGHT / 2), inToWorld(o.y));
    }
  });

  // Update toggle mesh colors
  SIM.gameObjects.filter(o => o.type === 'toggle' && o._dirty).forEach(toggle => {
    const owner = SIM.toggleOwner[toggle.quad];
    const color = owner === 'blue' ? 0x3B82F6 : owner === 'red' ? 0xEF4444 : 0x888888;
    if (toggle.mesh?.material) toggle.mesh.material.color.setHex(color);
    toggle._dirty = false;
  });

  // Live score refresh
  const sc = simCalcScore();
  SIM.score.player   = sc.player;
  SIM.score.opponent = sc.opponent;
}

// ─── PHYSICS CONSTANTS (VEX-accurate, overridden by config on load) ──────────
const TICK_DT    = 0.016;   // 16ms physics step — fixed, never changes

// These are recalculated by simApplyDrivetrainConfig() when a config loads.
// Defaults: 200rpm cartridge, 3.25" wheel, 12" track → ~34 in/s.
let DRIVE_SPEED  = 200 * Math.PI * 3.25 / 60;   // in/s
let TRACK_WIDTH  = 12.0;                          // inches
let TURN_RATE    = (DRIVE_SPEED * 2 / TRACK_WIDTH) * (180 / Math.PI); // deg/s
let WHEEL_DIAM   = 3.25;                          // inches

function simApplyDrivetrainConfig(dt) {
  if (!dt) return;
  const rpm      = parseInt(dt.cartridge)     || dt.maxRPM        || 200;
  const extRatio = dt.externalGearRatio       || 1.0;
  const diam     = dt.wheelDiameter           || 3.25;
  DRIVE_SPEED    = rpm * extRatio * Math.PI * diam / 60;
  WHEEL_DIAM     = diam;
  TRACK_WIDTH    = dt.trackWidth              || TRACK_WIDTH;
  TURN_RATE      = (DRIVE_SPEED * 2 / TRACK_WIDTH) * (180 / Math.PI);
}

// First-order lag time constants — tuned to real VEX carpet behavior
const DRIVE_TAU   = 0.10;   // s — motor applying voltage (0→99% in ~0.5 s)
const COAST_TAU   = 0.20;   // s — coasting (carpet friction decelerates)
const TURN_TAU    = 0.09;   // s — angular lag while turning
const COAST_TURN  = 0.17;   // s — angular friction when not turning

let _targetVx = 0, _targetVy = 0, _targetOmega = 0;

// ─── ROBOT–ROBOT COLLISION ────────────────────────────────────────────────────
// Separating Axis Theorem for two oriented bounding boxes in 2D field coords.
// Convention: angle θ degrees → right=(cos θ, sin θ), fwd=(sin θ, -cos θ).
// Returns { overlap, nx, ny } (normal from A toward B) or null if separated.
function obbOverlap(ax, ay, aa, aw, ah, bx, by, ba, bw, bh) {
  const aRad = aa * Math.PI / 180, bRad = ba * Math.PI / 180;
  const aHW = aw * 0.5, aHH = ah * 0.5, bHW = bw * 0.5, bHH = bh * 0.5;
  // Local unit axes for each box
  const aR = [Math.cos(aRad), Math.sin(aRad)];
  const aF = [Math.sin(aRad), -Math.cos(aRad)];
  const bR = [Math.cos(bRad), Math.sin(bRad)];
  const bF = [Math.sin(bRad), -Math.cos(bRad)];
  const dx = bx - ax, dy = by - ay;
  let minOv = Infinity, mnx = 0, mny = 0;
  for (const [tx, ty] of [aR, aF, bR, bF]) {
    const cd = dx * tx + dy * ty;
    const rA = aHW * Math.abs(aR[0]*tx + aR[1]*ty) + aHH * Math.abs(aF[0]*tx + aF[1]*ty);
    const rB = bHW * Math.abs(bR[0]*tx + bR[1]*ty) + bHH * Math.abs(bF[0]*tx + bF[1]*ty);
    const ov = rA + rB - Math.abs(cd);
    if (ov <= 0) return null;
    if (ov < minOv) { minOv = ov; const s = cd >= 0 ? 1 : -1; mnx = tx*s; mny = ty*s; }
  }
  return { overlap: minOv, nx: mnx, ny: mny };
}

function resolveRobotPair(ra, va, wa, ha, rb, vb, wb, hb) {
  // ra/rb: {x,y,angle}, va/vb: {vx,vy,omega} — mutated in-place
  const col = obbOverlap(ra.x, ra.y, ra.angle, wa, ha, rb.x, rb.y, rb.angle, wb, hb);
  if (!col) return;
  const { overlap, nx, ny } = col;
  // Positional correction — push apart with a slight surplus to prevent sticking
  const sep = (overlap + 0.2) * 0.5;
  ra.x -= nx * sep; ra.y -= ny * sep;
  rb.x += nx * sep; rb.y += ny * sep;
  // Velocity impulse along collision normal
  const dvx = vb.vx - va.vx, dvy = vb.vy - va.vy;
  const vRelN = dvx * nx + dvy * ny;
  if (vRelN >= 0) return; // already separating
  const e = 0.22; // restitution: inelastic — VEX bots are heavy polycarbonate
  const j = -(1 + e) * vRelN * 0.5; // equal mass impulse
  va.vx -= j * nx; va.vy -= j * ny;
  vb.vx += j * nx; vb.vy += j * ny;
  // Small angular kick from off-center impact — makes bots spin on glancing hits
  const tang = (dvx * ny - dvy * nx) * 0.07;
  va.omega -= tang; vb.omega += tang;
}

function resolveAllRobotCollisions() {
  if (!SIM.aiRobots.length) return;
  const r  = SIM.robot;
  const pW = SIM.config?.drivetrain?.robotWidth  || r.width;
  const pH = SIM.config?.drivetrain?.robotLength || r.height;
  // Run 3 solver iterations to handle chain reactions (3 bots in a row, corner pushes)
  for (let iter = 0; iter < 3; iter++) {
    // Player vs each AI
    SIM.aiRobots.forEach(ai => {
      resolveRobotPair(r, r, pW, pH, ai, ai, 15, 15);
    });
    // AI vs AI
    for (let i = 0; i < SIM.aiRobots.length; i++) {
      for (let j = i + 1; j < SIM.aiRobots.length; j++) {
        resolveRobotPair(SIM.aiRobots[i], SIM.aiRobots[i], 15, 15,
                         SIM.aiRobots[j], SIM.aiRobots[j], 15, 15);
      }
    }
  }
  // Clamp all robots to field walls after resolution
  const clamp = (ref, w, h) => {
    const a = ref.angle * Math.PI / 180;
    const cA = Math.abs(Math.cos(a)), sA = Math.abs(Math.sin(a));
    const hx = w/2 * cA + h/2 * sA, hy = w/2 * sA + h/2 * cA;
    ref.x = Math.max(hx, Math.min(FIELD_IN - hx, ref.x));
    ref.y = Math.max(hy, Math.min(FIELD_IN - hy, ref.y));
  };
  clamp(r, pW, pH);
  SIM.aiRobots.forEach(ai => clamp(ai, 15, 15));

  // Goals act as solid obstacles for robot collision
  const obstacles = SIM.goals.map(g => ({ x: g.x, y: g.y, radius: GOAL_SOLID_RADIUS }));
  const resolveVsObstacle = (bot, width, length) => {
    const botRadius = Math.max(width, length) * 0.42;
    obstacles.forEach(obs => {
      const dx = bot.x - obs.x, dy = bot.y - obs.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const minD = botRadius + obs.radius;
      if (d < minD) {
        const nx = dx / d, ny = dy / d;
        const push = minD - d;
        bot.x += nx * push;
        bot.y += ny * push;
        const vn = bot.vx * nx + bot.vy * ny;
        if (vn < 0) {
          bot.vx -= vn * nx;
          bot.vy -= vn * ny;
        }
      }
    });
  };
  resolveVsObstacle(r, pW, pH);
  SIM.aiRobots.forEach(ai => resolveVsObstacle(ai, 15, 15));
  clamp(r, pW, pH);
  SIM.aiRobots.forEach(ai => clamp(ai, 15, 15));
}

function simPhysicsTick() {
  if (SIM.match.mode === 'driver' || SIM.match.mode === 'freeRoam') {
    processDriverInput();
  } else if (SIM.match.mode === 'pid') {
    processPIDTick();
  }

  const r = SIM.robot;

  // First-order lag: separate tau for driving vs coasting so acceleration and
  // braking feel match real V5 motor + carpet behavior independently.
  const isDriving = (_targetVx !== 0 || _targetVy !== 0);
  const isTurning = (_targetOmega !== 0);
  const linAlpha  = TICK_DT / (isDriving ? DRIVE_TAU  : COAST_TAU);
  const turnAlpha = TICK_DT / (isTurning ? TURN_TAU   : COAST_TURN);

  r.vx    += (_targetVx    - r.vx)    * linAlpha;
  r.vy    += (_targetVy    - r.vy)    * linAlpha;
  r.omega += (_targetOmega - r.omega) * turnAlpha;

  // Clamp to free-speed ceiling (guards against floating-point drift)
  const spd = Math.sqrt(r.vx ** 2 + r.vy ** 2);
  if (spd > DRIVE_SPEED) { r.vx *= DRIVE_SPEED / spd; r.vy *= DRIVE_SPEED / spd; }

  // Wall collision with sliding:
  // Compute AABB half-extents of the rotated robot footprint, then advance
  // each axis independently — zeroing only the velocity component that would
  // penetrate a wall.  The other component continues freely, so the robot
  // slides along walls instead of stopping dead or teleporting.
  {
    const a    = r.angle * Math.PI / 180;
    const cosA = Math.abs(Math.cos(a));
    const sinA = Math.abs(Math.sin(a));
    const rw   = (SIM.config?.drivetrain?.robotWidth  || r.width)  / 2;
    const rd   = (SIM.config?.drivetrain?.robotLength || r.height) / 2;
    const hx   = rw * cosA + rd * sinA;
    const hy   = rw * sinA + rd * cosA;

    let nx = r.x + r.vx * TICK_DT;
    let ny = r.y + r.vy * TICK_DT;

    let hitWall = false;
    if (nx < hx || nx > FIELD_IN - hx) {
      r.vx = 0;
      nx   = Math.max(hx, Math.min(FIELD_IN - hx, nx));
      hitWall = true;
    }
    if (ny < hy || ny > FIELD_IN - hy) {
      r.vy = 0;
      ny   = Math.max(hy, Math.min(FIELD_IN - hy, ny));
      hitWall = true;
    }

    r.x = nx;
    r.y = ny;

    // On wall contact, snap the robot's flat side flush with the wall — only while
    // input is actively being given (keys held / gamepad live), not during coast-out.
    const hasInput = (_targetVx !== 0 || _targetVy !== 0 || _targetOmega !== 0);
    if (hitWall && SIM.match.mode === 'driver' && hasInput) {
      r.snapTarget = Math.round(r.angle / 90) * 90;
    }
  }

  // Wall-alignment snap: spring the robot toward snapTarget while not actively turning.
  // Cancelled the moment the driver steers, giving them full control back.
  if (r.snapTarget !== null && SIM.match.mode === 'driver') {
    const hasInput = (_targetVx !== 0 || _targetVy !== 0 || _targetOmega !== 0);
    if (!hasInput || Math.abs(_targetOmega) > TURN_RATE * 0.25) {
      r.snapTarget = null;
    } else {
      let diff = r.snapTarget - r.angle;
      diff = ((diff + 180) % 360 + 360) % 360 - 180; // normalise to [-180, 180]
      if (Math.abs(diff) < 0.4) {
        r.angle = r.snapTarget;
        r.omega = 0;
        r.snapTarget = null;
      } else {
        // Proportional spring capped at full turn rate — snaps in ~0.15 s from worst case
        r.omega = Math.sign(diff) * Math.min(Math.abs(diff) * 12, TURN_RATE);
      }
    }
  }

  r.angle += r.omega * TICK_DT;

  animateMotors();

  // Sensor updates
  const spd2 = Math.sqrt(r.vx ** 2 + r.vy ** 2);
  SIM.sensors.encFwd   += spd2 * TICK_DT * (360 / (Math.PI * WHEEL_DIAM));
  SIM.sensors.imuDrift += (Math.random() - 0.5) * 0.002;
  SIM.sensors.imu       = r.angle + SIM.sensors.imuDrift;
  SIM.sensors.odomX     = r.x + (Math.random() - 0.5) * 0.05;
  SIM.sensors.odomY     = r.y + (Math.random() - 0.5) * 0.05;

  if (SIM.match.running) {
    if (SIM.match.mode !== 'freeRoam') {
      SIM.match.elapsed = Math.min(SIM.match.duration, SIM.match.elapsed + TICK_DT);
      if (SIM.match.elapsed >= SIM.match.duration) simStopMatch();
    }
  }

  // Tick AI robots — skipped in free roam; ML policy takes over when mlAction is set
  if (SIM.match.running) {
    if (SIM.match.mode !== 'freeRoam') {
      SIM.aiRobots.forEach(ai => ai.mlAction ? simApplyMLAction(ai) : tickAIRobot(ai));
    }
    tickGameObjects();
  }

  // Telemetry: sample at ~10fps (every 6 physics ticks at 60Hz)
  if (SIM.telemetry.recording && SIM.match.running) {
    if (++SIM.telemetry._tick % 6 === 0) SIM.telemetry.buffer.push(simSnapshotState());
  }

  // Robot–robot collision resolution (runs even pre-match so player can bump stationary AIs)
  resolveAllRobotCollisions();

  // Sync all meshes after collision correction may have shifted positions
  simPositionRobotMesh();
  SIM.aiRobots.forEach(positionAIRobot);

  simUpdateSidebar();
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
// Differential tank drive: compute left/right wheel voltages (-1 to +1), then
// derive forward velocity and angular velocity via proper tank kinematics.
//   fwd  = (L + R) / 2 * MAX_SPEED
//   omega = (R - L) / TRACK_WIDTH * MAX_SPEED  (rad/s → deg/s)
function processDriverInput() {
  const k   = SIM.keys;
  const rad = SIM.robot.angle * Math.PI / 180;
  let leftV = 0, rightV = 0;   // [-1, 1] normalized voltage per side
  let intakeVoltage = 0;

  // Keyboard: arcade mapping → differential
  // W/S sets both sides equal; A/D adds opposite sign to each side.
  let kFwd = 0, kTurn = 0;
  if (k['w'] || k['arrowup'])    kFwd  =  1.0;
  if (k['s'] || k['arrowdown'])  kFwd  = -0.75;  // slight reverse penalty
  if (k['a'] || k['arrowleft'])  kTurn = -1.0;
  if (k['d'] || k['arrowright']) kTurn =  1.0;
  leftV  = Math.max(-1, Math.min(1, kFwd - kTurn));
  rightV = Math.max(-1, Math.min(1, kFwd + kTurn));

  // Keyboard intake uses Z by default
  if (k['z']) intakeVoltage = 100;

  // Gamepad: true tank drive (left stick Y = left side, right stick Y = right side)
  if (SIM.gamepad !== null) {
    const gp = navigator.getGamepads()[SIM.gamepad];
    if (gp) {
      const ly = -deadband(gp.axes[1], 0.12);
      const ry = -deadband(gp.axes[3] ?? gp.axes[1], 0.12);
      leftV  = ly;
      rightV = ry;
      const r2 = gp.buttons[7] ? gp.buttons[7].value : Math.max(0, (gp.axes[5] ?? -1) + 1) / 2;
      const l2 = gp.buttons[6] ? gp.buttons[6].value : Math.max(0, (gp.axes[4] ?? -1) + 1) / 2;
      intakeVoltage = (r2 - l2) * 100;
    }
  }

  // Legacy: drive intake-role motors via R/F keys (backward compat)
  if (SIM.config?.motors) {
    SIM.config.motors.forEach(m => {
      if (m.role === 'intake') {
        if (!SIM.motors[m.id]) SIM.motors[m.id] = { voltage: 0 };
        SIM.motors[m.id].voltage = intakeVoltage;
        const slider = document.getElementById('mv_slider_' + m.id);
        const label  = document.getElementById('mv_' + m.id);
        if (slider) slider.value = intakeVoltage;
        if (label)  label.textContent = intakeVoltage + '%';
      }
    });
  }

  // Mechanism keybinds — run after legacy so they take priority on same motor
  (SIM.config?.mechanisms || []).forEach(mech => {
    const mechType = (mech.type || '').toLowerCase();
    const defaultKey = mech.keyBind
      ? mech.keyBind.toLowerCase()
      : (mechType === 'intake' || mechType === 'conveyor') ? 'z'
      : (mechType === 'hopper' || mechType === 'flywheel' || mechType === 'outtake') ? 'x'
      : '';
    if (!defaultKey) return;
    const held    = !!k[defaultKey];
    const revHeld = mech.reverseKeyBind ? !!k[mech.reverseKeyBind.toLowerCase()] : false;
    if (!SIM.mechanisms[mech.id]) SIM.mechanisms[mech.id] = { active: false };
    SIM.mechanisms[mech.id].active = held || revHeld;
    const voltage = held    ?  (mech.direction || 1) * 100
                  : revHeld ? -(mech.direction || 1) * 100
                  : 0;
    (mech.motors || []).forEach(motorId => {
      if (!SIM.motors[motorId]) SIM.motors[motorId] = { voltage: 0 };
      SIM.motors[motorId].voltage = voltage;
      const slider = document.getElementById('mv_slider_' + motorId);
      const label  = document.getElementById('mv_' + motorId);
      if (slider) slider.value = voltage;
      if (label)  label.textContent = voltage + '%';
    });
  });

  // Tank kinematics → world-frame target velocities
  const fwdSpeed  = (leftV + rightV) / 2 * DRIVE_SPEED;
  const turnDegs  = (rightV - leftV) / TRACK_WIDTH * DRIVE_SPEED * (180 / Math.PI);

  _targetVx    = Math.sin(rad) * fwdSpeed;
  _targetVy    = -Math.cos(rad) * fwdSpeed;
  _targetOmega = turnDegs;
}

function deadband(v, db) { return Math.abs(v) < db ? 0 : v; }

// ─── PID TUNER TICK ───────────────────────────────────────────────────────────
function processPIDTick() {
  const p = SIM.pid;
  const error = p.target - p.current;
  p.integral = Math.max(-100, Math.min(100, p.integral + error * TICK_DT));
  const deriv = (error - p.prevError) / TICK_DT;
  p.prevError = error;
  const output = p.kP * error + p.kI * p.integral + p.kD * deriv;
  p.current += Math.max(-TURN_RATE, Math.min(TURN_RATE, output)) * TICK_DT;
  SIM.robot.angle = p.current;
  p.history.push(parseFloat(error.toFixed(2)));
  if (p.history.length > 100) p.history.shift();
  simDrawPIDGraph();

  // Status label
  const abs = Math.abs(error);
  let status = abs < 0.5 ? '✓ Settled' : abs < 5 ? 'Stable — low overshoot' : abs < 20 ? 'Oscillating — raise kD' : 'Unstable — lower kP';
  const el = document.getElementById('simPidStatus');
  if (el) el.textContent = status;

  _targetVx = 0; _targetVy = 0; _targetOmega = 0;
}

// ─── MOTOR ANIMATION ──────────────────────────────────────────────────────────
function animateMotors() {
  if (!SIM.config) return;
  const dt = SIM.config.drivetrain || {};

  // Build a voltage lookup so gears/sprockets can reference motors by id
  const voltageOf = id => (SIM.motors[id]?.voltage || 0) / 100;

  // Motors: spin mesh at RPM derived from cartridge × external gear ratio
  (SIM.config.motors || []).forEach(m => {
    const mesh = SIM.meshMap[m.meshName];
    if (!mesh) return;
    const cartRPM  = parseInt(m.cartridge || dt.cartridge || '200') || 200;
    const ratio    = m.gearRatio || 1.0;
    const dir      = m.reversed  ? -1 : 1;
    const rpt      = voltageOf(m.id) * cartRPM * ratio * dir * (Math.PI / 30) * TICK_DT;
    mesh.rotation[m.axis || 'x'] += rpt;
  });

  // Gears: spin at inputRPM × (inputTeeth / ownTeeth), direction inverts for meshing
  (SIM.config.gears || []).forEach(g => {
    const mesh = SIM.meshMap[g.meshName];
    if (!mesh) return;
    const inputMotor = SIM.config.motors?.find(m => m.id === g.linkedMotor);
    if (!inputMotor) return;
    const cartRPM    = parseInt(inputMotor.cartridge || dt.cartridge || '200') || 200;
    const inputRPM   = voltageOf(inputMotor.id) * cartRPM * (inputMotor.gearRatio || 1.0);
    const outputRPM  = inputRPM * ((g.inputTeeth || 36) / (g.teeth || 36));
    const dir        = g.meshes ? -1 : 1; // meshing gears reverse direction
    mesh.rotation[g.axis || 'y'] += dir * outputRPM * (Math.PI / 30) * TICK_DT;
  });

  // Sprockets: same direction as driver (chain), ratio = driverTeeth / ownTeeth
  (SIM.config.sprockets || []).forEach(s => {
    const mesh = SIM.meshMap[s.meshName];
    if (!mesh) return;
    // linkedTo can be a motor id or another sprocket id
    const srcMotor = SIM.config.motors?.find(m => m.id === s.linkedTo);
    let inputRPM = 0;
    if (srcMotor) {
      const cartRPM = parseInt(srcMotor.cartridge || dt.cartridge || '200') || 200;
      inputRPM = voltageOf(srcMotor.id) * cartRPM * (srcMotor.gearRatio || 1.0);
    }
    const outputRPM = inputRPM * ((s.driverTeeth || s.teeth || 18) / (s.teeth || 18));
    mesh.rotation[s.axis || 'x'] += outputRPM * (Math.PI / 30) * TICK_DT;
  });

  // Chains: advance dashOffset to animate chain movement
  SIM.chainLines.forEach(cl => {
    const srcMotor = SIM.config?.motors?.find(m => m.id === cl.linkedMotor);
    const v = srcMotor ? (SIM.motors[srcMotor.id]?.voltage || 0) / 100 : 0;
    cl.mat.dashOffset -= v * 0.004;
  });

  // Pistons: lerp position between retracted (0) and extended (stroke)
  (SIM.config.pistons || []).forEach(p => {
    const mesh = SIM.meshMap[p.meshName];
    if (!mesh) return;
    const extended = SIM.pistons[p.id]?.extended || false;
    const target   = extended ? (p.stroke || 2.5) : 0;
    const axis     = p.axis || 'z';
    mesh.position[axis] += (inToWorld(target) - mesh.position[axis]) * 0.12;
  });
}

// ─── LOAD OBJ CONFIG ──────────────────────────────────────────────────────────
async function simLoadConfig() {
  if (!window.electronAPI?.simLoadConfig) {
    simSetStatus('electronAPI not available');
    return;
  }
  const config = await window.electronAPI.simLoadConfig();
  if (!config) return;
  SIM.config = config;

  // Derive physics constants from drivetrain spec
  simApplyDrivetrainConfig(config.drivetrain);

  // Initialize subsystem runtime states
  (config.motors     || []).forEach(m => { SIM.motors[m.id]     = { voltage: 0 }; });
  (config.pistons    || []).forEach(p => { SIM.pistons[p.id]    = { extended: false }; });
  (config.mechanisms || []).forEach(m => { SIM.mechanisms[m.id] = { active: false }; });

  simSetStatus(`Config loaded: ${config.name || 'Robot'}`);
  if (typeof showToast === 'function') showToast(`Config loaded: ${config.name || 'Robot'}`, 'ok');
  simRenderConfigPanel();

  // Load the OBJ file if path is set
  if (config.objPath) await simLoadOBJ(config.objPath, config.mtlPath);
}

async function simLoadOBJ(objPath, mtlPath) {
  if (!window.electronAPI?.stlRead) return;
  simShowLoading('Loading robot model…');
  const resp = await window.electronAPI.stlRead(objPath);
  if (!resp) { simHideLoading(); return; }

  // Remove previous robot mesh children and reset scale
  while (SIM.group.children.length) SIM.group.remove(SIM.group.children[0]);
  SIM.group.scale.set(1, 1, 1);
  SIM.meshMap = {};

  // Inner group: holds CAD orientation (rotation + Y offset from the viewer).
  // The outer SIM.group handles field position and heading every tick — keeping
  // them separate means reorientation is never overwritten by the physics loop.
  // NOTE: orientGroup is kept parentless until after centering so that
  // THREE.Box3.setFromObject returns local-space coords, not world-space coords
  // (world coords would include SIM.group's field offset and corrupt the pivot).
  const orientGroup = new THREE.Group();

  if (resp.type === 'obj-geo') {
    resp.groups.forEach((g, i) => {
      if (!g.positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      if (g.normals) geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
      else geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(g.color[0], g.color[1], g.color[2]),
        metalness: 0.2, roughness: 0.6
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.name = g.name || `group_${i}`;
      orientGroup.add(mesh);
      SIM.meshMap[mesh.name] = mesh;
    });
  }

  // Step 1: apply saved CAD rotation first so that subsequent bbox measurements
  // are taken in the model's final orientation. Fusion 360 exports are often
  // Z-up, so the user would have saved a ±90° X rotation in the CAD viewer.
  // Measuring before that rotation would sample the wrong axes entirely.
  const modelName = objPath.split(/[\\/]/).pop();
  try {
    const raw = localStorage.getItem('stl_orient_' + modelName);
    if (raw) {
      const d = JSON.parse(raw);
      orientGroup.rotation.set(d.rx || 0, d.ry || 0, d.rz || 0);
    }
  } catch {}

  // Step 2: measure the horizontal footprint (X/Z) in the now-rotated pose,
  // then compute a uniform scale so the longest ground dimension hits the
  // target size. Uniform scale commutes with rotation, so measuring post-
  // rotation gives the right result regardless of export orientation.
  {
    const rb       = SIM.config?.drivetrain;
    const robotW   = rb?.robotWidth  || rb?.trackWidth  || 15;
    const robotL   = rb?.robotLength || robotW;
    const targetIn = Math.max(robotW, robotL);
    const box      = new THREE.Box3().setFromObject(orientGroup);
    const size     = new THREE.Vector3(); box.getSize(size);
    const maxDim   = Math.max(size.x, size.z) || 1;
    const s        = inToWorld(targetIn) / maxDim;
    orientGroup.scale.set(s, s, s);
  }

  // Step 3: center with both rotation and scale applied — XZ geometric center
  // goes to the group origin (physics pivot), bottom sits at Y=0.
  {
    const box    = new THREE.Box3().setFromObject(orientGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    orientGroup.position.set(-center.x, -box.min.y, -center.z);
  }

  // Step 4: sync physics hitbox to the actual rendered footprint.
  {
    const box  = new THREE.Box3().setFromObject(orientGroup);
    const size = new THREE.Vector3(); box.getSize(size);
    SIM.robot.width  = worldToIn(size.x);
    SIM.robot.height = worldToIn(size.z);
  }

  // Only now attach to SIM.group — position/rotation are correct in local space
  SIM.group.add(orientGroup);

  simPositionRobotMesh();
  buildMechanicsVisuals();
  simHideLoading();
  simSetStatus('Robot model loaded');
}

// ─── LOADING OVERLAY ──────────────────────────────────────────────────────────
function simShowLoading(msg) {
  const el = document.getElementById('simLoading');
  const msgEl = document.getElementById('simLoadingMsg');
  if (el) el.style.display = 'flex';
  if (msgEl) msgEl.textContent = msg || 'Loading…';
  if (typeof showToast === 'function') showToast(msg || 'Loading…');
}
function simHideLoading() {
  const el = document.getElementById('simLoading');
  if (el) el.style.display = 'none';
}

// ─── FIELD OBJ LOADER ─────────────────────────────────────────────────────────
// Replaces the procedural field with geometry from an OBJ file.
// The OBJ is auto-scaled so its horizontal footprint matches the 144"×144" field
// and centered at (FW/2, 0, FW/2) in Three.js world space.

// Automatically loads the bundled Field - Empty.obj on first open
async function simAutoLoadField() {
  if (!window.electronAPI?.simGetFieldPath) return;
  const p = await window.electronAPI.simGetFieldPath();
  if (p) await simLoadFieldOBJ(p);
}

async function simPickFieldOBJ() {
  if (!window.electronAPI?.simPickFieldObj) { simSetStatus('electronAPI not available'); return; }
  const p = await window.electronAPI.simPickFieldObj();
  if (p) await simLoadFieldOBJ(p);
}

async function simLoadFieldOBJ(objPath) {
  if (!window.electronAPI?.stlRead) return;
  simShowLoading('Loading field…');
  simSetStatus('Loading field OBJ…');
  const resp = await window.electronAPI.stlRead(objPath);
  if (!resp || resp.type !== 'obj-geo') { simHideLoading(); simSetStatus('Failed to load field OBJ'); return; }

  // Clear current field (procedural or previously loaded OBJ)
  while (SIM.fieldGroup.children.length) SIM.fieldGroup.remove(SIM.fieldGroup.children[0]);

  const FW = inToWorld(FIELD_IN);
  const meshGroup = new THREE.Group();

  resp.groups.forEach((g, i) => {
    if (!g.positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    if (g.normals) geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    else geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(g.color[0], g.color[1], g.color[2]),
      metalness: 0.1, roughness: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    meshGroup.add(mesh);
  });

  // Rotate flat: OBJ files from most CAD tools use Z-up, Three.js uses Y-up
  meshGroup.rotation.x = -Math.PI / 2;

  // Scale so the larger horizontal dimension spans the full field width
  const box1 = new THREE.Box3().setFromObject(meshGroup);
  const size = new THREE.Vector3(); box1.getSize(size);
  const maxH = Math.max(size.x, size.z) || 1;
  const s = FW / maxH;
  meshGroup.scale.set(s, s, s);

  // Center at field origin and sit on y=0
  const box2 = new THREE.Box3().setFromObject(meshGroup);
  const center = new THREE.Vector3(); box2.getCenter(center);
  meshGroup.position.set(FW / 2 - center.x, -box2.min.y, FW / 2 - center.z);

  SIM.fieldGroup.add(meshGroup);
  simHideLoading();
  simSetStatus('Field loaded');
}

// ─── MATCH TIMER ──────────────────────────────────────────────────────────────
function simToggleMatch() {
  if (SIM.match.running) simStopMatch(); else simStartMatch();
}
function simStartMatch() {
  simStartTelemetry();
  simLoadAdaptiveData(); // async — loads weakness profile in background from past sessions
  SIM.match.running = true;
  const btn = document.getElementById('simStartBtn');
  if (btn) { btn.textContent = '⏸ Pause'; btn.style.background = 'var(--gold)'; btn.style.color = '#fff'; }
  if (SIM.match.mode === 'auton') simRunAuton();
}
function simStopMatch() {
  simFlushTelemetry();
  SIM.match.running = false;
  SIM.autonRunning = false;
  const btn = document.getElementById('simStartBtn');
  if (btn) { btn.textContent = '▶ Start'; btn.style.background = ''; btn.style.color = ''; }
}
function simResetMatch() {
  simStopMatch();
  SIM.match.elapsed = 0;
  loadDefaultGameObjects();
  simResetRobot(); // also resets cargo, climb, and AI robots
  SIM.pid.history = []; SIM.pid.current = 0; SIM.pid.integral = 0; SIM.pid.prevError = 0;
}

// ─── ROBOT RESET ──────────────────────────────────────────────────────────────
function simResetRobot() {
  // Player starts at the middle of the left wall, facing inward (+X direction).
  const half = (SIM.config?.drivetrain?.robotWidth || SIM.robot.width) / 2 + 1;
  SIM.robot.x = half + 2;
  SIM.robot.y = FIELD_IN / 2;
  SIM.robot.angle = 90;
  SIM.robot.vx = 0; SIM.robot.vy = 0; SIM.robot.omega = 0; SIM.robot.snapTarget = null;
  SIM.override.heldPieces = [];
  SIM.toggleOwner = { left: null, right: null, top: null, bottom: null };
  SIM.sensors.encFwd = 0; SIM.sensors.imuDrift = 0;
  _targetVx = 0; _targetVy = 0; _targetOmega = 0;
  simPositionRobotMesh();
  resetAIRobots();
}

// ─── MODE SWITCH ──────────────────────────────────────────────────────────────
function simSetMode(mode) {
  SIM.match.mode = mode;
  simStopMatch();
  SIM.match.elapsed = 0;
  SIM.match.duration = mode === 'auton' ? 15 : 105;
  SIM.pid.history = []; SIM.pid.current = 0; SIM.pid.integral = 0; SIM.pid.prevError = 0;

  document.querySelectorAll('.sim-mode-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`simMode_${mode}`);
  if (btn) btn.classList.add('active');

  const pidPanel = document.getElementById('simPidPanel');
  if (pidPanel) pidPanel.style.display = mode === 'pid' ? 'block' : 'none';

  const autonPanel = document.getElementById('simAutonPanel');
  if (autonPanel) autonPanel.style.display = mode === 'auton' ? 'block' : 'none';

  // Hide AI robots in free roam; show them in competition modes
  SIM.aiRobots.forEach(ai => { if (ai.group) ai.group.visible = mode !== 'freeRoam'; });

  if (mode === 'pid') {
    SIM.pid.target = 90; SIM.pid.current = 0;
    simStartMatch();
  } else if (mode === 'freeRoam') {
    simResetMatch();
    simStartMatch();
  }
}

// ─── AUTONOMOUS RUNNER ────────────────────────────────────────────────────────
async function simRunAuton() {
  if (SIM.autonRunning) return;
  SIM.autonRunning = true;
  simResetRobot();

  // Default demo routine — user will replace with their own steps
  const steps = [
    { type: 'move', inches: 24, speed: 80 },
    { type: 'turn', degrees: 90 },
    { type: 'move', inches: 18, speed: 60 },
    { type: 'turn', degrees: -45 },
    { type: 'move', inches: 12, speed: 80 },
    { type: 'turn', degrees: 180 },
    { type: 'move', inches: 24, speed: 100 },
  ];

  for (const step of steps) {
    if (!SIM.autonRunning) break;
    if (step.type === 'move')  await simAutonMove(step.inches, step.speed || 100);
    if (step.type === 'turn')  await simAutonTurn(step.degrees);
    if (step.type === 'wait')  await simSleep(step.ms || 500);
  }
  SIM.autonRunning = false;
  simSetStatus('Autonomous complete');
}

function simAutonMove(inches, speedPct = 100) {
  return new Promise(resolve => {
    const speed = (speedPct / 100) * DRIVE_SPEED;
    const rad = SIM.robot.angle * Math.PI / 180;
    const targetX = SIM.robot.x + Math.sin(rad) * inches;
    const targetY = SIM.robot.y - Math.cos(rad) * inches;
    const startX = SIM.robot.x, startY = SIM.robot.y;
    const dist = inches;
    let travelled = 0;
    const iv = setInterval(() => {
      if (!SIM.autonRunning) { clearInterval(iv); resolve(); return; }
      const moved = speed * TICK_DT;
      travelled += moved;
      const t = Math.min(1, travelled / Math.abs(dist));
      SIM.robot.x = startX + (targetX - startX) * t;
      SIM.robot.y = startY + (targetY - startY) * t;
      SIM.robot.vx = Math.sin(rad) * speed;
      SIM.robot.vy = -Math.cos(rad) * speed;
      if (t >= 1) { clearInterval(iv); SIM.robot.vx = 0; SIM.robot.vy = 0; resolve(); }
    }, 16);
  });
}

function simAutonTurn(degrees) {
  return new Promise(resolve => {
    const rate = TURN_RATE * 0.8;
    const startAngle = SIM.robot.angle;
    const targetAngle = startAngle + degrees;
    const dir = Math.sign(degrees);
    const iv = setInterval(() => {
      if (!SIM.autonRunning) { clearInterval(iv); resolve(); return; }
      SIM.robot.angle += dir * rate * TICK_DT;
      SIM.robot.omega = dir * rate;
      const done = dir > 0 ? SIM.robot.angle >= targetAngle : SIM.robot.angle <= targetAngle;
      if (done) { SIM.robot.angle = targetAngle; SIM.robot.omega = 0; clearInterval(iv); resolve(); }
    }, 16);
  });
}

function simSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── PID GRAPH ────────────────────────────────────────────────────────────────
function simDrawPIDGraph() {
  const canvas = document.getElementById('simPidCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth * 2;
  canvas.height = 120;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const h = canvas.history || SIM.pid.history;
  if (h.length < 2) return;

  const w = canvas.width, ht = canvas.height;
  const max = Math.max(20, ...h.map(Math.abs));

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, ht/2); ctx.lineTo(w, ht/2); ctx.stroke();

  // Error line
  ctx.strokeStyle = '#1a7ddf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  h.forEach((v, i) => {
    const px = (i / (h.length - 1)) * w;
    const py = ht/2 - (v / max) * (ht/2 - 6);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();
}

// ─── SIDEBAR UPDATE ───────────────────────────────────────────────────────────
let _sidebarThrottle = 0;
function simUpdateSidebar() {
  const now = Date.now();
  if (now - _sidebarThrottle < 100) return;
  _sidebarThrottle = now;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const r = SIM.robot, s = SIM.sensors;

  set('simStatX',     r.x.toFixed(1) + '"');
  set('simStatY',     r.y.toFixed(1) + '"');
  set('simStatH',     ((r.angle % 360 + 360) % 360).toFixed(1) + '°');
  set('simStatSpd',   (Math.sqrt(r.vx**2 + r.vy**2)).toFixed(1) + ' in/s');
  set('simStatCargo', `${SIM.override.heldPieces.length}/3`);
  set('simStatPScore', String(SIM.score.player));
  set('simStatOScore', String(SIM.score.opponent));
  const tOwners = ['L','R','T','B'].map((lbl, i) => {
    const key = ['left','right','top','bottom'][i];
    const o = SIM.toggleOwner[key];
    return lbl + ':' + (o === 'blue' ? 'B' : o === 'red' ? 'R' : '-');
  }).join(' ');
  set('simStatClimb', tOwners);
  set('simSensorImu', s.imu.toFixed(1) + '°');
  set('simSensorOdomX', s.odomX.toFixed(1) + '"');
  set('simSensorOdomY', s.odomY.toFixed(1) + '"');
  set('simSensorEnc',   Math.round(s.encFwd) + ' ticks');

  // Match timer
  const isFreeRoam = SIM.match.mode === 'freeRoam';
  const rem = Math.max(0, SIM.match.duration - SIM.match.elapsed);
  const m = Math.floor(rem / 60), sec = Math.floor(rem % 60);
  const timerStr = isFreeRoam ? '∞' : `${m}:${String(sec).padStart(2,'0')}`;
  set('simTimer', timerStr);

  // Period badge
  const isAuton  = SIM.match.mode === 'auton';
  const isPID    = SIM.match.mode === 'pid';
  const endgame  = !isFreeRoam && rem <= 20 && SIM.match.running;
  const badge = document.getElementById('simPeriodBadge');
  if (badge) {
    badge.textContent = isFreeRoam ? 'FREE ROAM' : isAuton ? 'AUTON' : isPID ? 'PID' : endgame ? 'ENDGAME' : 'DRIVER';
    badge.style.background = isFreeRoam ? 'rgba(34,197,94,0.15)' : isAuton ? 'rgba(34,197,94,0.25)' : isPID ? 'rgba(99,102,241,0.2)' : endgame ? 'rgba(245,158,11,0.25)' : 'rgba(168,85,247,0.2)';
    badge.style.color = isFreeRoam ? '#4ade80' : isAuton ? '#22c55e' : isPID ? '#818cf8' : endgame ? '#f59e0b' : 'var(--gold)';
  }

  // Score HUD overlay
  set('simHudPlayer', String(SIM.score.player));
  set('simHudOpp',    String(SIM.score.opponent));
  set('simHudTimer',  timerStr);
  const hudPeriod = document.getElementById('simHudPeriod');
  if (hudPeriod) {
    hudPeriod.textContent = isFreeRoam ? 'FREE ROAM' : endgame ? 'ENDGAME' : isAuton ? 'AUTON' : 'DRIVER';
    hudPeriod.style.color = isFreeRoam ? '#4ade80' : endgame ? '#f59e0b' : 'var(--t3)';
  }
  const hudTimer = document.getElementById('simHudTimer');
  if (hudTimer) hudTimer.style.color = isFreeRoam ? '#4ade80' : endgame ? '#ef4444' : 'var(--gold)';
  const hudWave = document.getElementById('simHudWave');
  if (hudWave) hudWave.style.display = 'none';
}

// ─── CONFIG PANEL ─────────────────────────────────────────────────────────────
function simRenderConfigPanel() {
  const el = document.getElementById('simConfigContent');
  if (!el || !SIM.config) return;

  const c = SIM.config;
  const dt = c.drivetrain || {};

  const derivedSpeed = DRIVE_SPEED.toFixed(1);
  el.innerHTML = `
    <div class="sim-config-section">
      <div class="sim-config-label">Drivetrain</div>
      <div class="sim-config-row"><span>Type</span><span>${dt.type || 'tank'}</span></div>
      <div class="sim-config-row"><span>Wheel Ø</span><span>${dt.wheelDiameter || 3.25}"</span></div>
      <div class="sim-config-row"><span>Cartridge</span><span>${dt.cartridge || dt.maxRPM || 200} rpm</span></div>
      <div class="sim-config-row"><span>Ext. Ratio</span><span>${dt.externalGearRatio || 1.0}×</span></div>
      <div class="sim-config-row"><span>Track Width</span><span>${dt.trackWidth || 12}"</span></div>
      <div class="sim-config-row"><span>Free Speed</span><span style="color:var(--green);">${derivedSpeed} in/s</span></div>
    </div>
    ${(c.motors||[]).length ? `
    <div class="sim-config-section">
      <div class="sim-config-label">Motors (${c.motors.length})</div>
      ${c.motors.map(m => `
        <div class="sim-config-row">
          <span style="flex:1;">${m.id}${m.role && m.role!=='drive' ? ` <span style="font-size:9px;color:var(--t3);">[${m.role}]</span>` : ''}</span>
          <input id="mv_slider_${m.id}" type="range" min="-100" max="100" value="0" step="1"
            style="width:60px;"
            oninput="SIM.motors['${m.id}'].voltage=+this.value;document.getElementById('mv_${m.id}').textContent=this.value+'%'"/>
          <span id="mv_${m.id}" style="font-size:10px;min-width:32px;text-align:right;font-family:var(--fm);">0%</span>
        </div>`).join('')}
    </div>` : ''}
    ${(c.pistons||[]).length ? `
    <div class="sim-config-section">
      <div class="sim-config-label">Pistons (${c.pistons.length})</div>
      ${c.pistons.map(p => `
        <div class="sim-config-row">
          <span style="flex:1;">${p.id}</span>
          <button id="piston_btn_${p.id}" class="sim-piston-btn" onclick="simTogglePiston('${p.id}',this)">Extend</button>
        </div>`).join('')}
    </div>` : ''}
    ${(c.mechanisms||[]).length ? `
    <div class="sim-config-section">
      <div class="sim-config-label">Mechanisms (${c.mechanisms.length})</div>
      ${c.mechanisms.map(m => `
        <div class="sim-config-row">
          <span style="flex:1;">${m.id} <span style="font-size:9px;color:var(--t3);">[${m.type||'—'}]</span></span>
          <span style="font-size:10px;color:var(--t3);font-family:var(--fm);">${m.keyBind ? m.keyBind.toUpperCase() : '—'}</span>
        </div>`).join('')}
    </div>` : ''}
    ${(c.gears||[]).length || (c.sprockets||[]).length ? `
    <div class="sim-config-section">
      <div class="sim-config-label">Gear Train</div>
      ${(c.gears||[]).map(g => `<div class="sim-config-row"><span>${g.id}</span><span style="font-size:10px;color:var(--t3);">${g.teeth}T gear</span></div>`).join('')}
      ${(c.sprockets||[]).map(s => `<div class="sim-config-row"><span>${s.id}</span><span style="font-size:10px;color:var(--t3);">${s.teeth}T sprocket</span></div>`).join('')}
    </div>` : ''}
    ${(c.sensors||[]).length ? `
    <div class="sim-config-section">
      <div class="sim-config-label">Sensors (${c.sensors.length})</div>
      ${c.sensors.map(s => `<div class="sim-config-row"><span>${s.id}</span><span style="color:var(--gold);font-size:10px;">${s.type}</span></div>`).join('')}
    </div>` : ''}
  `;
}

function simTogglePiston(id, btn) {
  if (!SIM.pistons[id]) SIM.pistons[id] = { extended: false };
  SIM.pistons[id].extended = !SIM.pistons[id].extended;
  const extended = SIM.pistons[id].extended;
  // Update the button that was clicked (if any)
  if (btn) {
    btn.textContent = extended ? 'Retract' : 'Extend';
    btn.style.background = extended ? 'rgba(26,125,223,0.3)' : '';
  }
  // Also update any other rendered button for this piston
  const b2 = document.getElementById('piston_btn_' + id);
  if (b2 && b2 !== btn) {
    b2.textContent = extended ? 'Retract' : 'Extend';
    b2.style.background = extended ? 'rgba(26,125,223,0.3)' : '';
  }
}

function simKeyTogglePistons() {
  if (!SIM.config?.pistons?.length) return;
  SIM.config.pistons.forEach(p => simTogglePiston(p.id, null));
}

// ─── PID CONTROLS ─────────────────────────────────────────────────────────────
function simUpdatePID() {
  SIM.pid.kP = parseFloat(document.getElementById('simKp')?.value || 1.5);
  SIM.pid.kI = parseFloat(document.getElementById('simKi')?.value || 0.01);
  SIM.pid.kD = parseFloat(document.getElementById('simKd')?.value || 0.8);

  const fmtVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = parseFloat(val).toFixed(2); };
  fmtVal('simKpVal', SIM.pid.kP);
  fmtVal('simKiVal', SIM.pid.kI);
  fmtVal('simKdVal', SIM.pid.kD);

  // Reset PID state on change so graph resets
  SIM.pid.history = []; SIM.pid.current = 0; SIM.pid.integral = 0; SIM.pid.prevError = 0;
}

function simSetPIDTarget() {
  const el = document.getElementById('simPidTarget');
  if (el) SIM.pid.target = parseFloat(el.value) || 90;
  SIM.pid.history = []; SIM.pid.current = 0; SIM.pid.integral = 0; SIM.pid.prevError = 0;
}

// ─── ODOMETRY CONFIG ──────────────────────────────────────────────────────────
function simRenderOdomConfig() {
  const el = document.getElementById('simOdomConfig');
  if (!el) return;
  el.innerHTML = `
    <div class="sim-config-section">
      <div class="sim-config-label">Tracking Wheels</div>
      <div class="sim-config-row"><span>Wheel Ø (in)</span><input type="number" value="2.75" step="0.25" min="1" max="4" style="width:55px;background:var(--s3);border:1px solid var(--b2);color:var(--t1);font-size:12px;padding:2px 5px;border-radius:4px;" id="odomWheelDia"/></div>
      <div class="sim-config-row"><span>Fwd offset (in)</span><input type="number" value="0" step="0.5" style="width:55px;background:var(--s3);border:1px solid var(--b2);color:var(--t1);font-size:12px;padding:2px 5px;border-radius:4px;" id="odomFwdOff"/></div>
      <div class="sim-config-row"><span>Side offset (in)</span><input type="number" value="4" step="0.5" style="width:55px;background:var(--s3);border:1px solid var(--b2);color:var(--t1);font-size:12px;padding:2px 5px;border-radius:4px;" id="odomSideOff"/></div>
    </div>
    <div class="sim-config-section">
      <div class="sim-config-label">IMU</div>
      <div class="sim-config-row"><span>Drift/sec (°)</span><input type="number" value="0.1" step="0.05" min="0" max="2" style="width:55px;background:var(--s3);border:1px solid var(--b2);color:var(--t1);font-size:12px;padding:2px 5px;border-radius:4px;" id="odomImuDrift"/></div>
      <div class="sim-config-row"><span>Noise slider</span><input type="range" min="0" max="5" value="1" step="0.5" style="width:80px;" oninput="simSetNoiseLevel(+this.value)"/></div>
    </div>
    <div class="sim-config-section">
      <div class="sim-config-label">Ground Truth vs Odom</div>
      <div class="sim-config-row"><span>GT X</span><span id="odomGtX" style="font-family:var(--fm);color:var(--green);">—</span></div>
      <div class="sim-config-row"><span>GT Y</span><span id="odomGtY" style="font-family:var(--fm);color:var(--green);">—</span></div>
      <div class="sim-config-row"><span>Odom X</span><span id="odomEstX" style="font-family:var(--fm);color:var(--gold);">—</span></div>
      <div class="sim-config-row"><span>Odom Y</span><span id="odomEstY" style="font-family:var(--fm);color:var(--gold);">—</span></div>
      <div class="sim-config-row"><span>Error</span><span id="odomError" style="font-family:var(--fm);color:var(--red);">—</span></div>
    </div>`;

  setInterval(() => {
    const set2 = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set2('odomGtX', SIM.robot.x.toFixed(2) + '"');
    set2('odomGtY', SIM.robot.y.toFixed(2) + '"');
    set2('odomEstX', SIM.sensors.odomX.toFixed(2) + '"');
    set2('odomEstY', SIM.sensors.odomY.toFixed(2) + '"');
    const err = Math.sqrt((SIM.robot.x - SIM.sensors.odomX)**2 + (SIM.robot.y - SIM.sensors.odomY)**2);
    set2('odomError', err.toFixed(3) + '"');
  }, 200);
}

let _noiseLevel = 1;
function simSetNoiseLevel(v) {
  _noiseLevel = v;
  // Scales the random noise applied to sensor readings
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
function simSetStatus(msg) {
  const el = document.getElementById('simStatus');
  if (el) el.textContent = msg;
}

// ─── ANNOTATION UI ────────────────────────────────────────────────────────────
function simOpenAnnotation() {
  const modal = document.getElementById('simAnnotationModal');
  if (!modal) return;

  // Pre-populate form from current SIM.config if available
  const c = SIM.config;
  if (c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const dt = c.drivetrain || {};
    set('annDriveType',  dt.type            || 'tank');
    set('annWheelDia',   dt.wheelDiameter   ?? 3.25);
    set('annCartridge',  dt.cartridge       || dt.maxRPM || '200');
    set('annExtRatio',   dt.externalGearRatio ?? 1.0);
    set('annTrackWidth', dt.trackWidth      ?? 12);
    set('annRobotWidth', dt.robotWidth      ?? 15);
    set('annRobotLength',dt.robotLength     ?? 15);

    _annMotors     = (c.motors      || []).map(m => ({ ...m }));
    _annPistons    = (c.pistons     || []).map(p => ({ ...p }));
    _annMechanisms = (c.mechanisms  || []).map(m => ({ ...m }));
    _annGears      = (c.gears       || []).map(g => ({ ...g }));
    _annSprockets  = (c.sprockets   || []).map(s => ({ ...s }));

    annRenderMotors();
    annRenderPistons();
    annRenderMechanisms();
    annRenderGears();
    annRenderSprockets();
  }

  modal.style.display = 'flex';
}
function simCloseAnnotation() {
  const modal = document.getElementById('simAnnotationModal');
  if (modal) modal.style.display = 'none';
}

// Save annotation config (sim.json) via electron
async function simSaveConfig() {
  if (!window.electronAPI?.simSaveConfig || !SIM.config) return;
  await window.electronAPI.simSaveConfig(SIM.config);
  simSetStatus('Config saved');
}

// ─── INIT HOOK ────────────────────────────────────────────────────────────────
// Called after DOM is ready (from index.html)
function initSimulatorPage() {
  simRenderOdomConfig();
}

// ─── ANNOTATION MODAL LOGIC ───────────────────────────────────────────────────
// Appended to simulator.js

let _annMotors     = [];
let _annPistons    = [];
let _annMechanisms = [];
let _annGears      = [];
let _annSprockets  = [];

function annAddMotor() {
  const id = `motor_${_annMotors.length + 1}`;
  _annMotors.push({ id, meshName: '', role: 'intake', cartridge: '200', gearRatio: 1.0, reversed: false, axis: 'x' });
  annRenderMotors();
}

function annAddPiston() {
  const id = `piston_${_annPistons.length + 1}`;
  _annPistons.push({ id, meshName: '', axis: 'z', stroke: 2.5 });
  annRenderPistons();
}

function annAddMechanism() {
  const id = `mech_${_annMechanisms.length + 1}`;
  _annMechanisms.push({ id, type: 'intake', motors: [], keyBind: '', reverseKeyBind: '', direction: 1 });
  annRenderMechanisms();
}

function annAddGear() {
  const id = `gear_${_annGears.length + 1}`;
  _annGears.push({ id, meshName: '', teeth: 36, linkedMotor: '', inputTeeth: 36, axis: 'y' });
  annRenderGears();
}

function annAddSprocket() {
  const id = `sp_${_annSprockets.length + 1}`;
  _annSprockets.push({ id, meshName: '', teeth: 18, driverTeeth: 18, linkedTo: '', chainPartner: '', axis: 'x' });
  annRenderSprockets();
}

function annRenderMotors() {
  const el = document.getElementById('annMotorList');
  if (!el) return;
  el.innerHTML = _annMotors.map((m, i) => `
    <div class="ann-motor-card">
      <div class="ann-motor-row1">
        <input class="ann-input" placeholder="id" value="${m.id}" oninput="_annMotors[${i}].id=this.value"/>
        <input class="ann-input" placeholder="mesh name (OBJ group)" value="${m.meshName}" oninput="_annMotors[${i}].meshName=this.value" style="flex:2;"/>
        <button class="ann-del" onclick="_annMotors.splice(${i},1);annRenderMotors()">✕</button>
      </div>
      <div class="ann-motor-row2">
        <select class="ann-input" oninput="_annMotors[${i}].role=this.value">
          <option value="intake"   ${m.role==='intake'  ?'selected':''}>Intake</option>
          <option value="conveyor" ${m.role==='conveyor'?'selected':''}>Conveyor</option>
          <option value="flywheel" ${m.role==='flywheel'?'selected':''}>Flywheel</option>
          <option value="arm"      ${m.role==='arm'     ?'selected':''}>Arm</option>
          <option value="drive"    ${m.role==='drive'   ?'selected':''}>Drive</option>
          <option value="other"    ${m.role==='other'   ?'selected':''}>Other</option>
        </select>
        <select class="ann-input" oninput="_annMotors[${i}].cartridge=this.value">
          <option value="100" ${m.cartridge==='100'?'selected':''}>100 rpm</option>
          <option value="200" ${m.cartridge==='200'||!m.cartridge?'selected':''}>200 rpm</option>
          <option value="600" ${m.cartridge==='600'?'selected':''}>600 rpm</option>
        </select>
        <input class="ann-input" type="number" step="0.1" placeholder="ratio" value="${m.gearRatio||1}" style="width:54px;"
          oninput="_annMotors[${i}].gearRatio=+this.value" title="External gear ratio"/>
        <select class="ann-input" style="width:50px;" oninput="_annMotors[${i}].axis=this.value">
          <option value="x" ${m.axis==='x'?'selected':''}>X</option>
          <option value="y" ${m.axis==='y'?'selected':''}>Y</option>
          <option value="z" ${m.axis==='z'?'selected':''}>Z</option>
        </select>
        <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--t3);white-space:nowrap;">
          <input type="checkbox" ${m.reversed?'checked':''} onchange="_annMotors[${i}].reversed=this.checked"/> Rev
        </label>
      </div>
    </div>`).join('');
}

function annRenderMechanisms() {
  const el = document.getElementById('annMechList');
  if (!el) return;
  el.innerHTML = _annMechanisms.map((m, i) => `
    <div class="ann-motor-card">
      <div class="ann-motor-row1">
        <input class="ann-input" placeholder="id" value="${m.id}" oninput="_annMechanisms[${i}].id=this.value"/>
        <select class="ann-input" oninput="_annMechanisms[${i}].type=this.value">
          <option value="intake"   ${m.type==='intake'  ?'selected':''}>Intake</option>
          <option value="conveyor" ${m.type==='conveyor'?'selected':''}>Conveyor</option>
          <option value="hopper"   ${m.type==='hopper'  ?'selected':''}>Hopper</option>
          <option value="flywheel" ${m.type==='flywheel'?'selected':''}>Flywheel</option>
          <option value="arm"      ${m.type==='arm'     ?'selected':''}>Arm</option>
          <option value="climb"    ${m.type==='climb'   ?'selected':''}>Climb</option>
          <option value="outtake"  ${m.type==='outtake' ?'selected':''}>Outtake</option>
        </select>
        <button class="ann-del" onclick="_annMechanisms.splice(${i},1);annRenderMechanisms()">✕</button>
      </div>
      <div class="ann-motor-row2">
        <input class="ann-input" placeholder="motor ids (comma sep)" value="${(m.motors||[]).join(',')}"
          oninput="_annMechanisms[${i}].motors=this.value.split(',').map(s=>s.trim()).filter(Boolean)" style="flex:2;"/>
        <input class="ann-input" placeholder="key" value="${m.keyBind||''}" style="width:34px;" title="Key to activate"
          oninput="_annMechanisms[${i}].keyBind=this.value"/>
        <input class="ann-input" placeholder="rev" value="${m.reverseKeyBind||''}" style="width:34px;" title="Key to reverse"
          oninput="_annMechanisms[${i}].reverseKeyBind=this.value"/>
        <select class="ann-input" style="width:50px;" oninput="_annMechanisms[${i}].direction=+this.value">
          <option value="1"  ${m.direction!==-1?'selected':''}>Fwd</option>
          <option value="-1" ${m.direction===-1?'selected':''}>Rev</option>
        </select>
      </div>
    </div>`).join('');
}

function annRenderGears() {
  const el = document.getElementById('annGearList');
  if (!el) return;
  el.innerHTML = _annGears.map((g, i) => `
    <div class="ann-motor-card">
      <div class="ann-motor-row1">
        <input class="ann-input" placeholder="id" value="${g.id}" oninput="_annGears[${i}].id=this.value"/>
        <input class="ann-input" placeholder="mesh name" value="${g.meshName}" oninput="_annGears[${i}].meshName=this.value" style="flex:2;"/>
        <button class="ann-del" onclick="_annGears.splice(${i},1);annRenderGears()">✕</button>
      </div>
      <div class="ann-motor-row2">
        <input class="ann-input" type="number" placeholder="teeth" value="${g.teeth||36}" style="width:54px;"
          oninput="_annGears[${i}].teeth=+this.value" title="Tooth count of this gear"/>
        <input class="ann-input" type="number" placeholder="input T" value="${g.inputTeeth||36}" style="width:54px;"
          oninput="_annGears[${i}].inputTeeth=+this.value" title="Tooth count of driving gear"/>
        <input class="ann-input" placeholder="linked motor id" value="${g.linkedMotor||''}" style="flex:1;"
          oninput="_annGears[${i}].linkedMotor=this.value"/>
        <select class="ann-input" style="width:50px;" oninput="_annGears[${i}].axis=this.value">
          <option value="x" ${g.axis==='x'?'selected':''}>X</option>
          <option value="y" ${g.axis==='y'?'selected':''}>Y</option>
          <option value="z" ${g.axis==='z'?'selected':''}>Z</option>
        </select>
      </div>
    </div>`).join('');
}

function annRenderSprockets() {
  const el = document.getElementById('annSprocketList');
  if (!el) return;
  el.innerHTML = _annSprockets.map((s, i) => `
    <div class="ann-motor-card">
      <div class="ann-motor-row1">
        <input class="ann-input" placeholder="id" value="${s.id}" oninput="_annSprockets[${i}].id=this.value"/>
        <input class="ann-input" placeholder="mesh name" value="${s.meshName}" oninput="_annSprockets[${i}].meshName=this.value" style="flex:2;"/>
        <button class="ann-del" onclick="_annSprockets.splice(${i},1);annRenderSprockets()">✕</button>
      </div>
      <div class="ann-motor-row2">
        <input class="ann-input" type="number" placeholder="teeth" value="${s.teeth||18}" style="width:54px;"
          oninput="_annSprockets[${i}].teeth=+this.value" title="Tooth count of this sprocket"/>
        <input class="ann-input" type="number" placeholder="driver T" value="${s.driverTeeth||18}" style="width:54px;"
          oninput="_annSprockets[${i}].driverTeeth=+this.value" title="Tooth count of driving sprocket"/>
        <input class="ann-input" placeholder="linked to (motor/sprocket id)" value="${s.linkedTo||''}" style="flex:1;"
          oninput="_annSprockets[${i}].linkedTo=this.value" title="Motor or sprocket id that drives this one"/>
        <input class="ann-input" placeholder="chain partner mesh" value="${s.chainPartner||''}" style="flex:1;"
          oninput="_annSprockets[${i}].chainPartner=this.value" title="Mesh name of the other sprocket this one is chained to — draws animated chain"/>
        <select class="ann-input" style="width:50px;" oninput="_annSprockets[${i}].axis=this.value">
          <option value="x" ${s.axis==='x'?'selected':''}>X</option>
          <option value="y" ${s.axis==='y'?'selected':''}>Y</option>
          <option value="z" ${s.axis==='z'?'selected':''}>Z</option>
        </select>
      </div>
    </div>`).join('');
}

function annRenderPistons() {
  const el = document.getElementById('annPistonList');
  if (!el) return;
  el.innerHTML = _annPistons.map((p, i) => `
    <div class="ann-piston-row">
      <input class="ann-input" placeholder="id" value="${p.id}"
        oninput="_annPistons[${i}].id=this.value"/>
      <input class="ann-input" placeholder="mesh name" value="${p.meshName}"
        oninput="_annPistons[${i}].meshName=this.value"/>
      <select class="ann-input" oninput="_annPistons[${i}].axis=this.value">
        <option value="x" ${p.axis==='x'?'selected':''}>X axis</option>
        <option value="y" ${p.axis==='y'?'selected':''}>Y axis</option>
        <option value="z" ${p.axis==='z'?'selected':''}>Z axis</option>
      </select>
      <button class="ann-del" onclick="_annPistons.splice(${i},1);annRenderPistons()">✕</button>
    </div>`).join('');
}

function annSave() {
  const config = {
    name: 'Robot',
    drivetrain: {
      type:              document.getElementById('annDriveType')?.value             || 'tank',
      wheelDiameter:     parseFloat(document.getElementById('annWheelDia')?.value   || 3.25),
      cartridge:         document.getElementById('annCartridge')?.value             || '200',
      externalGearRatio: parseFloat(document.getElementById('annExtRatio')?.value   || 1.0),
      trackWidth:        parseFloat(document.getElementById('annTrackWidth')?.value  || 12),
      robotWidth:        parseFloat(document.getElementById('annRobotWidth')?.value  || 15),
      robotLength:       parseFloat(document.getElementById('annRobotLength')?.value || 15),
    },
    motors:     _annMotors.filter(m => m.id && m.meshName),
    pistons:    _annPistons.filter(p => p.id && p.meshName),
    mechanisms: _annMechanisms.filter(m => m.id),
    gears:      _annGears.filter(g => g.id && g.meshName),
    sprockets:  _annSprockets.filter(s => s.id && s.meshName).map(s => ({ ...s })),
    sensors:    [],
  };

  SIM.config = config;
  (config.motors  || []).forEach(m => { SIM.motors[m.id]  = { voltage: 0 }; });
  (config.pistons || []).forEach(p => { SIM.pistons[p.id] = { extended: false }; });

  simRenderConfigPanel();
  simCloseAnnotation();
  buildMechanicsVisuals();
  simSetStatus('Config built — save it with 📂 or load an OBJ');

  // Persist via electronAPI if available
  if (window.electronAPI?.simSaveConfig) {
    window.electronAPI.simSaveConfig(config);
  }
}

// ─── MECHANICS VISUALS (chains, gear rings, spec annotations) ─────────────────

function buildMechanicsVisuals() {
  if (!SIM.group || typeof THREE === 'undefined') return;

  // Remove old chain lines and gear rings from SIM.group
  [...SIM.chainLines.map(c => c.line), ...SIM.gearRings].forEach(obj => {
    if (obj.parent) obj.parent.remove(obj);
  });
  SIM.chainLines = [];
  SIM.gearRings  = [];

  // Remove old annotation sprites
  SIM.annotationSprites.forEach(s => { if (s.parent) s.parent.remove(s); });
  SIM.annotationSprites = [];

  if (!SIM.config) return;

  buildChainVisuals();
  buildGearVisuals();
  if (SIM.showAnnotations) buildAnnotationSprites();
}

// Build chain loop outline between paired sprockets.
// The chain is added to SIM.group so it follows the robot.
function buildChainVisuals() {
  (SIM.config.sprockets || []).forEach(s => {
    if (!s.chainPartner) return;
    const mesh1 = SIM.meshMap[s.meshName];
    const mesh2 = SIM.meshMap[s.chainPartner];
    if (!mesh1 || !mesh2) return;

    // Get positions in SIM.group local space
    const wp1 = new THREE.Vector3(), wp2 = new THREE.Vector3();
    mesh1.getWorldPosition(wp1);
    mesh2.getWorldPosition(wp2);
    const lp1 = SIM.group.worldToLocal(wp1.clone());
    const lp2 = SIM.group.worldToLocal(wp2.clone());

    // Sprocket pitch radius ≈ teeth × 0.125" (VEX #35 chain, 0.250" pitch)
    const r1 = inToWorld((s.teeth || 18) * 0.125);
    const partner = (SIM.config.sprockets || []).find(sp => sp.meshName === s.chainPartner);
    const r2 = inToWorld(((partner?.teeth) || s.teeth || 18) * 0.125);

    const points = _chainPath(lp1, lp2, r1, r2);
    if (!points.length) return;

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color: 0x999999, dashSize: 0.022, gapSize: 0.011,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    SIM.group.add(line);
    SIM.chainLines.push({ line, mat, linkedMotor: s.linkedTo });
  });
}

// Returns points for a chain loop around two circles in the XZ plane.
function _chainPath(p1, p2, r1, r2, arcPts = 14) {
  const dx = p2.x - p1.x, dz = p2.z - p1.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.001) return [];

  // Perpendicular unit vector (90° CCW)
  const px = -dz / dist, pz = dx / dist;
  const yAvg = (p1.y + p2.y) / 2;

  // Tangent contact points on each sprocket
  const t1 = new THREE.Vector3(p1.x + px * r1, yAvg, p1.z + pz * r1);
  const t2 = new THREE.Vector3(p2.x + px * r2, yAvg, p2.z + pz * r2);
  const b1 = new THREE.Vector3(p1.x - px * r1, yAvg, p1.z - pz * r1);
  const b2 = new THREE.Vector3(p2.x - px * r2, yAvg, p2.z - pz * r2);

  const pts = [];
  pts.push(t1.clone());
  pts.push(t2.clone());

  // Arc around sprocket 2 (top → bottom, clockwise when viewed from above)
  const aStart2 = Math.atan2(t2.z - p2.z, t2.x - p2.x);
  for (let i = 0; i <= arcPts; i++) {
    const a = aStart2 - (Math.PI * i / arcPts);
    pts.push(new THREE.Vector3(p2.x + Math.cos(a) * r2, yAvg, p2.z + Math.sin(a) * r2));
  }

  pts.push(b1.clone());

  // Arc around sprocket 1 (bottom → top)
  const aStart1 = Math.atan2(b1.z - p1.z, b1.x - p1.x);
  for (let i = 0; i <= arcPts; i++) {
    const a = aStart1 - (Math.PI * i / arcPts);
    pts.push(new THREE.Vector3(p1.x + Math.cos(a) * r1, yAvg, p1.z + Math.sin(a) * r1));
  }

  pts.push(t1.clone()); // close
  return pts;
}

// Draw pitch-circle rings around gears and dashed lines to their driving motor.
function buildGearVisuals() {
  const ringMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55 });
  const connMat = new THREE.LineDashedMaterial({ color: 0x3b82f6, dashSize: 0.03, gapSize: 0.015, transparent: true, opacity: 0.45 });

  (SIM.config.gears || []).forEach(g => {
    const mesh = SIM.meshMap[g.meshName];
    if (!mesh) return;

    const wp = new THREE.Vector3();
    mesh.getWorldPosition(wp);
    const lp = SIM.group.worldToLocal(wp.clone());

    // Pitch circle radius ≈ teeth × 0.05 (VEX HS gears, ~0.1" pitch radius per tooth pair)
    const r = inToWorld((g.teeth || 36) * 0.05);
    const circPts = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return new THREE.Vector3(lp.x + Math.cos(a) * r, lp.y, lp.z + Math.sin(a) * r);
    });
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circPts), ringMat.clone());
    SIM.group.add(ring);
    SIM.gearRings.push(ring);

    // Dashed line to linked motor mesh
    const srcMotor = (SIM.config.motors || []).find(m => m.id === g.linkedMotor);
    const motorMesh = srcMotor ? SIM.meshMap[srcMotor.meshName] : null;
    if (motorMesh) {
      const wp2 = new THREE.Vector3();
      motorMesh.getWorldPosition(wp2);
      const lp2 = SIM.group.worldToLocal(wp2.clone());
      const connLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([lp, lp2]),
        connMat.clone()
      );
      connLine.computeLineDistances();
      SIM.group.add(connLine);
      SIM.gearRings.push(connLine);
    }
  });
}

// ─── SPEC ANNOTATION SPRITES ─────────────────────────────────────────────────

function _makeTextSprite(lines, bgColor = 'rgba(10,10,20,0.78)', textColor = '#e2e8f0') {
  const W = 320, lineH = 22, pad = 10;
  const H = lines.length * lineH + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 6);
  ctx.fill();

  ctx.font = '13px monospace';
  ctx.fillStyle = textColor;
  lines.forEach((ln, i) => ctx.fillText(ln, pad, pad + 14 + i * lineH));

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(inToWorld(10), inToWorld(10) * (H / W), 1);
  return sprite;
}

function buildAnnotationSprites() {
  const c = SIM.config;
  if (!c) return;
  const dt = c.drivetrain || {};

  const attach = (meshName, lines, color) => {
    const mesh = SIM.meshMap[meshName];
    if (!mesh) return;
    const wp = new THREE.Vector3(); mesh.getWorldPosition(wp);
    const lp = SIM.group.worldToLocal(wp.clone());
    const sprite = _makeTextSprite(lines, 'rgba(10,10,22,0.82)', color || '#e2e8f0');
    sprite.position.set(lp.x, lp.y + inToWorld(4), lp.z);
    SIM.group.add(sprite);
    SIM.annotationSprites.push(sprite);
  };

  (c.motors || []).forEach(m => {
    const cartRPM  = parseInt(m.cartridge || dt.cartridge || '200') || 200;
    const outRPM   = cartRPM * (m.gearRatio || 1.0);
    const stallNm  = ({ '100': 3.6, '200': 2.1, '600': 0.7 }[m.cartridge] ?? 2.1);
    const gearNm   = (stallNm * (m.gearRatio || 1.0)).toFixed(2);
    attach(m.meshName, [
      `${m.id} [${m.role || 'motor'}]`,
      `Cart: ${cartRPM} rpm  Ratio: ${m.gearRatio || 1}x`,
      `Out: ${outRPM.toFixed(0)} rpm  Stall: ${gearNm} Nm`,
    ], '#93c5fd');
  });

  (c.gears || []).forEach(g => {
    const ratio = ((g.inputTeeth || 36) / (g.teeth || 36)).toFixed(2);
    attach(g.meshName, [
      `${g.id} — gear`,
      `${g.inputTeeth || 36}T ÷ ${g.teeth || 36}T = ${ratio}×`,
    ], '#fcd34d');
  });

  (c.sprockets || []).forEach(s => {
    const ratio = ((s.driverTeeth || s.teeth || 18) / (s.teeth || 18)).toFixed(2);
    const partner = s.chainPartner ? `⛓ ${s.chainPartner}` : 'no chain partner';
    attach(s.meshName, [
      `${s.id} — sprocket`,
      `${s.driverTeeth || s.teeth || 18}T ÷ ${s.teeth || 18}T = ${ratio}×`,
      partner,
    ], '#6ee7b7');
  });
}

function simToggleAnnotations() {
  SIM.showAnnotations = !SIM.showAnnotations;
  if (SIM.showAnnotations) {
    buildAnnotationSprites();
  } else {
    SIM.annotationSprites.forEach(s => { if (s.parent) s.parent.remove(s); });
    SIM.annotationSprites = [];
  }
  const btn = document.getElementById('simSpecsBtn');
  if (btn) {
    btn.style.borderColor = SIM.showAnnotations ? 'var(--green)' : '';
    btn.style.color       = SIM.showAnnotations ? 'var(--green)' : '';
    btn.textContent       = SIM.showAnnotations ? '🏷 Specs ON' : '🏷 Specs';
  }
}

// ─── DESIGN VALIDATOR ─────────────────────────────────────────────────────────

const _V5_STALL_NM = { '100': 3.6, '200': 2.1, '600': 0.7 };

function simRunDiagnostics() {
  const c = SIM.config;
  if (!c) {
    _showDiag([{ lvl: 'error', msg: 'No robot config loaded. Click Annotate and save a config first.' }]);
    return;
  }

  const issues = [];
  const ok  = msg => issues.push({ lvl: 'ok',      msg });
  const warn = msg => issues.push({ lvl: 'warning', msg });
  const err  = msg => issues.push({ lvl: 'error',   msg });
  const info = msg => issues.push({ lvl: 'info',    msg });

  const dt      = c.drivetrain || {};
  const motors  = c.motors     || [];
  const gears   = c.gears      || [];
  const sprockets = c.sprockets || [];

  // ── Motor count ──────────────────────────────────────────────────────────
  if      (motors.length === 0)          err('No motors configured');
  else if (motors.length > 8)            err(`${motors.length} motors — VEX V5 limit is 8`);
  else if (motors.length === 8)          ok(`Motor count: 8/8 (at limit)`);
  else                                   ok(`Motor count: ${motors.length}/8`);

  // ── Robot footprint ───────────────────────────────────────────────────────
  const rw = dt.robotWidth || 15, rl = dt.robotLength || 15;
  if (rw > 18 || rl > 18)   err(`Robot ${rw}"×${rl}" exceeds 18" starting-tile limit`);
  else                       ok(`Size ${rw}"×${rl}" — fits 18" starting box`);

  // ── Drive speed ───────────────────────────────────────────────────────────
  const spd = DRIVE_SPEED;
  if      (spd > 65) warn(`Drive speed ${spd.toFixed(1)} in/s — extremely fast, check ratio/traction`);
  else if (spd > 45) warn(`Drive speed ${spd.toFixed(1)} in/s — fast build, verify carpet traction`);
  else               ok(`Drive speed: ${spd.toFixed(1)} in/s`);

  // ── Drive motor count ─────────────────────────────────────────────────────
  const driveMtrs = motors.filter(m => m.role === 'drive');
  if (driveMtrs.length < 2)      warn(`Only ${driveMtrs.length} drive motor(s) — differential drive needs ≥ 2`);
  else if (driveMtrs.length % 2) warn(`Odd number of drive motors (${driveMtrs.length}) — check wiring for symmetry`);
  else                           ok(`Drive motors: ${driveMtrs.length}`);

  // ── Per-motor output RPM + torque ──────────────────────────────────────────
  motors.forEach(m => {
    const cartRPM  = parseInt(m.cartridge || dt.cartridge || '200') || 200;
    const outRPM   = cartRPM * (m.gearRatio || 1.0);
    const stallNm  = _V5_STALL_NM[m.cartridge] ?? 2.1;
    const gearNm   = stallNm * (m.gearRatio || 1.0);
    if (outRPM > 1200) warn(`Motor ${m.id}: output ${outRPM.toFixed(0)} rpm — risk of chain/gear skip`);
    info(`${m.id}: ${outRPM.toFixed(0)} rpm out  |  ${gearNm.toFixed(2)} Nm stall`);
  });

  // ── Gear ratios ───────────────────────────────────────────────────────────
  gears.forEach(g => {
    const ratio = (g.inputTeeth || 36) / (g.teeth || 36);
    if      (ratio > 10) warn(`Gear ${g.id}: ratio ${ratio.toFixed(1)}× is very high — check output RPM`);
    else if (ratio < 0.1) warn(`Gear ${g.id}: ratio ${ratio.toFixed(2)}× — very slow output, verify intent`);
    else                  ok(`Gear ${g.id}: ${g.inputTeeth}T → ${g.teeth}T (${ratio.toFixed(2)}×)`);
  });

  // ── Sprocket chain partner ────────────────────────────────────────────────
  sprockets.forEach(s => {
    if (s.chainPartner && !SIM.meshMap[s.chainPartner]) {
      warn(`Sprocket ${s.id}: chain partner mesh "${s.chainPartner}" not found in loaded OBJ`);
    } else if (s.chainPartner) {
      ok(`Sprocket ${s.id} ⛓ ${s.chainPartner}`);
    }
  });

  // ── External gear ratio sanity ────────────────────────────────────────────
  const extR = dt.externalGearRatio || 1.0;
  if (extR > 5)    warn(`Drivetrain ext. ratio ${extR}× — very high, double-check`);
  else if (extR < 0.2) warn(`Drivetrain ext. ratio ${extR}× — very low, robot will be slow`);

  _showDiag(issues);
}

function _showDiag(issues) {
  let modal = document.getElementById('simDiagModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'simDiagModal';
    modal.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'background:var(--s2,#12121e)', 'border:1px solid var(--b2,#2a2a4a)',
      'border-radius:12px', 'padding:20px 22px', 'z-index:9999',
      'min-width:400px', 'max-width:560px', 'max-height:72vh', 'overflow-y:auto',
      'box-shadow:0 12px 40px rgba(0,0,0,0.65)', 'font-family:var(--fb,sans-serif)',
    ].join(';');
    document.body.appendChild(modal);
  }

  const col = { ok: '#22c55e', warning: '#f59e0b', error: '#ef4444', info: '#60a5fa' };
  const ico = { ok: '✓', warning: '⚠', error: '✕', info: 'i' };
  const errs = issues.filter(x => x.lvl === 'error').length;
  const warns = issues.filter(x => x.lvl === 'warning').length;

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-size:15px;font-weight:700;color:var(--t1,#fff);">Design Diagnostics</span>
      <button onclick="document.getElementById('simDiagModal').style.display='none'"
        style="background:none;border:none;color:var(--t3,#777);font-size:18px;cursor:pointer;line-height:1;">✕</button>
    </div>
    ${issues.map(iss => `
      <div style="display:flex;gap:9px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="color:${col[iss.lvl]};font-size:11px;min-width:12px;font-weight:700;">${ico[iss.lvl]}</span>
        <span style="font-size:12px;color:var(--t2,#ccc);line-height:1.5;">${iss.msg}</span>
      </div>`).join('')}
    <div style="margin-top:12px;font-size:11px;color:var(--t3,#777);">
      ${errs} error${errs !== 1 ? 's' : ''} &nbsp;·&nbsp; ${warns} warning${warns !== 1 ? 's' : ''}
    </div>`;

  modal.style.display = 'block';
}

// ─── TELEMETRY ────────────────────────────────────────────────────────────────

function simCalcScore() {
  let player = 0, opponent = 0;
  SIM.goals.forEach(goal => {
    goal.pieces.forEach(piece => {
      if (piece.type === 'pin') {
        if (piece.color === 'blue') player += PIN_SCORE_ALLIANCE;
        else if (piece.color === 'red') opponent += PIN_SCORE_ALLIANCE;
        else if (piece.color === 'yellow') {
          const owner = SIM.toggleOwner[getQuadrant(goal.x, goal.y)];
          if (owner === 'blue') player += PIN_SCORE_YELLOW;
          else if (owner === 'red') opponent += PIN_SCORE_YELLOW;
        }
      } else if (piece.type === 'cup') {
        if (piece.scoredBy === 'blue') player += CUP_SCORE_VALUE;
        else if (piece.scoredBy === 'red') opponent += CUP_SCORE_VALUE;
      }
    });
  });
  // Midfield bonus at match end
  if (!SIM.match.running && SIM.match.elapsed > 0) {
    if (Math.hypot(SIM.robot.x - FIELD_IN / 2, SIM.robot.y - FIELD_IN / 2) < MIDFIELD_RADIUS)
      player += MIDFIELD_BONUS;
    SIM.aiRobots.forEach(ai => {
      if (Math.hypot(ai.x - FIELD_IN / 2, ai.y - FIELD_IN / 2) < MIDFIELD_RADIUS) {
        if (ai.team === 'blue') player += MIDFIELD_BONUS;
        else opponent += MIDFIELD_BONUS;
      }
    });
  }
  return { player, opponent };
}

function simSnapshotState() {
  const sc = simCalcScore();
  return {
    t:  +(SIM.match.elapsed.toFixed(2)),
    p:  { x: +SIM.robot.x.toFixed(1), y: +SIM.robot.y.toFixed(1),
          a: +SIM.robot.angle.toFixed(1), vx: +SIM.robot.vx.toFixed(1), vy: +SIM.robot.vy.toFixed(1) },
    ai: SIM.aiRobots.map(r => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), a: +r.angle.toFixed(1) })),
    sc,
  };
}

function simStartTelemetry() {
  SIM.telemetry.buffer    = [];
  SIM.telemetry.recording = true;
  SIM.telemetry.sessionId = Date.now();
  SIM.telemetry.mode      = SIM.match.mode;
  SIM.telemetry._tick     = 0;
}

async function simFlushTelemetry() {
  if (!SIM.telemetry.recording || !SIM.telemetry.buffer.length) return;
  SIM.telemetry.recording = false;
  if (!window.electronAPI?.simSaveTelemetry) return;
  await window.electronAPI.simSaveTelemetry({
    id:            SIM.telemetry.sessionId,
    date:          new Date().toISOString(),
    mode:          SIM.telemetry.mode,
    maxRobotSpeed: DRIVE_SPEED,
    frames:        SIM.telemetry.buffer,
  });
}

// ─── ML CONTROL INTERFACE ─────────────────────────────────────────────────────
// Each opponent AI can be switched to ML control by setting ai.mlAction = {leftV, rightV}.
// The Python training loop drives this via WebSocket (see nexus_rl_env.py).

function simApplyMLAction(ai) {
  const { leftV = 0, rightV = 0 } = ai.mlAction;
  const rad      = ai.angle * Math.PI / 180;
  const fwdSpeed = (leftV + rightV) / 2 * DRIVE_SPEED;
  const turnDegs = (rightV - leftV) / TRACK_WIDTH * DRIVE_SPEED * (180 / Math.PI);
  const tVx  = Math.sin(rad) * fwdSpeed;
  const tVy  = -Math.cos(rad) * fwdSpeed;

  const linAlpha  = TICK_DT / (Math.abs(fwdSpeed) > 0.1 ? DRIVE_TAU : COAST_TAU);
  const turnAlpha = TICK_DT / (Math.abs(turnDegs)  > 0.1 ? TURN_TAU  : COAST_TURN);
  ai.vx    += (tVx      - ai.vx)    * linAlpha;
  ai.vy    += (tVy      - ai.vy)    * linAlpha;
  ai.omega += (turnDegs - ai.omega) * turnAlpha;

  const spd = Math.sqrt(ai.vx ** 2 + ai.vy ** 2);
  if (spd > DRIVE_SPEED) { ai.vx *= DRIVE_SPEED / spd; ai.vy *= DRIVE_SPEED / spd; }

  const a = ai.angle * Math.PI / 180;
  const cosA = Math.abs(Math.cos(a)), sinA = Math.abs(Math.sin(a));
  const hw = 8, hx = hw * cosA + hw * sinA, hy = hw * sinA + hw * cosA;
  let nx = ai.x + ai.vx * TICK_DT, ny = ai.y + ai.vy * TICK_DT;
  if (nx < hx || nx > FIELD_IN - hx) { ai.vx = 0; nx = Math.max(hx, Math.min(FIELD_IN - hx, nx)); }
  if (ny < hy || ny > FIELD_IN - hy) { ai.vy = 0; ny = Math.max(hy, Math.min(FIELD_IN - hy, ny)); }
  ai.x = nx; ai.y = ny;
  ai.angle += ai.omega * TICK_DT;
}

// Returns a 15-element normalized observation vector for the given AI opponent.
// This is what the policy network sees each step.
function simGetObservation(aiIdx) {
  const ai = SIM.aiRobots[aiIdx];
  if (!ai) return null;
  const p = SIM.robot, F = FIELD_IN;

  const balls = SIM.gameObjects
    .filter(o => !o.scored)
    .map(o => ({ dx: o.x - ai.x, dy: o.y - ai.y }))
    .sort((a, b) => (a.dx ** 2 + a.dy ** 2) - (b.dx ** 2 + b.dy ** 2));
  const b1 = balls[0] || { dx: 0, dy: 0 };
  const b2 = balls[1] || { dx: 0, dy: 0 };

  const aRad = ai.angle * Math.PI / 180;
  return [
    ai.x / F,                  ai.y / F,                   // position (normalized 0–1)
    Math.sin(aRad),             Math.cos(aRad),             // heading as unit circle
    ai.vx / DRIVE_SPEED,        ai.vy / DRIVE_SPEED,        // velocity
    (p.x - ai.x) / F,          (p.y - ai.y) / F,           // player relative position
    p.vx / DRIVE_SPEED,         p.vy / DRIVE_SPEED,         // player velocity
    b1.dx / F,                  b1.dy / F,                  // nearest ball (relative)
    b2.dx / F,                  b2.dy / F,                  // 2nd nearest ball
    (SIM.match.duration - SIM.match.elapsed) / SIM.match.duration, // time remaining
  ];
}
