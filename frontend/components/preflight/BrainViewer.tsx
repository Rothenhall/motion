'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ANCHORS, type BrainRegion } from './brainAnchors';

/** tribe-service networks.encode_brain: per-second fsaverage5 map, uint8, zlib + base64, left hemisphere first. */
export type BrainMap = { mesh: string; fps: number; shape: [number, number]; dtype: string; range: [number, number]; encoding: string; data: string };

type Mesh = { positions: Float32Array; faces: Uint16Array; sulc: Uint8Array };
type Frames = { data: Uint8Array; seconds: number; vertices: number; mean: Float32Array; scale: number };

const VIEWS = {
  left: { label: 'Left', position: [-1, 0, 0.08] },
  right: { label: 'Right', position: [1, 0, 0.08] },
  top: { label: 'Top', position: [0, -0.02, 1] },
  back: { label: 'Back', position: [0, -1, 0.15] },
  bottom: { label: 'Under', position: [0, -0.02, -1] },
} as const;
type View = keyof typeof VIEWS;
const DISTANCE = 340;

let meshPromise: Promise<Mesh> | null = null;
/** public/brain/fsaverage5.bin: uint32 nVerts, uint32 nFaces, float32 xyz, uint16 faces, uint8 sulc. */
function loadMesh(): Promise<Mesh> {
  meshPromise ??= fetch('/brain/fsaverage5.bin').then(async (res) => {
    if (!res.ok) throw new Error('Could not load the brain mesh.');
    const buf = await res.arrayBuffer();
    const [nVerts, nFaces] = new Uint32Array(buf, 0, 2);
    let at = 8;
    const positions = new Float32Array(buf, at, nVerts * 3); at += nVerts * 12;
    const faces = new Uint16Array(buf, at, nFaces * 3); at += nFaces * 6;
    const sulc = new Uint8Array(buf, at, nVerts);
    return { positions, faces, sulc };
  });
  return meshPromise;
}

async function decodeFrames(brain: BrainMap): Promise<Frames> {
  const raw = Uint8Array.from(atob(brain.data), (c) => c.charCodeAt(0));
  const inflated = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate')));
  const data = new Uint8Array(await inflated.arrayBuffer());
  const [seconds, vertices] = brain.shape;
  // Each area relative to its own average over the reel, so changes over time stand out.
  const mean = new Float32Array(vertices);
  for (let t = 0; t < seconds; t++) for (let v = 0; v < vertices; v++) mean[v] += data[t * vertices + v];
  for (let v = 0; v < vertices; v++) mean[v] /= seconds;
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += 13) { const d = data[i] - mean[i % vertices]; if (d > 0) sample.push(d); }
  sample.sort((a, b) => a - b);
  const scale = sample.length ? Math.max(1, sample[Math.floor(sample.length * 0.97)]) : 1;
  return { data, seconds, vertices, mean, scale };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Grey folded cortex, with areas more active than their own average glowing from red to yellow. */
function paint(colors: Float32Array, mesh: Mesh, f: Frames, time: number, tone: { base: number; fold: number }) {
  const t0 = Math.max(0, Math.min(f.seconds - 1, Math.floor(time)));
  const t1 = Math.min(f.seconds - 1, t0 + 1);
  const w = Math.max(0, Math.min(1, time - t0));
  const a0 = t0 * f.vertices, a1 = t1 * f.vertices;
  for (let v = 0; v < f.vertices; v++) {
    const value = (f.data[a0 + v] * (1 - w) + f.data[a1 + v] * w - f.mean[v]) / f.scale;
    const grey = tone.base - tone.fold * (mesh.sulc[v] / 255);
    const heat = clamp01(value);
    const alpha = smooth(0.12, 0.5, heat);
    const r = clamp01(0.55 + heat * 1.2), g = clamp01(heat * 1.6 - 0.45), b = clamp01(heat * 2.4 - 1.9);
    colors[v * 3] = grey + (r - grey) * alpha;
    colors[v * 3 + 1] = grey + (g - grey) * alpha;
    colors[v * 3 + 2] = grey + (b - grey) * alpha;
  }
}

const isDarkTheme = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
/** Light cortex for dark surfaces. With no backdrop on a light page the grey is deeper so the folds and outline still read. */
const toneFor = (bare: boolean) => (bare && !isDarkTheme() ? { base: 0.7, fold: 0.42 } : { base: 0.8, fold: 0.36 });

/** `bare` draws the brain straight onto the page: transparent canvas, theme-aware greys, no panel around it. */
export default function BrainViewer({ brain, time, bare = false, regions }: { brain: BrainMap; time: number; bare?: boolean; regions?: BrainRegion[] }) {
  const host = useRef<HTMLDivElement>(null);
  const timeRef = useRef(time);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const viewRef = useRef<(v: View) => void>(() => undefined);
  const [view, setView] = useState<View>('left');
  const [error, setError] = useState<string | null>(null);
  const [second, setSecond] = useState(0);
  timeRef.current = time;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let frame = 0;
    let cleanup = () => undefined as void;

    Promise.all([loadMesh(), decodeFrames(brain)]).then(([mesh, frames]) => {
      if (disposed) return;
      if (frames.vertices * 3 !== mesh.positions.length) throw new Error('This brain map does not match the brain mesh.');
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 10, 2000);
      camera.up.set(0, 0, 1); // fsaverage is RAS: z points up
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minDistance = 180;
      controls.maxDistance = 600;
      if (bare) controls.minDistance = 150;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.faces, 1));
      geometry.computeVertexNormals();
      const colors = new Float32Array(frames.vertices * 3);
      const colorAttr = new THREE.BufferAttribute(colors, 3);
      geometry.setAttribute('color', colorAttr);
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      scene.add(new THREE.Mesh(geometry, material));
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      camera.add(key);
      key.position.set(0.4, 0.6, 1);
      scene.add(camera);

      // Labels printed on the brain itself: each system's name, lit by how active it is right now.
      type Label = { key: string; el: HTMLDivElement; pill: HTMLSpanElement; pos: THREE.Vector3; normal: THREE.Vector3; state: string; text: string; side: string; pw: number };
      const labels: Label[] = [];
      let labelLayer: HTMLDivElement | null = null;
      if (bare) {
        labelLayer = document.createElement('div');
        labelLayer.className = 'pf-bl-layer';
        el.appendChild(labelLayer);
        const normals = geometry.getAttribute('normal');
        for (const [key, anchors] of Object.entries(ANCHORS)) {
          for (const a of anchors) {
            let best = 0, bestD = Infinity;
            for (let i = 0; i < mesh.positions.length / 3; i++) {
              const dx = mesh.positions[i * 3] - a[0], dy = mesh.positions[i * 3 + 1] - a[1], dz = mesh.positions[i * 3 + 2] - a[2];
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestD) { bestD = d; best = i; }
            }
            const node = document.createElement('div');
            node.className = 'pf-bl';
            const dot = document.createElement('i'); dot.className = 'pf-bl-dot';
            const pill = document.createElement('span'); pill.className = 'pf-bl-pill';
            node.append(dot, pill);
            labelLayer.appendChild(node);
            labels.push({
              key, el: node, pill, state: '', text: '', side: '', pw: 90,
              pos: new THREE.Vector3(mesh.positions[best * 3], mesh.positions[best * 3 + 1], mesh.positions[best * 3 + 2]),
              normal: new THREE.Vector3(normals.getX(best), normals.getY(best), normals.getZ(best)).normalize(),
            });
          }
        }
      }
      const toCam = new THREE.Vector3();
      const proj = new THREE.Vector3();
      const updateLabels = () => {
        const w = el.clientWidth, h = el.clientHeight;
        const best = new Map<string, { l: Label; score: number; x: number; y: number }>();
        for (const l of labels) {
          toCam.copy(camera.position).sub(l.pos).normalize();
          const facing = l.normal.dot(toCam);
          proj.copy(l.pos).project(camera);
          const visible = proj.z < 1 && Math.abs(proj.x) < 0.96 && Math.abs(proj.y) < 0.96;
          const score = visible ? facing : -1;
          const cur = best.get(l.key);
          if (!cur || score > cur.score) best.set(l.key, { l, score, x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h });
        }
        const shown = new Set<Label>();
        const taken: { x: number; y: number }[] = [];
        const items = [...best.values()].filter((b) => b.score > 0.3 && regionsRef.current?.some((r) => r.key === b.l.key)).sort((a, b) => a.y - b.y);
        for (const it of items) {
          const region = regionsRef.current!.find((r) => r.key === it.l.key)!;
          const l = it.l;
          // Systems that matter right now carry their name; typical ones are a quiet dot so the brain stays readable.
          const wordy = region.state !== 'flat';
          let y = Math.max(14, Math.min(h - 14, it.y));
          if (wordy) for (let n = 0; n < 5 && taken.some((t) => Math.abs(t.y - y) < 22 && Math.abs(t.x - it.x) < 130); n++) y += 22; // nudge apart
          y = Math.min(h - 14, y);
          if (wordy) taken.push({ x: it.x, y });
          if (l.text !== region.label) { l.pill.textContent = region.label; l.text = region.label; l.pw = l.pill.offsetWidth || 90; }
          // Put the pill on the side that has room, so it never runs off the canvas.
          const side = it.x + 12 + l.pw > w - 4 ? 'left' : it.x - 12 - l.pw < 4 ? 'right' : it.x > w * 0.6 ? 'left' : 'right';
          if (l.state !== region.state || l.side !== side) { l.el.className = `pf-bl is-${region.state} on-${side}`; l.state = region.state; l.side = side; }
          l.el.style.transform = `translate(${it.x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          l.el.style.opacity = '1';
          shown.add(l);
        }
        for (const l of labels) if (!shown.has(l)) l.el.style.opacity = '0';
      };

      viewRef.current = (v: View) => {
        const [x, y, z] = VIEWS[v].position;
        camera.position.set(x, y, z).normalize().multiplyScalar(bare ? 265 : DISTANCE);
        controls.target.set(0, 0, 0);
        controls.update();
      };
      viewRef.current('left');

      const resize = () => {
        const w = el.clientWidth || 300, h = el.clientHeight || 300;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();

      let painted = -1;
      let shownSecond = -1;
      let lastDark = isDarkTheme();
      const loop = () => {
        frame = requestAnimationFrame(loop);
        const t = Math.max(0, Math.min(frames.seconds - 1, timeRef.current));
        const dark = isDarkTheme();
        if (dark !== lastDark) { lastDark = dark; painted = -1; } // theme switched: recolour
        if (Math.abs(t - painted) > 0.02) {
          paint(colors, mesh, frames, t, toneFor(bare));
          colorAttr.needsUpdate = true;
          painted = t;
          if (Math.floor(t) !== shownSecond) { shownSecond = Math.floor(t); setSecond(shownSecond); }
        }
        controls.update();
        camera.updateMatrixWorld();
        if (labels.length) updateLabels();
        renderer.render(scene, camera);
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        labelLayer?.remove();
      };
    }).catch((e) => { if (!disposed) setError(e instanceof Error ? e.message : 'Could not draw the brain view.'); });

    return () => { disposed = true; cleanup(); };
  }, [brain, bare]);

  if (error) return <div className="pf-brain-empty"><strong>{error}</strong></div>;
  return <div className={`pf-brain ${bare ? 'pf-brain-bare' : ''}`}>
    <div className="pf-brain-canvas" ref={host} role="img" aria-label="3D brain, coloured by the simulated response at the current second of the video. Drag to rotate." />
    <div className="pf-brain-bar">
      <div className="tag-row" role="group" aria-label="Brain view angle">
        {(Object.keys(VIEWS) as View[]).map((v) => <button key={v} type="button" className={`toolbar-filter ${view === v ? 'active' : ''}`} aria-pressed={view === v} onClick={() => { setView(v); viewRef.current(v); }}>{VIEWS[v].label}</button>)}
      </div>
      <span className="pf-brain-time">{Math.floor(second / 60)}:{String(second % 60).padStart(2, '0')}</span>
    </div>
    <div className="pf-brain-legend"><i aria-hidden="true" /> {bare ? 'Colour: brighter = more active than usual. Labels: green ▲ above usual, amber ▼ below. Drag to turn.' : 'Brighter = more active than that area\u2019s own average over the reel. Drag to rotate.'}</div>
  </div>;
}
