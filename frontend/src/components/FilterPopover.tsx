// Filter icon button + popover shell used by every master list page.
//
// The parent owns the draft filter state and passes the fields as children.
// The shell handles:
//   - filter-list icon with an active-count badge
//   - open / close
//   - "Apply" + "Clear" buttons at the bottom
//   - seeding draft ← committed on open, via the caller's onOpen callback
//
// Typical usage on a list page:
//
//   const [q, setQ] = useState('');
//   const [draftQ, setDraftQ] = useState('');
//
//   <FilterPopover
//     count={q ? 1 : 0}
//     onOpen={() => setDraftQ(q)}
//     onApply={() => setQ(draftQ)}
//     onClear={() => { setDraftQ(''); setQ(''); }}
//   >
//     <TextField label="Search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
//   </FilterPopover>

import { useRef, useState, type ReactNode } from 'react';
import {
  Badge, Button, IconButton, Menu, Stack, Tooltip, Typography,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

interface Props {
  /** Active-filter count shown as a badge on the icon. */
  count: number;
  /** Fired when the popover opens - use to seed draft state from committed state. */
  onOpen?: () => void;
  /** Fired when the user clicks Apply. */
  onApply: () => void;
  /** Fired when the user clicks Clear. */
  onClear: () => void;
  /** Optional: disable the Apply button (e.g. no changes made). */
  applyDisabled?: boolean;
  /** Filter fields — usually bound to the parent's draft state. */
  children: ReactNode;
}

export default function FilterPopover({
  count, onOpen, onApply, onClear, applyDisabled, children,
}: Props) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  function handleOpen() {
    setOpen(true);
    onOpen?.();
  }
  function handleApply() {
    onApply();
    setOpen(false);
  }
  function handleClear() {
    onClear();
    setOpen(false);
  }

  return (
    <>
      <Tooltip title="Filters">
        <IconButton ref={anchorRef} onClick={handleOpen} size="medium">
          <Badge color="primary" badgeContent={count} invisible={count === 0}>
            <FilterListIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        MenuListProps={{ sx: { p: 2, minWidth: 280 } }}
      >
        <Stack spacing={2}>
          <Typography variant="subtitle2">Filters</Typography>
          {children}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={handleClear} disabled={count === 0}>Clear</Button>
            <Button size="small" variant="contained" onClick={handleApply} disabled={applyDisabled}>
              Apply
            </Button>
          </Stack>
        </Stack>
      </Menu>
    </>
  );
}
