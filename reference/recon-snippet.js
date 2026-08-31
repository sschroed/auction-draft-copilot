// Paste into DevTools Console on the ESPN draft room tab.
// Copies selector recon data to your clipboard as JSON.
(() => {
  const clip = [];
  const attrs = (n) => {
    const cls = (n.getAttribute && n.getAttribute('class')) || '';
    const extra = [...(n.attributes || [])]
      .filter((a) => /^(data-|aria-)/.test(a.name) || a.name === 'id' || a.name === 'role')
      .map((a) => `[${a.name}="${a.value}"]`).join('');
    return n.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\s+/).join('.') : '') + extra;
  };
  const chainOf = (e) => {
    const c = [];
    let n = e;
    for (let i = 0; i < 7 && n && n.tagName !== 'BODY'; i++, n = n.parentElement) c.push(attrs(n));
    return c;
  };

  // 1) Every leaf element showing a $ amount, with its ancestor chain.
  const seen = new Set();
  const money = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.childElementCount) continue;
    const t = (e.textContent || '').trim();
    if (!/\$\s?\d/.test(t)) continue;
    const ch = chainOf(e);
    const key = ch.join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    money.push({ text: t.slice(0, 50), chain: ch });
    if (money.length >= 60) break;
  }
  clip.push({ section: 'moneyNodes', money });

  // 2) Container HTML around a text you name.
  const grab = (label) => {
    const q = prompt(label + ' — exact text as displayed (blank = skip)');
    if (!q) return;
    let best = null;
    for (const e of document.querySelectorAll('body *')) {
      if (e.childElementCount === 0 && (e.textContent || '').includes(q)) best = e;
    }
    if (!best) { clip.push({ section: label, error: 'not found' }); return; }
    let up = best;
    for (let i = 0; i < 3 && up.parentElement && up.parentElement.tagName !== 'BODY'; i++) up = up.parentElement;
    clip.push({ section: label, chain: chainOf(best), html: up.outerHTML.slice(0, 20000) });
  };
  grab('ON-BLOCK player name');
  grab('recently SOLD player name (pick history)');

  copy(JSON.stringify(clip));
  console.log('Copied:', clip.map((c) => c.section).join(' | '));
})();
