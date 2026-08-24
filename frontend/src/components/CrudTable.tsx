import { useEffect, useMemo, useState } from 'react';
import { Box, IconButton, Tooltip, Paper, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ConfirmDialog from './ConfirmDialog';

interface CrudTableProps<T extends Record<string, any>> {
  rows: T[];
  columns: GridColDef<T>[];
  loading?: boolean;
  getRowId: (row: T) => string | number;

  // server pagination (optional)
  rowCount?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;

  // row actions
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => Promise<void> | void;
  deleteConfirmMessage?: (row: T) => string;
  hideActions?: boolean;

  // Friendly empty-state copy shown when the grid has no rows. Falls back
  // to a generic "Nothing here yet" when nothing is passed.
  emptyMessage?: string;
  emptyHint?: string;
}

/**
 * MUI DataGrid wrapper used by every list page.
 * Adds Edit/Delete column + confirm-delete dialog out of the box.
 */
export default function CrudTable<T extends Record<string, any>>({
  rows, columns, loading, getRowId,
  rowCount, page, pageSize, onPageChange,
  onEdit, onDelete, deleteConfirmMessage, hideActions,
  emptyMessage, emptyHint,
}: CrudTableProps<T>) {
  const [pending, setPending] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Default every column to center-aligned (both cell + header) unless the
  // caller explicitly overrode `align` / `headerAlign`. Also strip the
  // per-column menu — pages shouldn't let users hide / pin / sort columns
  // ad-hoc (the layout is intentional).
  const normalizedColumns = useMemo<GridColDef<T>[]>(
    () => columns.map((col) => ({
      align:         col.align         ?? 'center',
      headerAlign:   col.headerAlign   ?? 'center',
      ...col,
      // Enforced regardless of caller intent: no per-column hide/pin menu.
      disableColumnMenu: true,
    })),
    [columns],
  );

  const allColumns = useMemo<GridColDef<T>[]>(() => {
    if (hideActions || (!onEdit && !onDelete)) return normalizedColumns;
    const actionsCol: GridColDef<T> = {
      field: '__actions',
      headerName: '',
      // Slim — just two icon buttons. Was 110px which pushed the column off
      // screen on standard 1280-wide viewports once the sidebar was open.
      width: 88,
      minWidth: 88,
      sortable: false,
      filterable: false,
      align: 'center',
      headerAlign: 'center',
      disableColumnMenu: true,
      renderCell: (p) => (
        <Box>
          {onEdit && (
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => onEdit(p.row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => setPending(p.row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ),
    };
    return [...normalizedColumns, actionsCol];
  }, [normalizedColumns, onEdit, onDelete, hideActions]);

  const isServer = typeof rowCount === 'number';

  function handlePagination(model: GridPaginationModel) {
    if (onPageChange) onPageChange(model.page + 1, model.pageSize);
  }

  async function confirmDelete() {
    if (!pending || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(pending);
    } finally {
      setDeleting(false);
      setPending(null);
    }
  }

  return (
    <Paper>
      <DataGrid<T>
        autoHeight
        rows={rows}
        columns={allColumns}
        getRowId={getRowId}
        loading={loading}
        disableRowSelectionOnClick
        disableColumnResize
        disableColumnReorder
        disableColumnMenu
        slots={{
          noRowsOverlay: () => (
            <Box sx={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              height: '100%', minHeight: 200,
              color: 'text.secondary', textAlign: 'center', px: 3,
            }}>
              <InboxOutlinedIcon sx={{ fontSize: 40, opacity: 0.5, mb: 1 }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {emptyMessage || 'Nothing here yet.'}
              </Typography>
              {emptyHint && (
                <Typography variant="caption" sx={{ mt: 0.5, opacity: 0.8 }}>
                  {emptyHint}
                </Typography>
              )}
            </Box>
          ),
        }}
        {...(isServer ? {
          pagination: true as const,
          paginationMode: 'server' as const,
          rowCount: rowCount || 0,
          paginationModel: { page: (page || 1) - 1, pageSize: pageSize || 10 },
          pageSizeOptions: [10, 25, 50, 100],
          onPaginationModelChange: handlePagination,
        } : {
          initialState: { pagination: { paginationModel: { pageSize: 25, page: 0 } } },
          pageSizeOptions: [10, 25, 50, 100],
        })}
      />
      <ConfirmDialog
        open={!!pending}
        title="Delete this item?"
        message={pending && deleteConfirmMessage ? deleteConfirmMessage(pending) : 'This action cannot be undone for hard-deleted rows; soft-deleted rows are flagged trash=1.'}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </Paper>
  );
}
