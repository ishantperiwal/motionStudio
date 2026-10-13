// Inbox v2 — animatic (take 2). Feature explainer built around the product's own story:
// the shared address → a new message (focus mode) → assign → hand-off in chat → payoff.
// 1920x1080 · 25 fps · ~19 s. World coordinates = the app window (sits at 100,50 on stage).
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';
import { camera } from '@studio/kits/camera.js';
import { cursor } from '@studio/kits/cursor.js';
import { sketch, shotHud } from '@studio/kits/sketch.js';

const s = await studio({ id: 'inbox-v2-animatic', width: 1920, height: 1080, fps: 25 });
const $ = (q) => document.querySelector(q);
const world = $('#world');
const sk = sketch(world, { seed: 7 });
const BLUE = '#2170F4', ORANGE = '#F2711C', INK = '#2b2b2b', PAPER = '#ffffff';
const ADDRESS = 'support@acme.com';

// ---------------------------------------------------------------- shot list
const shots = [
  { id: 'address', at: 0, dur: 80, title: 'The shared address', onscreen: '', action: 'The team’s address writes itself in, then flies to the top of the inbox list as the mail app opens around it.' },
  { id: 'arrive', at: 80, dur: 70, title: 'New message', onscreen: 'A new message lands', action: 'Message slides in; camera punches in and everything else dims away (focus mode).' },
  { id: 'assign', at: 150, dur: 80, title: 'Assign', onscreen: 'Assign it in one click', action: 'Priya opens the pill and picks Leena; the pill pops to “Leena”.' },
  { id: 'handoff', at: 230, dur: 40, title: 'To the chat', onscreen: '', action: 'Cursor heads for the chat while the camera eases out and the thread fades back in.' },
  { id: 'chat', at: 270, dur: 105, title: 'Loop in', onscreen: 'Loop in your teammate', titleTop: true, action: 'Punch in on the chat box; Priya types “@Leena…”, sends — camera pulls out as the message springs up.' },
  { id: 'payoff', at: 375, dur: 50, title: 'Owned', onscreen: 'Every ticket, owned.', titleTop: true, action: 'Leena is typing… “Okay, I’ll take this up.”' },
  { id: 'end', at: 425, dur: 50, title: 'End card', onscreen: '', action: 'Logo + line.' },
];
shotHud(s, $('#stage'), shots);
const shot = Object.fromEntries(shots.map((x) => [x.id, x]));

// ---------------------------------------------------------------- the world (rough wireframe of an email client)
// Wide shots should read as a real mail app: sidebar with folders, search, a list of
// actual messages and a reading pane. Close-ups focus on one thing at a time.
const appBase = sk.group(world, 'Window');
sk.rect(appBase, 0, 0, 1720, 980, { r: 14, fill: PAPER, roughness: 0.6 });
sk.rect(appBase, 0, 0, 1720, 40, { fill: '#2a2a2a', roughness: 0.4 });
[22, 44, 66].forEach((x, i) => sk.circle(appBase, x, 20, 12, { fill: ['#ff5f57', '#febc2e', '#28c840'][i], stroke: 'none' }));

const topbar = sk.group(world, 'Top bar');
sk.rect(topbar, 290, 56, 560, 40, { r: 10, fill: '#f2f2f2', stroke: '#d6d6d6' });
sk.circle(topbar, 312, 76, 16, { stroke: '#999', strokeWidth: 2 });
sk.text(topbar, 332, 83, 'Search mail', { size: 18, color: '#999' });
[1600, 1640, 1680].forEach((x, i) => sk.circle(topbar, x, 76, 30, { fill: ['#f3c6a5', '#b9d0f5', '#c9e7c3'][i], stroke: '#999' }));
sk.line(topbar, 260, 112, 1720, 112, { strokeWidth: 1.4, stroke: '#cfcfcf' });

// list header: the shared address the whole film lives in
const chip = sk.group(world, 'Address – list header');
sk.rect(chip, 284, 133, 30, 22, { r: 4, fill: BLUE, stroke: BLUE });
sk.path(chip, 'M288,137 L299,146 L310,137', { stroke: '#fff', strokeWidth: 2 });
const chipText = sk.text(chip, 326, 154, ADDRESS, { size: 26, color: '#1f1f20' });
sk.text(chip, 868, 152, '12 open', { size: 16, color: '#999', anchor: 'end' });

const listHead = sk.group(world, 'Pane dividers');
sk.line(listHead, 900, 112, 900, 980, { strokeWidth: 1.4, stroke: '#cfcfcf' });
const paneBar = sk.group(world, 'Reading pane toolbar');
[924, 962, 1000, 1038].forEach((x) => sk.rect(paneBar, x, 126, 24, 24, { r: 6, fill: '#e3e3e3', stroke: '#c9c9c9' }));
sk.text(paneBar, 1680, 145, '1 of 12', { size: 16, color: '#999', anchor: 'end' });

const avatar = (g, cx, cy, d, color, letter) => {
  sk.circle(g, cx, cy, d, { fill: color, stroke: color });
  sk.text(g, cx, cy + d * 0.2, letter, { size: Math.round(d * 0.5), anchor: 'middle', color: '#fff' });
};
const assigneePill = (g, xr, y, name, color) => {
  const w = 30 + name.length * 10;
  sk.rect(g, xr - w, y, w, 28, { r: 14, fill: PAPER, stroke: '#cfcfcf' });
  sk.circle(g, xr - w + 15, y + 14, 16, { fill: color, stroke: color });
  sk.text(g, xr - w + 28, y + 20, name, { size: 15 });
};
const people = { Mei: '#2FA84F', Rohan: '#8B5CF6', Leena: BLUE, Priya: ORANGE };
const inbox = [
  ['Mei Tan', 'Can’t log in after password reset', '9:41', 'Mei'],
  ['Rohan Das', 'Payout delayed since Monday', '9:12', 'Rohan'],
  ['Ava Lee', 'Invoice PDF downloads blank', 'Yesterday', 'Mei'],
  ['Noah Kim', 'Webhook returns 500 errors', 'Yesterday', 'Rohan'],
  ['Liam Wu', 'Refund not showing in statement', 'Mon', 'Leena'],
];
const oldRows = inbox.map(([from, subj, time, who], i) => {
  const g = sk.group(world, `Row – ${subj}`);
  const y = 190 + i * 126;
  sk.rect(g, 276, y, 608, 110, { r: 12, fill: '#f6f6f6', stroke: '#d4d4d4' });
  avatar(g, 312, y + 36, 32, ['#c58b63', '#7f8ea8', '#b07cc6', '#6aa38c', '#c9a14a'][i], from[0]);
  sk.text(g, 338, y + 43, from, { size: 20, color: '#333' });
  sk.text(g, 868, y + 42, time, { size: 15, color: '#999', anchor: 'end' });
  sk.text(g, 300, y + 80, subj, { size: 18, color: '#666' });
  assigneePill(g, 868, y + 64, who, people[who]);
  return g;
});

const row = sk.group(world, 'Row – Duplicate charge');
sk.rect(row, 276, 190, 608, 110, { r: 12, fill: '#e8f0ff', stroke: INK, strokeWidth: 2.4 });
avatar(row, 312, 226, 32, '#7C8DA6', 'D');
sk.text(row, 338, 233, 'Daniel Kim', { size: 20, color: '#333' });
sk.text(row, 868, 232, 'Now', { size: 15, color: BLUE, anchor: 'end' });
const dot = sk.group(row, 'Unread dot');
sk.circle(dot, 820, 226, 14, { fill: BLUE, stroke: BLUE });
sk.text(row, 300, 272, 'Duplicate charge on invoice #2048', { size: 22 });
const pill = sk.group(row, 'Pill – Assignee');
const pillA = sk.group(pill, 'Pill – Not assigned');
sk.rect(pillA, 732, 252, 136, 32, { r: 16, fill: PAPER });
sk.text(pillA, 800, 274, 'Not assigned ▾', { size: 16, anchor: 'middle' });
const pillB = sk.group(pill, 'Pill – Leena');
sk.rect(pillB, 764, 252, 104, 32, { r: 16, fill: '#eef3ff', stroke: BLUE });
sk.circle(pillB, 782, 268, 18, { fill: BLUE, stroke: BLUE });
sk.text(pillB, 826, 274, 'Leena', { size: 17, anchor: 'middle', color: BLUE });

// sidebar drawn after the list so new rows slide in from underneath it
const sidebar = sk.group(world, 'Sidebar');
sk.rect(sidebar, 0, 40, 260, 940, { fill: '#2f2f31', stroke: '#2f2f31', roughness: 0.4 });
sk.rect(sidebar, 24, 58, 30, 22, { r: 4, fill: BLUE, stroke: BLUE });
sk.text(sidebar, 64, 78, 'ACME', { size: 24, color: '#fff' });
sk.rect(sidebar, 24, 106, 212, 44, { r: 12, fill: BLUE, stroke: BLUE });
sk.text(sidebar, 130, 135, '✎  Compose', { size: 19, anchor: 'middle', color: '#fff' });
sk.rect(sidebar, 14, 172, 232, 40, { r: 10, fill: '#47474b', stroke: 'none' });
[['Inbox', '12'], ['Assigned to me', '3'], ['Sent', ''], ['Drafts', '2'], ['Archive', '']].forEach(([n, c], i) => {
  sk.rect(sidebar, 30, 183 + i * 48, 18, 18, { r: 4, fill: '#8a8a8e', stroke: 'none' });
  sk.text(sidebar, 60, 199 + i * 48, n, { size: 19, color: i === 0 ? '#fff' : '#c9c9cc' });
  if (c) sk.text(sidebar, 230, 199 + i * 48, c, { size: 16, color: '#9a9aa0', anchor: 'end' });
});
sk.text(sidebar, 30, 452, 'TEAMS', { size: 14, color: '#8a8a8e' });
[['Support', '#E5484D'], ['Billing', '#F3AD5E'], ['Sales', '#36AE22']].forEach(([n, c], i) => {
  sk.circle(sidebar, 39, 482 + i * 40, 14, { fill: c, stroke: c });
  sk.text(sidebar, 60, 488 + i * 40, n, { size: 19, color: '#c9c9cc' });
});

const menu = sk.group(world, 'Dropdown – Assign');
sk.rect(menu, 648, 296, 220, 200, { r: 12, fill: PAPER, strokeWidth: 2.2 });
const hover = sk.group(menu, 'Hover – Leena');
sk.rect(hover, 656, 306, 204, 42, { r: 8, fill: '#eef3ff', stroke: 'none' });
[['Leena', BLUE], ['Priya (you)', ORANGE], ['Rohan', '#8B5CF6'], ['Mei', '#2FA84F']].forEach(([n, c], i) => {
  sk.circle(menu, 680, 327 + i * 44, 22, { fill: c, stroke: c });
  sk.text(menu, 700, 334 + i * 44, n, { size: 20 });
});
const check = sk.group(menu, 'Check – Leena');
sk.path(check, 'M828,327 l7,7 l13,-14', { stroke: BLUE, strokeWidth: 3 });

// reading pane: empty at first, the thread fades in at the hand-off
const empty = sk.group(world, 'Empty state');
sk.rect(empty, 1240, 470, 140, 96, { r: 12, fill: '#f4f4f4', stroke: '#cfcfcf' });
sk.path(empty, 'M1254,486 L1310,524 L1366,486', { stroke: '#bdbdbd', strokeWidth: 3 });
sk.text(empty, 1310, 610, 'Select a message', { size: 18, color: '#aaa', anchor: 'middle' });

const thread = sk.group(world, 'Thread');
const tTitle = sk.group(thread, 'Thread title');
sk.text(tTitle, 940, 206, 'Duplicate charge on invoice #2048', { size: 26 });
const tCard = sk.group(thread, 'Card – Daniel email');
sk.rect(tCard, 940, 226, 740, 180, { r: 12, fill: PAPER });
avatar(tCard, 980, 266, 40, '#7C8DA6', 'D');
sk.text(tCard, 1012, 266, 'Daniel Kim', { size: 21 });
sk.text(tCard, 1012, 288, 'daniel.kim@gmail.com → support@acme.com', { size: 14, color: '#999' });
sk.text(tCard, 970, 334, 'Hi, I was charged twice for invoice #2048 on 4 Oct,', { size: 18, color: '#444' });
sk.text(tCard, 970, 362, '$149 each time. Could you please refund the duplicate?', { size: 18, color: '#444' });
const tEvent = sk.group(thread, 'Event – assigned');
sk.circle(tEvent, 1194, 438, 16, { fill: ORANGE, stroke: ORANGE });
sk.text(tEvent, 1210, 444, 'Priya assigned this to Leena', { size: 18, color: '#777' });
const tInput = sk.group(thread, 'Chat box');
const inputBox = sk.rect(tInput, 940, 880, 740, 62, { r: 16, fill: PAPER, stroke: '#bbb' });
const inputFocus = sk.rect(tInput, 940, 880, 740, 62, { r: 16, fill: 'none', stroke: BLUE, strokeWidth: 3.2 });
const placeholder = sk.text(tInput, 970, 920, 'Chat with your team…', { size: 20, color: '#aaa' });
const sendBtn = sk.group(tInput, 'Send button');
sk.circle(sendBtn, 1648, 911, 38, { fill: BLUE, stroke: BLUE });
sk.path(sendBtn, 'M1648,922 L1648,901 M1640,909 L1648,901 L1656,909', { stroke: '#fff', strokeWidth: 3 });

// typed message, one tspan per character
const MSG = '@Leena can you take this up?';
const typed = sk.text(tInput, 970, 920, '', { size: 22 });
const chars = [...MSG].map((ch) => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan'); t.textContent = ch; typed.appendChild(t); return t; });

const bubble = (name, y, color, letter, w) => {
  const g = sk.group(world, name);
  avatar(g, 962, y + 25, 40, color, letter);
  sk.rect(g, 996, y, w, 50, { r: 18, fill: '#f1f1f1', stroke: '#cfcfcf' });
  return g;
};
const sent = bubble('Chat – Priya', 742, ORANGE, 'P', 380);
sk.text(sent, 1016, 775, '', { size: 22 }).innerHTML = `<tspan fill="${BLUE}">@Leena</tspan> can you take this up?`;
const typing = sk.group(world, 'Typing indicator');
sk.circle(typing, 962, 833, 40, { fill: BLUE, stroke: BLUE });
const tdots = [0, 1, 2].map((i) => sk.circle(typing, 1006 + i * 18, 833, 11, { fill: '#999', stroke: 'none' }));
const okay = bubble('Chat – Leena', 808, BLUE, 'L', 300);
sk.text(okay, 1016, 841, 'Okay, I’ll take this up.', { size: 22 });

const endSk = sketch($('#endcard .box'), { seed: 99 });
const eb = $('#endcard .box');
endSk.rect(eb, 8, 8, 144, 94, { r: 14, fill: BLUE, stroke: BLUE });
endSk.path(eb, 'M24,28 L80,64 L136,28', { stroke: '#fff', strokeWidth: 6 });

// ---------------------------------------------------------------- camera + cursor
const VIEWS = {
  reveal: { x: 860, y: 490, zoom: 1.15 },
  full: { x: 860, y: 490, zoom: 1 },
  row: { x: 590, y: 250, zoom: 2.0 },
  pill: { x: 730, y: 340, zoom: 2.0 },
  mid: { x: 900, y: 520, zoom: 1.2 },
  chat: { x: 1215, y: 740, zoom: 1.9 },
  chatOut: { x: 1060, y: 620, zoom: 1.45 },
};
const cam = camera(s, $('#cam'), { origin: { x: 100, y: 50 }, start: 'reveal', views: VIEWS });
const P = cursor($('#cursors'), { name: 'Priya', from: '#FFB26B', to: ORANGE, x: 1500, y: 1150 }).tilt(s);

// where the list header's address sits on screen at the "reveal" framing — the hero lands there
const bb = chipText.getBBox(), v = VIEWS.reveal;
const land = { x: 960 + (bb.x + bb.width / 2 - v.x) * v.zoom, y: 540 + (bb.y + bb.height / 2 - v.y) * v.zoom };
const heroAddr = $('#hero .addr');
heroAddr.innerHTML = [...ADDRESS].map((c) => `<i>${c}</i>`).join('');
const heroScale = (26 * v.zoom) / 112;

// ---------------------------------------------------------------- initial state
const appParts = [appBase, sidebar, topbar, listHead, paneBar, empty, ...oldRows];
gsap.set(appParts, { opacity: 0 });
gsap.set(chip, { opacity: 0 });
gsap.set(row, { x: -640, opacity: 0 });
gsap.set([pillB, menu, check, tTitle, tCard, tInput, tEvent, sent, typing, okay, '#endcard', inputFocus, typed], { opacity: 0 });
gsap.set(heroAddr, { xPercent: -50, yPercent: -50 });
gsap.set(pillA, { opacity: 1 });
gsap.set(menu, { scaleY: 0.2, transformOrigin: '50% 0%' });
gsap.set(hover, { opacity: 0 });
gsap.set([sent, okay], { transformOrigin: '0% 100%' });
gsap.set(pill, { transformOrigin: '50% 50%' });
gsap.set('#title', { opacity: 0 });
gsap.set('#hero .addr i', { opacity: 0, y: 40 });
gsap.set('#hero .sub', { opacity: 0 });

// on-screen title placeholders
const titleText = $('#title span');
shots.filter((x) => x.onscreen).forEach((x) => s.beat(`title.${x.id}`, { at: x.at + 6, dur: 10, ease: 'settle' }, (b) => {
  b.fromTo('#title', { opacity: 0, y: 24 }, { opacity: 1, y: 0 });
  b.fromTo('#title', { opacity: 1 }, { opacity: 0 }, { at: x.dur - 14, dur: 6, ease: 'fade' });
}));
const titleEl = $('#title');
s.onFrame((f) => {
  const x = shots.find((k) => f >= k.at && f < k.at + k.dur);
  titleText.textContent = x?.onscreen || '';
  titleEl.style.top = x?.titleTop ? '96px' : 'auto';            // keep the title off the chat box
  titleEl.style.bottom = x?.titleTop ? 'auto' : '132px';
});

// ---------------------------------------------------------------- 1 · the address
s.beat('address.write', { at: 4, dur: 14, stagger: 1, ease: 'overshoot', note: 'Address writes itself in, letter by letter' },
  (b) => b.each('#hero .addr i', { opacity: 0, y: 40, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)' }));
s.beat('address.sub', { after: 'address.write', overlap: 0.6, dur: 12, ease: 'fade' }, (b) => b.fromTo('#hero .sub', { opacity: 0, y: 12 }, { opacity: 1, y: 0 }));
s.beat('address.fly', { at: 42, dur: 20, ease: 'whip', note: 'Flies (on an arc) to its place in the top-right' }, (b) => {
  b.fromTo('#hero .sub', { opacity: 1 }, { opacity: 0 }, { dur: 6, ease: 'fade' });
  b.fromTo(heroAddr, { left: 960 }, { left: land.x });
  b.fromTo(heroAddr, { top: 500 }, { top: land.y }, { ease: 'snap' });   // different x/y curves = an arc
  b.fromTo(heroAddr, { scale: 1 }, { scale: heroScale });
});
s.beat('address.land', { after: 'address.fly', gap: -2, dur: 6, ease: 'fade' }, (b) => {
  b.fromTo(chip, { opacity: 0 }, { opacity: 1 }, { dur: 3 });
  b.fromTo(heroAddr, { opacity: 1 }, { opacity: 0 }, { at: 2, dur: 4 });
});
s.beat('address.reveal', { after: 'address.land', gap: -2, dur: 22, stagger: 2, ease: 'settle', note: 'App builds in around it as the camera eases out' }, (b) => {
  cam.to(b, 'full', { dur: 26, ease: 'move' });
  b.each(appParts, { opacity: 0, y: 18 }, { opacity: 1, y: 0 }, { dur: 14 });
});

// ---------------------------------------------------------------- 2 · new message + focus mode
const others = [appBase, sidebar, topbar, chip, listHead, paneBar, empty, ...oldRows];
s.beat('arrive.shift', { at: shot.arrive.at, dur: 12 }, (b) => b.each(oldRows, { y: 0 }, { y: 126 }, { i: 0 }));
s.beat('arrive.slide', { after: 'arrive.shift', overlap: 0.5, dur: 16, ease: 'settle' }, (b) => b.fromTo(row, { x: -640, opacity: 0 }, { x: 0, opacity: 1 }));
s.beat('arrive.punch', { after: 'arrive.slide', overlap: 0.4, dur: 16, ease: 'whip', note: 'Punch in on the message' }, (b) => cam.to(b, 'row'));
s.beat('arrive.focus', { with: 'arrive.punch', offset: 4, dur: 14, ease: 'fade', note: 'Everything else dims away' },
  (b) => b.fromTo(others, { opacity: 1, filter: 'blur(0px)' }, { opacity: 0.12, filter: 'blur(3px)' }));
s.beat('arrive.dot', { after: 'arrive.punch', dur: 14, ease: 'fade' }, (b) => {
  b.fromTo(dot, { scale: 1 }, { scale: 1.7 }, { dur: 6 });
  b.fromTo(dot, { scale: 1.7 }, { scale: 1 }, { at: 6, dur: 8 });
});

// ---------------------------------------------------------------- 3 · assign
s.beat('assign.in', { at: shot.assign.at, dur: 14, note: 'Nudge toward the pill; Priya arrives' }, (b) => { cam.to(b, 'pill'); P.move(b, 846, 276); });
s.beat('assign.click', { after: 'assign.in', gap: 2, dur: 9 }, (b) => P.click(b));
s.beat('assign.open', { with: 'assign.click', offset: 2, dur: 10, ease: 'snap' }, (b) => b.fromTo(menu, { opacity: 0, scaleY: 0.2 }, { opacity: 1, scaleY: 1 }));
s.beat('assign.hover', { after: 'assign.open', gap: 2, dur: 10 }, (b) => { P.move(b, 812, 336); b.fromTo(hover, { opacity: 0 }, { opacity: 1 }, { at: 6, dur: 4, ease: 'fade' }); });
s.beat('assign.pick', { after: 'assign.hover', gap: 4, dur: 9 }, (b) => { P.click(b); b.fromTo(check, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }, { at: 1, dur: 7, ease: 'overshoot' }); });
s.beat('assign.swap', { after: 'assign.pick', gap: -2, dur: 16, ease: 'snap', note: 'Menu snaps shut; pill pops to Leena with a bump' }, (b) => {
  b.fromTo(menu, { opacity: 1, scaleY: 1 }, { opacity: 0, scaleY: 0.85 }, { dur: 6 });
  b.fromTo(pillA, { opacity: 1 }, { opacity: 0 }, { dur: 5, ease: 'fade' });
  b.fromTo(pillB, { opacity: 0 }, { opacity: 1 }, { at: 3, dur: 6, ease: 'fade' });
  b.fromTo(pill, { scale: 1 }, { scale: 1.18 }, { at: 3, dur: 5, ease: 'snap' });
  b.fromTo(pill, { scale: 1.18 }, { scale: 1 }, { at: 8, dur: 8, ease: 'overshoot' });
});

// ---------------------------------------------------------------- 4 · hand-off to the chat
s.beat('handoff.move', { at: shot.handoff.at, dur: 32, note: 'Cursor heads for the chat; camera eases out' }, (b) => { cam.to(b, 'mid'); P.move(b, 1500, 912); });
s.beat('handoff.unfocus', { with: 'handoff.move', offset: 2, dur: 18, ease: 'fade', note: 'Everything fades back in' },
  (b) => b.fromTo(others.filter((g) => g !== empty), { opacity: 0.12, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }));
s.beat('handoff.thread', { with: 'handoff.move', offset: 6, dur: 14, stagger: 3, ease: 'settle', note: 'Thread builds in, assignment event last' }, (b) => {
  b.fromTo(empty, { opacity: 0.12 }, { opacity: 0 }, { dur: 6, ease: 'fade' });
  b.each([tTitle, tCard, tInput, tEvent], { opacity: 0, y: 16 }, { opacity: 1, y: 0 });
});

// ---------------------------------------------------------------- 5 · chat
s.beat('chat.punch', { at: shot.chat.at, dur: 14, ease: 'whip', note: 'Punch in on the chat box' }, (b) => cam.to(b, 'chat'));
s.beat('chat.click', { after: 'chat.punch', gap: 2, dur: 9 }, (b) => {
  P.click(b);
  b.fromTo(inputFocus, { opacity: 0 }, { opacity: 1 }, { at: 1, dur: 4, ease: 'fade' });
  b.fromTo(placeholder, { opacity: 1 }, { opacity: 0 }, { at: 3, dur: 3, ease: 'fade' });
  b.set(typed, { opacity: 1 }, 3);
});
s.beat('chat.type', { with: 'chat.click', offset: 6, dur: 40, note: 'Fast typing; the mention turns blue' }, (b) => b.track(typed));
s.beat('chat.send', { after: 'chat.type', gap: 4, dur: 30, note: 'Send — camera pulls out while the message springs up' }, (b) => {
  b.fromTo(sendBtn, { scale: 1 }, { scale: 0.8 }, { dur: 3, ease: 'fade' });
  b.fromTo(sendBtn, { scale: 0.8 }, { scale: 1 }, { at: 3, dur: 6, ease: 'overshoot' });
  b.fromTo(typed, { opacity: 1 }, { opacity: 0 }, { at: 2, dur: 3, ease: 'fade' });
  b.fromTo(placeholder, { opacity: 0 }, { opacity: 1 }, { at: 5, dur: 6, ease: 'fade' });
  b.fromTo(inputFocus, { opacity: 1 }, { opacity: 0 }, { at: 4, dur: 6, ease: 'fade' });
  b.fromTo(sent, { opacity: 0, y: 130, scaleY: 0.7 }, { opacity: 1, y: 0, scaleY: 1 }, { at: 2, dur: 14, ease: 'overshoot' });
  cam.to(b, 'chatOut', { at: 2, dur: 28, ease: 'move' });
  P.move(b, 1820, 1120, { at: 6, dur: 22, ease: 'exit' });
  P.fade(b, 1, 0, { at: 10, dur: 14, ease: 'fade' });
});
gsap.set(sendBtn, { transformOrigin: '50% 50%' });
gsap.set(sent, { transformOrigin: '0% 100%' });
gsap.set(pill, { transformOrigin: '50% 50%' });
gsap.set(dot, { transformOrigin: '50% 50%' });
gsap.set([check], { transformOrigin: '50% 50%' });

// typing: chars revealed on an uneven rhythm; the mention turns blue once complete
const B = s.beats;
const kt = (() => { let t = 0; return [...MSG].map((c, i) => (t += i === 0 ? 0 : (c === ' ' ? 1.6 : 1) * (0.75 + ((i * 37) % 10) / 20))); })();
const ktMax = kt[kt.length - 1];
s.onFrame((f) => {
  const bt = B['chat.type'], n = kt.filter((t) => bt.f0 + (t / ktMax) * bt.dur <= f).length;
  chars.forEach((c, i) => { c.style.visibility = i < n ? 'visible' : 'hidden'; c.setAttribute('fill', i < 6 && n >= 6 ? BLUE : INK); });
  tdots.forEach((d, i) => { d.style.opacity = (Math.floor(f / 4) % 4) > i ? 1 : 0.25; });
});

// ---------------------------------------------------------------- 6 · payoff
s.beat('payoff.typing', { at: shot.payoff.at, dur: 18, ease: 'fade' }, (b) => {
  b.fromTo(typing, { opacity: 0 }, { opacity: 1 }, { dur: 4 });
  b.fromTo(typing, { opacity: 1 }, { opacity: 0 }, { at: 14, dur: 4 });
});
s.beat('payoff.okay', { after: 'payoff.typing', gap: -3, dur: 14, ease: 'overshoot', note: 'Leena replies — the payoff beat' },
  (b) => b.fromTo(okay, { opacity: 0, y: 30, scaleY: 0.7 }, { opacity: 1, y: 0, scaleY: 1 }));

// ---------------------------------------------------------------- 7 · end card
s.beat('end.card', { at: shot.end.at, dur: 12, ease: 'fade' }, (b) => b.fromTo('#endcard', { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1 }));

s.ready();
