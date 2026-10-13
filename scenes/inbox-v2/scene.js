// Inbox v2 — shared-inbox feature explainer (final). Built on the approved animatic's
// shots and timings (scenes/inbox-v2-animatic): address → new message (focus) → assign →
// hand-off → chat → payoff → end card. 1920x1080 · 25 fps · 19 s.
// Window space: the app window sits at (100, 50) on stage, 1720x980.
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';
import { camera } from '@studio/kits/camera.js';
import { cursor } from '@studio/kits/cursor.js';
import { typer } from '@studio/kits/typing.js';

const s = await studio({ id: 'inbox-v2', width: 1920, height: 1080, fps: 25 });
const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => [...r.querySelectorAll(q)];
const BLUE = '#2170F4', ORANGE = '#F2711C', ROHAN = '#8B5CF6', MEI = '#2FA84F', DANIEL = '#7C8DA6';
const ADDRESS = 'support@acme.com';

// ---------------------------------------------------------------- shots (same timings as the animatic)
const shots = [
  { id: 'address', at: 0, dur: 100 },
  { id: 'arrive', at: 100, dur: 70 },
  { id: 'assign', at: 170, dur: 112 },
  { id: 'handoff', at: 258, dur: 40 },
  { id: 'chat', at: 298, dur: 115 },
  { id: 'payoff', at: 413, dur: 68 },
  { id: 'end', at: 481, dur: 50 },
];
const shot = Object.fromEntries(shots.map((x) => [x.id, x]));

// ---------------------------------------------------------------- markup helpers
function av(letter, color, d) {
  // optical centring for "L": its mass sits bottom-left, so lift it 4% and keep it ~1% right of the box centre
  const nudge = letter === 'L' ? `transform:translate(${(0.01 * d).toFixed(2)}px,${(-0.01 * d).toFixed(2)}px)` : '';   // measured: ink mass centred, slightly lifted
  return `<span class="av" style="width:${d}px;height:${d}px;background:${color};font-size:${Math.round(d * 0.46)}px"><b style="${nudge}">${letter}</b></span>`;
}
const chev = `<svg width="16" height="16" viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="#5F6368" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const check = `<svg width="20" height="20" viewBox="0 0 14 14"><path d="M2.5 7.3 5.6 10.2 11.5 3.8" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const envelope = (w, h, fill = BLUE) => `<svg width="${w}" height="${h}" viewBox="0 0 30 22"><rect x=".5" y=".5" width="29" height="21" rx="4" fill="${fill}"/><path d="M4 5 15 13 26 5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const words = (text) => text.split(' ').map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
const dot = (d, c) => `<span class="av" style="width:${d}px;height:${d}px;background:${c}"></span>`;   // avatar with no letter

// Illustrative layout: only the subjects are real text in the list; the rest is skeleton.
const ROW_Y = 236, ROW_H = 148, ROW_STEP = 166;   // 20px of breathing room under the chips
const inbox = [
  ['Can’t log in after password reset', 'Mei', MEI, 360, 230],
  ['Payout delayed since Monday', 'Rohan', ROHAN, 390, 250],
  ['Invoice PDF downloads blank', 'Mei', MEI, 340, 210],
  ['Webhook returns 500 errors', 'Rohan', ROHAN, 380, 240],
];

$('#win').innerHTML = `
  <div class="a titlebar"><div class="a tl-dot" style="left:20px;background:#FF5F57"></div><div class="a tl-dot" style="left:44px;background:#FEBC2E"></div><div class="a tl-dot" style="left:68px;background:#28C840"></div></div>
  <div id="listBody" class="a">
    ${inbox.map(([subj, who, wc, w1, w2], i) => `
      <div class="row old" style="top:${ROW_Y + i * ROW_STEP}px" data-name="Row – ${subj}">
        <div class="cb"></div><div class="subj">${subj}</div><div class="bar date"></div>
        <div class="bar l1" style="width:${w1}px"></div><div class="bar l2" style="width:${w2}px"></div>
        <div class="chip">${av(who[0], wc, 30)}${who}${chev}</div>
      </div>`).join('')}
    <div class="row" id="rowNew" style="top:${ROW_Y}px" data-name="Row – Duplicate charge">
      <div class="cb"></div><div class="subj">Duplicate charge on invoice #2048</div><span class="udot" data-name="Unread dot"></span><div class="bar date"></div>
      <div class="bar l1" style="width:330px"></div><div class="bar l2" style="width:220px"></div>
      <div class="pill" data-name="Pill – Assignee">
        <div class="pill-l na" id="pillA"><span>Not assigned</span>${chev}</div>
        <div class="pill-l" id="pillB" style="opacity:0">${av('L', BLUE, 30)}<span>Leena</span>${chev}</div>
      </div>
    </div>
  </div>
  <div id="sidebar" class="a" data-name="Sidebar">
    <div class="a" style="left:26px;top:24px">${envelope(46, 34)}</div><div class="bar" style="left:88px;top:34px;width:110px;height:16px;background:#4A4A4E"></div>
    <div class="a folder on" style="top:108px"><i></i>Inbox<span class="count"></span></div>
    ${[150, 110, 130, 96].map((w, i) => `<div class="a folder" style="top:${176 + i * 64}px"><i></i><span class="bar" style="width:${w}px"></span></div>`).join('')}
    ${[['#E5484D', 110], ['#F3AD5E', 90], ['#36AE22', 100]].map(([c, w], i) =>
      `<div class="a" style="left:34px;top:${488 + i * 52}px;display:flex;align-items:center;gap:16px"><span style="width:16px;height:16px;border-radius:50%;background:${c}"></span><span class="bar" style="position:static;width:${w}px;height:14px;background:#3E3E42"></span></div>`).join('')}
  </div>
  <div id="topbar" class="a" data-name="Top bar">
    <div class="a search"><div class="a" style="left:18px;top:14px;width:24px;height:24px;border-radius:50%;border:3px solid #C3C8CF"></div><div class="bar" style="left:56px;top:19px;width:240px;height:14px;background:#DDE0E4"></div></div>
    <div class="a" style="right:30px;top:18px;display:flex;gap:10px">${dot(48, '#F3C6A5')}${dot(48, '#B9D0F5')}${dot(48, '#C9E7C3')}</div>
  </div>
  <div id="listHead" class="a" data-name="Address – list header">
    <div class="a addr-icon">${envelope(46, 34)}</div>
    <div class="a addr-text">${ADDRESS}</div>
  </div>
  <div class="a vline" style="left:1000px;top:128px;height:852px"></div>
  <div id="paneBar" class="a" data-name="Reading pane toolbar">
    ${[38, 80, 122, 164].map((x) => `<div class="sq" style="left:${x}px"></div>`).join('')}
  </div>
  <div id="empty" class="a" data-name="Empty state">
    <svg width="180" height="128" viewBox="0 0 140 100"><rect x="2" y="2" width="136" height="92" rx="12" fill="#F5F6F8" stroke="#D5D9DE" stroke-width="2.5"/><path d="M16 18 70 56 124 18" fill="none" stroke="#C3C8CF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  <div id="thread" class="a">
    <div class="a t-title" id="tTitle">Duplicate charge on invoice #2048</div>
    <div class="a card" id="tCard" data-name="Card – Daniel email">
      ${dot(52, DANIEL)}<div class="nm">Daniel Kim</div><div class="bar" style="left:96px;top:72px;width:220px;height:12px"></div>
      <div class="bar" style="left:28px;top:118px;width:560px"></div><div class="bar" style="left:28px;top:146px;width:500px"></div><div class="bar" style="left:28px;top:174px;width:260px;opacity:.7"></div>
    </div>
    <div class="a event" id="tEvent" data-name="Event – assigned">${av('P', ORANGE, 30)}<span>Priya assigned this to</span><span style="margin-left:4px;display:flex">${av('L', BLUE, 30)}</span><span>Leena</span></div>
    <div class="a msg" id="msgP" style="top:604px" data-name="Chat – Priya">${av('P', ORANGE, 52)}<div class="bubble"><span class="mention">@Leena</span> can you take this up?</div></div>
    <div class="a msg" id="typingInd" style="top:690px" data-name="Typing indicator"><span style="margin:0 9px">${av('L', BLUE, 34)}</span><div class="typing">Leena is typing<i>.</i><i>.</i><i>.</i></div></div>
    <div class="a msg" id="msgL" style="top:690px" data-name="Chat – Leena">${av('L', BLUE, 52)}<div class="bubble">Okay, I’ll take this up.</div></div>
    <div id="chat" class="a" data-name="Chat box">
      <div class="ph">Chat with your team…</div>
      <div class="tline" id="tlA"><div class="typed"></div></div>
      <div class="sendc" id="sendc"><svg width="22" height="22" viewBox="0 0 18 18"><path d="M9 14V4M4.5 8.5 9 4l4.5 4.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    </div>
  </div>
  <div id="dd" class="a" data-name="Dropdown – Assign"><div class="dd-in">
    <div id="ddHover" class="dd-hv" style="opacity:0"></div>
    ${[['Leena', 'L', BLUE], ['Priya', 'P', ORANGE], ['Rohan', 'R', ROHAN], ['Mei', 'M', MEI]].map(([n, l, c], i) =>
      `<div class="dd-it">${av(l, c, 34)}<span>${n}</span>${i === 0 ? `<span class="chk" id="chkLeena" style="opacity:0">${check}</span>` : ''}</div>`).join('')}
  </div></div>`;

// dropdown hangs under the pill, right-aligned with it
const pill = $('#rowNew .pill');
const wA = $('#pillA').offsetWidth + 4, wB = $('#pillB').offsetWidth + 4;   // + borders
pill.style.width = wA + 'px';
const PILL_R = 320 + 660 - 22, PILL_B = ROW_Y + 84 + 46;
const DD_H = 8 + 4 * 54 + 8 + 4;
Object.assign($('#dd').style, { left: (PILL_R - 290) + 'px', top: (PILL_B + 10) + 'px' });

// per-shot kinetic titles
$('#titles').innerHTML = shots.filter((x) => x.title).map((x) => `<div class="ttl${x.top ? ' top' : ''}" id="t-${x.id}" data-name="Title – ${x.title}"><span>${words(x.title)}</span></div>`).join('');
$('#endcard .name').innerHTML = words('Titan Shared Inbox');
$('#endcard .line').innerHTML = words('Every ticket, owned.');

// ---------------------------------------------------------------- camera, cursor, typing
// The opening hero *is* the list header: the camera starts tight on the address and pulls
// out, so the address arrives at its place in the inbox without any swap or shrink.
const winR = $('#win').getBoundingClientRect();
const hr = [$('#listHead .addr-icon'), $('#listHead .addr-text')].map((e) => e.getBoundingClientRect());
const heroC = { x: (hr[0].left + hr[1].right) / 2 - winR.left, y: (hr[1].top + hr[1].bottom) / 2 - winR.top };
const VIEWS = {
  hero: { x: heroC.x, y: heroC.y, zoom: 2.9 },
  full: { x: 860, y: 490, zoom: 1 },
  row: { x: 650, y: 310, zoom: 1.75 },
  pill: { x: 820, y: 455, zoom: 2.1 },
  mid: { x: 900, y: 520, zoom: 1.1 },
  chat: { x: 1200, y: 700, zoom: 1.7 },
  chatOut: { x: 1080, y: 600, zoom: 1.35 },
};
const cam = camera(s, $('#cam'), { origin: { x: 100, y: 50 }, start: 'hero', views: VIEWS });
const P = cursor($('#cursors'), { name: 'Priya', from: '#FFB26B', to: ORANGE, x: 1500, y: 1150, tagSize: 21, showTag: false }).tilt(s);   // name tag hidden for now (set showTag: true to bring it back)
const MSG = '@Leena can you take this up?';
const typ = typer($('#tlA .typed'), MSG, { seed: 5, caretH: 30 });
$('#hero .addr').remove();

// ---------------------------------------------------------------- initial state
const rowNew = $('#rowNew'), oldRows = $$('.row.old');
const shell = ['.titlebar', '#sidebar', '#topbar', '#paneBar', '#empty', '.vline', ...oldRows];
$('#hero').remove();   // no subline: the address alone opens the film
gsap.set('#winFrame', { opacity: 0 });
gsap.set(shell, { opacity: 0 });
gsap.set(['#listHead .addr-icon', '#listHead .addr-text'], { opacity: 0 });
gsap.set(rowNew, { x: -700, opacity: 0 });
gsap.set(['#tTitle', '#tCard', '#tEvent', '#chat', '#msgP', '#typingInd', '#msgL', '#endcard', '.ttl'], { opacity: 0 });
gsap.set('#dd', { height: 0, opacity: 0 });
gsap.set(['#msgP', '#msgL'], { transformOrigin: '0% 100%' });
gsap.set('.ttl .w > span, #endcard .w > span', { yPercent: 110 });

// ---------------------------------------------------------------- titles: words rise in, card fades out at the shot's end
for (const x of shots.filter((k) => k.title)) {
  s.beat(`title.${x.id}`, { at: x.at + 6, dur: 14, stagger: 2, ease: 'settle', note: `On-screen title: ${x.title}` }, (b) => {
    b.fromTo(`#t-${x.id}`, { opacity: 0, y: 16, scale: 0.97 }, { opacity: 1, y: 0, scale: 1 }, { dur: 10, ease: 'snap' });
    b.each(`#t-${x.id} .w > span`, { yPercent: 110 }, { yPercent: 0 });
    b.fromTo(`#t-${x.id}`, { opacity: 1, y: 0 }, { opacity: 0, y: -10 }, { at: x.dur - 14, dur: 7, ease: 'fade' });
  });
}

// ---------------------------------------------------------------- 1 · the address
// the icon arrives alone at the centre, then slides left and the address slides out from
// behind it — the text is masked at the icon's right edge, so it emerges from the icon
const iconDX = heroC.x - (hr[0].left + hr[0].width / 2 - winR.left);
const textW = hr[1].width, gapIT = hr[1].left - hr[0].right;
const textX0 = iconDX - textW - gapIT;
gsap.set('#listHead .addr-icon', { x: iconDX });
gsap.set('#listHead .addr-text', { x: textX0 });
s.beat('address.icon', { at: 2, dur: 12, ease: 'snap', note: 'Email icon pops in alone, centred, and overshoots big' },
  (b) => b.fromTo('#listHead .addr-icon', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1.3 }));
s.beat('address.reveal', { after: 'address.icon', gap: 2, dur: 20, ease: 'move', note: 'Icon settles back to size while it slides left; the address slides out from behind it' }, (b) => {
  b.fromTo('#listHead .addr-icon', { x: iconDX, scale: 1.3 }, { x: 0, scale: 1 });
  b.fromTo('#listHead .addr-text', { x: textX0, opacity: 1 }, { x: 0, opacity: 1 });
});
const addrIcon = $('#listHead .addr-icon'), addrText = $('#listHead .addr-text');
s.onFrame(() => {
  // mask edge = the icon's visible right edge, including its overshoot scale
  const iconRightGrow = (gsap.getProperty(addrIcon, 'scale') - 1) * hr[0].width / 2;
  const hidden = Math.max(0, gsap.getProperty(addrIcon, 'x') + iconRightGrow - gsap.getProperty(addrText, 'x') - gapIT);
  addrText.style.clipPath = hidden > 0.5 ? `inset(-20% -5% -20% ${hidden}px)` : 'none';
});
s.beat('address.pull', { at: 46, dur: 40, ease: 'move', note: 'Camera pulls out: the address travels to the top of the list as the mail app builds in' }, (b) => {
  cam.to(b, 'full');
  b.fromTo('#winFrame', { opacity: 0 }, { opacity: 1 }, { at: 8, dur: 16, ease: 'fade' });
});
s.beat('address.build', { with: 'address.pull', offset: 14, dur: 16, stagger: 2, ease: 'settle', note: 'App builds in around the address' }, (b) => {
  b.each(['.titlebar', '#sidebar', '#topbar', '.vline', '#paneBar', '#empty'], { opacity: 0, y: 14 }, { opacity: 1, y: 0 });
  // rows slide up + fade in, one after another. yPercent (not y), because y belongs to "arrive.shift"
  b.each(oldRows, { opacity: 0, yPercent: 30 }, { opacity: 1, yPercent: 0 }, { i: 5, dur: 18 });
});

// ---------------------------------------------------------------- 2 · new message, focus mode
const others = ['.titlebar', '#sidebar', '#topbar', '#listHead', '#paneBar', '#empty', '.vline', ...oldRows];
s.beat('arrive.shift', { at: shot.arrive.at + 2, dur: 12 }, (b) => oldRows.forEach((r) => b.fromTo(r, { y: 0 }, { y: ROW_STEP })));
s.beat('arrive.slide', { after: 'arrive.shift', overlap: 0.5, dur: 16, ease: 'settle', note: 'Slides in from under the sidebar' }, (b) => {
  b.fromTo(rowNew, { opacity: 0 }, { opacity: 1 }, { at: -1, dur: 1, ease: 'none' });
  b.fromTo(rowNew, { x: -700 }, { x: 0 });
});
s.beat('arrive.punch', { after: 'arrive.slide', gap: 10, dur: 36, ease: 'move', note: 'One move: zoom in on the message while Priya floats in to the pill' }, (b) => { cam.to(b, 'pill'); P.move(b, PILL_R - 30, PILL_B - 16); });
s.beat('arrive.focus', { with: 'arrive.punch', offset: 4, dur: 14, ease: 'fade', note: 'Everything else dims away' },
  (b) => b.fromTo(others, { opacity: 1, filter: 'blur(0px)' }, { opacity: 0.14, filter: 'blur(3px)' }));

// ---------------------------------------------------------------- 3 · assign
s.beat('assign.click', { after: 'arrive.punch', gap: 6, dur: 9 }, (b) => P.click(b));
s.beat('assign.open', { with: 'assign.click', offset: 2, dur: 14, ease: 'snap', note: 'Dropdown grows down from the pill' }, (b) => {
  b.fromTo('#dd', { height: 0 }, { height: DD_H });
  b.fromTo('#dd', { opacity: 0 }, { opacity: 1 }, { dur: 3, ease: 'fade' });
});
s.beat('assign.hover', { after: 'assign.open', gap: 8, dur: 16 }, (b) => { P.move(b, PILL_R - 80, PILL_B + 10 + 8 + 30); b.fromTo('#ddHover', { opacity: 0 }, { opacity: 1 }, { at: 10, dur: 5, ease: 'fade' }); });
s.beat('assign.pick', { after: 'assign.hover', gap: 10, dur: 9 }, (b) => { P.click(b); b.fromTo('#chkLeena', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }, { at: 1, dur: 7, ease: 'overshoot' }); });
s.beat('assign.swap', { after: 'assign.pick', gap: 4, dur: 20, ease: 'snap', note: 'Menu snaps shut; the pill pops to Leena' }, (b) => {
  b.fromTo('#dd', { opacity: 1, y: 0 }, { opacity: 0, y: -6 }, { dur: 6 });
  b.fromTo(pill, { width: wA }, { width: wB }, { at: 2, dur: 10 });
  b.fromTo('#pillA', { opacity: 1 }, { opacity: 0 }, { dur: 5, ease: 'fade' });
  b.fromTo('#pillB', { opacity: 0 }, { opacity: 1 }, { at: 3, dur: 6, ease: 'fade' });
  b.fromTo(pill, { scale: 1 }, { scale: 1.16 }, { at: 3, dur: 5 });
  b.fromTo(pill, { scale: 1.16 }, { scale: 1 }, { at: 8, dur: 8, ease: 'overshoot' });
});

// ---------------------------------------------------------------- 4 · hand-off
s.beat('handoff.move', { at: shot.handoff.at, dur: 32, note: 'Camera eases out as the thread opens' }, (b) => { cam.to(b, 'mid'); P.move(b, 905, ROW_Y + ROW_H + 6); });   // rest in the gap between rows, off any text
s.beat('handoff.unfocus', { with: 'handoff.move', offset: 2, dur: 18, ease: 'fade', note: 'Everything fades back in' },
  (b) => b.fromTo(others.filter((o) => o !== '#empty'), { opacity: 0.14, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }));
s.beat('handoff.thread', { with: 'handoff.move', offset: 6, dur: 14, stagger: 3, ease: 'settle', note: 'Thread opens; the assignment event lands last' }, (b) => {
  b.fromTo('#empty', { opacity: 0.14 }, { opacity: 0 }, { dur: 6, ease: 'fade' });
  b.fromTo(rowNew, { backgroundColor: '#EEF4FF' }, { backgroundColor: '#E6EFFF' }, { dur: 8, ease: 'fade' });
  b.fromTo('#rowNew .udot', { opacity: 1 }, { opacity: 0 }, { dur: 8, ease: 'fade' });
  b.each(['#tTitle', '#tCard', '#chat', '#tEvent'], { opacity: 0, y: 16 }, { opacity: 1, y: 0 });
});

// ---------------------------------------------------------------- 5 · chat
s.beat('chat.punch', { at: shot.chat.at, dur: 28, ease: 'move', note: 'Punch in on the chat box; the cursor flies there with the camera' }, (b) => { cam.to(b, 'chat'); P.move(b, 1520, 912); });
s.beat('chat.focus', { with: 'chat.punch', offset: 4, dur: 16, ease: 'fade', note: 'Focus on the chat: everything else dims away, like the new-message focus' },
  (b) => b.fromTo(['.titlebar', '#sidebar', '#topbar', '#listHead', '#paneBar', '.vline', ...oldRows, rowNew, '#tTitle', '#tCard'],
    { opacity: 1, filter: 'blur(0px)' }, { opacity: 0.14, filter: 'blur(3px)' }));
s.beat('chat.click', { after: 'chat.punch', gap: 2, dur: 9 }, (b) => P.click(b).track('#chat'));
s.beat('chat.type', { with: 'chat.click', offset: 6, dur: 40, note: 'Fast typing; the mention turns blue' }, (b) => { typ.schedule(b.f0, b.f0 + b.dur); b.track('#chat'); });
s.beat('chat.send', { after: 'chat.type', gap: 4, dur: 30, note: 'Send — camera pulls out while the message springs up' }, (b) => {
  b.fromTo('#sendc', { scale: 1 }, { scale: 0.82 }, { dur: 3, ease: 'fade' });
  b.fromTo('#sendc', { scale: 0.82 }, { scale: 1 }, { at: 3, dur: 7, ease: 'overshoot' });
  b.fromTo('#msgP', { opacity: 0, y: 90, scaleY: 0.7 }, { opacity: 1, y: 0, scaleY: 1 }, { at: 2, dur: 16, ease: 'overshoot' });   // lands right under the assigned label
  cam.to(b, 'chatOut', { at: 2, dur: 28, ease: 'move' });
  P.move(b, 1820, 1120, { at: 6, dur: 22, ease: 'exit' });
  P.fade(b, 1, 0, { at: 10, dur: 14, ease: 'fade' });
});

// ---------------------------------------------------------------- 6 · payoff
s.beat('payoff.typing', { at: shot.payoff.at, dur: 36, ease: 'fade', note: 'Leena is typing… held ~1.4 s' }, (b) => {
  b.fromTo('#typingInd', { opacity: 0 }, { opacity: 1 }, { dur: 4 });
  b.fromTo('#typingInd', { opacity: 1 }, { opacity: 0 }, { at: 32, dur: 4 });
});
s.beat('payoff.okay', { after: 'payoff.typing', gap: -3, dur: 14, ease: 'overshoot', note: 'Leena replies — the payoff' },
  (b) => b.fromTo('#msgL', { opacity: 0, y: 30, scaleY: 0.7 }, { opacity: 1, y: 0, scaleY: 1 }));

// ---------------------------------------------------------------- 7 · end card
s.beat('end.card', { at: shot.end.at, dur: 12, ease: 'fade' }, (b) => b.fromTo('#endcard', { opacity: 0 }, { opacity: 1 }));
s.beat('end.mark', { with: 'end.card', offset: 4, dur: 16, ease: 'overshoot' }, (b) => b.fromTo('#endcard .mark', { scale: 0.5, opacity: 0, rotation: -8 }, { scale: 1, opacity: 1, rotation: 0 }));
s.beat('end.words', { with: 'end.card', offset: 8, dur: 14, stagger: 3, ease: 'settle', note: 'Name, then the line' },
  (b) => b.each('#endcard .w > span', { yPercent: 110 }, { yPercent: 0 }));

// ---------------------------------------------------------------- per-frame state
const B = s.beats;
s.onFrame((f) => {
  const focus = [B['chat.click'].f0, B['chat.send'].f0 + 2];
  const on = f >= focus[0] && f < focus[1];
  $('#tlA').style.display = on ? 'flex' : 'none';
  const n = on ? typ.render(f, true, focus[0]) : 0;
  typ.spans.slice(0, 6).forEach((sp) => sp.classList.toggle('mention', n >= 6));
  $('#chat .ph').style.visibility = on && n > 0 ? 'hidden' : 'visible';   // placeholder until the first keystroke
  $('#sendc').style.background = on && n > 0 ? BLUE : '#C9D8F2';
  $('#chat').style.borderColor = on ? BLUE : '#DDDDDD';
  $('#chat').style.boxShadow = on ? '0 0 0 3px rgba(33,112,244,.14)' : 'none';
  $$('#typingInd i').forEach((d, i) => { d.style.opacity = (Math.floor(f / 5) % 4) > i ? 1 : 0.15; });
});

s.ready({ tail: 25 });   // hold the end card for a second
