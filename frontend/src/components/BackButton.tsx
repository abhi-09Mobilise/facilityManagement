// Global Back button injected by AppLayout above every authenticated page.
//
// Hidden on the role-home routes (where "back" would either exit the app
// or loop in place) — bookers / approvers / admins should never see it on
// their landing screen.
//
// Click behaviour:
//   1. Try browser-history back via navigate(-1). Covers the 95% case
//      where the user got here via a link.
//   2. If history is empty (deep-link entry, e.g. they pasted /admin/sites
//      into a new tab), fall back to "/" → RoleHomeRedirect picks the
//      right landing page per role.

import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

// Paths where we do NOT show the back button. Matches the same set
// RoleHomeRedirect can land on.
const HIDE_ON: string[] = [
  '/',
  '/dashboard',
  '/facility',
  '/approvals',
  '/my-bookings',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

export default function BackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Exact-match hide list. Sub-routes (e.g. /facility/type/xyz) still get
  // a back button, which is the desired behaviour — they're not the home.
  if (HIDE_ON.includes(pathname)) return null;

  // Don't render on the public portal (anonymous visitors) either —
  // AppLayout wraps those too in some setups but we keep them clean.
  if (pathname.startsWith('/p/')) return null;

  function handleBack() {
    // history.length >= 2 means we have a previous entry to pop.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      Back
    </Button>
  );
}
