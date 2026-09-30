/**
 * Playwright test — automate the frontend Detect flow against /scan-architect.
 *
 * This test does NOT modify any production code. It drives the existing UI:
 *   1. Log in as superadmin
 *   2. Navigate to a Hot Desks facility (desk-type, so the layout editor is available)
 *   3. Open the layout editor
 *   4. Upload the image passed via TEST_IMAGE env var
 *   5. Wait for the /api/floor-scan request to complete
 *   6. Capture screenshots, the network response body, console errors,
 *      and the scan-summary banner text
 *   7. Print a structured test report
 *
 * Run with:
 *     TEST_IMAGE=c:/Mobilise/test_images/apartment.png npx playwright test
 *
 * Prereqs:
 *   - frontend at http://localhost:5173
 *   - node backend at http://localhost:4002
 *   - python floor-scan svc at http://localhost:5001 with architect_best.pt loaded
 *   - Node controller's /api/floor-scan is TEMPORARILY routed to /scan-architect
 */

import { test, expect, Page, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';
const USERNAME = process.env.TEST_USER || 'superadmin';
const PASSWORD = process.env.TEST_PASS || 'admin123';
const IMAGE_PATH = process.env.TEST_IMAGE || 'c:/Mobilise/test_images/apartment.png';
const OUT_DIR = path.resolve(__dirname, '..', 'test-results', 'architect-detect');

// Selectors used by the Detect flow. Kept as loose text-matches so we don't
// couple the test to internal DOM structure. If the buttons are ever renamed
// in the layout editor, only these three lines need updating.
const SEL = {
  loginUsername:  '#username, input[name="username"], input[type="text"]:visible',
  loginPassword:  '#password, input[name="password"], input[type="password"]',
  loginSubmit:    'button[type="submit"], button:has-text("Sign in")',
  mastersLink:    'text=/masters/i',
  facilitiesTab:  'text=/facilities/i',
  hotDesksRow:    'text=/hot desks/i',
  editLayoutBtn:  'button:has-text("Design floor plan"), button:has-text("Edit floor plan")',
  uploadBtn:      'button:has-text("Upload plan"), button:has-text("Replace")',
  detectBtn:      'button:has-text("Detect")',
  // Scope to the desk-layout editor dialog so we don't accidentally hit the
  // facility form's "card photo" file input (identical attributes otherwise).
  hiddenFileInput: '[role="dialog"][aria-label="Design floor plan"] input[type="file"]',
  scanSummary:    'text=/auto-detect|couldn.t auto-detect|found nothing/i',
};


test('Architect detect flow — E2E via frontend UI', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`TEST_IMAGE not found: ${IMAGE_PATH}. Set TEST_IMAGE env var.`);
  }

  // ------------------------------------------------------------
  // Recorders — capture network + console before any navigation
  // ------------------------------------------------------------
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  let scanRequest: Request | null = null;
  let scanResponse: Response | null = null;
  let scanBody: any = null;
  let scanStatus = -1;

  page.on('request', req => {
    if (req.url().includes('/api/floor-scan')) scanRequest = req;
  });
  page.on('response', async res => {
    if (res.url().includes('/api/floor-scan')) {
      scanResponse = res;
      scanStatus = res.status();
      try { scanBody = await res.json(); } catch { scanBody = await res.text(); }
    }
  });

  // ------------------------------------------------------------
  // 1. Log in
  // ------------------------------------------------------------
  await page.goto(FRONTEND + '/login');
  await page.fill(SEL.loginUsername, USERNAME);
  await page.fill(SEL.loginPassword, PASSWORD);
  await Promise.all([
    page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 15000 }),
    page.click(SEL.loginSubmit),
  ]);
  await page.screenshot({ path: path.join(OUT_DIR, '01-after-login.png'), fullPage: true });

  // ------------------------------------------------------------
  // 2. Navigate to a Hot Desks (desk-type) facility.
  //    CrudTable rows aren't directly clickable — instead of hunting for the
  //    right edit-icon in a specific row, we query the API using the JWT
  //    already in localStorage to find any desk facility, then navigate by ID.
  //    This is deterministic across the ~1260 seeded facilities.
  // ------------------------------------------------------------
  await page.goto(FRONTEND + '/admin/masters/facilities');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT_DIR, '02-facilities-list.png'), fullPage: true });

  const facilityId: number = await page.evaluate(async () => {
    const token = localStorage.getItem('fm_token');
    const r = await fetch('/api/facilities?type=desk&limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await r.json();
    const row = (body.data?.data || body.data || [])[0];
    if (!row?.id) throw new Error('No desk facility found via API: ' + JSON.stringify(body).slice(0, 300));
    return row.id;
  });
  console.log('[test] using desk facility id:', facilityId);

  await page.goto(`${FRONTEND}/admin/masters/facilities/${facilityId}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT_DIR, '03-facility-form.png'), fullPage: true });

  // ------------------------------------------------------------
  // 3. On the facility form there's a "Floor plan" panel with a trigger
  //    button ("Design floor plan" / "Edit floor plan") that opens the
  //    layout-editor MODAL. Click it, then inside the modal click the
  //    "Floor plan" mode toggle (default is "Blank") to reveal the hidden
  //    file input.
  // ------------------------------------------------------------
  const openEditorBtn = page.locator(SEL.editLayoutBtn).first();
  await openEditorBtn.scrollIntoViewIfNeeded();
  await openEditorBtn.waitFor({ state: 'visible', timeout: 20_000 });
  await openEditorBtn.click();
  const dialog = page.locator('[role="dialog"][aria-label="Design floor plan"]');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(400);

  // Inside the dialog, click the "Floor plan" mode toggle (moves from blank
  // grid mode to image-upload mode).
  const modeFloorPlan = dialog.locator('button:has-text("Floor plan")').first();
  await modeFloorPlan.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '04-editor-mounted.png'), fullPage: true });

  // Now the hidden file input is present ONLY inside the dialog.
  const fileInput = dialog.locator('input[type="file"]');
  await fileInput.waitFor({ state: 'attached', timeout: 10_000 });

  // ------------------------------------------------------------
  // 4. Upload the test image via the hidden file input
  //    (bypasses the native OS file dialog)
  // ------------------------------------------------------------
  await fileInput.setInputFiles(IMAGE_PATH);
  await page.waitForTimeout(3000); // let file render + auto-detect fire

  // ------------------------------------------------------------
  // 5. Wait for the scan network round-trip to complete.
  //    The Detect action fires automatically after upload. If it didn't
  //    (older flow), click Detect manually as a fallback.
  // ------------------------------------------------------------
  const detectBtn = page.locator(SEL.detectBtn);
  if (await detectBtn.count() > 0) {
    try {
      await detectBtn.first().click({ timeout: 2000 });
    } catch { /* auto-scan may have already run */ }
  }

  // Wait until /api/floor-scan responds or 60s pass.
  const t0 = Date.now();
  while (!scanResponse && Date.now() - t0 < 60_000) {
    await page.waitForTimeout(500);
  }

  // Give the UI a beat to render the results banner.
  await page.waitForTimeout(1500);

  // ------------------------------------------------------------
  // 6. Capture the final state
  // ------------------------------------------------------------
  await page.screenshot({ path: path.join(OUT_DIR, '05-after-detect.png'), fullPage: true });

  const bannerText = await page.locator(SEL.scanSummary).first()
    .textContent({ timeout: 5000 }).catch(() => null);

  // Count chairs rendered on the canvas. Chair labels look like "C-01" etc.
  const chairLabels = await page.locator('text=/^C-\\d{2,3}$/').count();

  // Round + rect table shape counts by tag name — harder to introspect from
  // SVG DOM alone, so we lean on the scan-response body for the ground truth.
  const chairsInResp = scanBody?.data?.chairs?.length ?? 0;
  const roundInResp = scanBody?.data?.tables_round?.length ?? 0;
  const rectInResp = scanBody?.data?.tables_rect?.length ?? 0;
  const methodInResp = scanBody?.data?.thresholds?.detection_method ?? null;
  const methodLabel = ({1.0: 'YOLO', 2.0: 'OpenCV', 3.0: 'Architect'} as any)[methodInResp] ?? String(methodInResp);

  // ------------------------------------------------------------
  // 7. Structured report
  // ------------------------------------------------------------
  const report = {
    IMAGE: IMAGE_PATH,
    MODEL: methodLabel,
    ENDPOINT: 'POST /api/floor-scan (routed to /scan-architect at Node layer)',
    HTTP_STATUS: scanStatus,
    ARCHITECT_CHAIR_COUNT: chairsInResp,
    ARCHITECT_TABLES_ROUND_COUNT: roundInResp,
    ARCHITECT_TABLES_RECT_COUNT: rectInResp,
    FRONTEND_DISPLAY_CHAIR_LABELS: chairLabels,
    BANNER_TEXT: bannerText,
    CONSOLE_ERRORS: consoleErrors,
    PAGE_ERRORS: pageErrors,
    SCREENSHOT_PATH: path.join(OUT_DIR, '05-after-detect.png'),
    RESPONSE_BODY: scanBody,
    REQUEST_URL: scanRequest?.url() ?? null,
    REQUEST_METHOD: scanRequest?.method() ?? null,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'report.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );

  console.log('\n=========== ARCHITECT DETECT — TEST REPORT ===========');
  for (const [k, v] of Object.entries(report)) {
    if (k === 'RESPONSE_BODY') continue;
    console.log(`${k.padEnd(32)} ${JSON.stringify(v)}`);
  }
  console.log('======================================================\n');
  console.log('Response body saved to report.json');
  console.log(`Screenshots saved under: ${OUT_DIR}`);

  // Test never "fails" — it's a diagnostic capture. Assertions could be
  // added later once we know what a healthy Architect response looks like.
  expect(scanStatus).toBeGreaterThan(0);
});
