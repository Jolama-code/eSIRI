// Regenerates screenshots/, the static PNG and the A3 PDF.  Run from the repo root:
//   node docs/architecture/capture.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(ROOT, '../../frontend/package.json'))('playwright');
const OUT = ROOT + '/screenshots';
const b = await chromium.launch();
const errs = [];
async function page(w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/nuru-architecture.html');
  await p.waitForSelector('body[data-ready="1"]');
  return p;
}
for (const [w, h] of [[1920, 1080], [1366, 768]]) {
  const p = await page(w, h); const tag = `${w}x${h}`;
  await p.screenshot({ path: `${OUT}/static-${tag}.png` });
  await p.evaluate(() => __arch.setTrust(true)); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/static-trust-${tag}.png` });
  await p.evaluate(() => { __arch.setTrust(false); __arch.openPanel('node', 'agent'); }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/panel-box-agent-${tag}.png` });
  await p.evaluate(() => { __arch.closePanel(); __arch.openPanel('edge', 'kupload'); }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/panel-arrow-kupload-${tag}.png` });
  await p.evaluate(() => __arch.closePanel());
  // hover highlight
  await p.hover('[data-node="events"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/static-hover-events-${tag}.png` });
  await p.close();
}
const p = await page(1920, 1080);
await p.evaluate(() => __arch.setTab('anim'));
const flows = await p.evaluate(() => Object.fromEntries(Object.entries(__arch.FLOWS).map(([k, f]) => [k, f.steps.length])));
for (const [f, n] of Object.entries(flows)) {
  for (let i = 0; i < n; i++) {
    await p.evaluate(([f, i]) => __arch.showStep(f, i, true), [f, i]);
    await p.waitForTimeout(450);
    await p.screenshot({ path: `${OUT}/flow-${f}-step-${String(i + 1).padStart(2, '0')}.png` });
  }
}
// Static export: PNG + A3 PDF
const q = await page(1920, 1080);
await q.screenshot({ path: `${ROOT}/nuru-architecture-static.png` });
await q.emulateMedia({ media: 'print' });
await q.pdf({ path: `${ROOT}/nuru-architecture-A3.pdf`, format: 'A3', landscape: true, printBackground: true, preferCSSPageSize: true });
await q.screenshot({ path: `${OUT}/print-preview.png`, fullPage: true });
console.log('flows', flows, 'errors', errs);
await b.close();
