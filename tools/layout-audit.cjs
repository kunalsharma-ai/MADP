// Layout audit: page-level horizontal scroll, elements past the viewport edge, and overlapping text/controls.
// Usage: node tools/layout-audit.cjs <session-token-file> <out-dir> <brand> <widths e.g. 390,768,1280,1680> <paths...>
// Set OPEN=1 to open every <details> first. Needs the admin running on :3002.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [tok, out, brand, widthsArg, ...hrefs] = process.argv.slice(2);
  const widths = widthsArg.split(',').map(Number);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const report = [];
  for (const w of widths) {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await c.addCookies([
      { name: 'madp_session', value: fs.readFileSync(tok, 'utf8').trim(), domain: 'localhost', path: '/' },
      { name: 'madp_brand', value: brand, domain: 'localhost', path: '/' },
    ]);
    const p = await c.newPage();
    for (const h of hrefs) {
      try {
        await p.goto('http://localhost:3002' + h, { waitUntil: 'networkidle', timeout: 90000 });
        await p.waitForTimeout(1500); // let count-ups and rings settle
        if (process.env.OPEN) { await p.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true))); await p.waitForTimeout(300); }
        const info = await p.evaluate(() => {
          const vw = window.innerWidth;
          const main = document.querySelector('main') || document.body;
          const visible = (e) => {
            const s = getComputedStyle(e);
            if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
            const r = e.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          };
          const inScroller = (e) => {
            for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
              const s = getComputedStyle(a);
              if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return a;
            }
            return null;
          };
          const fixed = (e) => {
            for (let a = e; a; a = a.parentElement) if (/(fixed|sticky)/.test(getComputedStyle(a).position)) return true;
            return false;
          };
          const label = (e) => {
            const t = (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
            return `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0, 3).join('.') : ''} "${t}"`;
          };
          const leaves = [...main.querySelectorAll('*')].filter((e) => {
            if (!visible(e) || fixed(e) || e.closest('.sr-only')) return false;
            if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'IMG'].includes(e.tagName) && !(e.innerText || '').trim()) return false;
            if (e.closest('[aria-hidden="true"]') && !['INPUT', 'BUTTON'].includes(e.tagName)) return false;
            if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'IMG'].includes(e.tagName)) return true;
            if (e.closest('button')) return false;
            return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          });
          const past = [];
          const rects = leaves.map((e) => {
            const r = e.getBoundingClientRect();
            const sc = inScroller(e);
            if (r.right > vw + 1) {
              let ok = false;
              for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
                if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) { ok = a.getBoundingClientRect().right <= vw + 1; break; }
              }
              if (!ok) past.push(label(e));
            }
            // clip to scroller so content hidden inside a scroll box doesn't count as overlap
            let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
            if (sc) {
              const s = sc.getBoundingClientRect();
              box = { l: Math.max(box.l, s.left), t: Math.max(box.t, s.top), r: Math.min(box.r, s.right), b: Math.min(box.b, s.bottom) };
            }
            // text: use each line box of the element's own text nodes, so wrapped inline text and padding don't count
            let boxes = [box];
            if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'IMG'].includes(e.tagName)) {
              boxes = [];
              for (const n of e.childNodes) {
                if (n.nodeType !== 3 || !n.textContent.trim()) continue;
                const rg = document.createRange();
                rg.selectNodeContents(n);
                for (const tr of rg.getClientRects()) {
                  const bx = { l: Math.max(box.l, tr.left), t: Math.max(box.t, tr.top), r: Math.min(box.r, tr.right), b: Math.min(box.b, tr.bottom) };
                  if (bx.r - bx.l > 1 && bx.b - bx.t > 1) boxes.push(bx);
                }
              }
            }
            return { e, boxes };
          });
          const overlaps = [];
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i], c = rects[j];
              if (a.e.contains(c.e) || c.e.contains(a.e)) continue;
              let hit = false;
              for (const x of a.boxes) for (const y of c.boxes) {
                const ix = Math.min(x.r, y.r) - Math.max(x.l, y.l);
                const iy = Math.min(x.b, y.b) - Math.max(x.t, y.t);
                const sm = Math.min((x.r - x.l) * (x.b - x.t), (y.r - y.l) * (y.b - y.t));
                if (ix > 2 && iy > 3 && sm > 0 && (ix * iy) / sm > 0.15) hit = true;
              }
              if (hit) overlaps.push(`${label(a.e)} <> ${label(c.e)}`);
            }
          }
          // text clipped by its own box without an ellipsis
          const clipped = leaves
            .filter((e) => {
              const s = getComputedStyle(e);
              return /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName);
            })
            .map(label);
          return { sw: document.documentElement.scrollWidth, vw, past: past.slice(0, 8), overlaps: [...new Set(overlaps)].slice(0, 12), clipped: clipped.slice(0, 6) };
        });
        const bad = info.sw > info.vw + 1 || info.past.length || info.overlaps.length || info.clipped.length;
        if (bad) report.push(`[${w}] ${h}\n  ${JSON.stringify(info)}`);
        await p.screenshot({ path: `${out}/${w}${h.replace(/[/?=&]/g, '_') || '_root'}.png`, fullPage: true });
      } catch (e) {
        report.push(`[${w}] ${h} FAIL ${String(e).slice(0, 150)}`);
      }
    }
    await c.close();
  }
  console.log(report.join('\n') || 'clean');
  await b.close();
})();
