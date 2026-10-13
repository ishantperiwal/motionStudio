// Shared inbox: Priya assigns an email to Leena, they chat, Leena replies to the customer.
// 1920x1080 · 25 fps. Coordinates below are in window space (window sits at 100,50 on stage).
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';
import { camera } from '@studio/kits/camera.js';
import { cursor } from '@studio/kits/cursor.js';
import { typer } from '@studio/kits/typing.js';

const s = await studio({ id: 'inbox', width: 1920, height: 1080, fps: 25 });
const $ = (q) => document.querySelector(q);
const BLUE = '#2170F4', ORANGE = '#F2711C', ROHAN = '#8B5CF6', MEI = '#2FA84F', DANIEL = '#7C8DA6';

// ---------------------------------------------------------------- markup
function av(letter, color, d) {
  // optical centring: "L" reads right-heavy and low, nudge it left 4% / up 2% of the diameter
  const nudge = letter === 'L' ? `transform:translate(${(-0.04 * d).toFixed(2)}px,${(-0.02 * d).toFixed(2)}px)` : '';
  return `<span class="av" style="width:${d}px;height:${d}px;background:${color};font-size:${Math.round(d * 0.46)}px"><b style="${nudge}">${letter}</b></span>`;
}
const chev = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const check = `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 7.3 5.6 10.2 11.5 3.8" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

$('#sideSk').innerHTML = [96, 70, 84, 112].map((w, k) => `
  <div class="a side-item" style="top:${220 + 48 * k}px">
    <div class="sq" style="left:16px;top:11px;width:18px;height:18px;background:#4A4A4E"></div>
    <div class="bar" style="left:46px;top:14px;width:${w}px;height:12px;background:#3E3E42"></div>
  </div>`).join('');

const rowHTML = (id, subject, chipHTML, w1, w2, unread) => `<div class="row" id="${id}">
    <div class="cb"></div>
    <div class="subj">${subject}${unread ? '<span class="udot"></span>' : ''}</div>
    <div class="bar date"></div>
    <div class="bar l1" style="width:${w1}px"></div>
    <div class="bar l2" style="width:${w2}px"></div>
    <div class="chip">${chipHTML}</div>
  </div>`;
const chipFor = (name, color) => `<div class="chip-l">${av(name[0], color, 20)}<span>${name}</span>${chev}</div>`;
const existing = [
  ['Can’t log in after password reset', 'Mei', MEI, 360, 230],
  ['Payout delayed since Monday', 'Rohan', ROHAN, 390, 250],
  ['Invoice PDF downloads blank', 'Mei', MEI, 340, 210],
  ['Webhook returns 500 errors', 'Rohan', ROHAN, 380, 240],
  ['Refund not showing in statement', 'Mei', MEI, 350, 220],
];
$('#listBody').innerHTML =
  rowHTML('rowNew', 'Duplicate charge on invoice #2048',
    `<div class="chip-l na" id="chipA"><span>Not assigned</span>${chev}</div>
     <div class="chip-l" id="chipB" style="opacity:0">${av('L', BLUE, 20)}<span>Leena</span>${chev}</div>`, 370, 236, true) +
  existing.map((r, i) => rowHTML('row' + i, r[0], chipFor(r[1], r[2]), r[3], r[4], false)).join('');
document.querySelectorAll('#listBody .row').forEach((el, i) => { el.style.top = (15 + Math.max(0, i - 1) * 154) + 'px'; });

const ddPeople = [['Leena', 'L', BLUE], ['Priya (you)', 'P', ORANGE], ['Rohan', 'R', ROHAN], ['Mei', 'M', MEI]];
$('#ddItems').innerHTML =
  ddPeople.map(([n, l, c], i) => `<div class="dd-it">${av(l, c, 24)}<span>${n}</span>${i === 0 ? `<span class="chk" id="chkLeena" style="opacity:0">${check}</span>` : ''}</div>`).join('') +
  `<div class="dd-dv"></div><div class="dd-it"><span class="dash"></span><span>Unassigned</span><span class="chk" id="chkUn">${check}</span></div>`;

const footReply = `<div class="pill">Reply</div><div class="pill-sk"></div><div class="ft-r"></div>`;
$('#email').innerHTML = `
  <div class="hd">${av('D', DANIEL, 44)}<div class="nm">Daniel Kim</div>
    <div class="bar" style="left:84px;top:58px;width:190px;height:12px"></div>
    <div class="tm">9:12 AM</div></div>
  <div class="bd" style="height:90px">Hi, I was charged twice for invoice #2048 on 4 Oct, $149 each time. Could you please refund the duplicate charge?<br>Thanks, Daniel</div>
  <div class="sp"></div><div class="dv"></div>
  <div class="ft"><div class="ft-l">${footReply}</div></div>`;
$('#event').innerHTML = `${av('P', ORANGE, 20)}<span>Priya assigned this to Leena</span>`;
$('#msgA').innerHTML = `${av('P', ORANGE, 40)}<div class="bubble"><span class="mention">@Leena</span> can you take this up?</div>`;
$('#typingInd').innerHTML = `${av('L', BLUE, 40)}<div class="typing">Leena is typing<i>.</i><i>.</i><i>.</i></div>`;
$('#msgB').innerHTML = `${av('L', BLUE, 40)}<div class="bubble">Okay, I’ll take this up.</div>`;
$('#msgC').innerHTML = `${av('L', BLUE, 40)}<div class="bubble">Priya, all taken care of.</div>`;
$('#compose').innerHTML = `
  <div class="hd">${av('L', BLUE, 44)}<div class="nm">Leena</div><div class="sub">to Daniel Kim</div>
    <div class="tm" id="cDraft">Draft</div><div class="tm" id="cTime" style="opacity:0">10:46 AM</div></div>
  <div class="bd" id="cBody"><div class="typed"></div></div>
  <div class="sp"></div><div class="dv" id="cDiv" style="opacity:0"></div>
  <div class="ft">
    <div class="ft-l" id="cSendBar"><div class="btn-send" id="cSend">Send</div><span class="ic"></span><span class="ic"></span><span class="ic"></span><div class="ft-r"></div></div>
    <div class="ft-l" id="cReplyBar" style="opacity:0">${footReply}</div>
  </div>`;

// names the editor shows when you point at things
const name = (sel, n) => document.querySelectorAll(sel).forEach((e) => { e.dataset.name = n; });
name('#win', 'Window'); name('#sidebar', 'Sidebar'); name('#rowNew', 'Row – Duplicate charge'); name('#rowNew .chip', 'Pill – Assignee');
name('#dd', 'Dropdown – Assign'); name('#email', 'Card – Daniel email'); name('#compose', 'Composer / Card – Leena reply');
name('#chat', 'Chat box'); name('#event', 'Event – assigned'); name('#msgA', 'Chat – Priya'); name('#msgB', 'Chat – Leena 1');
name('#msgC', 'Chat – Leena 2'); name('#typingInd', 'Typing indicator'); name('#empty', 'Empty state'); name('#badge', 'Badge – Inbox');

// ---------------------------------------------------------------- layout (thread content coords)
const VP_H = 639, GAP = 24;
const Y = { email: 100 };
Y.event = Y.email + $('#email').offsetHeight + GAP;
Y.msgA = Y.event + 20 + GAP;
Y.msgB = Y.msgA + 48 + 16;
Y.compose = Y.msgB + 48 + GAP;
for (const [k, sel] of [['event', '#event'], ['msgA', '#msgA'], ['msgB', '#typingInd'], ['msgB', '#msgB'], ['compose', '#compose']]) $(sel).style.top = Y[k] + 'px';

const REPLY = 'Hi Daniel, thanks for flagging this. We’ve confirmed the duplicate charge and started a refund of $149. It should reach your account in 3–5 business days. — Leena';
const typR = typer($('#cBody .typed'), REPLY, { seed: 7, caretH: 24 });
const lines = typR.lineOf(typR.spans.length - 1, 30) + 1;
const growAt = typR.spans.findIndex((_, i) => typR.lineOf(i, 30) === 2);
const H2 = 60, HF = lines * 30;
const cBody = $('#cBody');
cBody.style.height = H2 + 'px';
const compChrome = $('#compose').offsetHeight - H2;
const scroll2 = Y.compose + compChrome + H2 + GAP - VP_H;
const scroll3 = Y.compose + compChrome + HF + GAP - VP_H;
Y.msgC = Y.compose + compChrome + HF + GAP;
$('#msgC').style.top = Y.msgC + 'px';
const scrollF = Y.msgC + 48 + GAP - VP_H;
const typA = typer($('#tlA .typed'), '@Leena can you take this up?', { seed: 3, caretH: 22 });
const typB = typer($('#tlB .typed'), 'Priya, all taken care of.', { seed: 11, caretH: 22 });

const rowNew = $('#rowNew');
const rowsOld = [...document.querySelectorAll('#listBody .row')].slice(1);
const chip = rowNew.querySelector('.chip');
const wA = $('#chipA').offsetWidth + 2, wB = $('#chipB').offsetWidth + 2;
chip.style.width = wA + 'px';
rowsOld.forEach((r) => { const c = r.querySelector('.chip'); c.style.width = (c.firstElementChild.offsetWidth + 2) + 'px'; });

// ---------------------------------------------------------------- kits
const cam = camera(s, $('#cam'), {
  origin: { x: 100, y: 50 }, start: 'full',
  views: {
    full: { x: 860, y: 490, zoom: 1 },
    side: { x: 520, y: 330, zoom: 1.75 },
    list: { x: 620, y: 430, zoom: 1.3 },
    read: { x: 860, y: 520, zoom: 1.1 },
    pill: { x: 840, y: 450, zoom: 1.9 },
    chat: { x: 1180, y: 690, zoom: 1.65 },
    card: { x: 1140, y: 520, zoom: 1.6 },
    comp: { x: 1140, y: 690, zoom: 1.55 },
  },
});
const P = cursor($('#cursors'), { name: 'Priya', from: '#FFB26B', to: ORANGE, x: 700, y: 1090 });
const L = cursor($('#cursors'), { name: 'Leena', from: '#6EA8FF', to: BLUE, x: 1260, y: 1130 });

// ---------------------------------------------------------------- initial state
gsap.set('#win', { scale: 0.9, opacity: 0, transformOrigin: '50% 50%' });
gsap.set('#sidebar', { x: -360 });
gsap.set('#chrome', { opacity: 0 });
gsap.set(rowsOld, { opacity: 0, y: 24 });
gsap.set(rowNew, { x: -620, opacity: 0 });   // parked under the sidebar
gsap.set('#empty', { opacity: 0, x: 60 });
gsap.set(['#title', '#email', '#chat', '#event', '#msgA', '#typingInd', '#msgB', '#compose', '#msgC'], { opacity: 0 });
gsap.set(['#msgA', '#msgB', '#msgC'], { transformOrigin: '0% 50%' });
gsap.set('#dd', { height: 0, opacity: 0 });

// ---------------------------------------------------------------- cursor feel
// A zero-length "settings" beat: its params show as sliders in the inspector.
const feel = s.beat('cursor.tilt', {
  at: 0, dur: 0, note: 'Inertial tilt: cursors lean into horizontal travel and spring back',
  params: {
    strength: { value: 0.2, min: 0, max: 1, step: 0.05 },
    max: { value: 24, min: 0, max: 40, step: 1 },
    bounce: { value: 0, min: 0, max: 1, step: 0.05 },
  },
});
const tiltParams = () => Object.fromEntries(Object.entries(feel.params).map(([k, v]) => [k, v.value]));
P.tilt(s, tiltParams);
L.tilt(s, tiltParams);

// ---------------------------------------------------------------- 1. intro
s.beat('intro.window', { at: 0, dur: 40, ease: 'intro', note: 'Window scales up' },
  (b) => b.fromTo('#win', { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1 }));
s.beat('intro.sidebar', { at: 6, dur: 32 }, (b) => b.fromTo('#sidebar', { x: -360 }, { x: 0 }));
s.beat('intro.chrome', { at: 14, dur: 20, ease: 'fade' }, (b) => b.fromTo('#chrome', { opacity: 0 }, { opacity: 1 }));
s.beat('intro.rows', { at: 20, dur: 18, stagger: 7, note: 'Inbox rows cascade in' },
  (b) => b.each(rowsOld, { opacity: 0, y: 24 }, { opacity: 1, y: 0 }));
s.beat('intro.empty', { at: (B) => B['intro.rows'].lastStart, dur: 22, note: 'Envelope slides in with the last row' },
  (b) => b.fromTo('#empty', { opacity: 0, x: 60 }, { opacity: 1, x: 0 }));

// ---------------------------------------------------------------- 2. sidebar close-up
s.beat('cam.sidebar', { at: 76, dur: 36, note: 'Zoom to sidebar; Priya glides below Inbox' }, (b) => {
  cam.to(b, 'side');
  P.move(b, 176, 270);
});

// ---------------------------------------------------------------- 3. new email
s.beat('new.shift', { at: 137, dur: 26, note: 'Existing rows make room' },
  (b) => rowsOld.forEach((r) => b.fromTo(r, { y: 0 }, { y: 154 })));
s.beat('new.camera', { with: 'new.shift', dur: 40 }, (b) => cam.to(b, 'list'));
s.beat('new.slide', { after: 'new.shift', overlap: 0.5, dur: 28, ease: 'settle', note: 'New email slides in from under the sidebar' }, (b) => {
  b.fromTo(rowNew, { opacity: 0 }, { opacity: 1 }, { at: -1, dur: 1, ease: 'none' });
  b.fromTo(rowNew, { x: -620 }, { x: 0 });
});
s.beat('new.badge', { at: (B) => B['new.slide'].f0 + 8, dur: 14, params: { pop: { value: 1.3, min: 1, max: 1.8, step: 0.05 } } }, (b) => {
  b.fromTo('#badge', { scale: 1 }, { scale: b.p.pop }, { dur: 6, ease: 'fade' });
  b.fromTo('#badge', { scale: b.p.pop }, { scale: 1 }, { at: 6, dur: 8, ease: 'fade' });
});

// ---------------------------------------------------------------- 4. open the thread
s.beat('open.move', { at: 184, dur: 22 }, (b) => P.move(b, 670, 316));
s.beat('open.click', { after: 'open.move', gap: 2, dur: 9, ease: 'fade', note: 'Click selects the row' }, (b) => {
  P.click(b);
  b.fromTo(rowNew, { backgroundColor: '#F5F6F8' }, { backgroundColor: '#E6EFFF' }, { at: 1 });
  b.fromTo(rowNew.querySelector('.l1'), { backgroundColor: '#DADEE3' }, { backgroundColor: '#C8DAFA' }, { at: 1 });
  b.fromTo(rowNew.querySelector('.l2'), { backgroundColor: '#E6E9EC' }, { backgroundColor: '#D6E3FB' }, { at: 1 });
  b.fromTo(rowNew.querySelector('.date'), { backgroundColor: '#E1E4E8' }, { backgroundColor: '#CCDCF7' }, { at: 1 });
  b.fromTo(rowNew.querySelector('.udot'), { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.4 }, { at: 2 });
  b.fromTo('#empty', { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.96 }, { at: 1 });
});
s.beat('open.thread', { with: 'open.click', offset: 6, dur: 16, stagger: 4, note: 'Title, email card and chat box arrive' },
  (b) => b.each(['#title', '#email', '#chat'], { opacity: 0, y: 12 }, { opacity: 1, y: 0 }));
s.beat('open.camera', { with: 'open.click', offset: 4, dur: 35, note: 'Zoom out slightly to read' }, (b) => cam.to(b, 'read'));

// ---------------------------------------------------------------- 5. assign
s.beat('assign.approach', { at: 282, dur: 36, note: 'Zoom in to the pill' }, (b) => {
  cam.to(b, 'pill');
  P.move(b, 914, 356);
});
s.beat('assign.click', { after: 'assign.approach', gap: 4, dur: 9 }, (b) => P.click(b));
s.beat('assign.dropdown', { with: 'assign.click', offset: 2, dur: 14, note: 'Dropdown grows downward from the pill' }, (b) => {
  b.fromTo('#dd', { height: 0 }, { height: 226 });
  b.fromTo('#dd', { opacity: 0 }, { opacity: 1 }, { dur: 4, ease: 'fade' });
});
s.beat('assign.hover', { at: 344, dur: 16 }, (b) => {
  P.move(b, 862, 402);   // rests between the name and the tick, so the tick isn't hidden
  b.fromTo('#ddHover', { opacity: 0 }, { opacity: 1 }, { at: 8, dur: 5, ease: 'fade' });
});
s.beat('assign.pick', { after: 'assign.hover', gap: 6, dur: 9 }, (b) => {
  P.click(b);
  b.fromTo('#chkUn', { opacity: 1 }, { opacity: 0 }, { at: 1, dur: 4, ease: 'fade' });
  b.fromTo('#chkLeena', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, { at: 1, dur: 5, ease: 'fade' });
});
s.beat('assign.close', { with: 'assign.pick', offset: 10, dur: 14, note: 'Dropdown closes; pill becomes "Leena"' }, (b) => {
  b.fromTo('#dd', { opacity: 1, y: 0 }, { opacity: 0, y: -4 }, { dur: 8, ease: 'fade' });
  b.fromTo(chip, { width: wA }, { width: wB }, { at: 2 });
  b.fromTo('#chipA', { opacity: 1 }, { opacity: 0 }, { at: 2, dur: 8, ease: 'fade' });
  b.fromTo('#chipB', { opacity: 0 }, { opacity: 1 }, { at: 7, dur: 9, ease: 'fade' });
});
s.beat('assign.event', { at: 392, dur: 12 }, (b) => b.fromTo('#event', { opacity: 0, y: 8 }, { opacity: 1, y: 0 }));

// ---------------------------------------------------------------- 6. chat with Leena
s.beat('chat.approach', { at: 404, dur: 40, note: 'Fly to the chat box' }, (b) => {
  cam.to(b, 'chat');
  P.move(b, 1540, 922);
});
s.beat('chat.clickA', { after: 'chat.approach', gap: 4, dur: 9 }, (b) => P.click(b).track('#chat'));
s.beat('chat.typeA', { at: 454, dur: 56, note: '@Leena can you take this up?' }, (b) => { typA.schedule(b.f0, b.f0 + b.dur); b.track('#chat'); });
s.beat('chat.sendA', { after: 'chat.typeA', gap: 6, dur: 14 }, (b) => {
  b.fromTo('#sendc', { scale: 1 }, { scale: 0.86 }, { dur: 3, ease: 'fade' });
  b.fromTo('#sendc', { scale: 0.86 }, { scale: 1 }, { at: 3, dur: 6, ease: 'fade' });
  b.fromTo('#msgA', { opacity: 0, y: 12, scale: 0.97 }, { opacity: 1, y: 0, scale: 1 }, { at: 3, dur: 11 });
});
s.beat('chat.typing', { at: 536, dur: 52, note: 'Leena is typing… where her reply will land' }, (b) => {
  b.fromTo('#typingInd', { opacity: 0 }, { opacity: 1 }, { dur: 8, ease: 'fade' });
  b.fromTo('#typingInd', { opacity: 1 }, { opacity: 0 }, { at: b.dur - 6, dur: 6, ease: 'fade' });
});
s.beat('chat.replyB', { at: (B) => B['chat.typing'].f1 - 4, dur: 11 },
  (b) => b.fromTo('#msgB', { opacity: 0, y: 8, scale: 0.97 }, { opacity: 1, y: 0, scale: 1 }));

// ---------------------------------------------------------------- 7. handoff to Leena
s.beat('handoff', { at: 600, dur: 36, note: 'Camera to the email card; Priya leaves, Leena arrives' }, (b) => {
  cam.to(b, 'card');
  P.move(b, 1820, 1160, { ease: 'exit' });
  P.fade(b, 1, 0, { at: 6, dur: 20, ease: 'fade' });
  L.move(b, 1092, 563);
});
s.beat('reply.click', { after: 'handoff', gap: 4, dur: 9 }, (b) => L.click(b));
s.beat('reply.open', { at: 644, dur: 32, note: 'Thread scrolls up; composer appears below the chat' }, (b) => {
  cam.to(b, 'comp');
  b.fromTo('#thread', { y: 0 }, { y: -scroll2 });
  b.fromTo('#compose', { opacity: 0, y: 20 }, { opacity: 1, y: 0 }, { at: 6, dur: 24 });
  L.move(b, 1400, 806);
});

// ---------------------------------------------------------------- 8. reply
s.beat('reply.type', { at: 682, dur: 134, note: 'Reply typed into the composer' }, (b) => { typR.schedule(b.f0, b.f0 + b.dur); b.track('#compose'); });
s.beat('reply.grow', { at: () => typR.times[growAt] - 2, dur: 8, note: 'Composer grows when line 3 appears' }, (b) => {
  b.fromTo(cBody, { height: H2 }, { height: HF });
  b.fromTo('#thread', { y: -scroll2 }, { y: -scroll3 });
});
s.beat('reply.toSend', { at: 822, dur: 14 }, (b) => L.move(b, 1088, 813));
s.beat('reply.send', { after: 'reply.toSend', gap: 4, dur: 20, ease: 'fade', note: 'Composer becomes a message card' }, (b) => {
  L.click(b);
  b.fromTo('#cSend', { scale: 1 }, { scale: 0.94 }, { dur: 3 });
  b.fromTo('#cSend', { scale: 0.94 }, { scale: 1 }, { at: 3, dur: 5 });
  b.fromTo('#compose', { borderColor: BLUE, boxShadow: '0 0 0 1px rgba(33,112,244,1)' }, { borderColor: '#DDDDDD', boxShadow: '0 0 0 1px rgba(33,112,244,0)' }, { at: 4, dur: 16 });
  b.fromTo('#cDraft', { opacity: 1 }, { opacity: 0 }, { at: 4, dur: 8 });
  b.fromTo('#cTime', { opacity: 0 }, { opacity: 1 }, { at: 10, dur: 10 });
  b.fromTo('#cSendBar', { opacity: 1 }, { opacity: 0 }, { at: 4, dur: 8 });
  b.fromTo('#cReplyBar', { opacity: 0 }, { opacity: 1 }, { at: 10, dur: 10 });
  b.fromTo('#cDiv', { opacity: 0 }, { opacity: 1 }, { at: 6, dur: 12 });
});
s.beat('reply.scroll', { with: 'reply.send', offset: 10, dur: 28, note: 'Leave room above the chat box' },
  (b) => b.fromTo('#thread', { y: -scroll3 }, { y: -scrollF }));

// ---------------------------------------------------------------- 9. Leena closes the loop
s.beat('chat.toB', { with: 'reply.scroll', dur: 28 }, (b) => L.move(b, 1540, 922));
s.beat('chat.clickB', { after: 'chat.toB', gap: 4, dur: 9 }, (b) => L.click(b).track('#chat'));
s.beat('chat.typeB', { with: 'chat.clickB', offset: 4, dur: 40, note: 'Priya, all taken care of.' }, (b) => { typB.schedule(b.f0, b.f0 + b.dur); b.track('#chat'); });
s.beat('chat.sendB', { after: 'chat.typeB', gap: 2, dur: 14 }, (b) => {
  b.fromTo('#sendc', { scale: 1 }, { scale: 0.86 }, { dur: 3, ease: 'fade' });
  b.fromTo('#sendc', { scale: 0.86 }, { scale: 1 }, { at: 3, dur: 6, ease: 'fade' });
  b.fromTo('#msgC', { opacity: 0, y: 12, scale: 0.97 }, { opacity: 1, y: 0, scale: 1 }, { at: 3, dur: 11 });
});
s.beat('outro', { with: 'chat.sendB', offset: 10, dur: 30, note: 'Leena accelerates away; camera returns to the full window' }, (b) => {
  cam.to(b, 'full');
  L.move(b, 1900, 1220, { ease: 'exit' });
  L.fade(b, 1, 0, { at: 4, dur: 20, ease: 'fade' });
});

// ---------------------------------------------------------------- per-frame state (typing, focus)
const B = s.beats;
s.onFrame((f) => {
  const focusA = [B['chat.clickA'].f0, B['chat.sendA'].f0 + 2];
  const focusB = [B['chat.clickB'].f0, B['chat.sendB'].f0 + 2];
  const focusR = [B['reply.open'].f0 + 6, B['reply.send'].f0];
  const inA = f >= focusA[0] && f < focusA[1], inB = f >= focusB[0] && f < focusB[1];
  // display, not visibility: revealed spans set visibility themselves and would leak through
  $('#tlA').style.display = inA ? 'flex' : 'none';
  $('#tlB').style.display = inB ? 'flex' : 'none';
  const nA = inA ? typA.render(f, true, focusA[0]) : 0;
  const nB = inB ? typB.render(f, true, focusB[0]) : 0;
  typA.spans.slice(0, 6).forEach((sp) => sp.classList.toggle('mention', nA >= 6));   // mention turns blue once complete
  const hasText = (inA && nA > 0) || (inB && nB > 0);
  $('#ph').style.visibility = hasText ? 'hidden' : 'visible';
  $('#sendc').style.background = hasText ? BLUE : '#C9D8F2';
  $('#chat').style.borderColor = inA || inB ? BLUE : '#DDDDDD';
  $('#chat').style.boxShadow = inA || inB ? '0 0 0 3px rgba(33,112,244,.14)' : 'none';
  typR.render(f, f >= focusR[0] && f < focusR[1], focusR[0]);
  document.querySelectorAll('#typingInd i').forEach((d, i) => { d.style.opacity = (Math.floor(f / 5) % 4) > i ? 1 : 0.15; });
});

s.ready({ tail: 40 });
