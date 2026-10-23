/**
 * Theme-native composition primitives. These are the original MUI components,
 * with their complete types, keyboard behavior and slot APIs, under Prism's
 * supported package surface. No duplicate state, styling engine or wrappers.
 * Use createPrismTheme / PrismThemeProvider when composing a small application;
 * use PrismProvider for the full settings/localization stack.
 */
export {
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  FormControlLabel,
  FormLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
export type { ButtonProps, TextFieldProps, SliderProps, SxProps, Theme } from '@mui/material';
export { ThemeProvider as PrismThemeProvider, useTheme } from '@mui/material/styles';
export { default as useMediaQuery } from '@mui/material/useMediaQuery';

export { default as Breadcrumbs } from '@mui/material/Breadcrumbs';

export { default as SvgIcon } from '@mui/material/SvgIcon';
export type { SvgIconProps } from '@mui/material/SvgIcon';
export {
  PrismIconProvider,
  prismIconNames,
  type PrismIconSet,
  type PrismIconName,
  type PrismIconComponent,
} from '../icons/context.js';
