import { useEffect, useMemo, useState } from 'react';
import { Box, IconButton, Tooltip, Paper } from '@mui/material';
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
}

/**
 * MUI DataGrid wrapper used by every list page.
 * Adds Edit/Delete column + confirm-delete dialog out of the box.
 */
export default function CrudTable<T extends Record<string, any>>({
  rows, columns, loading, getRowId,
  rowCount, page, pageSize, onPageChange,
  onEdit, onDelete, deleteConfirmMessage, hideActions,
}: CrudTableProps<T>) {
  const [pending, setPending] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allColumns = useMemo<GridColDef<T>[]>(() => {
    if (hideActions || (!onEdit && !onDelete)) return columns;
    const actionsCol: GridColDef<T> = {
      field: '__actions',
      headerName: '',
      width: 110,
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
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
    return [...columns, actionsCol];
  }, [columns, onEdit, onDelete, hideActions]);

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
        {...(isServer ? {
          pagination: true as const,
          paginationMode: 'server' as const,
          rowCount: rowCount || 0,
          paginationModel: { page: (page || 1) - 1, pageSize: pageSize || 10 },
          pageSizeOptions: [10, 25, 50],
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
