import {
  Dialog, DialogContent, DialogActions, Box, Typography, Button, Stack, IconButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import CloseIcon from '@mui/icons-material/Close';

interface Props {
  open: boolean;
  bookingId: string;
  pending?: boolean;   // true when the booking went into a workflow
  onClose: () => void;
  onCreateNew: () => void;
  onViewDetails: () => void;
}

export default function BookingSuccessDialog({
  open, bookingId, pending = false, onClose, onCreateNew, onViewDetails,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </Box>
      <DialogContent sx={{ pt: 0 }}>
        <Stack alignItems="center" spacing={1}>
          {pending ? (
            <HourglassTopIcon color="warning" sx={{ fontSize: 64 }} />
          ) : (
            <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
          )}
          <Typography variant="h6" sx={{ fontWeight: 700, textAlign: 'center' }}>
            {pending ? 'Booking sent for approval' : 'Booking confirmed'}
          </Typography>
        </Stack>

        <Stack direction="row" justifyContent="space-between" sx={{ mt: 3, py: 1, borderBottom: '1px dashed', borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Booking ID</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{bookingId}</Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {pending
            ? 'Your manager will review it shortly. You\'ll get an email once it\'s decided. Track its status under My bookings.'
            : 'You\'re all set. View the booking details or create another booking.'}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" fullWidth onClick={onCreateNew}>Create New Booking</Button>
        <Button variant="contained" fullWidth onClick={onViewDetails}>View Booking Details</Button>
      </DialogActions>
    </Dialog>
  );
}
