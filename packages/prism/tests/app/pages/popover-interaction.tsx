import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Dialog, DialogContent, DialogTitle, Menu, MenuItem, Select } from '../../../src/ui';
import { CustomPopover } from '../../../src/components/popover';

// Keep the real Grow exit in progress long enough to test hit testing directly.
// No transition mocks, pointer forwarding or focus workarounds are installed.
const transitionDuration = { enter: 0, exit: 10_000 };

export function PopoverInteractionTestPage() {
  const [params] = useSearchParams();
  const kind = params.get('kind') ?? 'menu';
  const inDialog = params.has('dialog');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('Initial');
  const [actions, setActions] = useState(0);
  const [backgroundActions, setBackgroundActions] = useState(0);
  const close = () => setOpen(false);
  const choose = () => { setSelected('Selected'); close(); };
  const dialog = (content: ReactNode) => inDialog
    ? <Dialog open aria-labelledby="preferences-title">
      <DialogTitle id="preferences-title">Preferences</DialogTitle>
      <DialogContent>{content}</DialogContent>
    </Dialog>
    : content;

  return <Box sx={{ p: 3 }}>
    <Button onClick={() => setBackgroundActions(value => value + 1)}>Background action</Button>
    <output data-testid="background-actions">{backgroundActions}</output>
    {dialog(<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3 }}>
      {kind === 'select' ? <Select
        value={selected}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={close}
        onChange={event => setSelected(event.target.value)}
        inputProps={{ 'aria-label': 'Choose value' }}
        MenuProps={{ transitionDuration, keepMounted: params.has('keepMounted') }}
      >
        <MenuItem value="Initial">Initial</MenuItem>
        <MenuItem value="Selected">Selected</MenuItem>
      </Select> : <Button
        aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={open}
        onClick={event => { setAnchor(event.currentTarget); setOpen(true); }}
      >Choose value</Button>}
      <Button onClick={() => setActions(value => value + 1)}>Adjacent action</Button>
      <output data-testid="actions">{actions}</output>
      <output data-testid="selection">{selected}</output>
      {kind === 'menu' && <Menu
        open={open} anchorEl={anchor} onClose={close}
        transitionDuration={transitionDuration} keepMounted={params.has('keepMounted')}
      >
        <MenuItem onClick={choose}>Select value</MenuItem>
      </Menu>}
      {kind === 'popover' && <CustomPopover
        open={open} anchorEl={anchor} onClose={close}
        transitionDuration={transitionDuration} keepMounted={params.has('keepMounted')}
      >
        <Button onClick={choose}>Select value</Button>
      </CustomPopover>}
    </Box>)}
  </Box>;
}
