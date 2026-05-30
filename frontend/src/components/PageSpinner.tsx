// Full-area spinner used as the <Suspense> fallback for lazy-loaded routes
// and lazy in-page components (Gantt timeline tab, layout editor modal, …).
//
// Deliberately minimal — a single centred Loader2 with a soft brand tint.
// Nothing in the bundle that isn't already imported elsewhere.

import { Loader2 } from 'lucide-react';

interface Props {
  /** Optional label shown under the spinner. Empty by default. */
  label?: string;
  /** Tailwind padding/height tweak — defaults to page-sized. */
  className?: string;
}

export default function PageSpinner({ label, className }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={
        'flex flex-col items-center justify-center gap-2 ' +
        'py-16 w-full text-brand-navy ' +
        (className || '')
      }
    >
      <Loader2 className="h-7 w-7 animate-spin" />
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
    </div>
  );
}
