// Zapp Account film · 1920x1200 (16:10) · 25 fps. Built shot by shot from the director's notes.
//   Shot 1 · Arrival: the phone slides in from the bottom right, one full turn (screen lit, empty), and lands →
//   one camera move: a zoom in → the UI builds itself top to bottom, each component dropping in whole.
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';

const s = await studio({ id: 'zapp-film', width: 1920, height: 1200, fps: 25 });
const $ = (q) => document.querySelector(q), $$ = (q) => [...document.querySelectorAll(q)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const outExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

// chain fromTo's on one target without restating where it was
const S = (el, init) => {
  gsap.set(el, init);
  const cur = { ...init };
  return { el, cur, to(b, vars, x = {}) { const from = {}; for (const k in vars) from[k] = cur[k]; b.fromTo(el, from, vars, x); Object.assign(cur, vars); return b; } };
};

// ---------------------------------------------------------------- timing (frames)
const ARRIVE = { dur: 42, ease: [0.22, 0.6, 0.3, 1] };   // the phone's arrival curve
const PUSH = { ease: [0.55, 0, 0.3, 1] };                // camera: holds wide while the phone flies in, then pushes; lands with it
const T = { land: 42, zoom: 0, travel: 40, end: 724 };    // fly-in and zoom are one move: the camera pushes in from frame 0
const BUILD = { header: 38, balance: 50, actions: 66, nudge: 82, quick: 94, footer: 110 };   // when each section slides in (after the top wash)

// ---------------------------------------------------------------- camera rig
const CAM = { rx: 30, rz: -20, ry: 12, s: 0.95, fx: 0, fy: 0, ty: 0, ny: 0, __label: 'camera' };   // ny = small per-callout nudge   // fy = framing, ty = travel; summed so the two can overlap   // angled three-quarter view
const cam = S(CAM, { ...CAM });
Object.assign(CAM, { rx0: CAM.rx, rz0: CAM.rz, ry0: CAM.ry, s0: CAM.s });   // the opening view, for the loop back
const grid = $('#grid'), GRID_K = 1.45, GRID_DAMP = 0.65;
const worlds = [$('#world'), $('#world2'), $('#world3')];   // tile wall + shadow, and the phone (its own layer for the 2D outline)
s.onFrame(() => {
  const t = `scale(${CAM.s}) rotateX(${CAM.rx}deg) rotateZ(${CAM.rz}deg) rotateY(${CAM.ry}deg) translate3d(${-CAM.fx}px, ${-(CAM.fy + CAM.ty + CAM.ny)}px, 0)`;
  worlds.forEach((w) => { w.style.transform = t; });
  // the grid zooms with the camera, but its density changes much less than the phone's size does:
  // it is counter-scaled so on-screen cells go ~85px → ~120px instead of ~57px → ~144px
  grid.style.transform = `translateZ(-260px) scale(${GRID_K * Math.pow(CAM.s, -GRID_DAMP)})`;
});

// ---------------------------------------------------------------- phone body
const SLABS = 26, DEPTH = 1.6;     // ~42px thick
const slabs = Array.from({ length: SLABS }, (_, k) => {
  const i = k + 1, el = document.createElement('div');
  el.className = 'slab';
  $('#slabs').appendChild(el);
  gsap.set(el, { z: -i * DEPTH });
  return el;
});
gsap.set('#backplate', { z: -SLABS * DEPTH - 0.5, rotationY: 180 });
// solid side walls on the straight edges, so the body reads as one surface when its side faces the camera
// (the stacked slabs alone show as stripes edge-on); the rounded corners stay as the slab stack
{
  const TH = SLABS * DEPTH, R = 58, W = 384, H = 804;
  [['left', -0.2, R, TH, H - 2 * R, { rotationY: -90 }], ['right', W - 0.8, R, TH, H - 2 * R, { rotationY: 90 }],
   ['top', R, 0, W - 2 * R, TH, { rotationX: 90 }], ['bottom', R, H, W - 2 * R, TH, { rotationX: -90 }]].forEach(([side, x, y, w, h, rot]) => {
    const el = document.createElement('div');
    el.className = 'side-wall'; el.dataset.name = `Side wall – ${side}`;
    const vertical = side === 'left' || side === 'right';
    Object.assign(el.style, { left: `${vertical ? x - w / 2 : x}px`, top: `${vertical ? y : y - h / 2}px`, width: `${w}px`, height: `${h}px` });
    $('#slabs').after(el);
    gsap.set(el, { z: -TH / 2, ...rot });
    // antenna bands: drawn on the left side of the body only, ~34px in from each corner
    if (side === 'left') [34, h - 34].forEach((at) => {
      const band = document.createElement('i');
      band.className = 'antenna'; band.dataset.name = 'Antenna band';
      Object.assign(band.style, { left: '0', right: '0', top: `${at - 3.5}px`, height: '7px' });
      el.appendChild(band);
    });
  });
}
// side buttons: solid extruded pills on the side face — a groove ring at the base, a closed ring of wall facets
// around the whole outline (straight edges and rounded ends), and a flat cap on top. No layer stacks, so they stay
// solid from any angle.
const THICK = SLABS * DEPTH, PILL = Math.round(THICK * 0.48), BTN_H = 3.5;
const pillOutline = (w, len, seg = 8) => {        // points around a vertical pill, clockwise
  const r = w / 2, pts = [];
  for (let k = 0; k <= seg; k++) { const a = Math.PI + (Math.PI * k) / seg; pts.push([r + r * Math.cos(a), r + r * Math.sin(a)]); }
  for (let k = 0; k <= seg; k++) { const a = (Math.PI * k) / seg; pts.push([r + r * Math.cos(a), len - r + r * Math.sin(a)]); }
  return pts;
};
[['left', 176, 96], ['right', 220, 90]].forEach(([side, top, len]) => {   // one long pill on the left, power button on the right
  const el = document.createElement('div');
  el.className = 'side-btn'; el.dataset.name = 'Side button';
  Object.assign(el.style, { left: `${(side === 'left' ? -0.6 : 384.6) - PILL / 2}px`, top: `${top}px`, width: `${PILL}px`, height: `${len}px` });
  el.innerHTML = '<i class="groove"></i><i class="cap"></i>';
  $('#phone').appendChild(el);
  gsap.set(el, { z: -THICK / 2, rotationY: side === 'left' ? -90 : 90 });
  const [groove, cap] = el.children;
  groove.style.borderRadius = `${PILL / 2 + 2}px`;
  cap.style.borderRadius = `${PILL / 2}px`;
  gsap.set(cap, { z: BTN_H });
  // wall facets: each runs from one outline point to the next and stands straight up off the side face
  const pts = pillOutline(PILL, len);
  pts.forEach(([x0, y0], k) => {
    const [x1, y1] = pts[(k + 1) % pts.length];
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 0.01) return;
    const w = document.createElement('b');
    w.className = 'btn-wall';
    const th = Math.atan2(-dx, dy) * 180 / Math.PI;
    Object.assign(w.style, { width: `${BTN_H}px`, height: `${L + 0.4}px`, transformOrigin: '0 0',
      transform: `translate3d(${x0}px, ${y0}px, 0) rotateZ(${th}deg) rotateY(-90deg)` });
    el.appendChild(w);
  });
});
// extrude a flat outline straight up (along local z) by h: one wall facet per outline segment
const extrude = (parent, pts, h, z0 = 0) => pts.forEach(([x0, y0], k) => {
  const [x1, y1] = pts[(k + 1) % pts.length], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 0.01) return;
  const w = document.createElement('b');
  w.className = 'xw';
  Object.assign(w.style, { width: `${h}px`, height: `${L + 0.4}px`, transformOrigin: '0 0',
    transform: `translate3d(${x0}px, ${y0}px, ${z0}px) rotateZ(${Math.atan2(-dx, dy) * 180 / Math.PI}deg) rotateY(-90deg)` });
  parent.appendChild(w);
});
const roundRect = (w, h, r, seg = 6) => {
  const pts = [], c = [[w - r, r, -90], [w - r, h - r, 0], [r, h - r, 90], [r, r, 180]];
  c.forEach(([cx, cy, a0]) => { for (let k = 0; k <= seg; k++) { const a = ((a0 + (90 * k) / seg) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } });
  return pts;
};
const circle = (r, n = 28) => Array.from({ length: n }, (_, k) => [r + r * Math.cos((2 * Math.PI * k) / n), r + r * Math.sin((2 * Math.PI * k) / n)]);
// camera island: 8px off the back; each lens a 5px metal-rimmed barrel on top of it
{
  const ISLAND = 8, LENS = 5, bump = document.querySelector('.cam-bump');
  extrude(bump, roundRect(88, 158, 44), ISLAND);
  gsap.set(bump.querySelector('.cap'), { z: ISLAND });
  bump.querySelectorAll('.lens').forEach((l) => { extrude(l, circle(32), LENS, ISLAND); gsap.set(l.querySelector('.glass'), { z: ISLAND + LENS }); });
}
gsap.set('#screen', { z: 3 });
gsap.set(['.island', '.home-ind'], { z: 1.5 });   // flush on the glass (just above the UI so it draws on top)
gsap.set('#floorShadow', { x: 34, y: 46, z: -SLABS * DEPTH - 70, opacity: 0 });

const PHONE0 = { x: 400, y: 1450 };   // first frame: fully below the frame
const PHONE_OUT = { x: -1000, y: -1700 };   // loop exit: fully out past the top left (opposite corner)
const phone = S($('#phone'), { x: PHONE0.x, y: PHONE0.y, z: 0, rotationX: 0, rotationY: -360, rotationZ: 18 });   // starts below the frame, slightly right of centre; rises in with one full turn

// ---------------------------------------------------------------- BEFORE phone (old PayZapp Wallet)
// A copy of the finished phone body with the old wallet screen rebuilt in place of the Zapp UI.
const phoneB = $('#phone').cloneNode(true);
phoneB.id = 'phoneBefore'; phoneB.dataset.name = 'Phone – Before';
{
  const scr = phoneB.querySelector('#screen');
  const keep = [scr.querySelector('.island'), scr.querySelector('.home-ind')];
  const ICON = {'limits': `<svg viewBox="0 0 24 24"><path d="M2.5 18.5a9.5 9.5 0 1 1 19 0z" fill="#0066B4"/><circle cx="12" cy="15.6" r="2.4" fill="#E7F4FF"/><path d="M12 15.6l4.2-4.6" stroke="#E7F4FF" stroke-width="2.4" stroke-linecap="round"/></svg>`, 'transfer': `<img src="assets/ic-transfer-glyph.svg" style="width:21px;height:18px;filter:hue-rotate(-12deg) saturate(1.6) brightness(1.15)">`, 'txns': `<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="3" fill="#0066B4"/><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h7" stroke="#E7F4FF" stroke-width="1.8" stroke-linecap="round"/><path d="M5 5.5h-1M5 9h-1M5 12.5h-1M5 16h-1M19 5.5h1M19 9h1M19 12.5h1M19 16h1" stroke="#0066B4" stroke-width="1.6" stroke-linecap="round"/></svg>`, 'auto': `<svg viewBox="0 0 24 24" fill="none" stroke="#0066B4" stroke-width="2" stroke-linecap="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M17.5 3.5v3.3h-3.3"/><path d="M9.5 8.5h5M9.5 11h5M12.5 8.5c1.6 0 1.6 2.5 0 2.5h-3l4 4.5"/></svg>`, 'dl': `<svg viewBox="0 0 24 24" fill="none" stroke="#0066B4" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v9m-4-4 4 4 4-4"/><path d="M5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`};
  const rows = [['limits', 'Payment Limits', 'Update your transaction limits'], ['transfer', 'Send Money to Account', 'Transfer money from wallet to account'],
    ['txns', 'Wallet Transactions', 'View your transactions on this account'], ['auto', 'Manage Auto-Load', 'Load money into your wallet automatically'],
    ['dl', 'Download Statement', 'Download last 6 months statement']];
  // Z and the navy lower band, traced from the card in the screenshot (card units)
  const Z = 'M83.5,39 L163.5,0 L203.5,0 L168.5,119 L312,89 L312,99 L121,164 L152,32.5 Z';
  scr.innerHTML = `<div class="bscr" data-name="Before – PayZapp Wallet">
    <div class="hdr"></div>
    <div class="sb-t">9:41</div><img class="sb-i" src="assets/statusbar-right.svg">
    <svg class="back" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 10H3m6-6-6 6 6 6"/></svg>
    <div class="ttl">PayZapp Wallet</div><div class="help">?</div>
    <div class="card" data-name="Before – Prepaid card">
      <svg width="312" height="198" viewBox="0 0 312 198"><path d="M0,152.5 L312,90 L312,198 L0,198 Z" fill="#004B8F"/><path d="${Z}" fill="#E61A23"/></svg>
      <div class="hdfc">HDFC BANK</div>
      <div class="pz"><i></i><span><span class="p">PAY</span><span class="z">ZAPP</span></span></div><div class="pre">PREPAID</div>
      <div class="num">1093&nbsp; 4012&nbsp; 4583&nbsp; 1002</div><div class="visa">VISA</div>
    </div>
    <div class="bbtn" style="left:24px"><svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.5 12 2.5 12S6.5 19 12 19s9.5-7 9.5-7S17.5 5 12 5z" fill="#fff"/><circle cx="12" cy="12" r="3.6" fill="#2F7BE0"/></svg>View details</div>
    <div class="bbtn" style="left:188px"><svg viewBox="0 0 24 24"><rect x="8" y="7" width="12" height="15" rx="2.5" fill="#fff"/><rect x="4" y="3" width="12" height="15" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/></svg>Copy number</div>
    <div class="sheet">
      <div class="wb">WALLET BALANCE</div><div class="wamt">₹500</div>
      <div class="wadd" data-name="Before – Add Money"><svg width="13" height="13" viewBox="0 0 13 13"><path d="M6.5 1v11M1 6.5h11" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>Add Money</div>
      <div class="div"></div>
      ${rows.map(([k, t, sub], i) => `<div class="row" style="top:${100 + i * 72}px"><i>${ICON[k]}</i><b>${t}</b><span>${sub}</span></div>`).join('')}
    </div>
  </div>`;
  keep.forEach((k) => scr.appendChild(k));
}
$('#phone').after(phoneB);
const shadowBEl = $('#floorShadow').cloneNode(true);
shadowBEl.id = 'floorShadowB'; shadowBEl.dataset.name = 'Floor shadow – Before';
$('#floorShadow').after(shadowBEl);
const phoneBefore = S(phoneB, { x: -1500, y: 0, z: 0, rotationX: 0, rotationY: 30, rotationZ: 0, autoAlpha: 0 });
const shadowB = S(shadowBEl, { x: 34 - 1500, y: 46, opacity: 0 });

// ---------------------------------------------------------------- UI components
// A component keeps its integrity: a tile, its glyph, its label and its badge travel together as one.
// Resting UI has no shadows (matches the design); a faint shadow exists only while a piece is in the air.
const BOX0 = '0px 22px 28px 0px rgba(25,55,85,0.12)', BOX1 = '0px 0px 0px 0px rgba(25,55,85,0)';
const DROP0 = 'drop-shadow(0px 14px 12px rgba(25,55,85,0.14))', DROP1 = 'drop-shadow(0px 0px 0px rgba(25,55,85,0))';
const nth = (el, sel) => $$(sel).indexOf(el);
const keyOf = (el) => {
  if (el.matches('.sb-time, .sb-icons')) return 'status';
  if (el.matches('.amount')) return 'balance';
  if (el.matches('.waves')) return 'waves';     // its own piece: fades in after the button, never shows through it
  for (const [sel, name] of [['.aicon', 'action'], ['.glyph', 'action'], ['.alabel', 'action'], ['.qicon', 'quick'], ['.qglyph', 'quick'], ['.qlabel', 'quick'], ['.rcard', 'reward']])
    if (el.matches(sel)) return `${name}-${nth(el, sel)}`;
  return el.className.replace('pc ', '').split(' ')[0];
};
const comps = [];
$$('.pc').forEach((el) => {
  const k = keyOf(el);
  let c = comps.find((x) => x.key === k);
  if (!c) comps.push((c = { key: k, grp: el.dataset.grp, parts: [] }));
  c.parts.push({ el, rest: +(el.dataset.z || 1), sh: el.dataset.sh || '' });
});
// Every component slides into place from a little below its spot, lifted slightly off the glass. The camera is
// orthographic, so the lift runs along the view direction: it never shifts where a piece appears on screen.
const SLIDE = 36, LIFTZ = 160, CAM_AT_BUILD = { rx: 30, rz: -20, ry: 12, s: 2.4, fx: 0, fy: -100 };
const m = new DOMMatrix(`scale(${CAM_AT_BUILD.s}) rotateX(${CAM_AT_BUILD.rx}deg) rotateZ(${CAM_AT_BUILD.rz}deg) rotateY(${CAM_AT_BUILD.ry}deg)`).inverse();
const VIEW = m.transformPoint(new DOMPoint(0, 0, 1, 0));            // toward the viewer, in the phone's coordinates
const vk = LIFTZ / VIEW.z;
comps.forEach((c) => { c.from = c.key === 'waves' ? { x: 0, y: 0, z: 0 } : { x: 0, y: SLIDE, z: 0 }; });   // content layer is clipped (flat): a straight slide up
comps.forEach((c) => c.parts.forEach((p) => {
  gsap.set(p.el, { x: c.from.x, y: c.from.y, z: p.rest + c.from.z, opacity: 0 });
  if (p.sh === 'box') gsap.set(p.el, { boxShadow: BOX0 });
  if (p.sh === 'drop') gsap.set(p.el, { filter: DROP0 });
}));

// ---------------------------------------------------------------- 1 · fly-in, spin, land; screen powers on
s.beat('phone.fly', { at: 0, dur: ARRIVE.dur, ease: ARRIVE.ease, note: 'Phone slides in from the bottom right, turning one full rotation, and lands' }, (b) =>
  phone.to(b, { x: 0, y: 0, rotationY: 0, rotationZ: 0 }));
s.beat('phone.shadow', { at: T.land - 16, dur: 26, ease: 'fade', note: 'Floor shadow arrives with it' }, (b) => b.fromTo('#floorShadow', { opacity: 0 }, { opacity: 1 }));

// ---------------------------------------------------------------- 2 · one camera move: zoom in
// zoom (scale only) and framing (vertical) are separate tweens, so nothing drives the same value twice
// fly-in, zoom and framing are one arrival: same start, same duration, same curve, so they land together
s.beat('cam.zoom', { at: 0, dur: ARRIVE.dur, ease: PUSH.ease, note: 'Camera pushes in with the fly-in; lands with it' }, (b) => cam.to(b, { s: 2.4 }));
s.beat('cam.frame', { at: 0, dur: ARRIVE.dur, ease: PUSH.ease, note: 'Framing settles on the top of the phone with the landing' }, (b) => cam.to(b, { fy: -270 }));
// the pan down eases in before the arrival has fully settled, so the motion hands off without a stop
s.beat('cam.travel', { at: ARRIVE.dur - 12, dur: 158, ease: [0.42, 0, 0.3, 1], note: 'Camera travels slowly down to the bottom of the screen' }, (b) => cam.to(b, { ty: 485 }));
s.beat('screen.scroll', { at: 64, dur: 118, ease: [0.4, 0, 0.3, 1], note: 'Screen scrolls up a little so the rewards / offer cards come into view' }, (b) => b.fromTo('#content', { y: 0 }, { y: -92 }));

gsap.set('.top-wash', { opacity: 0, y: -60 });
s.beat('screen.wash', { at: 54, dur: 14, ease: 'settle', note: 'The blue top area fades in just before the action tiles land' }, (b) =>
  b.fromTo('.top-wash', { opacity: 0, y: -60 }, { opacity: 1, y: 0 }));

// each section's components drop onto the screen, one after another, the same way
Object.entries(BUILD).forEach(([grp, at]) => {
  const list = comps.filter((c) => c.grp === grp).sort((a, b) => (a.key === 'waves') - (b.key === 'waves'));   // waves last
  s.beat(`fly.${grp}`, { at, dur: 18, stagger: 3, ease: [0.2, 0.7, 0.3, 1], note: `${grp}: components slide down into place, whole` }, (b) => list.forEach((c, i) => c.parts.forEach((p) => {
    b.fromTo(p.el, { x: c.from.x, y: c.from.y, z: p.rest + c.from.z }, { x: 0, y: 0, z: p.rest }, { i });
    b.fromTo(p.el, { opacity: 0 }, { opacity: p.el.matches('.waves') ? 0.65 : 1 }, { i, dur: p.el.matches('.waves') ? 14 : 5, ease: 'fade' });   // waves at the prototype's 65%
    if (p.sh === 'box') b.fromTo(p.el, { boxShadow: BOX0 }, { boxShadow: BOX1 }, { i });
    if (p.sh === 'drop') b.fromTo(p.el, { filter: DROP0 }, { filter: DROP1 }, { i });
  })));
});
// balance counts up as it lands
const amtR = $('.amount .r'), amtP = $('.amount .p');
s.onFrame((f) => {
  const cents = Math.round(24306 * outExpo(clamp01((f - s.beats['fly.balance'].f0 - 4) / 28)));
  amtR.textContent = `₹${Math.floor(cents / 100)}`;
  amtP.textContent = `.${String(cents % 100).padStart(2, '0')}`;
});

// ================================================================ Shot 2 · Showcase flips
// The phone flips a full turn while sliding to one side of the frame, and the camera frames one part of the
// UI per stop (from the case study): first the top — Cashpoints up top, Balance as the hero, Add Money as the
// hero CTA, Auto-Load right under it — then the payment actions (PIN-LESS / ₹0 FEE) and the soft nudge.
// each hold walks through its decisions one at a time; copy is the presentation's own (see CALLOUTS)
const BEAT = 70;                                   // frames per number (~2.8s)
// Before / After sits between the build and the flips
const BA = { start: 196, move: 50, labels: 246, out: 360 };   // starts as the pan settles on the offers (was 236)
const SH2 = { flip1: BA.out };   // the flip starts the same frame the old wallet starts leaving — one motion, not two
SH2.hold1 = SH2.flip1 + 54; SH2.end = SH2.hold1 + 3 * BEAT + 40;   // one flip, then the three numbers build a list beside the phone
const FLIP = { dur: 54, ease: [0.62, 0, 0.22, 1] };
// a sideways move on screen, expressed in the phone's world (the camera is rotated, orthographic)
const SHOW_VIEW = { rx: 12, rz: -8, ry: 4 };   // flatter than the build's three-quarter view, so the UI reads clearly
const camRot = new DOMMatrix(`rotateX(${SHOW_VIEW.rx}deg) rotateZ(${SHOW_VIEW.rz}deg) rotateY(${SHOW_VIEW.ry}deg)`).inverse();
const screenToWorld = (dx, dy, scale) => { const v = camRot.transformPoint(new DOMPoint(dx / scale, dy / scale, 0, 0)); return { x: v.x, y: v.y, z: v.z }; };
const STOPS = {
  left: { s: 2.35, d: [-540, 20], rotationY: 366, ty: 30, note: 'Flip 1 → left: close on the top — Earn (Cashpoints up top), Balance, Add Money, Auto-Load' },
  right: { s: 2.35, d: [-300, 20], rotationY: -6, ty: 230, note: 'Flip 2 (spins back the other way, staying on the left): close on the payment actions with PIN-LESS / ₹0 FEE' },
};
Object.values(STOPS).forEach((st) => Object.assign(st, screenToWorld(st.d[0], st.d[1], st.s)));
const shadow = S($('#floorShadow'), { x: 34, y: 46 });
const flipTo = (name, at) => {
  const st = STOPS[name];
  s.beat(`show.${name}`, { at, dur: FLIP.dur, ease: FLIP.ease, note: st.note }, (b) => {
    phone.to(b, { x: st.x, y: st.y, z: st.z, rotationY: st.rotationY });
    shadow.to(b, { x: 34 + st.x, y: 46 + st.y });
    cam.to(b, { s: st.s, ty: st.ty, ...SHOW_VIEW });
  });
};
// ================================================================ Before / After
// Zapp Account stands upright and slides right; the old PayZapp Wallet slides in on the left; both are labelled.
const BA_POS = 232, BA_VIEW = { rx: 0, rz: 0, ry: 0, s: 1.75, ty: 80 };   // close: big phones, bottoms run off the frame (it's a glance, not a side-by-side audit)   // camera straight on: both phones perfectly vertical
s.beat('ba.reframe', { at: BA.start, dur: BA.move, ease: 'move', note: 'Before/After: camera squares up; Zapp Account slides right, upright' }, (b) => {
  cam.to(b, BA_VIEW);
  phone.to(b, { x: BA_POS, y: 0, z: 0, rotationY: 0 });
  shadow.to(b, { x: 34 + BA_POS, y: 46 });
  b.fromTo('#content', { y: -92 }, { y: 0 }, { dur: 30 });                  // its screen scrolls back to the top
});
s.beat('ba.beforeIn', { at: BA.start + 10, dur: BA.move, ease: 'settle', note: 'The old PayZapp Wallet slides in on the left' }, (b) => {
  phoneBefore.to(b, { autoAlpha: 1 }, { dur: 1 });
  phoneBefore.to(b, { x: -BA_POS, rotationY: 0 });
  shadowB.to(b, { x: 34 - BA_POS, opacity: 1 });
});
const baLayer = document.createElement('div'); baLayer.id = 'baLabels'; $('#stage').appendChild(baLayer);
const baLabel = (title, sub, el) => {
  const d = document.createElement('div'); d.className = 'ba-label'; d.dataset.name = `Label – ${title}`;
  d.innerHTML = `<b>${title}</b>`; baLayer.appendChild(d); gsap.set(d, { opacity: 0, xPercent: -50, yPercent: -100 });
  return { d, el };
};
const baLabels = [baLabel('Before', 'PayZapp Wallet', phoneB), baLabel('After', 'Zapp Account', $('#phone'))];
s.beat('ba.labels', { at: BA.labels, dur: 16, stagger: 6, ease: 'settle', note: 'Before / After labels rise in above the phones' }, (b) =>
  b.each(baLabels.map((l) => l.d), { opacity: 0, y: 24 }, { opacity: 1, y: 0 }));
s.beat('ba.labelsOut', { at: BA.out - 6, dur: 12, ease: 'exit', note: 'Labels lift away' }, (b) =>
  b.fromTo(baLabels.map((l) => l.d), { opacity: 1, y: 0 }, { opacity: 0, y: -20 }));
s.beat('ba.beforeOut', { at: BA.out, dur: 36, ease: [0.4, 0, 0.75, 0.55], note: 'The old wallet slides out left; the flips take over' }, (b) => {
  phoneBefore.to(b, { x: -1150, rotationY: -180 });   // flips as it goes (mirrors the Zapp phone leaving right)
  shadowB.to(b, { x: 34 - 1150, opacity: 0 });
  phoneBefore.to(b, { autoAlpha: 0 }, { at: 35, dur: 1 });
});
const stageEl0 = $('#stage');
s.onFrame(() => {
  const sr = stageEl0.getBoundingClientRect(), k = sr.width / 1920;
  baLabels.forEach(({ d, el }) => {
    if (+getComputedStyle(d).opacity === 0) return;
    const r = el.getBoundingClientRect();
    Object.assign(d.style, { left: `${(r.left + r.width / 2 - sr.left) / k}px`, top: `${(r.top - sr.top) / k - 50}px` });
  });
}, 55);

// (no flip: from Before / After the phone flies straight off and the numbers take over)
// the grid recedes while the numbers are on screen, so the type reads cleanly
gsap.set('#grid', { opacity: 0.35 });   // the grid stays quiet for the whole film

// ---------------------------------------------------------------- callouts: one design decision at a time
// Headline + supporting line are word for word from the presentation; stats are the ones it pairs with them.
// Results only: one number per beat, while the camera keeps the part of the UI it relates to in focus (figures from the deck)
// one list, built top to bottom beside the phone; each card stays once it appears. The camera eases down a little
// with each card (ty), so the focus walks down the screen with the list.
// Each card: the number, two or three words, and a small chart that shows what the number means
// (case study: Apr–Sep 2025 growth ~1.5× loads / ~2.1× spends; 1 in 5 wallet loaders on Auto-Load, Jul 2025)
// The numbers stand on their own (no phone): a centred column of equal cards in the camera's world.
// Each new card is centred by the camera as it lands (ty); the summary squares up on the whole column.
const NUM_S = 2.1;   // camera scale while the numbers come in (straight on)
// card sizes are whole grid cells at that zoom, and the grid has a line through the world origin, so each card sits
// exactly on grid lines, centred, with the grid symmetric around it
const CELL = 60 * GRID_K * Math.pow(NUM_S, -GRID_DAMP);          // one grid cell in world px at NUM_S
const CARD = { w: 12 * CELL, h: 5 * CELL, gap: CELL };          // world px, fixed so the layout is known up front
const cardY = (i) => i * (CARD.h + CARD.gap) + (Math.round(CARD.h / CELL) % 2 ? CELL / 2 : 0);   // centre of card i; an odd cell count shifts half a cell so the edges stay on grid lines
const FY = -270;                                                // the camera's framing offset since the arrival (fy)
const tyFor = (yc) => yc - FY;                                  // camera travel that centres world y = yc on screen
const CALLOUTS = [
  { el: '.add-money', kicker: 'Loads', n: [1.5, 1, '×'], label: 'Monthly loads', viz: 'bars' },
  { el: '.auto-load', kicker: 'Auto-Load', n: [20, 0, '%'], label: '1 in 5 used <span class="nw">Auto-Load</span>', viz: 'people' },
  { el: '.aicon', kicker: 'Spends', n: [2.1, 1, '×'], label: 'Monthly spends increased', viz: 'bars' },
];
const BAR_H = 70;   // the April bar (1×); September is drawn at the multiple
const PERSON = '<svg viewBox="0 0 24 36"><circle cx="12" cy="7.5" r="6.5"/><path d="M1.5 35v-8.5C1.5 20 6 16.5 12 16.5S22.5 20 22.5 26.5V35z"/></svg>';
const vizHtml = (c) => c.viz === 'bars'
  ? `<div class="viz bars"><div class="col"><i class="bar apr" style="height:${BAR_H}px"></i><span>Apr</span></div><i class="chev" style="margin-bottom:${26 + BAR_H / 2 - 14}px"><svg viewBox="0 0 18 18"><path d="M6 3l6 6-6 6"/></svg></i><div class="col"><i class="bar sep" style="height:${BAR_H}px"></i><span>Sep</span></div></div>`
  : `<div class="viz people"><div class="group">${[0, 1, 2, 3, 4].map((k) => `<i class="pp p${k}${k === 3 ? ' on' : ''}">${PERSON}</i>`).join('')}</div></div>`   // a group of five: three behind, two in front; the highlighted one stands in front;
const pointerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
pointerSvg.id = 'pointers'; pointerSvg.setAttribute('viewBox', '0 0 1920 1200');
$('#stage').appendChild(pointerSvg);
const pointers = [];
const calloutLayer = document.createElement('div');
calloutLayer.id = 'callouts';
$('#stage').appendChild(calloutLayer);
const callout = (side, c, i, at) => {
  const el = document.createElement('div');
  el.className = `co co-${side}`; el.dataset.name = `Callout – ${c.kicker}`;
  Object.assign(el.style, { width: `${CARD.w}px`, height: `${CARD.h}px` });
  el.innerHTML = `<div class="txt"><b class="num">0</b><span class="lbl">${c.label}</span></div>${vizHtml(c)}`;
  el.dataset.first = String(c.n[0])[0];
  $('#world3').appendChild(el);   // a copy of the camera's world above the vignette, so the type isn't dimmed
  const numEl = el.querySelector('.num'), [nv, dp, unit] = c.n;
  const barB = el.querySelector(".bar.sep"), firstP = el.querySelector('.pp.on');
  s.onFrame((f) => {   // counts up; the chart fills with it (September's bar grows from April's height; the one person fills in)
    const p = Math.max(0, Math.min(1, (f - at - 4) / 26)), e = 1 - Math.pow(1 - p, 3);
    numEl.innerHTML = (nv * e).toFixed(dp) + `<span class="u">${unit}</span>`;
    if (barB) barB.style.height = `${BAR_H * (1 + (nv - 1) * e)}px`;
    if (firstP) firstP.style.setProperty('--fill', e.toFixed(3));
  });   // counts up   // lives on the grid surface, in the scene's own perspective (placed each frame below)
  const parts = [numEl, el.querySelector('.lbl'), el.querySelector('.viz')];
  const bg = document.createElement('i'); bg.className = 'co-bg'; el.prepend(bg);   // the box, as its own layer so it can grow by transform
  gsap.set(el, { opacity: 0 }); gsap.set(parts, { opacity: 0, y: 16 });
  gsap.set([...parts, bg], { transformOrigin: '0% 0%' }); el.style.transformOrigin = '0 50%';   // the card grows from its left-middle (its anchor)
  // pointer: a line from the card to the element it talks about, with a ring on the element
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.innerHTML = '<path class="case" pathLength="1"/><path pathLength="1"/><circle class="case" r="9"/><circle r="9"/>';
  pointerSvg.appendChild(g);
  const kids = [...g.children], line = [kids[0], kids[1]], ring = [kids[2], kids[3]];
  gsap.set(g, { opacity: 0 }); gsap.set(line, { attr: { 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 } }); gsap.set(ring, { scale: 0, transformOrigin: '50% 50%', transformBox: 'fill-box' });
  const off = { x: 0, y: 40 };   // slide offset (world px, along the surface) — added to the per-frame placement
  pointers.push({ el, g, line, ring, off, target: document.querySelector(c.el), side, bg });
  s.beat(`number.${c.kicker.toLowerCase().replace(/\W+/g, '-')}`, { at, dur: 16, stagger: 5, ease: 'settle', note: `Number: ${c.label}` }, (b) => {
    // the box opens out from the phone's side, then its type rises in
    // in: the box slides up into place as it fades in; its number and label follow, one after the other
    b.fromTo(off, { y: 40 }, { y: 0 }, { dur: 18, ease: 'settle' });
    // fade the box layer itself, not the card: a fading parent would switch the backdrop blur off until it reaches 1 (a visible pop)
    b.fromTo(el, { opacity: 0 }, { opacity: 1 }, { dur: 1 });
    b.fromTo(bg, { opacity: 0 }, { opacity: 1 }, { dur: 12, ease: 'fade' });
    b.each(parts, { opacity: 0, y: 18 }, { opacity: 1, y: 0 }, { at: 6, dur: 16, ease: 'settle' });
    // no pointer line: the number is plain type beside the phone
    // it stays: the cards build up into a list
    if (i) cam.to(b, { ty: tyFor(cardY(i)) }, { at: -6, dur: 30, ease: 'move' });   // pan only: centre the new card
    else cam.to(b, { ty: tyFor(cardY(0)), s: NUM_S }, { at: PHONE_OFF - NUM0, dur: 52, ease: 'move' });   // pans down with the phones leaving, onto the first card   // straight on, like Before / After: a gentle push and pan onto the first card
    // point at the element it talks about: the camera eases toward it, the element gives a small pop
  });
};
const PHONE_OFF = BA.out;      // the phone flies off the same frame the old wallet starts leaving
const NUM0 = PHONE_OFF + 14;   // lands toward the end of the phones' exit   // first number lands as the phone clears the centre
CALLOUTS.forEach((c, i) => callout('left', c, i, NUM0 + i * BEAT));
// (no summary zoom-out: after the last number holds, the cards slide off and the film loops)
// The phone leaves as the numbers begin: it flies on out through the top left, turning, while card 1 lands.
// It stays out (the same spot the loop needs), so the loop out only has the cards and the camera to settle.
s.beat('phone.out', { at: PHONE_OFF, dur: 36, ease: [0.4, 0, 0.75, 0.55], note: 'Before / After split apart: the Zapp phone slides out right, flipping, as the old wallet goes left' }, (b) => {
  phone.to(b, { x: 1150, y: 0, z: 0, rotationY: 180 });   // out to the right, flipping: the mirror of the old wallet leaving left
  // once it is out of frame, park it (unseen) at its first-frame spot below the frame, so the loop ends exactly where it starts
  phone.to(b, { x: PHONE0.x, y: PHONE0.y, z: 0, rotationY: -360, rotationZ: 18 }, { at: 37, dur: 1 });
  shadow.to(b, { x: 34 + 1150, y: 46 });
  b.fromTo('#floorShadow', { opacity: 1 }, { opacity: 0 }, { dur: 16, ease: 'fade' });
});
// ================================================================ Loop out
// Everything leaves so the last frame is the first frame again: the cards slide off to the right, the phone
// goes back out the way it came in (bottom right, one more full turn), and the camera returns to its opening view.
// The phone's exit curve mirrors its arrival (ends as fast as the arrival starts) so the loop point has no hitch.
const EXIT = NUM0 + 2 * BEAT + 64;   // the last number lands, holds, then everything clears
const LOOP_EASE = [0.7, 0, 0.78, 0.4];   // the arrival curve [0.22, 0.6, 0.3, 1], reversed in time
s.beat('loop.cards', { at: EXIT, dur: 24, stagger: 4, ease: 'exit', note: 'The three cards slide off to the right' }, (b) =>
  pointers.forEach((p, i) => {
    b.fromTo(p.off, { x: 0 }, { x: 1600 }, { at: i * 4 });
    b.fromTo(p.el, { opacity: 1 }, { opacity: 0 }, { at: i * 4 + 23, dur: 1 });   // gone once off screen (no fade: a fading card loses its blur)
  }));
s.beat('loop.camera', { at: EXIT + 4, dur: ARRIVE.dur, ease: [0.7, 0, 0.45, 1], note: 'Camera eases back to the opening view as the cards clear (the push-in, reversed)' }, (b) =>
  cam.to(b, { rx: CAM.rx0, rz: CAM.rz0, ry: CAM.ry0, s: CAM.s0, fx: 0, fy: 0, ty: 0, ny: 0 }));
// the cards sit at fixed spots in a centred column on the world plane; the camera does the framing
s.onFrame(() => pointers.forEach((p, i) => {
  p.el.style.transform = `translate3d(${-CARD.w / 2 + p.off.x}px, ${cardY(i) - CARD.h / 2 + p.off.y}px, 0)`;
}), 60);
// the second flip also lets the last left-hand nudge go
// (no camera nudges during the holds: the camera stays still while each number is up)

// the floor shadow narrows with the phone as it turns (a face-sized shadow behind an edge-on phone reads as a dark band)
const phoneEl = $('#phone');
s.onFrame(() => {
  const ry = (gsap.getProperty(phoneEl, 'rotationY') * Math.PI) / 180;
  gsap.set('#floorShadow', { scaleX: Math.max(0.1, Math.abs(Math.cos(ry))) });
});

// animated waves: the prototype's Lottie, stepped by the frame so preview and export match
const waveAnims = [...document.querySelectorAll('.waves .w')].map((container) => window.lottie.loadAnimation({
  container, renderer: 'svg', loop: true, autoplay: false, path: 'assets/waveSlowed.json',
  rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
}));
await Promise.all(waveAnims.map((a) => new Promise((ok) => (a.isLoaded ? ok() : a.addEventListener('DOMLoaded', ok)))));
s.onFrame((f) => waveAnims.forEach((a) => a.goToAndStop(((f / s.fps) * 60) % a.totalFrames, true)));   // Lottie runs at 60fps

// optical left edge: shift each number so its first glyph's ink lines up with the label's first glyph
await Promise.all([700, 800].map((w) => document.fonts.load(`${w} 20px ManropeLocal`)));
{
  const c = document.createElement('canvas').getContext('2d');
  const inkLeft = (el, text) => { const cs = getComputedStyle(el); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return -c.measureText(text).actualBoundingBoxLeft; };
  pointers.forEach((p) => {
    const num = p.el.querySelector('.num'), lbl = p.el.querySelector('.lbl');
    // align the label with the number's upright stroke, not the 1's flag (the flag pokes out ~0.17em to the left)
    const d = inkLeft(num, '1') - inkLeft(lbl, lbl.textContent[0]);
    num.style.marginLeft = `${-d}px`;
    if (p.el.dataset.first === '1') lbl.style.marginLeft = `${0.12 * parseFloat(getComputedStyle(num).fontSize)}px`;
  });
}
// the before screen uses Inter (as the real app does): make sure it has loaded before any frame is captured
await Promise.all([400, 500, 600, 700, 800].flatMap((w) => [document.fonts.load(`${w} 16px InterLocal`), document.fonts.load(`${w} 16px InterRupee`, '₹')]));
s.ready({ tail: -1 });   // loop: the last frame is one step before the first frame's state (which equals frame 0), so the seam doesn't repeat a frame
