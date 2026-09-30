/**
 * End-to-end Playwright investigation of the real DeskLayoutEditor upload +
 * /api/floor-scan + /scan-gemini + Gemini flow. Captures ACTUAL evidence:
 * per-run network trace, per-run backend response, per-run frontend rendered
 * count, per-run failure classification.
 *
 * TEST_IMAGE  full path to the image to upload (default: proxy_floorplan.jpg)
 * RUNS        how many identical uploads to run (default: 5)
 * TAG         a label written into result filenames (default: baseline)
 */
import { test, expect, Page, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5175';
const USERNAME = process.env.TEST_USER || 'superadmin';
const PASSWORD = process.env.TEST_PASS || 'admin123';
const IMAGE_PATH = process.env.TEST_IMAGE || 'c:/Mobilise/facilityManagement/tests/proxy_floorplan.jpg';
const RUNS = parseInt(process.env.RUNS || '5', 10);
const TAG = process.env.TAG || 'baseline';
const OUT_DIR = path.resolve(__dirname, '..', 'test-results', `real-upload-${TAG}`);

const SEL = {
  loginUsername:   '#username, input[name="username"], input[type="text"]:visible',
  loginPassword:   '#password, input[name="password"], input[type="password"]',
  loginSubmit:     'button[type="submit"], button:has-text("Sign in")',
  editLayoutBtn:   'button:has-text("Design floor plan"), button:has-text("Edit floor plan")',
  scanSummary:     'text=/auto-detect|couldn.t auto-detect|found nothing/i',
};

interface RunReport {
  run: number;
  ok: boolean;
  http_status: number;
  parse_ok: number | null;
  latency_ms: number;
  scan_body: any;
  chairs_backend: number;
  round_backend: number;
  rect_backend: number;
  chairs_rendered: number;
  console_errors: string[];
  request_body_size: number;
  image_naturalWidth: number;
  image_naturalHeight: number;
  final_verdict: 'success' | 'http200-but-not-parseable' | 'http200-but-rendered-mismatch' | 'http-failed';
}

test.setTimeout(15 * 60_000); // 15 min for the whole 5-run test

test('real-upload E2E: RUNS iterations with full trace', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(IMAGE_PATH)) throw new Error(`TEST_IMAGE not found: ${IMAGE_PATH}`);
  const imgBytes = fs.statSync(IMAGE_PATH).size;

  // Console recorder
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

  // ------------------------------------------------------------------ login
  await page.goto(FRONTEND + '/login');
  await page.fill(SEL.loginUsername, USERNAME);
  await page.fill(SEL.loginPassword, PASSWORD);
  await Promise.all([
    page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 15_000 }),
    page.click(SEL.loginSubmit),
  ]);

  // ---------------------------------------------------- navigate to facility
  const facilityId: number = await page.evaluate(async () => {
    const token = localStorage.getItem('fm_token');
    const r = await fetch('/api/facilities?type=desk&limit=5', { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json();
    const row = (body.data?.data || body.data || [])[0];
    if (!row?.id) throw new Error('No desk facility found');
    return row.id;
  });

  const reports: RunReport[] = [];

  for (let i = 1; i <= RUNS; i++) {
    // Fresh navigation each run to avoid modal state pollution
    await page.goto(`${FRONTEND}/admin/masters/facilities/${facilityId}`);
    await page.waitForLoadState('networkidle');

    // Open editor
    const openEditor = page.locator(SEL.editLayoutBtn).first();
    await openEditor.scrollIntoViewIfNeeded();
    await openEditor.waitFor({ state: 'visible', timeout: 20_000 });
    await openEditor.click();
    const dialog = page.locator('[role="dialog"][aria-label="Design floor plan"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(300);

    // Switch to Floor plan mode to reveal hidden file input
    await dialog.locator('button:has-text("Floor plan")').first().click();
    await page.waitForTimeout(300);

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 10_000 });

    // Per-run network capture
    let scanReq: Request | null = null;
    let scanRes: Response | null = null;
    let scanBody: any = null;
    let scanStatus = -1;
    let requestBodySize = -1;
    const reqStart = { t: 0 };

    const onReq = (req: Request) => {
      if (req.url().includes('/api/floor-scan')) {
        scanReq = req;
        reqStart.t = Date.now();
        try {
          const pd = req.postData();
          requestBodySize = pd ? Buffer.byteLength(pd, 'utf8') : -1;
        } catch { requestBodySize = -1; }
      }
    };
    const onRes = async (res: Response) => {
      if (res.url().includes('/api/floor-scan')) {
        scanRes = res;
        scanStatus = res.status();
        try { scanBody = await res.json(); } catch { scanBody = await res.text(); }
      }
    };
    page.on('request', onReq);
    page.on('response', onRes);

    // Upload
    const preErrCount = consoleErrors.length;
    await fileInput.setInputFiles(IMAGE_PATH);

    // Wait up to 120 s for scan response
    const waitStart = Date.now();
    while (!scanRes && Date.now() - waitStart < 120_000) {
      await page.waitForTimeout(300);
    }
    const latency_ms = scanRes ? (Date.now() - reqStart.t) : -1;

    await page.waitForTimeout(1000); // let UI render results

    // Inspect frontend layout state and rendered SVG for chair count
    const rendered = await page.evaluate(() => {
      // Chair labels in the SVG canvas look like "C-01", "C-02", ...
      const chairEls = Array.from(document.querySelectorAll('text'))
        .filter(t => /^C-\d{2,3}$/.test((t.textContent || '').trim()));
      return {
        chair_labels: chairEls.length,
      };
    });

    // Image natural dims (as browser saw them after decode)
    const dims = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const flooryImg = imgs.find(i => i.src.startsWith('data:image')) || imgs[imgs.length - 1];
      return flooryImg ? { w: flooryImg.naturalWidth, h: flooryImg.naturalHeight } : { w: -1, h: -1 };
    });

    page.off('request', onReq);
    page.off('response', onRes);

    // Screenshot per run
    await page.screenshot({ path: path.join(OUT_DIR, `run-${i}-final.png`), fullPage: true });

    const dataObj = scanBody && scanBody.data ? scanBody.data : (scanBody || {});
    const parseOk = (dataObj.thresholds && typeof dataObj.thresholds.parse_ok === 'number')
      ? dataObj.thresholds.parse_ok
      : null;
    const chairsBackend = (dataObj.chairs || []).length;
    const roundBackend  = (dataObj.tables_round || []).length;
    const rectBackend   = (dataObj.tables_rect || []).length;

    // Phase 5 success criteria (strict): HTTP 200 AND parse_ok=1 AND
    // (frontend rendered chairs match backend chair count). Anything less
    // is a failure, even if HTTP status is 200.
    let final: RunReport['final_verdict'];
    if (scanStatus !== 200) final = 'http-failed';
    else if (parseOk !== 1) final = 'http200-but-not-parseable';
    else if (rendered.chair_labels !== chairsBackend) final = 'http200-but-rendered-mismatch';
    else final = 'success';

    const report: RunReport = {
      run: i,
      ok: final === 'success',
      http_status: scanStatus,
      parse_ok: parseOk,
      latency_ms,
      scan_body: scanBody,
      chairs_backend: chairsBackend,
      round_backend: roundBackend,
      rect_backend: rectBackend,
      chairs_rendered: rendered.chair_labels,
      console_errors: consoleErrors.slice(preErrCount),
      request_body_size: requestBodySize,
      image_naturalWidth: dims.w,
      image_naturalHeight: dims.h,
      final_verdict: final,
    };
    reports.push(report);

    // Persist per-run raw body
    fs.writeFileSync(
      path.join(OUT_DIR, `run-${i}-response.json`),
      JSON.stringify(scanBody, null, 2),
      'utf-8',
    );

    console.log(`RUN ${i}/${RUNS}  http=${scanStatus}  parse_ok=${parseOk}  ms=${latency_ms}  ` +
      `chairs(be=${report.chairs_backend} rendered=${report.chairs_rendered})  ` +
      `round=${report.round_backend}  rect=${report.rect_backend}  ` +
      `verdict=${final}`);
  }

  // Save the full report
  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify({
      image_path: IMAGE_PATH,
      image_file_size: imgBytes,
      runs: reports,
    }, null, 2),
    'utf-8',
  );

  // Compact console table (Phase 5 format)
  console.log('\n=== SUMMARY ===');
  console.log('Run | http | parse_ok | ms    | chairs_be | rendered | round | rect | verdict');
  for (const r of reports) {
    console.log(
      `${String(r.run).padStart(3)} | ${String(r.http_status).padStart(4)} | ` +
      `${String(r.parse_ok).padStart(8)} | ${String(r.latency_ms).padStart(5)} | ` +
      `${String(r.chairs_backend).padStart(9)} | ${String(r.chairs_rendered).padStart(8)} | ` +
      `${String(r.round_backend).padStart(5)} | ${String(r.rect_backend).padStart(4)} | ${r.final_verdict}`
    );
  }
  const successes = reports.filter(r => r.final_verdict === 'success').length;
  console.log(`\nSUCCESS RATE: ${successes}/${reports.length}`);
});
