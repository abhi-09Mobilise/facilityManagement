// Mask R-CNN service — thin Node.js wrapper that keeps a long-running
// Python worker alive and speaks newline-delimited JSON to it.
//
// Why a long-running worker?
//   torchvision's Mask R-CNN loads ~180MB of weights and takes 2-4 seconds
//   to warm up. Spawning python per request would burn that on every call.
//   Instead we spawn once, wait for the "ready" line, then reuse the same
//   process for the lifetime of the Node server.
//
// Usage:
//   const maskRcnn = require('./services/maskRcnnService');
//   const dets = await maskRcnn.detect('C:/tmp/floor-plan.png', { scoreThreshold: 0.5 });
//   // dets = [{ label, score, box: [x1,y1,x2,y2], mask_polygon?: [[x,y],...] }, ...]
//
// The worker script lives at:
//   backend/scripts/python/mask_rcnn_service.py
//
// Environment overrides:
//   PYTHON_BIN               - path to the python interpreter (default: 'python')
//   MASK_RCNN_SCRIPT         - absolute path to mask_rcnn_service.py
//                              (default: <backend>/scripts/python/mask_rcnn_service.py)
//   MASK_RCNN_TIMEOUT_MS     - per-request timeout (default: 60000)
//
// A single request is one detect() call. Multiple concurrent detect() calls
// interleave through the same worker: we tag each with an incrementing id
// and dispatch replies by that id.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
dotenv.config();
// Absolute path to the Python worker script. Env override wins so the
// script can live outside the backend repo (e.g. a shared ML services
// folder) without editing this file.

console.log(process.env.MASK_RCNN_SCRIPT);
const WORKER_SCRIPT = process.env.MASK_RCNN_SCRIPT
  || path.join(__dirname, '..', '..', 'scripts', 'python', 'mask_rcnn_service.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const DEFAULT_TIMEOUT_MS = Number(process.env.MASK_RCNN_TIMEOUT_MS) || 60000;

class MaskRcnnService {
  constructor() {
    this._proc = null;
    this._rl = null;
    this._readyPromise = null;    // resolves when the worker prints its ready line
    this._pending = new Map();    // id -> { resolve, reject, timer }
    this._nextId = 1;
  }

  // Lazy: only spawn when someone actually calls detect().
  _ensureRunning() {
    if (this._proc && !this._proc.killed && this._proc.exitCode === null) return;

    const proc = spawn(PYTHON_BIN, ['-u', WORKER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this._proc = proc;

    // stderr = human logs. Prefix so they don't get confused with app logs.
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', function onErr(chunk) {
      chunk.toString().split(/\r?\n/).forEach(function (line) {
        if (line) console.error('[mask-rcnn] ' + line);
      });
    });

    proc.on('exit', (code, signal) => {
      console.warn(
        '[mask-rcnn] worker exited (code=' + code + ', signal=' + signal + '). ' +
        'Pending requests: ' + this._pending.size
      );
      // Reject anything still in flight.
      for (const p of this._pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(
          'Mask R-CNN worker exited before responding (code ' + code + ')'
        ));
      }
      this._pending.clear();
      this._proc = null;
      this._rl = null;
      this._readyPromise = null;
    });

    proc.on('error', (err) => {
      // spawn() itself failed (e.g. python not on PATH).
      console.error('[mask-rcnn] failed to start: ' + err.message);
      for (const p of this._pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this._pending.clear();
      this._proc = null;
      this._rl = null;
      this._readyPromise = null;
    });

    // Newline-delimited JSON on stdout — one message per line.
    this._rl = readline.createInterface({ input: proc.stdout });

    this._readyPromise = new Promise((resolve, reject) => {
      let handled = false;
      this._rl.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); }
        catch (_e) {
          console.warn('[mask-rcnn] non-JSON stdout: ' + line);
          return;
        }
        if (!handled && Object.prototype.hasOwnProperty.call(msg, 'ready')) {
          handled = true;
          if (msg.ready) {
            console.log('[mask-rcnn] worker ready (device=' + msg.device +
                        ', categories=' + msg.categories + ')');
            resolve();
          } else {
            reject(new Error(msg.error || 'Worker failed to initialise'));
          }
          return;
        }
        this._handleResponse(msg);
      });
    });
  }

  _handleResponse(msg) {
    const p = this._pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this._pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.results);
    else        p.reject(new Error(msg.error || 'Mask R-CNN worker error'));
  }

  /**
   * Detect objects in an image file.
   *
   * @param {string} imagePath  absolute path to a file the Python worker can open
   * @param {object} [opts]
   * @param {number} [opts.scoreThreshold=0.5]  drop results below this confidence
   * @param {boolean} [opts.wantPolygons=true]  include coarse polygon per mask
   * @param {number} [opts.timeoutMs]           per-call timeout override
   * @returns {Promise<Array<{ label, score, box, mask_polygon? }>>}
   */
  async detect(imagePath, opts) {
    if (!imagePath) throw new Error('imagePath is required');
    const options = opts || {};
    this._ensureRunning();
    await this._readyPromise;

    const id = String(this._nextId++);
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('mask-rcnn detect() timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });

      const payload = {
        id: id,
        path: imagePath,
        score_threshold: typeof options.scoreThreshold === 'number' ? options.scoreThreshold : 0.5,
        want_polygons: options.wantPolygons !== false,
      };
      this._proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  /**
   * Gracefully stop the worker. Safe to call multiple times.
   */
  shutdown() {
    if (!this._proc) return;
    try { this._proc.stdin.end(); } catch (_e) { /* ignore */ }
    // Give python 1s to flush + exit cleanly, then kill.
    const p = this._proc;
    setTimeout(() => {
      if (p && !p.killed && p.exitCode === null) p.kill();
    }, 1000);
  }
}

// Export a singleton — one Python worker per Node process is what we want.
module.exports = new MaskRcnnService();
