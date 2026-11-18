// Copied from Eris-Bot board/mascot.js (same owner). Keep in sync when the rig changes there.
// Eris mascot. Part 1: the old one-picture version (fallback). Part 2: the layered rig. Part 3: which one to use.
// Supervisor mascot, from one picture: eyes and blush are cut out into their own layers, the hair tips bend with a WebGL shader.
// Mascot.mount(container, {size, src, label, debug}) -> {el, setState(name), gaze(x, y)}
// Owner's rules: never change the eye style, never add a mouth. Expression = gaze, blink, blush, head turn, hair, whole-body motion.
(() => {
const CSS = `
.mc{position:relative;width:var(--mc-s);height:var(--mc-s);cursor:pointer;flex:0 0 auto}
.mc-body{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#0d0c0c;transform-origin:50% 90%}
.mc-body canvas{display:block}
.mc-layer{position:absolute;pointer-events:none}
.mc-layer canvas{width:100%;height:100%}
.mc-base{position:absolute;inset:0;width:100%;height:100%}
.mc-eye{transition:transform .14s cubic-bezier(.3,.7,.4,1)}
.mc-eye canvas{transform-origin:50% 55%;transition:transform .07s ease-in}
.mc-blush{transition:transform .3s cubic-bezier(.3,.7,.4,1),opacity .4s,filter .4s;opacity:.95}
.mc-blink .mc-eye canvas,.mc-sleep .mc-eye canvas{transform:scaleY(.1)}
.mc-surprise .mc-eye canvas{transform:scale(1.18)}
.mc-happy .mc-blush,.mc-cheer .mc-blush{opacity:1;filter:saturate(1.6) brightness(1.02)}
.mc-worry .mc-blush{opacity:.55}
.mc-idle .mc-body,.mc-focus .mc-body{animation:mc-float 3.2s ease-in-out infinite}
@keyframes mc-float{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(calc(-6px*var(--k))) rotate(1.5deg)}}
.mc-focus .mc-body{animation-duration:4.5s}
.mc-think .mc-body{animation:mc-sway 2.6s ease-in-out infinite}
@keyframes mc-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(4deg) translateY(calc(-2px*var(--k)))}}
.mc-happy .mc-body{animation:mc-hop .9s cubic-bezier(.3,1.6,.5,1) infinite}
.mc-cheer .mc-body{animation:mc-hop .7s cubic-bezier(.3,1.6,.5,1) infinite}
@keyframes mc-hop{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.06,.93)}45%{transform:translateY(calc(-22px*var(--k))) scale(.97,1.04)}75%{transform:translateY(0) scale(1.04,.96)}}
.mc-surprise .mc-body{animation:mc-jolt .6s cubic-bezier(.2,1.8,.4,1) 1 both}
@keyframes mc-jolt{0%{transform:scale(1)}30%{transform:translateY(calc(-14px*var(--k))) scale(1.05)}100%{transform:none}}
.mc-worry .mc-body{animation:mc-shake .5s ease-in-out infinite}
@keyframes mc-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(calc(-3px*var(--k))) rotate(-1deg)}75%{transform:translateX(calc(3px*var(--k))) rotate(1deg)}}
.mc-sleep .mc-body{animation:mc-breathe 4s ease-in-out infinite}
@keyframes mc-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.025) translateY(calc(2px*var(--k)))}}
.mc-bubble{position:absolute;right:calc(-18px*var(--k));top:calc(-6px*var(--k));background:var(--mc-card,#fff);color:var(--mc-ink,#6b655f);border:1px solid var(--mc-line,rgba(0,0,0,.08));border-radius:max(10px,calc(18px*var(--k)));padding:max(2px,calc(7px*var(--k))) max(5px,calc(12px*var(--k)));font-size:max(12px,calc(20px*var(--k)));box-shadow:0 6px 18px rgba(0,0,0,.12);opacity:0;transform:scale(.6) translateY(8px);transition:opacity .25s,transform .35s cubic-bezier(.3,1.5,.5,1);pointer-events:none}
.mc-bubble.on{opacity:1;transform:none}
.mc-dots i{display:inline-block;width:.35em;height:.35em;margin:0 .1em;border-radius:50%;background:currentColor;animation:mc-dot 1.2s infinite}
.mc-dots i:nth-child(2){animation-delay:.15s}.mc-dots i:nth-child(3){animation-delay:.3s}
@keyframes mc-dot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-.25em);opacity:1}}
@media (prefers-reduced-motion:reduce){.mc-body,.mc-dots i{animation:none!important}.mc-eye,.mc-blush{transition:none}}`;
const STATES = ['idle', 'think', 'focus', 'happy', 'cheer', 'surprise', 'worry', 'sleep'];
// status bubble per state (emoji for now; hand-drawn art later)
const BUBBLE = {think: '<span class="mc-dots"><i></i><i></i><i></i></span>', happy: '✨', cheer: '🎉', surprise: '❓', worry: '💧', sleep: '💤'};
// where the eyes wander per state: [x, y] in -1..1
const SPOTS = {idle: [[0, 0], [0, 0], [-1, 0], [1, 0], [-.7, -.8], [.7, -.8], [0, .6]], think: [[.8, -1], [.6, -1], [1, -.8]], focus: [[-.5, .9], [-.3, 1], [-.7, .8]],
  happy: [[0, .1]], cheer: [[0, 0], [-.3, 0], [.3, 0]], surprise: [[0, -.2]], worry: [[-1, .7], [1, .7], [0, .9], [-.6, .5]], sleep: [[0, .3]]};
// hair sway per state: [amplitude, speed]
const HAIR = {idle: [.011, 1], think: [.008, .8], focus: [.006, .7], happy: [.016, 1.6], cheer: [.02, 2], surprise: [.014, 1.4], worry: [.009, 1.8], sleep: [.004, .45]};

// connected blobs of pixels passing test inside a region, biggest first
function blobs(test, W, H, R) {
  const lab = new Int32Array(W * H), out = []; let n = 0;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const s0 = y * W + x; if (lab[s0] || !test(s0 * 4)) continue;
    const q = {x0: x, x1: x, y0: y, y1: y, n: 0}, st = [s0]; lab[s0] = ++n;
    while (st.length) {
      const p = st.pop(), px = p % W, py = p / W | 0; q.n++; q.x0 = Math.min(q.x0, px); q.x1 = Math.max(q.x1, px); q.y0 = Math.min(q.y0, py); q.y1 = Math.max(q.y1, py);
      for (const v of [p - 1, p + 1, p - W, p + W]) { const vx = v % W, vy = v / W | 0; if (vx < R.x0 || vx >= R.x1 || vy < R.y0 || vy >= R.y1 || lab[v] || !test(v * 4)) continue; lab[v] = n; st.push(v); }
    }
    out.push(q);
  }
  return out.sort((a, b) => b.n - a.n);
}

// hair sway: bend the picture itself with a GPU shader, weighted 0 on face/crown/clothes and up to 1 along the hair tips
function warp(src, wm, M) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.className = 'mc-base';
  const gl = c.getContext('webgl', {premultipliedAlpha: false}); if (!gl) return null;
  const sh = (t, code) => { const s = gl.createShader(t); gl.shaderSource(s, code); gl.compileShader(s); return s; }, pg = gl.createProgram();
  gl.attachShader(pg, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, `precision mediump float;uniform sampler2D img,wm;uniform float t,amp;varying vec2 uv;
    void main(){float w=texture2D(wm,uv).r;vec2 o=w*amp*vec2(sin(t*1.6-uv.y*7.)+.45*sin(t*2.9-uv.y*13.),.3*cos(t*1.2+uv.x*6.));gl_FragColor=texture2D(img,uv-o);}`));
  gl.linkProgram(pg); if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) return null; gl.useProgram(pg);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pg, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit, fmt, w, h, data, el) => {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    el ? gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, el) : gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data);
  };
  tex(0, gl.RGBA, 0, 0, null, src); tex(1, gl.LUMINANCE, M, M, wm);
  gl.uniform1i(gl.getUniformLocation(pg, 'img'), 0); gl.uniform1i(gl.getUniformLocation(pg, 'wm'), 1);
  const ut = gl.getUniformLocation(pg, 't'), ua = gl.getUniformLocation(pg, 'amp'); gl.viewport(0, 0, c.width, c.height);
  return {c, draw(t, amp) { gl.uniform1f(ut, t); gl.uniform1f(ua, amp); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }};
}

// debug: true honours the checking hashes #look=x,y[,blink] (fixed pose) and #wm (show where the hair moves)
function mount(box, {size = 220, src = '/mascots/supervisor-idle.png', label = 'Supervisor 角色', debug = false} = {}) {
  if (!document.getElementById('mc-css')) { const s = document.createElement('style'); s.id = 'mc-css'; s.textContent = CSS; document.head.appendChild(s); }
  const av = document.createElement('div'); av.className = 'mc mc-idle'; av.setAttribute('role', 'img'); av.setAttribute('aria-label', label);
  av.style.setProperty('--mc-s', size + 'px'); av.style.setProperty('--k', size / 220);
  av.innerHTML = '<div class="mc-body"></div><div class="mc-bubble" aria-hidden="true"></div>'; box.appendChild(av);
  const body = av.firstChild, bubble = av.lastChild;
  let eyes = [], blush = [], state = 'idle', follow = 0;
  const layer = (cls, x0, y0, w, h, W, H, c) => {
    const e = document.createElement('div'); e.className = 'mc-layer ' + cls;
    Object.assign(e.style, {left: x0 / W * 100 + '%', top: y0 / H * 100 + '%', width: w / W * 100 + '%', height: h / H * 100 + '%'}); e.appendChild(c); return e;
  };
  // eyes move the full range; with head>0 the face turns a little too, so the blush follows at about a third
  function gaze(x, y, head = .35) {
    eyes.forEach(e => e.style.transform = `translate(${x * e.r.x}px,${y * e.r.y}px)`);
    blush.forEach(e => e.style.transform = `translate(${x * e.r * head * 3}px,${y * e.r * head}px)`);
  }
  const blinkOnce = ms => { av.classList.add('mc-blink'); setTimeout(() => av.classList.remove('mc-blink'), ms); };
  function blink() {
    if (state !== 'sleep') { blinkOnce(130); if (Math.random() < .2) setTimeout(() => blinkOnce(120), 280); }
    setTimeout(blink, state === 'focus' ? 4500 + Math.random() * 3000 : 2200 + Math.random() * 3200);
  }
  function wander() {
    const p = SPOTS[state]; if (Date.now() - follow > 2500) { const q = p[Math.random() * p.length | 0]; gaze(q[0], q[1], Math.random() < .4 ? .35 : 0); }
    setTimeout(wander, state === 'worry' ? 500 + Math.random() * 500 : state === 'think' ? 2200 : 900 + Math.random() * 2200);
  }
  function setState(k) {
    if (!STATES.includes(k)) return; state = k; av.className = 'mc mc-' + k;
    bubble.innerHTML = BUBBLE[k] || ''; bubble.classList.toggle('on', !!BUBBLE[k]);
    const q = SPOTS[k][0]; gaze(q[0], q[1]);
  }
  const img = new Image(); img.src = src;
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const bx = cv.getContext('2d', {willReadFrequently: true}); bx.drawImage(img, 0, 0); const im = bx.getImageData(0, 0, W, H), d = im.data, orig = new Uint8ClampedArray(d);
    const L = i => .3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2], F = {x0: W * .1 | 0, x1: W * .75 | 0, y0: H * .35 | 0, y1: H * .85 | 0};
    const sk = [0, 0, 0, 0];
    for (let y = F.y0; y < F.y1; y++) for (let x = F.x0; x < F.x1; x++) { const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 235 && g > 200 && b > 190 && r - b < 45) { sk[0] += r; sk[1] += g; sk[2] += b; sk[3]++; } }
    const skin = sk[3] ? [sk[0] / sk[3], sk[1] / sk[3], sk[2] / sk[3]] : [253, 228, 220], sL = .3 * skin[0] + .59 * skin[1] + .11 * skin[2];
    // eyes: the two biggest tall near-black blobs (the choker is wide, so it is skipped); blush: the two biggest pink blobs (pink has blue >= green; jaw shadow does not)
    const eb = blobs(i => d[i] < 60 && d[i + 1] < 55 && d[i + 2] < 55, W, H, F).filter(q => (q.y1 - q.y0) > (q.x1 - q.x0) * 1.2 && q.n > W * H * .0008).slice(0, 2);
    const bb = blobs(i => d[i] > 215 && d[i + 1] < skin[1] - 18 && d[i + 2] >= d[i + 1] - 4, W, H, F).filter(q => q.n > W * H * .0006).slice(0, 2);
    // lift a feature into its own sprite and leave skin behind: pixel = skin*(1-a) + colour*a
    const lift = (q, test, amt) => {
      const pad = W * .025 | 0, x0 = q.x0 - pad, y0 = q.y0 - pad, w = q.x1 - q.x0 + 2 * pad, h = q.y1 - q.y0 + 2 * pad, c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'), sp = cx.createImageData(w, h); let far = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y0 + y) * W + x0 + x) * 4; if (test(i)) far = Math.max(far, amt(i)); }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * W + x0 + x) * 4, o = (y * w + x) * 4; if (!test(i)) continue; const a = Math.min(1, amt(i) / far);
        for (let k = 0; k < 3; k++) sp.data[o + k] = a > .05 ? Math.max(0, Math.min(255, (d[i + k] - skin[k] * (1 - a)) / a)) : d[i + k]; sp.data[o + 3] = 255 * a;
        d[i] = skin[0]; d[i + 1] = skin[1]; d[i + 2] = skin[2];
      }
      cx.putImageData(sp, 0, 0); return {c, x0, y0, w, h, q};
    };
    const isEye = i => (d[i] - d[i + 1] < 50 || d[i] < 100) && L(i) < sL - 6, isBlush = i => d[i] > 200 && d[i + 1] < skin[1] - 4 && d[i + 2] >= d[i + 1] - 6;
    const E = eb.sort((a, b) => a.x0 - b.x0).map(q => lift(q, isEye, i => sL - L(i)));
    const B = bb.map(q => lift(q, isBlush, i => skin[1] - d[i + 1]));
    bx.putImageData(im, 0, 0);
    // hair weight map (MxM): red-hair mask, blurred so edges can move both ways, x distance from the face, x below the crown
    const M = 128, wm = new Float32Array(M * M), fc = E.length === 2 ? {x: (E[0].q.x1 + E[1].q.x0) / 2 / W, y: (E[0].q.y0 + E[1].q.y1) / 2 / H + .05} : {x: .42, y: .66};
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { const i = (((y + .5) / M * H | 0) * W + ((x + .5) / M * W | 0)) * 4, r = orig[i], g = orig[i + 1]; wm[y * M + x] = r > 90 && r - g > 70 && g < 110 ? 1 : 0; }
    for (let pass = 0; pass < 2; pass++) for (const dir of [1, M]) { const t = wm.slice(); for (let p = 0; p < M * M; p++) { let s = 0, n = 0; for (let k = -3; k <= 3; k++) { const q = p + k * dir; if (q < 0 || q >= M * M || (dir === 1 && ((q / M | 0) !== (p / M | 0)))) continue; s += t[q]; n++; } wm[p] = s / n; } }
    const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }, wb = new Uint8Array(M * M);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { const u = (x + .5) / M, v = (y + .5) / M; wb[y * M + x] = 255 * wm[y * M + x] * sm(.24, .42, Math.hypot(u - fc.x, v - fc.y)) * sm(.3, .55, v); }
    if (debug && location.hash === '#wm') { // where the hair moves, for checking
      const o = document.createElement('canvas'); o.width = o.height = M; const ox = o.getContext('2d'), od = ox.createImageData(M, M);
      for (let p = 0; p < M * M; p++) { od.data[p * 4 + 1] = 255; od.data[p * 4 + 3] = wb[p]; } ox.putImageData(od, 0, 0); o.className = 'mc-base'; o.style.zIndex = 9; setTimeout(() => body.appendChild(o), 0);
    }
    const g = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : warp(cv, wb, M);
    if (g) {
      body.appendChild(g.c); let t = 0, last = performance.now(), amp = HAIR.idle[0];
      const tick = now => { const h = HAIR[state]; amp += (h[0] - amp) * .05; t += (now - last) / 1000 * h[1]; last = now; g.draw(t, amp); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    } else { cv.className = 'mc-base'; body.appendChild(cv); }
    B.forEach(s => { const e = layer('mc-blush', s.x0, s.y0, s.w, s.h, W, H, s.c); e.r = (s.q.x1 - s.q.x0) / W * size * .16; blush.push(e); body.appendChild(e); });
    E.forEach(s => { const e = layer('mc-eye', s.x0, s.y0, s.w, s.h, W, H, s.c); e.r = {x: (s.q.x1 - s.q.x0) / W * size * .45, y: (s.q.y1 - s.q.y0) / H * size * .14}; eyes.push(e); body.appendChild(e); });
    const m = debug && location.hash.match(/^#look=(-?[\d.]+),(-?[\d.]+)(,blink)?$/); // fixed pose, for checking by eye
    if (m) { gaze(+m[1], +m[2], 1); if (m[3]) av.classList.add('mc-blink'); return; }
    const q = SPOTS[state][0]; gaze(q[0], q[1]);
    setTimeout(blink, 1200); setTimeout(wander, 800);
  };
  // desktop: eyes follow the cursor; phone: tap and she looks at you
  const R = 120 * size / 220;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !eyes.length || state === 'sleep') return;
    const r = av.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .55), k = Math.max(1, Math.hypot(dx, dy) / R);
    follow = Date.now(); gaze(Math.max(-1, Math.min(1, dx / R / k * 1.2)), Math.max(-1, Math.min(1, dy / R / k * 1.2)));
  });
  av.addEventListener('click', () => { if (state === 'sleep') return; follow = Date.now(); gaze(0, .2, .35); blinkOnce(130); });
  return {el: av, setState, gaze};
}
window.MascotFlat = {mount};
})();

// Eris rig: the picture is cut into layers (back hair+body, face, front hair, eyes, blush, earring),
// each drawn as a bendable mesh in one WebGL canvas. The head turns in pseudo-3D (things nearer the viewer slide further),
// hair and earring lag behind on springs, and states play shuffled motion clips (idea from Grok's avatar).
// ErisRig.mount(box, {size, src, label, debug}) -> {el, setState, gaze, blink, poke, pose}
// Owner's rules: never change the eye style, never add a mouth.
(() => {
const CSS = `
.er{position:relative;width:var(--er-s);height:var(--er-s);flex:0 0 auto;cursor:pointer}
.er-c{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#0d0c0c}
.er-c canvas,.er-c img{display:block;width:100%;height:100%}
.er-bubble{position:absolute;right:calc(-18px*var(--k));top:calc(-6px*var(--k));background:var(--mc-card,#fff);color:var(--mc-ink,#6b655f);border:1px solid var(--mc-line,rgba(0,0,0,.08));border-radius:max(10px,calc(18px*var(--k)));padding:max(2px,calc(7px*var(--k))) max(5px,calc(12px*var(--k)));font-size:max(12px,calc(20px*var(--k)));box-shadow:0 6px 18px rgba(0,0,0,.12);opacity:0;transform:scale(.6) translateY(8px);transition:opacity .25s,transform .35s cubic-bezier(.3,1.5,.5,1);pointer-events:none}
.er-bubble.on{opacity:1;transform:none}
.er-dots i{display:inline-block;width:.35em;height:.35em;margin:0 .1em;border-radius:50%;background:currentColor;animation:er-dot 1.2s infinite}
.er-dots i:nth-child(2){animation-delay:.15s}.er-dots i:nth-child(3){animation-delay:.3s}
@keyframes er-dot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-.25em);opacity:1}}
@media (prefers-reduced-motion:reduce){.er-dots i{animation:none}}`;
const LAYERS = ['base', 'face', 'blush0', 'blush1', 'eye0', 'eye1', 'brow', 'front', 'ear'];
const RIG = {size: 512, tilt: .3083, head: {cx: 205.1, cy: 284.8, rx: 151.1, ry: 163.3}, ear: [310.5, 402.6]}; // from prep.py's rig.json
const BUBBLE = {think: '<span class="er-dots"><i></i><i></i><i></i></span>', happy: '✨', cheer: '🎉', surprise: '❓', worry: '💧', sleep: '💤'};

// ---------- motion clips: tracks of [time s, value]; missing params rest at 0 (eyeOpen/blush/eyeScale at their state face) ----------
// yaw/pitch -1..1 (head turn), roll degrees, by px up(-)/down(+) at 220px, sq squash (+ = wide & short), ex/ey gaze -1..1
const C = {
  idle_breathe: {d: 4.2, yaw: [[0, 0], [2.1, .08], [4.2, 0]], roll: [[0, -1.5], [2.1, 1.5], [4.2, -1.5]], sq: [[0, 0], [2.1, -.012], [4.2, 0]]},
  idle_lookL: {d: 3.6, yaw: [[0, 0], [.5, -.55], [2.8, -.5], [3.4, 0]], roll: [[0, 0], [.5, -3], [3.4, 0]], ex: [[0, 0], [.35, -.9], [2.8, -.8], [3.3, 0]]},
  idle_lookR: {d: 3.6, yaw: [[0, 0], [.5, .55], [2.8, .5], [3.4, 0]], roll: [[0, 0], [.5, 3], [3.4, 0]], ex: [[0, 0], [.35, .9], [2.8, .8], [3.3, 0]]},
  idle_tilt: {d: 3.2, roll: [[0, 0], [.45, 9], [2.4, 8], [3.1, 0]], yaw: [[0, 0], [.45, .15], [3.1, 0]], by: [[0, 0], [.3, -2], [.6, 0]]},
  idle_up: {d: 3, pitch: [[0, 0], [.5, -.4], [2.2, -.35], [2.9, 0]], ey: [[0, 0], [.4, -.9], [2.2, -.8], [2.8, 0]]},
  idle_hop: {d: 1.4, by: [[0, 0], [.12, 3], [.38, -10], [.62, 0], [.75, 2], [.9, 0]], sq: [[0, 0], [.12, .06], [.38, -.04], [.62, .05], [.8, 0]]},
  think_tilt: {d: 4, roll: [[0, 0], [.6, 10], [3.3, 9], [4, 0]], yaw: [[0, 0], [.6, .35], [4, 0]], pitch: [[0, 0], [.6, -.25], [3.5, -.2], [4, 0]], ex: [[0, 0], [.4, .8], [3.6, .8], [4, 0]], ey: [[0, 0], [.4, -.9], [3.6, -.9], [4, 0]]},
  think_ponder: {d: 5, yaw: [[0, .25], [2.5, -.25], [5, .25]], roll: [[0, 4], [2.5, -4], [5, 4]], pitch: [[0, -.2], [5, -.2]], ex: [[0, .6], [2.5, -.6], [5, .6]], ey: [[0, -.8], [5, -.8]]},
  think_hmm: {d: 3.4, roll: [[0, 0], [.5, -8], [2.8, -7], [3.4, 0]], pitch: [[0, 0], [.5, -.3], [3.4, 0]], ex: [[0, 0], [.4, -.6], [3, -.6], [3.4, 0]], ey: [[0, 0], [.4, -1], [3, -1], [3.4, 0]], by: [[0, 0], [.5, -2], [3.4, 0]]},
  focus_down: {d: 4.5, pitch: [[0, .35], [4.5, .35]], yaw: [[0, -.15], [2.2, -.05], [4.5, -.15]], ex: [[0, -.5], [1.5, -.2], [3, -.6], [4.5, -.5]], ey: [[0, .9], [4.5, .9]]},
  focus_scan: {d: 3.6, pitch: [[0, .35], [3.6, .35]], ex: [[0, -.7], [.9, -.7], [1.1, .3], [2.2, .3], [2.4, -.7], [3.6, -.7]], ey: [[0, .9], [3.6, .9]], yaw: [[0, -.2], [1.1, .05], [2.4, -.2], [3.6, -.2]]},
  focus_nod: {d: 2, pitch: [[0, .35], [.3, .5], [.6, .32], [.9, .45], [1.2, .35], [2, .35]], ey: [[0, .9], [2, .9]], ex: [[0, -.4], [2, -.4]]},
  happy_bounce: {d: 1.6, by: [[0, 0], [.14, 4], [.42, -18], [.7, 0], [.82, 3], [1, 0]], sq: [[0, 0], [.14, .08], [.42, -.05], [.7, .07], [.86, 0]], roll: [[0, 0], [.42, -4], [.8, 0]], ey: [[0, 0], [.42, -.3], [.8, 0]]},
  happy_sway: {d: 2.4, roll: [[0, -8], [.6, 8], [1.2, -8], [1.8, 8], [2.4, -8]], yaw: [[0, -.2], [.6, .2], [1.2, -.2], [1.8, .2], [2.4, -.2]], by: [[0, 0], [.3, -4], [.6, 0], [.9, -4], [1.2, 0], [1.5, -4], [1.8, 0], [2.1, -4], [2.4, 0]]},
  happy_nod: {d: 1.8, pitch: [[0, 0], [.25, .4], [.5, -.1], [.75, .35], [1, 0]], by: [[0, 0], [.25, 3], [.5, 0]], ey: [[0, 0], [.25, .3], [1, 0]]},
  cheer_jump: {d: 1.2, by: [[0, 0], [.12, 5], [.38, -26], [.6, 0], [.7, 4], [.85, 0]], sq: [[0, 0], [.12, .1], [.38, -.07], [.6, .1], [.78, 0]], roll: [[0, 0], [.38, 10], [.7, 0]], pitch: [[0, 0], [.38, -.35], [.7, 0]], ey: [[0, 0], [.38, -.6], [.7, 0]]},
  cheer_wiggle: {d: 1.4, roll: [[0, -12], [.35, 12], [.7, -12], [1.05, 12], [1.4, -12]], yaw: [[0, -.35], [.35, .35], [.7, -.35], [1.05, .35], [1.4, -.35]], by: [[0, 0], [.17, -8], [.35, 0], [.52, -8], [.7, 0], [.87, -8], [1.05, 0], [1.22, -8], [1.4, 0]]},
  surprise_jolt: {d: 2.6, by: [[0, 0], [.1, -16], [.35, 0], [2.6, 0]], sq: [[0, 0], [.1, -.08], [.3, .05], [.5, 0]], pitch: [[0, 0], [.1, -.4], [.6, -.2], [2.2, -.15], [2.6, 0]], es: [[0, 1], [.1, 1.22], [.5, 1.15], [2.2, 1.12], [2.6, 1]]},
  surprise_look: {d: 2.4, yaw: [[0, 0], [.12, .6], [1.6, .55], [2.2, 0]], roll: [[0, 0], [.12, 6], [2.2, 0]], ex: [[0, 0], [.08, 1], [1.6, 1], [2.1, 0]], es: [[0, 1], [.12, 1.18], [1.6, 1.12], [2.2, 1]], by: [[0, 0], [.12, -8], [.4, 0]]},
  worry_shake: {d: 2, yaw: [[0, 0], [.2, -.35], [.45, .35], [.7, -.35], [.95, .35], [1.2, 0], [2, 0]], ex: [[0, 0], [.2, -.8], [.45, .8], [.7, -.8], [.95, .8], [1.2, 0]], ey: [[0, .4], [2, .4]]},
  worry_droop: {d: 4, pitch: [[0, 0], [.8, .35], [3.4, .3], [4, 0]], roll: [[0, 0], [.8, -6], [3.4, -5], [4, 0]], ey: [[0, 0], [.6, .9], [3.4, .9], [4, 0]], ex: [[0, 0], [.6, -.6], [2, .3], [3.4, -.4], [4, 0]], by: [[0, 0], [.8, 3], [4, 0]], sq: [[0, 0], [.8, .02], [4, 0]]},
  worry_fidget: {d: 2.4, roll: [[0, -3], [.3, 3], [.6, -3], [.9, 3], [1.2, -3], [2.4, -3]], ex: [[0, -.9], [.6, .9], [1.2, -.9], [1.8, .9], [2.4, -.9]], ey: [[0, .6], [2.4, .6]], by: [[0, 0], [.15, 1.5], [.3, 0], [.45, 1.5], [.6, 0]]},
  sleep_drift: {d: 6, pitch: [[0, .4], [3, .45], [6, .4]], roll: [[0, 9], [3, 12], [6, 9]], sq: [[0, 0], [3, -.025], [6, 0]], by: [[0, 3], [3, 1], [6, 3]]},
  sleep_nodoff: {d: 5, pitch: [[0, .4], [2.4, .55], [2.6, .2], [3.2, .35], [5, .4]], roll: [[0, 9], [2.4, 13], [2.6, 6], [5, 9]], by: [[0, 3], [2.4, 6], [2.6, -1], [5, 3]], eo: [[0, .06], [2.5, .06], [2.6, .35], [3, .06], [5, .06]]},
};
// state = face + clip playlist (shuffled each round, like Grok's) + what the eyes do between clips
const ST = {
  idle: {face: {eo: 1, bl: .9}, clips: ['idle_breathe', 'idle_breathe', 'idle_lookL', 'idle_breathe', 'idle_lookR', 'idle_tilt', 'idle_up', 'idle_hop'], wander: 1},
  think: {face: {eo: 1, bl: .9}, clips: ['think_tilt', 'think_ponder', 'think_hmm']},
  focus: {face: {eo: 1, bl: .85}, clips: ['focus_down', 'focus_scan', 'focus_down', 'focus_nod'], blinkSlow: 1},
  happy: {face: {eo: 1, bl: 1.25}, clips: ['happy_bounce', 'happy_sway', 'happy_nod', 'happy_bounce']},
  cheer: {face: {eo: 1, bl: 1.35}, clips: ['cheer_jump', 'cheer_wiggle', 'cheer_jump']},
  surprise: {face: {eo: 1, bl: .9}, clips: ['surprise_jolt', 'surprise_look'], next: 'idle', hold: 6},
  worry: {face: {eo: 1, bl: .55}, clips: ['worry_shake', 'worry_droop', 'worry_fidget']},
  sleep: {face: {eo: .06, bl: .8}, clips: ['sleep_drift', 'sleep_nodoff', 'sleep_drift'], noBlink: 1},
};
const POKES = {
  nod: {d: .9, pitch: [[0, 0], [.2, .45], [.45, -.05], [.7, .2], [.9, 0]]},
  bounce: C.happy_bounce, hop: C.idle_hop,
  shake: {d: 1.1, yaw: [[0, 0], [.18, -.4], [.4, .4], [.62, -.3], [.84, .2], [1.1, 0]]},
  tilt: {d: 1.6, roll: [[0, 0], [.3, 12], [1.2, 10], [1.6, 0]], yaw: [[0, 0], [.3, .2], [1.6, 0]]},
  wobble: {d: 1.2, sq: [[0, 0], [.1, .12], [.3, -.09], [.5, .06], [.7, -.03], [.9, 0]], roll: [[0, 0], [.15, -6], [.4, 5], [.7, -2], [1, 0]]},
};
const sample = (tr, t) => {
  if (!tr) return null; if (t <= tr[0][0]) return tr[0][1];
  for (let i = 1; i < tr.length; i++) if (t <= tr[i][0]) { const [t0, v0] = tr[i - 1], [t1, v1] = tr[i], k = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * k * k * (3 - 2 * k); }
  return tr[tr.length - 1][1];
};
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function mount(box, {size = 220, src = n => '/mascots/eris-' + n + '.png', label = 'Eris', debug = false, onFail = null} = {}) {
  if (!document.getElementById('er-css')) { const s = document.createElement('style'); s.id = 'er-css'; s.textContent = CSS; document.head.appendChild(s); }
  const av = document.createElement('div'); av.className = 'er'; av.setAttribute('role', 'img'); av.setAttribute('aria-label', label);
  av.style.setProperty('--er-s', size + 'px'); av.style.setProperty('--k', size / 220);
  av.innerHTML = '<div class="er-c"></div><div class="er-bubble mc-bubble" aria-hidden="true"></div>'; box.appendChild(av);
  const wrap = av.firstChild, bubble = av.lastChild, small = size < 110;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = RIG.size, hd = RIG.head, th = RIG.tilt, ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
  const PX = S / 220; // clip px values are authored at 220px
  // ---------- live params ----------
  const P = {yaw: 0, pitch: 0, roll: 0, by: 0, bx: 0, sq: 0, ex: 0, ey: 0, eo: 1, es: 1, bl: .9};
  let state = 'idle', face = ST.idle.face, list = [], cur = null, ct = 0, poke = null, pt = 0, stateT = 0, fixed = null;
  let gazeT = {x: 0, y: 0, until: 0}, wand = {x: 0, y: 0}, blinkK = 0;
  const api = {state: () => state, el: av, setState, gaze, blink, poke: p => { if (POKES[p]) { poke = POKES[p]; pt = 0; } }, pose: o => { fixed = o; if (api.redraw) api.redraw(); }};
  function setState(k) {
    if (!ST[k] || k === state && cur) return; state = k; face = ST[k].face; list = []; cur = null; stateT = 0;
    bubble.innerHTML = BUBBLE[k] || ''; bubble.classList.toggle('on', !!BUBBLE[k]);
  }
  function gaze(x, y, ms = 2500) { gazeT = {x, y, until: performance.now() + ms}; }
  let blinkAt = -1e9, blinkDbl = false;
  function blink() { blinkAt = performance.now(); blinkDbl = Math.random() < .25; }
  // ---------- images ----------
  const imgs = {}; let left = LAYERS.length;
  let failed = false; // a layer that won't load (e.g. phone offline, layers not cached): hand over to the caller's fallback
  LAYERS.forEach(n => { const im = new Image(); im.onerror = () => { if (failed) return; failed = true; av.remove(); if (onFail) onFail(); }; im.onload = () => { if (!--left && !failed) start(); }; im.src = typeof src === 'function' ? src(n) : src[n]; imgs[n] = im; });
  function start() {
    const cv = document.createElement('canvas'), dpr = Math.min(3, devicePixelRatio || 1); cv.width = cv.height = Math.round(size * dpr);
    const gl = !reduce && cv.getContext('webgl', {premultipliedAlpha: true, antialias: true});
    if (!gl) { const x = cv.getContext('2d'); for (const n of LAYERS) x.drawImage(imgs[n], 0, 0, cv.width, cv.height); wrap.appendChild(cv); return; } // reduced motion / no WebGL: the still picture, rebuilt from its layers
    wrap.appendChild(cv);
    const sh = (t, code) => { const s = gl.createShader(t); gl.shaderSource(s, code); gl.compileShader(s); return s; }, pg = gl.createProgram();
    gl.attachShader(pg, sh(gl.VERTEX_SHADER, `attribute vec2 p,uv;varying vec2 v;void main(){v=uv;gl_Position=vec4(p.x/${S / 2}.-1.,1.-p.y/${S / 2}.,0.,1.);}`));
    gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D t;uniform float a;varying vec2 v;void main(){gl_FragColor=texture2D(t,v)*a;}'));
    gl.linkProgram(pg); gl.useProgram(pg);
    const aP = gl.getAttribLocation(pg, 'p'), aU = gl.getAttribLocation(pg, 'uv'), uA = gl.getUniformLocation(pg, 'a');
    gl.enableVertexAttribArray(aP); gl.enableVertexAttribArray(aU);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const tex = {}; for (const n of LAYERS) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgs[n]); gl.generateMipmap(gl.TEXTURE_2D); tex[n] = t; // 512px: mipmaps keep 48px avatars from shimmering
    }
    // sprite boxes and the base hair map, read once from the pictures
    const rd = document.createElement('canvas'); rd.width = rd.height = S; const rx = rd.getContext('2d', {willReadFrequently: true});
    const bbox = n => { rx.clearRect(0, 0, S, S); rx.drawImage(imgs[n], 0, 0); const d = rx.getImageData(0, 0, S, S).data; let x0 = S, y0 = S, x1 = 0, y1 = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return {x0: x0 - 2, y0: y0 - 2, x1: x1 + 3, y1: y1 + 3, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2}; };
    const box = {}; for (const n of ['eye0', 'eye1', 'brow', 'blush0', 'blush1', 'ear']) box[n] = bbox(n);
    const M = 64, hm = new Float32Array(M * M); rx.clearRect(0, 0, S, S); rx.drawImage(imgs.base, 0, 0, M, M); const hd8 = rx.getImageData(0, 0, M, M).data;
    for (let i = 0; i < M * M; i++) { const r = hd8[i * 4], g = hd8[i * 4 + 1]; hm[i] = r > 75 && r - g > 45 && g < 120 ? 1 : 0; }
    for (let pass = 0; pass < 2; pass++) for (const dir of [1, M]) { const t = hm.slice(); for (let p = 0; p < M * M; p++) { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const q = p + k * dir; if (q < 0 || q >= M * M || (dir === 1 && (q / M | 0) !== (p / M | 0))) continue; s += t[q]; n++; } hm[p] = s / n; } }
    const hairAt = (x, y) => { const i = Math.max(0, Math.min(M - 1, x / S * M | 0)), j = Math.max(0, Math.min(M - 1, y / S * M | 0)); return hm[j * M + i]; };
    // head-frame coords of an image point: a along the eye line, b down the face, both /radius
    const hf = (x, y) => { const dx = x - hd.cx, dy = y - hd.cy; return [(dx * ux + dy * uy) / hd.rx, (dx * vx + dy * vy) / hd.ry]; };
    // ---------- meshes: per vertex rest position, uv, and the weights that never change ----------
    function grid(n, x0, y0, x1, y1, kind) {
      const V = [], I = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * j / n, [a, b] = hf(x, y), e = Math.hypot(a, b);
        const wHead = (1 - sm(1.15, 2.0, e)) * (1 - sm(.95, 1.45, b)); // base: how much it follows the head
        const sphere = Math.sqrt(Math.max(0, 1 - e * e));
        const dBase = (b < .2 ? .2 * (1 - sm(.85, 1.35, e)) : 0) - .3 * sm(.9, 1.4, e); // crown sits forward, the hair around sits back
        let depth, wHair;
        if (kind === 'base') { depth = dBase; wHair = hairAt(x, y) * sm(.95, 1.6, e) * (.35 + .65 * sm(-.6, 1.2, b)); }
        else if (kind === 'face') { depth = .12 + .85 * Math.pow(sphere, 1.6); wHair = 0; } // stays between the hair's cut edge and the hair above it, so no skin peeks out
        else { const wf = sm(1.02, .7, e); depth = dBase + (.98 - dBase) * wf; wHair = wf * sm(-.7, .45, b); } // front hair: pinned to the base at its cut edge
        V.push({x, y, u: x / S, v: y / S, a, b, wHead: kind === 'base' ? wHead : 1, depth, wHair});
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * (n + 1) + i; I.push(k, k + 1, k + n + 1, k + 1, k + n + 2, k + n + 1); }
      return mk(V, I);
    }
    function mk(V, I) {
      const pos = gl.createBuffer(), uv = gl.createBuffer(), ib = gl.createBuffer(), arr = new Float32Array(V.length * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V.flatMap(p => [p.u, p.v])), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
      return {V, pos, uv, ib, n: I.length, arr};
    }
    const o = .08 * S, hx0 = hd.cx - hd.rx * 1.25, hy0 = hd.cy - hd.ry * 1.25, hx1 = hd.cx + hd.rx * 1.25, hy1 = hd.cy + hd.ry * 1.25;
    const mesh = {base: grid(44, -o, -o, S + o, S + o, 'base'), face: grid(26, hx0, hy0, hx1, hy1, 'face'), front: grid(28, hx0, hy0, hx1, hy1, 'front')};
    const quad = n => { const b = box[n]; return mk([[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => ({x, y, u: x / S, v: y / S})), [0, 1, 2, 1, 3, 2]); };
    for (const n of ['eye0', 'eye1', 'brow', 'blush0', 'blush1', 'ear']) mesh[n] = quad(n);
    // ---------- springs: hair and earring lag behind the head ----------
    const spring = (k, c) => ({x: 0, y: 0, vx: 0, vy: 0, k, c});
    const sp = {back: spring(38, 5.5), front: spring(70, 7), ear: spring(30, 3)};
    const step = (s, tx, ty, dt) => { s.vx += (s.k * (tx - s.x) - s.c * s.vx) * dt; s.vy += (s.k * (ty - s.y) - s.c * s.vy) * dt; s.x += s.vx * dt; s.y += s.vy * dt; };
    // ---------- the deformation ----------
    let F; // per-frame values
    function deform(p, kind) {
      const w = p.wHead, rr = F.roll * w;
      // turn: slide along the head's own axes, nearer = further
      let x = p.x + (F.tu * ux + F.tv * vx) * p.depth * w, y = p.y + (F.tu * uy + F.tv * vy) * p.depth * w;
      // face outline squeezes on the side it turns to
      if (kind === 'face') { const k = -F.yaw * .06 * p.a * Math.abs(p.a) * hd.rx; x += k * ux; y += k * uy; }
      // hair lags (spring offset) and drifts in the air
      if (p.wHair) { const s = kind === 'front' ? sp.front : sp.back, wind = kind === 'front' ? 0 : F.amp * Math.sin(F.t * 1.3 - p.b * 2.2) * (1 + .4 * Math.sin(F.t * .7));
        x += (s.x - F.hx + wind) * p.wHair; y += (s.y - F.hy) * p.wHair * .35; }
      // roll around the neck
      const c = Math.cos(rr), s = Math.sin(rr), dx = x - F.nx, dy = y - F.ny; x = F.nx + dx * c - dy * s; y = F.ny + dx * s + dy * c;
      return body(x, y);
    }
    // whole body: hop and squash from the bottom centre
    const body = (x, y) => [S / 2 + (x - S / 2) * (1 + F.sq) + F.bx, S + (y - S) * (1 - F.sq) + F.by];
    const headPt = (x, y, depth) => { const [a, b] = hf(x, y); return deform({x, y, a, b, wHead: 1, depth, wHair: 0}, 'sprite'); };
    function draw(n, alpha, posFn) {
      const m = mesh[n]; for (let i = 0; i < m.V.length; i++) { const q = posFn(m.V[i], i); m.arr[i * 2] = q[0]; m.arr[i * 2 + 1] = q[1]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, m.arr, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.bindTexture(gl.TEXTURE_2D, tex[n]); gl.uniform1f(uA, alpha); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
    }
    // a rigid sprite riding on the face: moved, rolled, and (eyes) squashed along the face's up-down axis
    function sprite(n, depth, gx, gy, sy, scale, alpha) {
      const b = box[n], c = headPt(b.cx, b.cy, depth), ang = th + F.roll, cu = Math.cos(ang), su = Math.sin(ang), k = (1 - F.sq * .5) * scale;
      const ox = gx * ux + gy * vx, oy = gx * uy + gy * vy;
      draw(n, alpha, p => { const dx = p.x - b.cx, dy = p.y - b.cy, a = (dx * ux + dy * uy) * k, bb = (dx * vx + dy * vy) * k * sy; return [c[0] + ox + a * cu - bb * su, c[1] + oy + a * su + bb * cu]; });
    }
    // ---------- main loop ----------
    let last = performance.now(), t = 0;
    const amp = small ? 1.35 : 1; // small avatars: bigger, simpler moves (Grok's compact clips idea)
    function frame(now) {
      const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = Math.max(last, now); // rAF time can be older than performance.now(): never step backwards t += dt; stateT += dt;
      // pick the clip
      const stDef = ST[state];
      if (stDef.next && stateT > (stDef.hold || 5)) setState(stDef.next);
      if (!cur || ct >= cur.d) { if (!list.length) list = shuffle(ST[state].clips); cur = C[list.shift()]; ct = 0; }
      ct += dt;
      const val = (k, d = 0) => { let v = sample(cur[k], ct); if (v == null) v = d; if (poke) { const pv = sample(poke[k], pt); if (pv != null) v = k === 'es' ? v * pv : v + pv; } return v; };
      if (poke && (pt += dt) > poke.d) poke = null;
      const ease = 1 - Math.pow(.0015, dt); // soften clip boundaries
      const tgt = fixed || {yaw: val('yaw') * (small ? 1.1 : 1), pitch: val('pitch'), roll: val('roll') * amp, by: val('by') * amp, bx: 0, sq: val('sq') * (small ? 1.2 : 1), es: val('es', 1)};
      for (const k of ['yaw', 'pitch', 'roll', 'by', 'bx', 'sq', 'es']) if (tgt[k] != null) P[k] += (tgt[k] - P[k]) * (fixed ? 1 : ease);
      // eyes: pointer/tap gaze > clip > wander
      let ex = cur.ex ? val('ex') : wand.x, ey = cur.ey ? val('ey') : wand.y;
      if (now < gazeT.until) { ex = gazeT.x; ey = gazeT.y; }
      if (fixed) { ex = fixed.ex || 0; ey = fixed.ey || 0; }
      const fe = 1 - Math.pow(.0000005, dt); P.ex += (ex - P.ex) * fe; P.ey += (ey - P.ey) * fe;
      if (stDef.wander && Math.random() < dt * .6) wand = Math.random() < .35 ? {x: 0, y: 0} : {x: Math.random() * 1.6 - .8, y: Math.random() * 1.2 - .6};
      // blink
      if ((!fixed || fixed.live) && !stDef.noBlink && now - blinkAt > (stDef.blinkSlow ? 4500 : 2600) + Math.random() * 30000 * dt * 60) blink();
      const bt = (now - blinkAt) / 1000; blinkK = bt < .07 ? bt / .07 : bt < .15 ? 1 - (bt - .07) / .08 : blinkDbl && bt > .28 && bt < .43 ? 1 - Math.abs(bt - .355) / .075 : 0;
      if (fixed && fixed.blink) blinkK = 1;
      const eoT = cur.eo ? val('eo') : face.eo; P.eo += (eoT - P.eo) * ease; P.bl += (face.bl - P.bl) * (1 - Math.pow(.05, dt));
      // frame constants
      const tu = P.yaw * hd.rx * .3, tv = P.pitch * hd.ry * .18;
      const nx0 = hd.cx + vx * hd.ry * .95, ny0 = hd.cy + vy * hd.ry * .95;
      F = {t, yaw: P.yaw, tu, tv, roll: P.roll * Math.PI / 180, sq: P.sq, bx: P.bx * PX, by: P.by * PX, nx: nx0, ny: ny0, amp: reduce ? 0 : (state === 'sleep' ? 1.2 : 2.2) * (small ? .6 : 1), hx: 0, hy: 0};
      // where the head is now (screen px), springs chase it
      const hc = headPt(hd.cx, hd.cy, .6), dxh = hc[0] - hd.cx, dyh = hc[1] - hd.cy;
      if (!fixed || fixed.live) { step(sp.back, dxh, dyh, dt); step(sp.front, dxh, dyh, dt); step(sp.ear, dxh, dyh, dt); } else for (const s of Object.values(sp)) { s.x = dxh; s.y = dyh; }
      F.hx = dxh; F.hy = dyh;
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(.05, .047, .047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      draw('base', 1, p => deform(p, 'base'));
      draw('face', 1, p => deform(p, 'face'));
      sprite('blush0', .78, 0, 0, 1, 1, Math.min(1, P.bl)); sprite('blush1', .78, 0, 0, 1, 1, Math.min(1, P.bl));
      if (P.bl > 1) { sprite('blush0', .78, 0, 0, 1, 1.12, (P.bl - 1) * 1.6); sprite('blush1', .78, 0, 0, 1, 1.12, (P.bl - 1) * 1.6); }
      const open = Math.max(.08, P.eo * (1 - blinkK * .92)), gx = P.ex * hd.rx * .085, gy = P.ey * hd.ry * .05;
      sprite('eye0', .9, gx, gy, open, P.es, 1); sprite('eye1', .9, gx, gy, open, P.es, 1);
      sprite('brow', .78, 0, -(P.es - 1) * hd.ry * .25, 1, 1, 1); // eyebrow rides the face in one piece; lifts a little when surprised
      draw('front', 1, p => deform(p, 'front'));
      // earring: swings on its ring
      const eb = box.ear, ring = [RIG.ear[0], RIG.ear[1] + 2], rp = headPt(ring[0], ring[1], .15), sw = Math.max(-.5, Math.min(.5, -(sp.ear.x - dxh) * .02 + Math.sin(t * 1.7) * .03 * F.amp / 2.2)) + F.roll * .9 * 0;
      const ca = Math.cos(sw + F.roll * .2), sa = Math.sin(sw + F.roll * .2);
      draw('ear', 1, p => { const dx = p.x - ring[0], dy = p.y - ring[1]; return [rp[0] + dx * ca - dy * sa, rp[1] + dx * sa + dy * ca]; });
      if (!fixed || fixed.live) requestAnimationFrame(frame); else frameDone = true;
    }
    let frameDone = false;
    const m = debug && location.hash.match(/^#pose=([-\d.,a-z]*)$/);
    if (m) { const [yaw, pitch, roll, ex, ey, bl] = m[1].split(','); fixed = {yaw: +yaw || 0, pitch: +pitch || 0, roll: +roll || 0, by: 0, bx: 0, sq: 0, es: 1, ex: +ex || 0, ey: +ey || 0, blink: bl === 'b'}; }
    requestAnimationFrame(frame);
    api.redraw = () => { if (frameDone) { frameDone = false; requestAnimationFrame(frame); } };
  }
  // desktop: eyes (and a little of the head) follow the cursor; phone: tap = look at you + a small reaction
  const R = 140 * size / 220;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || state === 'sleep') return;
    const r = av.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .5), k = Math.max(1, Math.hypot(dx, dy) / R);
    gaze(Math.max(-1, Math.min(1, dx / R / k)), Math.max(-1, Math.min(1, dy / R / k)), 1500);
  });
  let down = null; av.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  av.addEventListener('click', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; // that was a drag, not a tap
    if (state === 'sleep') { api.poke('wobble'); return; } gaze(0, .1, 1800); blink(); api.poke(['nod', 'tilt', 'wobble', 'hop'][Math.random() * 4 | 0]); });
  return api;
}
window.ErisRig = {mount};
})();

// Board entry point: the layered rig (head turns, hair on springs) when WebGL works, the one-picture version otherwise.
// Rig layers are /mascots/eris-*.png, cut by avatar-rig/prep.py; ?flat in the URL forces the old one.
window.Mascot = {mount(box, o = {}) {
  let gl = null; try { gl = document.createElement('canvas').getContext('webgl'); } catch (e) {}
  if (!gl || /[?&]flat\b/.test(location.search)) return MascotFlat.mount(box, o);
  const {src, ...rest} = o; let cur, rig = true; // the flat one's gaze(x, y, head) takes no duration and has no pokes
  const api = {setState: k => cur.setState(k), gaze: (x, y, ms) => rig ? cur.gaze(x, y, ms) : cur.gaze(x, y), poke: p => rig && cur.poke(p)};
  cur = ErisRig.mount(box, {...rest, onFail: () => { const s = cur.state(); rig = false; cur = MascotFlat.mount(box, o); cur.setState(s); api.el = cur.el; }});
  api.el = cur.el; return api;
}};
