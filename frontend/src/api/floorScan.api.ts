// Floor-plan auto-detection API.
//
// Posts a data URL to the Node proxy at /api/floor-scan, which forwards to
// the Python OpenCV microservice. Returns image-pixel coordinates of
// detected furniture; the caller scales to canvas pixels.
//
// Detection is best-effort. The caller should silently fall back to
// manual placement on any error — we don't want to block the upload.

import api from './client';
import type { ApiEnvelope } from '@/types';

export interface ScanChair {
  x: number;       // top-left x in original image pixels
  y: number;
  w: number;
  h: number;
  conf: number;    // 0..1
}

export interface ScanTableRound {
  cx: number;      // centre x in image pixels
  cy: number;
  r: number;
  conf: number;
}

export interface ScanTableRect {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface ScanResult {
  image_width: number;
  image_height: number;
  chairs: ScanChair[];
  tables_round: ScanTableRound[];
  tables_rect: ScanTableRect[];
  thresholds?: Record<string, number>;
}

export const floorScanApi = {
  // Pass the same data URL that the editor stores in layout.imageUrl.
  // Backend will accept it as either multipart or JSON; we go with JSON
  // since the editor already has the data URL handy.
  scan: (imageDataUrl: string) =>
    api
      .post<ApiEnvelope<ScanResult>>('/floor-scan', { image_base64: imageDataUrl })
      .then((r) => r.data),
};
