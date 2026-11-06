/* ═══════════════════════════════════════════════════════════════════
   dm-star-site.js — mounts ONE star from "Journey of the Skyboard" on a page.
   The star itself is ui/dm-star.js from dartsolarpunk/dartmeadow-space
   (commit 4ef182e), copied VERBATIM as ./dm-star.js: same palette/blackbody,
   plasma granulation + limb darkening, ray-marched corona, fume shell,
   prominence loops/flare ribbons, and the same per-frame LOD (DMStar.frame).
   This file only supplies what the game's index.html supplies around it:
     - THREE (r185 WebGPU build, vendored) + THREE.TSL on window
     - GFX tier flags and makeCircleTex() (copied verbatim from the game)
     - renderer / scene / camera, loop, resize, pause, reduced motion
     - overlay-safe alpha for the additive layers (see makeOverlaySafe)
   Credits: star code and TSL materials (c) Radical Deepscale LLC / DART Meadow.
   three.js (c) three.js authors, MIT (vendor/LICENSE-three).
   Usage:  import {mountStar} from './star/dm-star-site.js';
           mountStar(document.getElementById('star-host'), {preset:'sol', seed:1});
   ═══════════════════════════════════════════════════════════════════ */
import * as THREE_NS from './vendor/three.webgpu.min.js';
import * as TSL from './vendor/three.tsl.min.js';

/* ── one config object: pick the star here ── */
export const PRESETS = {
  sol:    { temp: 5778, seed: 1 },   // the pale golden star (game: _solVis = DMStar.build({temp:5778,seed:1}))
  veyraA: { temp: 8200, seed: 0 },   // blue-white A of the Veyra binary (seed: set yours)
  veyraB: { temp: 3000, seed: 0 }
};
export const DEFAULTS = {
  preset: 'sol',     // key of PRESETS; or leave and set type/temp/seed directly
  type: null,        // game spectral label ('G','K orange','M red dwarf','F white','B blue giant'...) -> DMStar.tempFor
  temp: null,        // kelvin; overrides preset/type
  seed: null,        // integer seed (granulation phase, flare/loop layout); overrides preset
  radius: 1,         // build radius (scene units)
  distance: 3.2,     // camera distance in radii; sets the game's LOD (ang = R/d). 3.2 -> near-surface shader, loops visible
  viewRadius: 2.45,  // how many radii fit to the half-size of the host box (2.45 shows the full corona)
  quality: 'auto',   // 'auto' | 'low' | 'high' (game's lowTier switch)
  dprCap: 2,
  fallbackSrc: new URL('./star-fallback.png', import.meta.url).href,
  forceWebGL: /[?&]gl=1\b/.test(location.search)
};

const w = window;
w.THREE = Object.assign({}, THREE_NS); w.THREE.TSL = TSL;
Object.assign(w, TSL);
if (typeof w.atan2 !== 'function' && typeof TSL.atan === 'function') w.atan2 = (y, x) => TSL.atan(y, x);   // as in the game
const THREE = w.THREE;

/* makeCircleTex — verbatim from the game's index.html (v189 AR-safe feathered disc) */
function makeCircleTex(size,col,alpha){
  // (v189) AR-safe: colour held constant to the rim and ONLY alpha falls off (smooth gaussian-ish
  // curve to exactly 0 at the edge), so additive/normal particles never draw a dark quad or a
  // hard disc rim over a transparent canvas. Accepts 'rgb(..)', 'rgba(..)' or '#hex'.
  size=Math.max(8,size|0); if(alpha==null) alpha=1;
  const c=document.createElement('canvas');c.width=size;c.height=size;
  const ctx=c.getContext('2d');
  const half=size/2;
  let r=255,gg=255,b=255;
  try{ const k=new THREE.Color(String(col||'#fff').replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)/,'rgb($1,$2,$3)')); r=Math.round(k.r*255);gg=Math.round(k.g*255);b=Math.round(k.b*255); }catch(e){}
  const g=ctx.createRadialGradient(half,half,0,half,half,half);
  const st=[[0,1],[0.2,0.82],[0.4,0.5],[0.6,0.22],[0.8,0.06],[1,0]];
  for(const [t,a] of st) g.addColorStop(t,'rgba('+r+','+gg+','+b+','+(alpha*a).toFixed(4)+')');
  ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
w.makeCircleTex = makeCircleTex;
w.GFX = w.GFX || { preset: 'auto', isMobile: false };

let starScript = null;
function loadGameStar() {
  if (w.DMStar) return Promise.resolve(w.DMStar);
  return starScript || (starScript = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('./dm-star.js', import.meta.url).href;
    s.onload = () => w.DMStar ? res(w.DMStar) : rej(new Error('DMStar missing')); s.onerror = () => rej(new Error('dm-star.js failed')); document.head.appendChild(s);
  }));
}

/* The game draws stars over an opaque space scene. Here the canvas is transparent + premultiplied, so
   the additive layers (corona, fume, ribbons, ember quads) must (a) add light and (b) write alpha that
   covers exactly that light — otherwise their opacity-1 shells paint an opaque black disc. Same colours,
   same shader maths; only the blend factors and an alpha = max(rgb) are added. The opaque photosphere
   (normal blending, alpha 1) is untouched. */
function makeOverlaySafe(group) {
  const T = TSL;
  group.traverse(o => {
    const m = o.material; if (!m || m.blending !== THREE.AdditiveBlending) return;
    if (m.isNodeMaterial && m.colorNode) {
      const c = (m.opacityNode ? m.colorNode.mul(m.opacityNode) : m.colorNode).toVar();
      m.colorNode = c; m.opacityNode = T.max(c.r, T.max(c.g, c.b)).clamp(0, 1);
      m.blendSrc = THREE.OneFactor;
    } else m.blendSrc = THREE.SrcAlphaFactor;      // ember quads: texture alpha already shapes them
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
    m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    m.needsUpdate = true;
  });
}

export async function mountStar(host, userCfg) {
  const cfg = Object.assign({}, DEFAULTS, userCfg || {});
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
  w.GFX.isMobile = mobile; w.GFX.preset = cfg.quality === 'auto' ? 'auto' : cfg.quality;
  const ctl = { backend: 'none', paused: false, dispose() {}, renderOnce() {} };
  const showFallback = why => {
    host.dataset.star = 'fallback'; console.warn('[star] static fallback:', why);
    const im = new Image(); im.src = cfg.fallbackSrc; im.alt = ''; im.setAttribute('aria-hidden', 'true');
    im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none';
    host.appendChild(im); ctl.backend = 'fallback'; return ctl;
  };
  try {
    const DMStar = await loadGameStar();
    const base = PRESETS[cfg.preset] || PRESETS.sol;
    const temp = cfg.temp || (cfg.type ? DMStar.tempFor(cfg.type) : base.temp);
    const seed = cfg.seed != null ? cfg.seed : base.seed;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;background:transparent';
    cv.setAttribute('aria-hidden', 'true'); host.appendChild(cv);
    const mk = fw => new THREE.WebGPURenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance', forceWebGL: fw });
    let renderer;
    try { renderer = mk(cfg.forceWebGL); await renderer.init(); }
    catch (e) { console.warn('[star] WebGPU init failed, WebGL2:', e && e.message); renderer = mk(true); await renderer.init(); }
    ctl.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    w.flightRenderer = renderer; w.flightScene = scene;       // the game's precompile() looks these up
    const star = DMStar.build({ radius: cfg.radius, temp, seed });
    scene.add(star.group); makeOverlaySafe(star.group);
    ctl.star = star; ctl.renderer = renderer;

    const size = () => {
      const W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
      const dpr = Math.min(devicePixelRatio || 1, mobile ? Math.min(cfg.dprCap, 1.5) : cfg.dprCap);
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
      const d = cfg.distance * cfg.radius, half = cfg.viewRadius * cfg.radius * (H / Math.min(W, H));
      camera.fov = 2 * Math.atan(half / d) * 180 / Math.PI; camera.aspect = W / H;
      camera.position.set(0, 0, d); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    };
    size(); new ResizeObserver(size).observe(host);

    let raf = 0, last = 0, visible = true, running = false;
    const frame = (now) => {
      raf = 0; if (!running) return;
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60); last = now;
      DMStar.frame(camera, dt); renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    const update = () => {
      const want = visible && !document.hidden && !reduce.matches && !ctl.paused;
      if (want && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
      else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
    // a still frame (reduced motion / before first view): warm the loops a few ticks so plumes exist, then draw
    const still = () => { for (let i = 0; i < 30; i++) DMStar.frame(camera, 0.1); renderer.render(scene, camera); };
    ctl.renderOnce = still;
    const io = new IntersectionObserver(e => { visible = e[e.length - 1].isIntersecting; update(); }, { threshold: 0 });
    io.observe(host);
    document.addEventListener('visibilitychange', update);
    reduce.addEventListener && reduce.addEventListener('change', () => { if (reduce.matches) still(); update(); });
    if (reduce.matches) still();
    update();
    host.dataset.star = ctl.backend;
    ctl.pause = () => { ctl.paused = true; update(); }; ctl.resume = () => { ctl.paused = false; update(); };
    ctl.dispose = () => { running = false; cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener('visibilitychange', update); renderer.dispose(); cv.remove(); };
    return ctl;
  } catch (e) { return showFallback(e && e.message || e); }
}
