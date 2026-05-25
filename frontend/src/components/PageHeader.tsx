import { Box, Stack, Typography, Button, IconButton, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  back?: string | true;          // string = nav target, true = navigate(-1)
  onRefresh?: () => void;
  addLabel?: string;
  onAdd?: () => void;
  children?: ReactNode;           // extra action buttons
}

export default function PageHeader({
  title, subtitle, back, onRefresh, addLabel, onAdd, children,
}: Props) {
  const navigate = useNavigate();
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        {back && (
          <Tooltip title="Back">
            <IconButton size="small" onClick={() => typeof back === 'string' ? navigate(back) : navigate(-1)}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {onRefresh && (
          <Button startIcon={<RefreshIcon />} onClick={onRefresh}>Refresh</Button>
        )}
        {children}
        {onAdd && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd}>
            {addLabel || 'New'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
