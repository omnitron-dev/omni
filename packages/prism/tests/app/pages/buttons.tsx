/**
 * Buttons Test Page
 *
 * Renders various button types for accessibility testing.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Fab from '@mui/material/Fab';
import ButtonGroup from '@mui/material/ButtonGroup';
import LoadingButton from '@mui/lab/LoadingButton';

// Icons
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import MenuIcon from '@mui/icons-material/Menu';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshIcon from '@mui/icons-material/Refresh';

export function ButtonsTestPage() {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Buttons Test Page
      </Typography>

      {/* Regular buttons with text */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Text Buttons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained">Save Changes</Button>
          <Button variant="contained" color="secondary">
            Cancel
          </Button>
          <Button variant="outlined">Edit Profile</Button>
          <Button variant="text">Learn More</Button>
          <Button disabled>Disabled</Button>
        </Box>
      </Box>

      {/* Buttons with icons and text */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Buttons with Icons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<SaveIcon />}>
            Save
          </Button>
          <Button variant="contained" endIcon={<DeleteIcon />} color="error">
            Delete
          </Button>
          <Button variant="outlined" startIcon={<EditIcon />}>
            Edit
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />}>
            Add Item
          </Button>
        </Box>
      </Box>

      {/* Icon-only buttons (must have aria-label) */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Icon-Only Buttons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <IconButton aria-label="Search">
            <SearchIcon />
          </IconButton>
          <IconButton aria-label="Settings">
            <SettingsIcon />
          </IconButton>
          <IconButton aria-label="Close">
            <CloseIcon />
          </IconButton>
          <IconButton aria-label="Open menu">
            <MenuIcon />
          </IconButton>
          <IconButton aria-label="More options">
            <MoreVertIcon />
          </IconButton>
          <IconButton aria-label="Refresh" color="primary">
            <RefreshIcon />
          </IconButton>
          <IconButton aria-label="Delete" color="error">
            <DeleteIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Floating action buttons */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Floating Action Buttons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Fab color="primary" aria-label="Add item">
            <AddIcon />
          </Fab>
          <Fab color="secondary" aria-label="Edit">
            <EditIcon />
          </Fab>
          <Fab variant="extended" color="primary">
            <AddIcon sx={{ mr: 1 }} />
            Add Item
          </Fab>
        </Box>
      </Box>

      {/* Button groups */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Button Groups
        </Typography>
        <ButtonGroup variant="contained" aria-label="Formatting options">
          <Button aria-label="Bold">B</Button>
          <Button aria-label="Italic">I</Button>
          <Button aria-label="Underline">U</Button>
        </ButtonGroup>
      </Box>

      {/* Loading buttons */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Loading Buttons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <LoadingButton loading variant="contained">
            Submit
          </LoadingButton>
          <LoadingButton loading loadingIndicator="Loading..." variant="outlined">
            Fetch data
          </LoadingButton>
          <LoadingButton loading loadingPosition="start" startIcon={<SaveIcon />} variant="contained">
            Save
          </LoadingButton>
        </Box>
      </Box>

      {/* Submit button for form navigation test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Form Submit
        </Typography>
        <Button type="submit" variant="contained">
          Submit
        </Button>
      </Box>
    </Box>
  );
}
