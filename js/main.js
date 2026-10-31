import { createCamera, project, unproject } from './camera.js';
import { createRenderer } from './renderer2d.js';
import { createWorld, addBody, removeBody, computeAccelerations, step, predictPath,
         diagnostics, radiusFromMass, handleCollisions, adaptiveDt } from './physics.js';
import { orbitalElements, sampleOrbit, AU_YR_TO_KMS } from './orbits.js';
import { loadPreset } from './presets.js';


const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);


// ---- Camera ----
const cam = createCamera();
function resetCamera() {
    cam.target = [0, 0, 0];
    cam.yaw = 0.5;
    cam.pitch = Math.PI / 3;
    cam.distance = PRESET_DISTANCE;
}
let PRESET_DISTANCE = 8;
resetCamera();


// ---- World ----
const w = createWorld();
let currentPreset = 'earth';


// Loads the current scenario and returns it (so callers can read its defaults)
function initWorld() {
    const p = loadPreset(w, currentPreset);
    PRESET_DISTANCE = p.distance;
    cam.target = [0, 0, 0]; cam.distance = p.distance;
    renderer.clearTrails();
    return p;
}
initWorld();

window.addEventListener('resize', renderer.resize);
renderer.resize();
const W = () => window.innerWidth;
const H = () => window.innerHeight;


// ---- Conservation baseline ----
let base = diagnostics(w);
function resetBaseline() { base = diagnostics(w); }


// ---- Time controls ----
const DT = 0.0005;
const MAX_SUBSTEPS = 1000; // raised from 200 so close encounters can use tiny steps
let speed = 0.5;             // simulated years per real second
let paused = false;
let stepOnce = false;
const playBtn = document.getElementById('btn-play');
const stepBtn = document.getElementById('btn-step');
const speedSlider = document.getElementById('speed');
const speedLabel = document.getElementById('speed-val');


function setPaused(p) {
    paused = p;
    playBtn.textContent = paused ? 'Play' : 'Pause';
}
playBtn.addEventListener('click', () => setPaused(!paused));
stepBtn.addEventListener('click', () => { setPaused(true); stepOnce = true; });


// Slider is log10(speed): -2 -> 0.01 yr/s, 2 -> 100 yr/s
function setSpeed(v) {
    speed = v;
    speedSlider.value = Math.log10(v);
    speedLabel.textContent = v.toFixed(v < 1 ? 2 : 1) + ' yr/s';
}
speedSlider.addEventListener('input', () => setSpeed(Math.pow(10, Number(speedSlider.value))));


// Selection (declared early because Restart and the scenario dropdown use it)
let selected = -1;
let followIdx = -1; // body the camera is locked onto, or -1


// ---- Tools: Launch / Select / Move / Delete ----
let tool = 'launch';
let moveIdx = -1;      // body currently being dragged by the Move tool
const toolBtns = document.querySelectorAll('#tools button');
toolBtns.forEach((b) => {
    b.addEventListener('click', () => {
        tool = b.dataset.tool;
        toolBtns.forEach((x) => x.classList.toggle('active', x === b));
        canvas.style.cursor =
            tool === 'delete' ? 'not-allowed' :
            tool === 'move'   ? 'grab' : 'crosshair';
    });
});


// Each scenario can set its natural scale mode, speed and launch strength
function applyPresetDefaults(p) {
    applyScale(p.trueScale === true);
    setSpeed(p.speed !== undefined ? p.speed : 0.5);
    setGain(p.gain !== undefined ? p.gain : 4);
    document.getElementById('chaos-note').hidden = !p.chaotic;
}


// Integrator choice, restart, and scenario choice
let method = 'verlet';
document.getElementById('method').addEventListener('change', (e) => {
    method = e.target.value;
    resetBaseline();
});
document.getElementById('btn-restart').addEventListener('click', () => {
    applyPresetDefaults(initWorld());
    selected = -1;
    setFollow(-1);
    resetBaseline();
});
document.getElementById('preset').addEventListener('change', (e) => {
    currentPreset = e.target.value;
    applyPresetDefaults(initWorld());
    selected = -1;
    setFollow(-1);
    resetBaseline();
});


// Reverse time and adaptive timestep
let reversed = false;
let adaptive = true;
const revBtn = document.getElementById('btn-rev');
revBtn.addEventListener('click', () => {
    reversed = !reversed;
    revBtn.textContent = reversed ? 'Forward' : 'Reverse';
});
document.getElementById('adaptive').addEventListener('change', (e) => {
    adaptive = e.target.checked;
});


window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        setPaused(!paused);
    }
});


// ---- UI: launch body type + mass ----
// Masses in solar masses (M☉)
const BODY_TYPES = {
    star: 1,           // Sun-like
    reddwarf: 0.2,
    giant: 9.5e-4,     // Jupiter
    rocky: 3e-6,       // Earth-ish
    moon: 3.7e-8,      // our Moon
    asteroid: 4.7e-10, // Ceres
    comet: 1e-16,      // tiny: gravitationally a test particle
};
let launchMass = BODY_TYPES.rocky;
const typeSelect = document.getElementById('body-type');
const massSlider = document.getElementById('mass');
const massLabel = document.getElementById('mass-val');


function fmtMass(m) {
    if (m >= 0.01) return m.toFixed(2) + ' M☉';
    const earth = m / 3.003e-6;
    if (earth >= 0.01) return earth.toFixed(earth < 10 ? 2 : 1) + ' M⊕';
    return m.toExponential(1) + ' M☉';
}
function setLaunchMass(m) {
    launchMass = m;
    massSlider.value = Math.log10(m);
    massLabel.textContent = fmtMass(m);
}
typeSelect.addEventListener('change', () => {
    const m = BODY_TYPES[typeSelect.value];
    if (m !== undefined) setLaunchMass(m); // "custom" keeps the current mass
});
// Slider is log10(mass): -17 -> 1e-17 M☉, 1.5 -> ~31 M☉
massSlider.addEventListener('input', () => {
    launchMass = Math.pow(10, Number(massSlider.value));
    massLabel.textContent = fmtMass(launchMass);
    typeSelect.value = 'custom';
});
setLaunchMass(launchMass);


// ---- UI: inclination slider ----
const inclSlider = document.getElementById('incl');
const inclLabel = document.getElementById('incl-val');
let inclination = 0;
inclSlider.addEventListener('input', () => {
    inclination = Number(inclSlider.value);
    inclLabel.textContent = inclination + '°';
});


// ---- UI: launch height slider ----
// The click is projected onto the horizontal plane z = launchHeight.
const heightSlider = document.getElementById('height');
const heightLabel = document.getElementById('height-val');
let launchHeight = 0;
heightSlider.addEventListener('input', () => {
    launchHeight = Number(heightSlider.value);
    heightLabel.textContent = launchHeight.toFixed(2) + ' AU';
});


// ---- UI: launch strength (drag distance in AU -> launch speed in AU/yr) ----
// Slider is log10(gain): 0 -> x1, 4 -> x10000. Small systems (Earth-Moon) need a big gain.
const gainSlider = document.getElementById('gain');
const gainLabel = document.getElementById('gain-val');
let launchGain = 4;
function setGain(g) {
    launchGain = g;
    gainSlider.value = Math.log10(g);
    gainLabel.textContent = '×' + (g >= 100 ? g.toFixed(0) : g.toFixed(1));
}
gainSlider.addEventListener('input', () => setGain(Math.pow(10, Number(gainSlider.value))));


// ---- UI: trail length (0 = off) ----
const trailSlider = document.getElementById('trail');
const trailLabel = document.getElementById('trail-val');
trailSlider.addEventListener('input', () => {
    const n = Number(trailSlider.value);
    renderer.setTrailLength(n);
    trailLabel.textContent = n === 0 ? 'off' : n;
});


// ---- UI: softening (log10 of ε in AU) ----
const softSlider = document.getElementById('soft');
const softLabel = document.getElementById('soft-val');
softSlider.addEventListener('input', () => {
    w.softening = Math.pow(10, Number(softSlider.value));
    softLabel.textContent = w.softening.toExponential(1) + ' AU';
    computeAccelerations(w); // keep Verlet's stored accelerations consistent
    resetBaseline();          // the potential energy formula just changed
});


// ---- Momentum zeroing ----
// Subtracts the centre-of-mass velocity from every body, so the system's
// total momentum is zero and it stops drifting across the screen.
function zeroMomentum() {
    let mx = 0, my = 0, mz = 0, m = 0;
    for (let i = 0; i < w.n; i++) {
        mx += w.mass[i] * w.vx[i];
        my += w.mass[i] * w.vy[i];
        mz += w.mass[i] * w.vz[i];
        m += w.mass[i];
    }
    if (m === 0) return;
    for (let i = 0; i < w.n; i++) {
        w.vx[i] -= mx / m;
        w.vy[i] -= my / m;
        w.vz[i] -= mz / m;
    }
    resetBaseline();
}
let autoZero = true;
document.getElementById('btn-zero').addEventListener('click', zeroMomentum);
document.getElementById('autozero').addEventListener('change', (e) => {
    autoZero = e.target.checked;
});


// ---- UI: camera buttons ----
document.getElementById('btn-top').addEventListener('click', () => { cam.pitch = Math.PI / 2; });
document.getElementById('btn-side').addEventListener('click', () => { cam.pitch = 0.05; });
document.getElementById('btn-bottom').addEventListener('click', () => { cam.pitch = -Math.PI / 2; });
document.getElementById('btn-reset').addEventListener('click', () => { setFollow(-1); resetCamera(); });


// ---- UI: follow camera ----
const followBtn = document.getElementById('btn-follow');
function setFollow(i) {
    followIdx = i;
    followBtn.textContent = i >= 0 ? 'Unfollow' : 'Follow selected';
}
followBtn.addEventListener('click', () => {
    if (followIdx >= 0) setFollow(-1);
    else if (selected >= 0 && selected < w.n) setFollow(selected);
});


const orthoBtn = document.getElementById('btn-ortho');
orthoBtn.addEventListener('click', () => {
    cam.ortho = !cam.ortho;
    orthoBtn.textContent = cam.ortho ? 'Orthographic' : 'Perspective';
});


// ---- UI: overlay toggles ----
document.getElementById('ov-com').addEventListener('change', (e) => {
    renderer.setShowCOM(e.target.checked);
});
document.getElementById('ov-vel').addEventListener('change', (e) => {
    renderer.setShowVel(e.target.checked);
});
document.getElementById('ov-acc').addEventListener('change', (e) => {
    renderer.setShowAcc(e.target.checked);
});
document.getElementById('ov-hill').addEventListener('change', (e) => {
    renderer.setShowHill(e.target.checked);
});
document.getElementById('ov-hz').addEventListener('change', (e) => {
    renderer.setShowHZ(e.target.checked);
});
document.getElementById('ov-plane').addEventListener('change', (e) => {
    renderer.setShowPlane(e.target.checked);
});
document.getElementById('ov-scale').addEventListener('change', (e) => {
    renderer.setShowScaleBar(e.target.checked);
});
document.getElementById('ov-field').addEventListener('change', (e) => {
    renderer.setShowField(e.target.checked);
});
document.getElementById('ov-gizmo').addEventListener('change', (e) => {
    renderer.setShowGizmo(e.target.checked);
});


// ---- UI: visual vs true scale ----
let trueScale = false;
const scaleBtn = document.getElementById('btn-scale');
const scaleNote = document.getElementById('scale-note');
function applyScale(v) {
    trueScale = v;
    renderer.setTrueScale(v);
    scaleBtn.textContent = v ? 'True scale' : 'Visual scale';
    scaleNote.textContent = v
        ? 'True sizes · merges only on real contact'
        : 'Sizes exaggerated · merges at 30× radius';
}
scaleBtn.addEventListener('click', () => applyScale(!trueScale));


// ---- Launch velocity ----
function launchVelocity(start, current) {
    const dx = (start[0] - current[0]) * launchGain;
    const dy = (start[1] - current[1]) * launchGain;
    const spd = Math.hypot(dx, dy);
    const i = (inclination * Math.PI) / 180;
    const c = Math.cos(i);
    const v = [dx * c, dy * c, spd * Math.sin(i)];
    if (followIdx >= 0 && followIdx < w.n) { // launch velocity is relative to the followed body
        v[0] += w.vx[followIdx]; v[1] += w.vy[followIdx]; v[2] += w.vz[followIdx];
    }
    return v;
}


// ---- Picking: nearest body to the click, in screen space ----
function pickBody(sx, sy) {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < w.n; i++) {
        const p = project(cam, [w.px[i], w.py[i], w.pz[i]], W(), H());
        if (!p) continue;
        const d = Math.hypot(p.x - sx, p.y - sy);
        const tolerance = 16;
        if (d > tolerance) continue;
        const score = d + p.depth * 0.01;
        if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
}


// ---- Info panel ----
const infoEl = document.getElementById('info');
const fmt = (x, d = 3) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;


function updateInfo() {
    if (selected < 0 || selected >= w.n) {
        infoEl.hidden = true;
        return;
    }
    infoEl.hidden = false;
    const i = selected;
    const el = orbitalElements(w, i);
    let html = `<h3>Body #${i}</h3>`;
    html += row('Mass', fmtMass(w.mass[i]));
    html += row('Position (AU)', `${fmt(w.px[i], 2)}, ${fmt(w.py[i], 2)}, ${fmt(w.pz[i], 2)}`);
    if (!el) {
        html += '<div class="sec">No other bodies</div>';
        infoEl.innerHTML = html;
        return;
    }
    html += `<div class="sec">Around body #${el.dominant}</div>`;
    html += row('Distance', fmt(el.dist, 3) + ' AU');
    html += row('Speed', fmt(el.speed * AU_YR_TO_KMS, 2) + ' km/s');
    html += row('Circular speed', fmt(el.vCirc * AU_YR_TO_KMS, 2) + ' km/s');
    html += row('Escape speed', fmt(el.vEsc * AU_YR_TO_KMS, 2) + ' km/s');
    html += `<div class="sec">Orbit</div>`;
    html += row('Type', el.type + (el.bound ? ' (bound)' : ' (escaping)'));
    html += row('Eccentricity', fmt(el.ecc, 4));
    html += row('Semi-major axis', el.type === 'parabolic' ? '∞' : fmt(el.a, 3) + ' AU');
    html += row('Periapsis', fmt(el.peri, 3) + ' AU');
    html += row('Apoapsis', el.apo === null ? '—' : fmt(el.apo, 3) + ' AU');
    html += row('Period', el.period === null ? '—' : fmt(el.period, 3) + ' yr');
    html += `<div class="sec">Orientation</div>`;
    html += row('Inclination', fmt(el.incl, 1) + '°' + (el.retrograde ? ' (retrograde)' : ''));
    html += row('Ascending node Ω', el.node === null ? '—' : fmt(el.node, 1) + '°');
    html += row('Arg. periapsis ω', el.argPeri === null ? '—' : fmt(el.argPeri, 1) + '°');
    html += row('True anomaly ν', el.nu === null ? '—' : fmt(el.nu, 1) + '°');
    infoEl.innerHTML = html;
}


// ---- Edit panel: change mass and radius of the selected body ----
// The panel is built ONCE per selected body (not every refresh), otherwise
// rewriting its HTML would reset the sliders while you drag them.

const editEl = document.getElementById('edit');
const AU_KM = 149597870.7;
let editFor = -1;   // which body the panel is currently built for

function fmtRadius(r) {
    const km = r * AU_KM;
    return km >= 10 ? Math.round(km).toLocaleString() + ' km' : km.toPrecision(2) + ' km';
}

function buildEdit(i) {
    editEl.innerHTML = `
        <h3>Edit body #${i}</h3>
        <label>Mass: <span id="edit-mass-val"></span>
          <input id="edit-mass" type="range" min="-17" max="1.5" step="0.01">
        </label>
        <label>Radius: <span id="edit-rad-val"></span>
          <input id="edit-rad" type="range" min="-9" max="-1" step="0.01">
        </label>
        <label>Color:
          <input id="edit-color" type="color" value="#cccccc">
        </label>
        <button id="edit-color-auto">Auto color</button>
        <div class="hint">Changing mass resets radius to match (constant density).
        Radius affects collisions and True-scale drawing.</div>`;

    const massIn  = document.getElementById('edit-mass');
    const massVal = document.getElementById('edit-mass-val');
    const radIn   = document.getElementById('edit-rad');
    const radVal  = document.getElementById('edit-rad-val');
    const colIn   = document.getElementById('edit-color');

    const showMass = () => {
        massVal.textContent = fmtMass(w.mass[i]);
        massIn.value = Math.log10(Math.max(w.mass[i], 1e-30));
    };
    const showRad = () => {
        radVal.textContent = fmtRadius(w.radius[i]);
        radIn.value = Math.log10(Math.max(w.radius[i], 1e-12));
    };
    showMass();
    showRad();

    massIn.addEventListener('input', () => {
        if (selected !== i || i >= w.n) return;
        w.mass[i] = Math.pow(10, Number(massIn.value));
        w.radius[i] = radiusFromMass(w.mass[i]);
        computeAccelerations(w);   // forces changed, so refresh stored accelerations
        resetBaseline();           // total energy changed on purpose
        showMass();
        showRad();
    });

    radIn.addEventListener('input', () => {
        if (selected !== i || i >= w.n) return;
        w.radius[i] = Math.pow(10, Number(radIn.value));
        showRad();
    });

    // ---- color ----
    const hexToRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const rgbToHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    if (w.color[i]) colIn.value = rgbToHex(w.color[i]);

    colIn.addEventListener('input', () => {
        if (selected !== i || i >= w.n) return;
        w.color[i] = hexToRgb(colIn.value);
    });

    document.getElementById('edit-color-auto').addEventListener('click', () => {
        if (selected !== i || i >= w.n) return;
        w.color[i] = null;
        colIn.value = '#cccccc';
    });
}

function updateEdit() {
    if (selected < 0 || selected >= w.n) {
        editEl.hidden = true;
        editFor = -1;
        return;
    }
    editEl.hidden = false;
    if (editFor !== selected) {
        editFor = selected;
        buildEdit(selected);
    }
}


// ---- Simulated clock ----
const clockEl = document.getElementById('clock');
function updateClock() {
    const t = w.time;
    const days = t * 365.25;
    const text = Math.abs(t) >= 1
      ? `t = ${t.toFixed(3)} yr`
      : `t = ${days.toFixed(1)} days`;
    clockEl.textContent = text + (reversed ? '     ⏪' : '');
}


// ---- Conservation panel ----
const consEl = document.getElementById('cons');
const vmag = (v) => Math.hypot(v[0], v[1], v[2]);
const pct = (x) => {
    const p = x * 100;
    return (Math.abs(p) < 1e-12 ? '0' : p.toExponential(2)) + ' %';
};
function updateConservation() {
    const d = diagnostics(w);
    const dE = base.energy !== 0 ? (d.energy - base.energy) / Math.abs(base.energy) : 0;
    const dPvec = [d.P[0] - base.P[0], d.P[1] - base.P[1], d.P[2] - base.P[2]];
    const dP = base.pscale > 0 ? vmag(dPvec) / base.pscale : 0;
    const dLvec = [d.L[0] - base.L[0], d.L[1] - base.L[1], d.L[2] - base.L[2]];
    const L0 = vmag(base.L);
    const dL = L0 > 0 ? vmag(dLvec) / L0 : 0;
    let html = '<h3>Conservation</h3>';
    html += row('Total energy', d.energy.toExponential(4) + ' M☉AU²/yr²');
    html += row('Energy drift', pct(dE));
    html += row('Momentum |P|', vmag(d.P).toExponential(3));
    html += row('Momentum drift', pct(dP));
    html += row('Ang. momentum |L|', vmag(d.L).toExponential(4));
    html += row('Ang. mom. drift', pct(dL));
    html += `<div class="sec">Baseline resets on launch, merge, delete, move or edit</div>`;
    consEl.innerHTML = html;
}


// ---- Deleting a body ----
function deleteBody(i) {
    const { removed, moved } = removeBody(w, i);
    renderer.removeTrail(removed, moved);

    if (selected === removed) selected = -1;
    else if (selected === moved) selected = removed;

    if (followIdx === removed) setFollow(-1);
    else if (followIdx === moved) followIdx = removed;

    resetBaseline();
}

// Which body pulls hardest at point p? (largest m / d²)
function dominantAt(p) {
    let best = -1, bestPull = 0;
    for (let j = 0; j < w.n; j++) {
        const dx = w.px[j] - p[0], dy = w.py[j] - p[1], dz = w.pz[j] - p[2];
        const pull = w.mass[j] / (dx * dx + dy * dy + dz * dz + 1e-12);
        if (pull > bestPull) { bestPull = pull; best = j; }
    }
    return best;
}

// The orbital plane a body launched from `start` with velocity `vel` would have
function aimPlane(start, vel) {
    const j = dominantAt(start);
    if (j < 0) return null;
    const r = [start[0] - w.px[j], start[1] - w.py[j], start[2] - w.pz[j]];
    const v = [vel[0] - w.vx[j], vel[1] - w.vy[j], vel[2] - w.vz[j]];
    const h = [r[1] * v[2] - r[2] * v[1],
               r[2] * v[0] - r[0] * v[2],
               r[0] * v[1] - r[1] * v[0]];          // h = r × v (plane normal)
    const rl = Math.hypot(r[0], r[1], r[2]);
    const hl = Math.hypot(h[0], h[1], h[2]);
    if (rl < 1e-12 || hl < 1e-12) return null;
    const pHat = r.map((x) => x / rl);
    const hHat = h.map((x) => x / hl);
    const qHat = [hHat[1] * pHat[2] - hHat[2] * pHat[1],
                  hHat[2] * pHat[0] - hHat[0] * pHat[2],
                  hHat[0] * pHat[1] - hHat[1] * pHat[0]];   // qHat = hHat × pHat
    return { center: [w.px[j], w.py[j], w.pz[j]], pHat, qHat, R: rl * 1.3 };
}

// ---- Input ----
let mode = null;
let lastX = 0, lastY = 0;
let downX = 0, downY = 0;
let aim = null;
const CLICK_THRESHOLD = 5;


canvas.addEventListener('contextmenu', (e) => e.preventDefault());


canvas.addEventListener('pointerdown', (e) => {
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        setFollow(-1);
        mode = 'pan';
    } else if (e.button === 0) {
        if (tool === 'launch') {
            const p = unproject(cam, e.clientX, e.clientY, W(), H(), launchHeight);
            if (p) {
                mode = 'launch';
                aim = { start: p, current: p, path: null };
            }
        } else if (tool === 'move') {
            const i = pickBody(e.clientX, e.clientY);
            if (i >= 0) {
                moveIdx = i;
                selected = i;
                mode = 'move';
                canvas.style.cursor = 'grabbing';
            }
        } else {
            mode = 'pick';   // Select / Delete start by clicking a body
        }
    } else {
        mode = 'rotate';
    }
});


canvas.addEventListener('pointermove', (e) => {
    if (mode === 'rotate') {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        cam.yaw -= dx * 0.005;
       cam.pitch = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, cam.pitch + dy * 0.005));
    } else if (mode === 'pan') {
        const p0 = unproject(cam, lastX, lastY, W(), H(), 0);
        const p1 = unproject(cam, e.clientX, e.clientY, W(), H(), 0);
        if (p0 && p1) {
            cam.target = [
                cam.target[0] + (p0[0] - p1[0]),
                cam.target[1] + (p0[1] - p1[1]),
                cam.target[2],
            ];
        }
    } else if (mode === 'launch') {
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (moved >= CLICK_THRESHOLD) {
            const p = unproject(cam, e.clientX, e.clientY, W(), H(), launchHeight);
            if (p) {
                aim.current = p;
               const vel = launchVelocity(aim.start, p);
               aim.path = predictPath(w, aim.start, vel, launchMass, 400, 0.002, followIdx);
               aim.plane = aimPlane(aim.start, vel);
            }
        }
    } else if (mode === 'move' && moveIdx >= 0 && moveIdx < w.n) {
        // slide along the horizontal plane at the body's own height
        const p = unproject(cam, e.clientX, e.clientY, W(), H(), w.pz[moveIdx]);
        if (p) {
            w.px[moveIdx] = p[0];
            w.py[moveIdx] = p[1];
            computeAccelerations(w);
        }
    }
    lastX = e.clientX;
    lastY = e.clientY;
});


canvas.addEventListener('pointerup', (e) => {
    if (mode === 'pick') {
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (moved < CLICK_THRESHOLD) {
            const i = pickBody(e.clientX, e.clientY);
            if (tool === 'select') selected = i;
            else if (tool === 'delete' && i >= 0) deleteBody(i);
        }
    }
    if (mode === 'move') {
        moveIdx = -1;
        canvas.style.cursor = 'grab';
        resetBaseline();   // moving a body changes total energy
    }
    if (mode === 'launch' && aim) {
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (moved < CLICK_THRESHOLD) {
            selected = pickBody(e.clientX, e.clientY);
        } else {
            const vel = launchVelocity(aim.start, aim.current);
            addBody(w, { pos: aim.start, vel, mass: launchMass, radius: radiusFromMass(launchMass) });
            computeAccelerations(w);
            if (autoZero) zeroMomentum();
            resetBaseline();
        }
    }
    mode = null;
    aim = null;
    canvas.releasePointerCapture(e.pointerId);
});


canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.distance *= Math.exp(e.deltaY * 0.001);
    cam.distance = Math.min(200, Math.max(0.004, cam.distance));
}, { passive: false });


// ---- Main loop ----
let last = performance.now();
let acc = 0;
let lastInfo = 0;
const flashes = []; // visual events from merges, consumed by the renderer
const COLLISION_SCALE = 30; // physical radii are tiny; this makes merges happen at visible distances


// A merge renumbers bodies: j is removed, and the last body moves into slot j.
// Keep any stored index (selection, follow target) pointing at the right body.
function remapIndex(idx, ev) {
    if (idx === ev.removed) return ev.kept;
    if (idx === ev.moved) return ev.removed;
    return idx;
}


function runCollisions() {
    const events = handleCollisions(w, trueScale ? 1 : COLLISION_SCALE);
    if (events.length > 0) {
        for (const ev of events) {
            flashes.push(ev);
            renderer.removeTrail(ev.removed, ev.moved);
            selected = remapIndex(selected, ev);
            if (followIdx >= 0) followIdx = remapIndex(followIdx, ev);
        }
        if (selected >= w.n) selected = -1;
        resetBaseline(); // merging changes the system's totals
    }
}


function frame(now) {
    const real = Math.min((now - last) / 1000, 0.1);
    last = now;
    // the simulation holds still while a body is being dragged with the Move tool
    if (!paused && mode !== 'move') acc += real * speed;


    const dir = reversed ? -1 : 1;
    const stepDt = () => (adaptive ? Math.min(DT, adaptiveDt(w)) : DT);
    let substeps = 0;


    if (stepOnce && mode !== 'move') {
        step(w, dir * stepDt(), method);
        renderer.recordTrails(w);
        if (!reversed) runCollisions();
        stepOnce = false;
    }


    while (substeps < MAX_SUBSTEPS) {
        const dt = stepDt();
        if (acc < dt) break;
        step(w, dir * dt, method);
        renderer.recordTrails(w);
        if (!reversed) runCollisions();
        acc -= dt;
        substeps++;
    }
    if (substeps === MAX_SUBSTEPS) acc = 0;


    const orbit = (selected >= 0 && selected < w.n) ? sampleOrbit(w, selected) : null;


    if (followIdx >= 0) {
        if (followIdx < w.n) cam.target = [w.px[followIdx], w.py[followIdx], w.pz[followIdx]];
        else setFollow(-1);
    }


    renderer.render(cam, w, aim, selected, orbit, flashes, followIdx);
    flashes.length = 0;


    if (now - lastInfo > 100) {
        updateInfo();
        updateEdit();
        updateConservation();
        updateClock();
        lastInfo = now;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);