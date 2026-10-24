// Modal that renders the printable check-in QR for one specific facility.
//
// Opened from the Facilities list's "QR" row action. The QR encodes
//   /checkin?facility=<id>
// so the backend can reject any code whose booking is for a different
// facility (e.g. a Hot Desks booking won't check in via the Boardroom A
// QR). Admin can print it to stick on the facility's wall / door, or
// download a PNG for digital signage.
//
// Deliberately self-contained — the dialog owns its own print-only styles
// and canvas-to-PNG export, so the parent only passes { open, onClose,
// facility }. No API round-trip: the QR is a static URL derived from the
// facility id, so this works for every facility the moment it's created.

import { useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  Button, Stack, Typography, TextField, Divider, Box,
} from '@mui/material';
import {
  Close as CloseIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';

export interface FacilityQrDialogProps {
  open: boolean;
  onClose: () => void;
  facility: {
    id: number;
    name: string;
    type?: string;
    site_name?: string;
    floor_name?: string;
  } | null;
}

// Where the kiosk should land when scanned. In dev this picks up the Vite
// origin (http://localhost:5173); in prod it is https://fms.onmobilise.com.
// Override via VITE_PUBLIC_APP_URL when the FMS web app is served from a
// different hostname than the admin UI (e.g. a staging mirror pointing
// kiosks at prod).
function publicAppOrigin(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const override = env?.VITE_PUBLIC_APP_URL && env.VITE_PUBLIC_APP_URL.trim();
  if (override) return override.replace(/\/+$/, '');
  return window.location.origin;
}

function buildCheckinUrl(facilityId: number): string {
  return `${publicAppOrigin()}/checkin?facility=${facilityId}`;
}

// Filename-safe version of a facility name, falls back to the id so the
// download never produces a bare "checkin-qr-.png".
function safeSlug(name: string, id: number): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `facility-${id}`;
}

export default function FacilityQrDialog({ open, onClose, facility }: FacilityQrDialogProps) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  if (!facility) return null;

  const qrUrl = buildCheckinUrl(facility.id);

  function handlePrint() {
    window.print();
  }

  function handleDownloadPng() {
    const host = canvasHostRef.current;
    if (!host || !facility) return;
    const canvas = host.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `checkin-qr-${safeSlug(facility.name, facility.id)}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {/* Print-only styles: hide everything on the page except the QR card
          so a Ctrl+P from the dialog produces one clean sheet. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #facility-qr-print, #facility-qr-print * { visibility: visible !important; }
          #facility-qr-print {
            position: absolute; inset: 0; margin: 0; padding: 24mm;
            display: flex; align-items: center; justify-content: center;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <DialogTitle className="no-print" sx={{ pr: 6 }}>
        Check-in QR
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* The printable card. Centred QR + facility name + optional
            location breadcrumb + URL. */}
        <Box
          id="facility-qr-print"
          sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 1.5, py: 2,
          }}
        >
          <Typography variant="overline" color="text.secondary" letterSpacing={2}>
            Scan to check in
          </Typography>
          <Typography variant="h6" fontWeight={700} textAlign="center">
            {facility.name}
          </Typography>
          {(facility.site_name || facility.floor_name) && (
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {[facility.site_name, facility.floor_name].filter(Boolean).join(' · ')}
            </Typography>
          )}

          {/* Visible QR for print + screen (SVG — scales cleanly). */}
          <QRCodeSVG value={qrUrl} size={220} level="M" includeMargin />

          {/* Hidden canvas so handleDownloadPng() can export a raster. */}
          <Box ref={canvasHostRef} sx={{ display: 'none' }} aria-hidden>
            <QRCodeCanvas value={qrUrl} size={512} level="M" includeMargin />
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            textAlign="center"
            sx={{ maxWidth: 260 }}
          >
            Open your phone camera, point it at this code, then enter the
            check-in code from your booking confirmation email.
          </Typography>
        </Box>

        <Divider className="no-print" sx={{ my: 1.5 }} />

        <Stack spacing={1} className="no-print">
          <TextField
            size="small"
            value={qrUrl}
            fullWidth
            InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } }}
            label="Check-in URL"
          />
        </Stack>
      </DialogContent>

      <DialogActions className="no-print" sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadPng}>
          Download PNG
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
          Print
        </Button>
      </DialogActions>
    </Dialog>
  );
}
