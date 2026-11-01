import { createWorld, addBody, step, computeAccelerations, diagnostics,
         handleCollisions, radiusFromMass, G } from './physics.js';
import { loadPreset } from './presets.js';
import { orbitalElements, findDominant } from './orbits.js';

const DT = 0.0005;

// ---- helpers ----
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rel = (w, i, j) => [w.px[i] - w.px[j], w.py[i] - w.py[j], w.pz[i] - w.pz[j]];
const fmt = (x) => Number(x).toExponential(2);

function fresh(key) {
    const w = createWorld();
    loadPreset(w, key);
    return w;
}
function run(w, years, dt = DT, method = 'verlet') {
    const n = Math.round(Math.abs(years) / dt);
    const d = years < 0 ? -dt : dt;
    for (let k = 0; k < n; k++) step(w, d, method);
}
function body(w, mass, pos, vel, radius = radiusFromMass(mass)) {
    return addBody(w, { pos, vel, mass, radius });
}

// ---- tests: each returns { pass, detail } ----
const tests = [
    {
        name: 'Earth returns to its starting point after 1 year',
        fn() {
            const w = fresh('earth');
            const r0 = rel(w, 1, 0);
            run(w, 1);
            const err = dist3(r0, rel(w, 1, 0));
            return { pass: err < 1e-3, detail: `position error ${fmt(err)} AU (limit 1e-3)` };
        },
    },
    {
        name: 'Energy is conserved over 10 years (Verlet)',
        fn() {
            const w = fresh('earth');
            const e0 = diagnostics(w).energy;
            run(w, 10);
            const drift = Math.abs((diagnostics(w).energy - e0) / e0);
            return { pass: drift < 1e-6, detail: `relative drift ${fmt(drift)} (limit 1e-6)` };
        },
    },
    {
        name: 'Momentum is conserved over 10 years',
        fn() {
            const w = fresh('earth');
            const d0 = diagnostics(w);
            run(w, 10);
            const d1 = diagnostics(w);
            const dP = Math.hypot(d1.P[0] - d0.P[0], d1.P[1] - d0.P[1], d1.P[2] - d0.P[2]);
            const rel = d0.pscale > 0 ? dP / d0.pscale : dP;
            return { pass: rel < 1e-9, detail: `relative drift ${fmt(rel)} (limit 1e-9)` };
        },
    },
    {
        name: 'Inclination is conserved (30° orbit stays at 30°)',
        fn() {
            const w = createWorld();
            body(w, 1, [0, 0, 0], [0, 0, 0]);
            const inc = (30 * Math.PI) / 180;
            const v = Math.sqrt(G / 1);
            body(w, 3e-6, [1, 0, 0], [0, v * Math.cos(inc), v * Math.sin(inc)]);
            computeAccelerations(w);
            const before = orbitalElements(w, 1).incl;
            run(w, 5);
            const after = orbitalElements(w, 1).incl;
            const ok = Math.abs(before - 30) < 0.01 && Math.abs(after - 30) < 0.01;
            return { pass: ok, detail: `start ${before.toFixed(4)}°, after 5 yr ${after.toFixed(4)}° (limit ±0.01°)` };
        },
    },
    {
        name: 'Time reversal: 2 yr forward then 2 yr back returns to start',
        fn() {
            const w = fresh('solar');
            const x0 = Array.from(w.px.slice(0, w.n));
            const y0 = Array.from(w.py.slice(0, w.n));
            run(w, 2);
            run(w, -2);
            let worst = 0;
            for (let i = 0; i < w.n; i++) {
                worst = Math.max(worst, Math.hypot(w.px[i] - x0[i], w.py[i] - y0[i]));
            }
            return { pass: worst < 1e-8, detail: `worst position error ${fmt(worst)} AU (limit 1e-8)` };
        },
    },
    {
        name: 'Merge conserves mass and momentum, and records the energy change',
        fn() {
            const w = createWorld();
            body(w, 2e-3, [0, 0, 0],    [1, 0, 0],    0.1);
            body(w, 1e-3, [0.05, 0, 0], [-0.5, 2, 0], 0.1);
            computeAccelerations(w);
            const d0 = diagnostics(w);
            const events = handleCollisions(w, 1);
            const d1 = diagnostics(w);

            const merged = events.length === 1 && w.n === 1;
            const massOk = merged && Math.abs(w.mass[0] - 3e-3) < 1e-15;
            const dP = Math.hypot(d1.P[0] - d0.P[0], d1.P[1] - d0.P[1], d1.P[2] - d0.P[2]);
            const ledger = merged && Number.isFinite(events[0].dE) && Array.isArray(events[0].dL);
            const eErr = ledger ? Math.abs(d1.energy + events[0].dE - d0.energy) : Infinity;

            const pass = merged && massOk && dP < 1e-12 && ledger && eErr < 1e-9;
            return { pass, detail: `merged=${merged}, mass ok=${massOk}, momentum change ${fmt(dP)}, ledger recorded=${ledger}` };
        },
    },
    {
        name: 'Hill-sphere dominant body (Moon → Earth, Earth → Sun, far body → Sun)',
        fn() {
            const w = createWorld();
            const v = Math.sqrt(G);
            const sun   = body(w, 1,      [0, 0, 0],       [0, 0, 0]);
            const earth = body(w, 3.0e-6, [1, 0, 0],       [0, v, 0]);
            const moon  = body(w, 3.7e-8, [1.00257, 0, 0], [0, v, 0]);
            const far   = body(w, 3.7e-8, [1.5, 0, 0],     [0, v, 0]);
            computeAccelerations(w);
            const a = findDominant(w, moon), b = findDominant(w, earth), c = findDominant(w, far);
            return {
                pass: a === earth && b === sun && c === sun,
                detail: `moon→#${a} (want ${earth}), earth→#${b} (want ${sun}), far→#${c} (want ${sun})`,
            };
        },
    },
];

// ---- run and show ----
function runAll() {
    const table = document.getElementById('results');
    table.innerHTML = '<tr><th>Test</th><th>Result</th><th>Details</th></tr>';
    let passed = 0;
    for (const t of tests) {
        let res;
        try {
            res = t.fn();
        } catch (err) {
            res = { pass: false, detail: 'ERROR: ' + err.message };
        }
        if (res.pass) passed++;
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${t.name}</td>` +
            `<td class="${res.pass ? 'pass' : 'fail'}">${res.pass ? 'PASS' : 'FAIL'}</td>` +
            `<td>${res.detail}</td>`;
        table.appendChild(tr);
    }
    const summary = document.getElementById('summary');
    summary.textContent = `${passed} / ${tests.length} passed`;
    summary.className = passed === tests.length ? 'pass' : 'fail';
}

document.getElementById('rerun').addEventListener('click', runAll);
runAll();