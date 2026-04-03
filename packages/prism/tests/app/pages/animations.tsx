/**
 * Animations Test Page
 *
 * Renders animated components for testing prefers-reduced-motion.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Fade from '@mui/material/Fade';
import Grow from '@mui/material/Grow';
import Slide from '@mui/material/Slide';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { keyframes } from '@mui/material/styles';

const pulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

export function AnimationsTestPage() {
  const [showFade, setShowFade] = useState(true);
  const [showGrow, setShowGrow] = useState(true);
  const [showSlide, setShowSlide] = useState(true);
  const [showCollapse, setShowCollapse] = useState(true);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Animations Test Page
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        These animations should respect prefers-reduced-motion settings.
      </Typography>

      {/* Custom animated element for testing */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Custom Animation
        </Typography>
        <Box
          data-animated="true"
          sx={{
            width: 100,
            height: 100,
            bgcolor: 'primary.main',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.contrastText',
            animation: `${pulse} 2s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
              animationDuration: '0s',
            },
          }}
        >
          Pulse
        </Box>
      </Box>

      {/* Loading indicators */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Loading Indicators
        </Typography>
        <Box sx={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <CircularProgress />
          <Box sx={{ width: 200 }}>
            <LinearProgress />
          </Box>
        </Box>
      </Box>

      {/* Transition components */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Transition Components
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Button variant="outlined" onClick={() => setShowFade((prev) => !prev)}>
            Toggle Fade
          </Button>
          <Button variant="outlined" onClick={() => setShowGrow((prev) => !prev)}>
            Toggle Grow
          </Button>
          <Button variant="outlined" onClick={() => setShowSlide((prev) => !prev)}>
            Toggle Slide
          </Button>
          <Button variant="outlined" onClick={() => setShowCollapse((prev) => !prev)}>
            Toggle Collapse
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, minHeight: 120 }}>
          <Fade in={showFade}>
            <Paper sx={{ p: 2, width: 120 }}>Fade</Paper>
          </Fade>

          <Grow in={showGrow}>
            <Paper sx={{ p: 2, width: 120 }}>Grow</Paper>
          </Grow>

          <Slide direction="up" in={showSlide} mountOnEnter unmountOnExit>
            <Paper sx={{ p: 2, width: 120 }}>Slide</Paper>
          </Slide>
        </Box>

        <Collapse in={showCollapse}>
          <Paper sx={{ p: 2, mt: 2 }}>
            <Typography>Collapsible content</Typography>
          </Paper>
        </Collapse>
      </Box>
    </Box>
  );
}
