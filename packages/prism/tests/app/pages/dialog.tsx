/**
 * Dialog Test Page
 *
 * Renders ConfirmDialog and DeleteDialog for E2E testing.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { ConfirmDialog, DeleteDialog } from '../../../src/components/confirm-dialog';

export function DialogTestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoadingMode = searchParams.get('loading') === 'true';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [asyncDialogOpen, setAsyncDialogOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = () => {
    setConfirmed(true);
    setConfirmOpen(false);
  };

  const handleAsyncConfirm = async () => {
    setLoading(true);
    // Simulate async operation - stays loading for tests
    await new Promise((resolve) => setTimeout(resolve, 5000));
    setLoading(false);
    setAsyncDialogOpen(false);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Dialog Test Page
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Button variant="contained" onClick={() => setConfirmOpen(true)}>
          Open Dialog
        </Button>

        <Button variant="contained" color="error" onClick={() => setDeleteOpen(true)}>
          Delete Item
        </Button>

        {isLoadingMode && (
          <Button variant="contained" color="secondary" onClick={() => setAsyncDialogOpen(true)}>
            Open Async Dialog
          </Button>
        )}
      </Box>

      {confirmed && (
        <Typography color="success.main" sx={{ mb: 2 }}>
          Confirmed!
        </Typography>
      )}

      {/* Standard Confirm Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="Confirm Action"
        content="Are you sure you want to proceed with this action?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      />

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => setDeleteOpen(false)}
        itemName="Test Item"
      />

      {/* Async Dialog with Loading */}
      <ConfirmDialog
        open={asyncDialogOpen}
        onClose={() => setAsyncDialogOpen(false)}
        onConfirm={handleAsyncConfirm}
        title="Async Confirm"
        content="This dialog simulates an async operation."
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        loading={loading}
      />
    </Box>
  );
}
