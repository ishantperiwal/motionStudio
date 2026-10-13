// Character-by-character typing with uneven, seeded pacing and a caret.
//   const t = typer(containerEl, 'Hello', { seed: 3, caretH: 22 });
//   s.beat('type', { at: 100, dur: 40 }, (b) => t.schedule(b.f0, b.f0 + b.dur).track && b.track(containerEl));
//   s.onFrame((f) => t.render(f, focused, focusFrom));
import { rng } from '../ease.js';

export function typer(container, text, { seed = 1, caretH = 22, caretColor = '#2170F4' } = {}) {
  container.style.position ||= 'relative';
  const spans = [...text].map((ch) => { const s = document.createElement('span'); s.textContent = ch; s.style.visibility = 'hidden'; container.appendChild(s); return s; });
  const caret = document.createElement('i');
  Object.assign(caret.style, { position: 'absolute', width: '2px', height: caretH + 'px', borderRadius: '1px', background: caretColor, visibility: 'hidden' });
  container.appendChild(caret);
  const t = {
    spans, caret, times: [], shown: -1,
    /** Spread keystrokes between f0 (first char) and f1 (last char). */
    schedule(f0, f1) {
      const r = rng(seed), w = [];
      for (let i = 1; i < spans.length; i++) {
        const prev = text[i - 1];
        let d = 0.55 + r() * 1.0;
        if (prev === ' ') d += 0.35 + r() * 0.6;
        if (',.?!—'.includes(prev)) d += 1.6 + r() * 1.2;
        if (r() < 0.07) d += 1.4 + r() * 1.6;
        if (r() < 0.18) d *= 0.45;
        w.push(d);
      }
      const sum = w.reduce((a, b) => a + b, 0) || 1;
      t.times = [f0]; let acc = f0;
      w.forEach((d) => { acc += d * (f1 - f0) / sum; t.times.push(acc); });
      return t;
    },
    count(f) { let n = 0; while (n < t.times.length && t.times[n] <= f + 1e-6) n++; return n; },
    /** Line index (0-based) each char sits on once fully typed. */
    lineOf(i, lineH) { return Math.round((spans[i].offsetTop - spans[0].offsetTop) / lineH); },
    render(f, focused = false, focusFrom = 0) {
      const n = t.count(f);
      if (n !== t.shown) { spans.forEach((s, i) => { s.style.visibility = i < n ? 'visible' : 'hidden'; }); t.shown = n; }
      let show = false;
      if (focused) { const last = n > 0 ? t.times[n - 1] : focusFrom; show = (f - last) < 10 || Math.floor((f - last) / 13) % 2 === 1; }
      caret.style.visibility = show ? 'visible' : 'hidden';
      if (show) {
        const ref = n > 0 ? spans[n - 1] : spans[0];
        caret.style.left = ((n > 0 ? ref.offsetLeft + ref.offsetWidth : ref.offsetLeft) + 1) + 'px';
        caret.style.top = (ref.offsetTop + (ref.offsetHeight - caretH) / 2) + 'px';
      }
      return n;
    },
  };
  return t;
}
