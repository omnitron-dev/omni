import SvgIcon from '@mui/material/SvgIcon';
import type { SvgIconProps } from '@mui/material/SvgIcon';

// ---------------------------------------------------------------------------
// 1. DashboardIcon — grid/chart layout (4 rounded squares)
// ---------------------------------------------------------------------------

export const DashboardIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2 6C2 4.46 2 3.69 2.35 3.12C2.54 2.81 2.81 2.54 3.12 2.35C3.69 2 4.46 2 6 2C7.54 2 8.31 2 8.88 2.35C9.19 2.54 9.46 2.81 9.65 3.12C10 3.69 10 4.46 10 6C10 7.54 10 8.31 9.65 8.88C9.46 9.19 9.19 9.46 8.88 9.65C8.31 10 7.54 10 6 10C4.46 10 3.69 10 3.12 9.65C2.81 9.46 2.54 9.19 2.35 8.88C2 8.31 2 7.54 2 6Z"
    />
    <path
      fill="currentColor"
      opacity="0.2"
      d="M14 18C14 16.46 14 15.69 14.35 15.12C14.54 14.81 14.81 14.54 15.12 14.35C15.69 14 16.46 14 18 14C19.54 14 20.31 14 20.88 14.35C21.19 14.54 21.46 14.81 21.65 15.12C22 15.69 22 16.46 22 18C22 19.54 22 20.31 21.65 20.88C21.46 21.19 21.19 21.46 20.88 21.65C20.31 22 19.54 22 18 22C16.46 22 15.69 22 15.12 21.65C14.81 21.46 14.54 21.19 14.35 20.88C14 20.31 14 19.54 14 18Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M2 6C2 4.46 2 3.69 2.35 3.12C2.54 2.81 2.81 2.54 3.12 2.35C3.69 2 4.46 2 6 2C7.54 2 8.31 2 8.88 2.35C9.19 2.54 9.46 2.81 9.65 3.12C10 3.69 10 4.46 10 6C10 7.54 10 8.31 9.65 8.88C9.46 9.19 9.19 9.46 8.88 9.65C8.31 10 7.54 10 6 10C4.46 10 3.69 10 3.12 9.65C2.81 9.46 2.54 9.19 2.35 8.88C2 8.31 2 7.54 2 6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M14 6C14 4.46 14 3.69 14.35 3.12C14.54 2.81 14.81 2.54 15.12 2.35C15.69 2 16.46 2 18 2C19.54 2 20.31 2 20.88 2.35C21.19 2.54 21.46 2.81 21.65 3.12C22 3.69 22 4.46 22 6C22 7.54 22 8.31 21.65 8.88C21.46 9.19 21.19 9.46 20.88 9.65C20.31 10 19.54 10 18 10C16.46 10 15.69 10 15.12 9.65C14.81 9.46 14.54 9.19 14.35 8.88C14 8.31 14 7.54 14 6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M2 18C2 16.46 2 15.69 2.35 15.12C2.54 14.81 2.81 14.54 3.12 14.35C3.69 14 4.46 14 6 14C7.54 14 8.31 14 8.88 14.35C9.19 14.54 9.46 14.81 9.65 15.12C10 15.69 10 16.46 10 18C10 19.54 10 20.31 9.65 20.88C9.46 21.19 9.19 21.46 8.88 21.65C8.31 22 7.54 22 6 22C4.46 22 3.69 22 3.12 21.65C2.81 21.46 2.54 21.19 2.35 20.88C2 20.31 2 19.54 2 18Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M14 18C14 16.46 14 15.69 14.35 15.12C14.54 14.81 14.81 14.54 15.12 14.35C15.69 14 16.46 14 18 14C19.54 14 20.31 14 20.88 14.35C21.19 14.54 21.46 14.81 21.65 15.12C22 15.69 22 16.46 22 18C22 19.54 22 20.31 21.65 20.88C21.46 21.19 21.19 21.46 20.88 21.65C20.31 22 19.54 22 18 22C16.46 22 15.69 22 15.12 21.65C14.81 21.46 14.54 21.19 14.35 20.88C14 20.31 14 19.54 14 18Z"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 2. AppsIcon — layered squares/blocks
// ---------------------------------------------------------------------------

export const AppsIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2 6C2 3.79 3.79 2 6 2H18C20.21 2 22 3.79 22 6V14C22 16.21 20.21 18 18 18H6C3.79 18 2 16.21 2 14V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 6C2 3.79 3.79 2 6 2H18C20.21 2 22 3.79 22 6V14C22 16.21 20.21 18 18 18H6C3.79 18 2 16.21 2 14V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 22H19"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M9 22V18M15 22V18"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M9 7V13M12 9.5V13M15 7V13"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 3. LogsIcon — terminal/document with lines
// ---------------------------------------------------------------------------

export const LogsIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M4 4C4 2.9 4.9 2 6 2H18C19.1 2 20 2.9 20 4V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 4C4 2.9 4.9 2 6 2H18C19.1 2 20 2.9 20 4V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M8 7H16M8 11H14M8 15H12"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 4. MetricsIcon — bar chart
// ---------------------------------------------------------------------------

export const MetricsIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M3.89 3.89C2.5 5.28 2.5 7.52 2.5 12C2.5 16.48 2.5 18.72 3.89 20.11C5.28 21.5 7.52 21.5 12 21.5C16.48 21.5 18.72 21.5 20.11 20.11C21.5 18.72 21.5 16.48 21.5 12C21.5 7.52 21.5 5.28 20.11 3.89C18.72 2.5 16.48 2.5 12 2.5C7.52 2.5 5.28 2.5 3.89 3.89Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.89 3.89C2.5 5.28 2.5 7.52 2.5 12C2.5 16.48 2.5 18.72 3.89 20.11C5.28 21.5 7.52 21.5 12 21.5C16.48 21.5 18.72 21.5 20.11 20.11C21.5 18.72 21.5 16.48 21.5 12C21.5 7.52 21.5 5.28 20.11 3.89C18.72 2.5 16.48 2.5 12 2.5C7.52 2.5 5.28 2.5 3.89 3.89Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M7 17V14M12 17V8M17 17V11"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 5. AlertIcon — bell with exclamation
// ---------------------------------------------------------------------------

export const AlertIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2.53 14.77C2.32 16.16 3.27 17.13 4.43 17.61C8.89 19.46 15.11 19.46 19.57 17.61C20.73 17.13 21.68 16.16 21.47 14.77C21.34 13.91 20.69 13.2 20.21 12.5C19.59 11.58 19.53 10.57 19.52 9.5C19.52 5.36 16.16 2 12 2C7.84 2 4.48 5.36 4.48 9.5C4.47 10.57 4.41 11.58 3.79 12.5C3.31 13.2 2.66 13.91 2.53 14.77Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.53 14.77C2.32 16.16 3.27 17.13 4.43 17.61C8.89 19.46 15.11 19.46 19.57 17.61C20.73 17.13 21.68 16.16 21.47 14.77C21.34 13.91 20.69 13.2 20.21 12.5C19.59 11.58 19.53 10.57 19.52 9.5C19.52 5.36 16.16 2 12 2C7.84 2 4.48 5.36 4.48 9.5C4.47 10.57 4.41 11.58 3.79 12.5C3.31 13.2 2.66 13.91 2.53 14.77Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 19C8.46 20.73 10.08 22 12 22C13.92 22 15.54 20.73 16 19"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 7V11M12 13.5V13.51"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 6. NodesIcon — server rack / connected nodes
// ---------------------------------------------------------------------------

export const NodesIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2 5C2 3.9 2.9 3 4 3H20C21.1 3 22 3.9 22 5V7C22 8.1 21.1 9 20 9H4C2.9 9 2 8.1 2 7V5Z"
    />
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2 17C2 15.9 2.9 15 4 15H20C21.1 15 22 15.9 22 17V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V17Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 5C2 3.9 2.9 3 4 3H20C21.1 3 22 3.9 22 5V7C22 8.1 21.1 9 20 9H4C2.9 9 2 8.1 2 7V5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 17C2 15.9 2.9 15 4 15H20C21.1 15 22 15.9 22 17V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V17Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M6 6H6.01M6 18H6.01"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 9V15"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 7. ContainersIcon — box/cube
// ---------------------------------------------------------------------------

export const ContainersIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 12L3 7M12 12V22M12 12L21 7"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 8. DeployIcon — rocket launch
// ---------------------------------------------------------------------------

export const DeployIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12.393 2.91C12.2892 2.75236 12.1444 2.6246 11.974 2.54019C11.8037 2.45577 11.6138 2.41776 11.4234 2.43C8.61 2.63 5.79 5.95 5 8.55C4.73 9.41 5.06 10.27 5.8 10.87L7.5 12.22C7.56 12.27 7.59 12.35 7.58 12.44L7.22 15.61C7.13 16.42 7.72 17.14 8.54 17.24C8.6 17.25 8.67 17.25 8.73 17.25L12 17V2.96C12.14 2.94 12.27 2.93 12.393 2.91Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 17L8.73 17.25C7.9 17.33 7.17 16.73 7.09 15.9L6.73 12.73C6.72 12.64 6.67 12.56 6.6 12.5L4.9 11.15C4.16 10.55 3.83 9.69 4.1 8.83C4.89 6.23 8.02 2.57 11.42 2.43C12.48 2.39 13.54 2.91 14.36 3.73C16 5.37 17.2 8.45 16.6 12C16.32 13.6 15.52 15.15 14.4 16.26L12 17Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 7.5C12.83 7.5 13.5 8.17 13.5 9C13.5 9.83 12.83 10.5 12 10.5C11.17 10.5 10.5 9.83 10.5 9C10.5 8.17 11.17 7.5 12 7.5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 19L8 17M7 22L12 17"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 9. SettingsIcon — gear
// ---------------------------------------------------------------------------

export const SettingsIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M15.5 12C15.5 13.93 13.93 15.5 12 15.5C10.07 15.5 8.5 13.93 8.5 12C8.5 10.07 10.07 8.5 12 8.5C13.93 8.5 15.5 10.07 15.5 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M21.5 14.53L21.26 14.53C20.41 14.47 19.68 15.13 19.62 15.98C19.6 16.23 19.65 16.47 19.76 16.69L19.89 16.94C20.29 17.69 20.02 18.63 19.27 19.03L18.73 19.34C17.98 19.74 17.04 19.47 16.64 18.72L16.51 18.47C16.08 17.73 15.12 17.46 14.38 17.89L14.38 17.89C13.64 18.31 13.37 19.27 13.79 20.01L13.92 20.26C14.32 21.01 14.05 21.95 13.3 22.35L12.76 22.66C12.01 23.06 11.07 22.79 10.67 22.04L10.54 21.79C10.11 21.05 9.15 20.78 8.41 21.21L8.41 21.21C7.67 21.64 7.4 22.59 7.83 23.34V23.34"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M15.5 12C15.5 13.93 13.93 15.5 12 15.5C10.07 15.5 8.5 13.93 8.5 12C8.5 10.07 10.07 8.5 12 8.5C13.93 8.5 15.5 10.07 15.5 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M2.5 14.53L2.74 14.53C3.59 14.47 4.32 15.13 4.38 15.98C4.4 16.23 4.35 16.47 4.24 16.69L4.11 16.94C3.71 17.69 3.98 18.63 4.73 19.03L5.27 19.34C6.02 19.74 6.96 19.47 7.36 18.72L7.49 18.47C7.92 17.73 8.88 17.46 9.62 17.89V17.89C10.36 18.31 10.63 19.27 10.21 20.01L10.08 20.26C9.68 21.01 9.95 21.95 10.7 22.35L11.24 22.66"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M21.99 8.37C22.03 8.04 21.36 6.88 21.01 6.28C20.64 5.63 20.45 5.31 20.13 5.18C19.82 5.05 19.46 5.15 18.74 5.35L17.52 5.7C17.06 5.8 16.58 5.74 16.16 5.53L15.82 5.33C15.46 5.1 15.19 4.76 15.03 4.36L14.7 3.37C14.48 2.71 14.37 2.38 14.11 2.19C13.85 2 13.5 2 12.81 2H11.69C10.99 2 10.65 2 10.39 2.19C10.13 2.38 10.02 2.71 9.8 3.37L9.46 4.36C9.31 4.76 9.03 5.1 8.68 5.33L8.34 5.53C7.92 5.74 7.44 5.8 6.98 5.7L5.76 5.35C5.04 5.15 4.68 5.05 4.37 5.18C4.05 5.31 3.86 5.63 3.49 6.28C3.14 6.88 2.47 8.04 2.5 8.37C2.54 8.69 2.77 8.95 3.24 9.47L4.27 10.63C4.52 10.94 4.7 11.5 4.7 12C4.7 12.5 4.52 13.06 4.27 13.37L3.24 14.53C2.77 15.05 2.54 15.31 2.5 15.63C2.47 15.96 2.64 16.26 3 16.87L3.49 17.72C3.86 18.37 4.05 18.69 4.37 18.82C4.68 18.95 5.04 18.85 5.76 18.65L6.98 18.3C7.44 18.2 7.92 18.26 8.34 18.47L8.68 18.67C9.03 18.9 9.31 19.24 9.46 19.64L9.8 20.63C10.02 21.29 10.13 21.62 10.39 21.81C10.65 22 10.99 22 11.69 22H12.81C13.5 22 13.85 22 14.11 21.81C14.37 21.62 14.48 21.29 14.7 20.63L15.03 19.64C15.19 19.24 15.46 18.9 15.82 18.67L16.16 18.47C16.58 18.26 17.06 18.2 17.52 18.3L18.74 18.65C19.46 18.85 19.82 18.95 20.13 18.82C20.45 18.69 20.64 18.37 21.01 17.72L21.5 16.87C21.85 16.26 22.03 15.96 21.99 15.63C21.96 15.31 21.73 15.05 21.26 14.53L20.23 13.37C19.98 13.06 19.8 12.5 19.8 12C19.8 11.5 19.98 10.94 20.23 10.63L21.26 9.47C21.73 8.95 21.96 8.69 21.99 8.37Z"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 10. SearchIcon — magnifying glass
// ---------------------------------------------------------------------------

export const SearchIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M20 11C20 6.03 15.97 2 11 2C6.03 2 2 6.03 2 11C2 15.97 6.03 20 11 20C15.97 20 20 15.97 20 11Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M20 11C20 6.03 15.97 2 11 2C6.03 2 2 6.03 2 11C2 15.97 6.03 20 11 20C15.97 20 20 15.97 20 11Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.5 17.5L22 22"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 11. RefreshIcon — circular arrows
// ---------------------------------------------------------------------------

export const RefreshIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 3C7.03 3 3 7.03 3 12C3 16.97 7.03 21 12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.65 6.35C16.2 4.9 14.21 4 12 4C7.58 4 4.01 7.58 4.01 12C4.01 16.42 7.58 20 12 20C15.73 20 18.84 17.45 19.73 14"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20 4V10H14"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 12. PlayIcon — play triangle
// ---------------------------------------------------------------------------

export const PlayIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M18.89 11.15L7.38 4.17C6.55 3.66 5.5 4.26 5.5 5.22V18.78C5.5 19.74 6.55 20.34 7.38 19.83L18.89 12.85C19.67 12.37 19.67 11.63 18.89 11.15Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18.89 11.15L7.38 4.17C6.55 3.66 5.5 4.26 5.5 5.22V18.78C5.5 19.74 6.55 20.34 7.38 19.83L18.89 12.85C19.67 12.37 19.67 11.63 18.89 11.15Z"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 13. StopIcon — square stop
// ---------------------------------------------------------------------------

export const StopIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M6 4C4.9 4 4 4.9 4 6V18C4 19.1 4.9 20 6 20H18C19.1 20 20 19.1 20 18V6C20 4.9 19.1 4 18 4H6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 4C4.9 4 4 4.9 4 6V18C4 19.1 4.9 20 6 20H18C19.1 20 20 19.1 20 18V6C20 4.9 19.1 4 18 4H6Z"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 14. RestartIcon — circular arrow with break
// ---------------------------------------------------------------------------

export const RestartIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12C4 9.79 4.9 7.79 6.34 6.34"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12C4 9.79 4.9 7.79 6.34 6.34"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8V4H8"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 15. CloseIcon — X mark
// ---------------------------------------------------------------------------

export const CloseIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 9L9 15M9 9L15 15"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 16. CheckIcon — checkmark
// ---------------------------------------------------------------------------

export const CheckIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 12.5L10.5 15L16 9"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 17. PlusIcon — plus sign
// ---------------------------------------------------------------------------

export const PlusIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 8V16M8 12H16"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 18. ChevronRightIcon — right chevron
// ---------------------------------------------------------------------------

export const ChevronRightIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 6L15 12L9 18"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 19. TerminalIcon — terminal prompt >_
// ---------------------------------------------------------------------------

export const TerminalIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M3 6C3 4.34 4.34 3 6 3H18C19.66 3 21 4.34 21 6V18C21 19.66 19.66 21 18 21H6C4.34 21 3 19.66 3 18V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 6C3 4.34 4.34 3 6 3H18C19.66 3 21 4.34 21 6V18C21 19.66 19.66 21 18 21H6C4.34 21 3 19.66 3 18V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7 15L10 12L7 9"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M13 15H17"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 20. PipelineIcon — workflow/pipeline steps
// ---------------------------------------------------------------------------

export const PipelineIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M4 6C4 4.9 4.9 4 6 4H10C11.1 4 12 4.9 12 6V10C12 11.1 11.1 12 10 12H6C4.9 12 4 11.1 4 10V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 6C4 4.9 4.9 4 6 4H10C11.1 4 12 4.9 12 6V10C12 11.1 11.1 12 10 12H6C4.9 12 4 11.1 4 10V6Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14 14H18C19.1 14 20 14.9 20 16V18C20 19.1 19.1 20 18 20H16C14.9 20 14 19.1 14 18V14Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 8H14M14 8V14M8 12V14H14"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 21. TraceIcon — signal/wave trace
// ---------------------------------------------------------------------------

export const TraceIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 12H7L9 7L12 17L15 9L17 12H21"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 22. BackupIcon — database with arrow
// ---------------------------------------------------------------------------

export const BackupIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 3C7.58 3 4 4.79 4 7V17C4 19.21 7.58 21 12 21C16.42 21 20 19.21 20 17V7C20 4.79 16.42 3 12 3Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M4 7C4 4.79 7.58 3 12 3C16.42 3 20 4.79 20 7M4 7V17C4 19.21 7.58 21 12 21C16.42 21 20 19.21 20 17V7M4 7C4 9.21 7.58 11 12 11C16.42 11 20 9.21 20 7M4 12C4 14.21 7.58 16 12 16C16.42 16 20 14.21 20 12"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 15V19M12 19L14 17M12 19L10 17"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 23. DashboardBuilderIcon — dashboard with plus
// ---------------------------------------------------------------------------

export const DashboardBuilderIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M3 5C3 3.9 3.9 3 5 3H19C20.1 3 21 3.9 21 5V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 5C3 3.9 3.9 3 5 3H19C20.1 3 21 3.9 21 5V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M3 9H21M9 9V21"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M15 13V17M13 15H17"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 24. KubernetesIcon — helm wheel
// ---------------------------------------------------------------------------

export const KubernetesIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 8V16M8.5 10L15.5 14M15.5 10L8.5 14"
    />
    <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 25. ServerIcon — server tower
// ---------------------------------------------------------------------------

export const ServerIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M4 5C4 3.34 5.34 2 7 2H17C18.66 2 20 3.34 20 5V19C20 20.66 18.66 22 17 22H7C5.34 22 4 20.66 4 19V5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 5C4 3.34 5.34 2 7 2H17C18.66 2 20 3.34 20 5V19C20 20.66 18.66 22 17 22H7C5.34 22 4 20.66 4 19V5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M4 9H20M4 15H20"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M8 5.5H8.01M8 12H8.01M8 18.5H8.01"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M14 5.5H16M14 12H16M14 18.5H16"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 26. StacksIcon — layered squares representing deployment stacks
// ---------------------------------------------------------------------------

export const StacksIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M5 8C5 6.9 5.9 6 7 6H17C18.1 6 19 6.9 19 8V16C19 17.1 18.1 18 17 18H7C5.9 18 5 17.1 5 16V8Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 8C5 6.9 5.9 6 7 6H17C18.1 6 19 6.9 19 8V16C19 17.1 18.1 18 17 18H7C5.9 18 5 17.1 5 16V8Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 10C3 8.9 3.9 8 5 8V18C3.9 18 3 17.1 3 16V10Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 10C21 8.9 20.1 8 19 8V18C20.1 18 21 17.1 21 16V10Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M8 3H16M7 21H17"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M9 10H15M9 14H13"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 27. ProjectIcon — folder with gear
// ---------------------------------------------------------------------------

export const ProjectIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M2 7C2 5.34 3.34 4 5 4H9L11 6H19C20.66 6 22 7.34 22 9V17C22 18.66 20.66 20 19 20H5C3.34 20 2 18.66 2 17V7Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 7C2 5.34 3.34 4 5 4H9L11 6H19C20.66 6 22 7.34 22 9V17C22 18.66 20.66 20 19 20H5C3.34 20 2 18.66 2 17V7Z"
    />
    <circle cx="12" cy="13" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 11V10.5M12 15.5V15M14 12L14.5 11.7M9.5 14.3L10 14M14 14L14.5 14.3M9.5 11.7L10 12"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 28. SyncIcon — circular arrows for data sync status
// ---------------------------------------------------------------------------

export const SyncIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 8L18 6L16 4"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M6 6H18"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 16L6 18L8 20"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M18 18H6"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 29. EyeIcon — toggle eye (open/closed) — same API as portal
//     Usage: <EyeIcon open={showPassword} />
// ---------------------------------------------------------------------------

export const EyeIcon = (props?: any & { open?: boolean }) =>
  props?.open ? (
    <SvgIcon {...props}>
      <path fill="currentColor" opacity="0.4" fillRule="evenodd" clipRule="evenodd" d="M22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C7.31078 5 3.8221 9.12944 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C16.6892 19 20.1779 14.8706 21.544 12.955C21.848 12.5287 22 12.3155 22 12ZM12 9C13.6569 9 15 10.3431 15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M21.544 11.045C21.848 11.4713 22 11.6845 22 12C22 12.3155 21.848 12.5287 21.544 12.955C20.1779 14.8706 16.6892 19 12 19C7.31078 19 3.8221 14.8706 2.45604 12.955C2.15201 12.5287 2 12.3155 2 12C2 11.6845 2.15201 11.4713 2.45604 11.045C3.8221 9.12944 7.31078 5 12 5C16.6892 5 20.1779 9.12944 21.544 11.045Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12Z" />
    </SvgIcon>
  ) : (
    <SvgIcon {...props}>
      <path fill="currentColor" opacity="0.4" d="M12 14C18 14 22 8 22 8H2C2 8 6 14 12 14Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M22 8C22 8 18 14 12 14C6 14 2 8 2 8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M15 13.5L16.5 16" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M20 11L22 13" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M2 13L4 11" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M9 13.5L7.5 16" />
    </SvgIcon>
  );

/** @deprecated Use EyeIcon with open prop instead */
export const VisibilityIcon = (props?: SvgIconProps) => <EyeIcon {...props} open />;
/** @deprecated Use EyeIcon with open prop instead */
export const VisibilityOffIcon = (props?: SvgIconProps) => <EyeIcon {...props} open={false} />;

// ---------------------------------------------------------------------------
// 31. DeleteIcon — trash can (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const DeleteIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5H19.5Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5"
    />
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M21 5.5H3" />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M16.0575 5.5L15.3748 4.09173C14.9213 3.15626 14.6946 2.68852 14.3035 2.39681C14.2167 2.3321 14.1249 2.27454 14.0288 2.2247C13.5957 2 13.0759 2 12.0363 2C10.9706 2 10.4377 2 9.99745 2.23412C9.89986 2.28601 9.80675 2.3459 9.71906 2.41317C9.3234 2.7167 9.10239 3.20155 8.66037 4.17126L8.05469 5.5"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 32. EditIcon — pencil edit (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const EditIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M8 16L8.72397 13.1041C8.89804 12.4079 9.25807 11.772 9.76558 11.2645L16.4249 4.6051L19.3949 7.57508L12.7356 14.2344C12.228 14.7419 11.5922 15.102 10.8959 15.276L8 16Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M16.4249 4.60509L17.4149 3.6151C18.2351 2.79497 19.5648 2.79497 20.3849 3.6151C21.205 4.43524 21.205 5.76493 20.3849 6.58507L19.3949 7.57506M16.4249 4.60509L9.76558 11.2644C9.25807 11.772 8.89804 12.4078 8.72397 13.1041L8 16L10.8959 15.276C11.5922 15.102 12.228 14.7419 12.7356 14.2344L19.3949 7.57506M16.4249 4.60509L19.3949 7.57506"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18.9999 13.5C18.9999 16.7875 18.9999 18.4312 18.092 19.5376C17.9258 19.7401 17.7401 19.9258 17.5375 20.092C16.4312 21 14.7874 21 11.4999 21H11C7.22876 21 5.34316 21 4.17159 19.8284C3.00003 18.6569 3 16.7712 3 13V12.5C3 9.21252 3 7.56879 3.90794 6.46244C4.07417 6.2599 4.2599 6.07417 4.46244 5.90794C5.56879 5 7.21252 5 10.5 5"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 33. LogoutIcon — exit arrow (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const LogoutIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M2.5 12C2.5 7.52162 2.5 5.28245 3.89124 3.89121C5.28249 2.49997 7.52166 2.49997 12 2.49997C16.4783 2.49997 18.7175 2.49997 20.1088 3.89121C21.5 5.28245 21.5 7.52162 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1087C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1087C2.5 18.7175 2.5 16.4783 2.5 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M2.5 12C2.5 7.52163 2.5 5.28245 3.89124 3.89121C5.28249 2.49997 7.52166 2.49997 12 2.49997C16.4783 2.49997 18.7175 2.49997 20.1088 3.89121C21.5 5.28245 21.5 7.52163 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1087C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1087C2.5 18.7175 2.5 16.4783 2.5 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M7 12.0323H13.9756M13.9756 12.0323C13.9756 12.6028 11.8204 14.5197 11.8204 14.5197M13.9756 12.0323C13.9756 11.447 11.8204 9.56795 11.8204 9.56795M17 7.99997V16"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 34. ZoomInIcon — magnifier with plus (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const ZoomInIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M17.5 11C17.5 7.41015 14.5899 4.5 11 4.5C7.41015 4.5 4.5 7.41015 4.5 11C4.5 14.5899 7.41015 17.5 11 17.5C14.5899 17.5 17.5 14.5899 17.5 11Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M17.5 11C17.5 7.41015 14.5899 4.5 11 4.5C7.41015 4.5 4.5 7.41015 4.5 11C4.5 14.5899 7.41015 17.5 11 17.5C14.5899 17.5 17.5 14.5899 17.5 11Z"
    />
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M15.5 15.5L20 20" />
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M8.5 11H13.5M11 8.5V13.5" />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 35. ZoomOutIcon — magnifier with minus (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const ZoomOutIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M17.5 11C17.5 7.41015 14.5899 4.5 11 4.5C7.41015 4.5 4.5 7.41015 4.5 11C4.5 14.5899 7.41015 17.5 11 17.5C14.5899 17.5 17.5 14.5899 17.5 11Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M17.5 11C17.5 7.41015 14.5899 4.5 11 4.5C7.41015 4.5 4.5 7.41015 4.5 11C4.5 14.5899 7.41015 17.5 11 17.5C14.5899 17.5 17.5 14.5899 17.5 11Z"
    />
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M15.5 15.5L20 20" />
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M8.5 11H13.5" />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 36. FullscreenIcon — expand corners (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const FullscreenIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.5 21C16.8956 21 17.5933 21 18.1611 20.8278C19.4395 20.44 20.44 19.4395 20.8278 18.1611C21 17.5933 21 16.8956 21 15.5M21 8.5C21 7.10444 21 6.40666 20.8278 5.83886C20.44 4.56046 19.4395 3.56004 18.1611 3.17224C17.5933 3 16.8956 3 15.5 3M8.5 21C7.10444 21 6.40666 21 5.83886 20.8278C4.56046 20.44 3.56004 19.4395 3.17224 18.1611C3 17.5933 3 16.8956 3 15.5M3 8.5C3 7.10444 3 6.40666 3.17224 5.83886C3.56004 4.56046 4.56046 3.56004 5.83886 3.17224C6.40666 3 7.10444 3 8.5 3"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 37. FullscreenExitIcon — collapse corners (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const FullscreenExitIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.5 3C9.5 3 9.5 5.10444 9.5 6.5C9.5 7.89556 8.89556 8.5 7.5 8.5C6.10444 8.5 3 8.5 3 8.5M14.5 3C14.5 3 14.5 5.10444 14.5 6.5C14.5 7.89556 15.1044 8.5 16.5 8.5C17.8956 8.5 21 8.5 21 8.5M9.5 21C9.5 21 9.5 18.8956 9.5 17.5C9.5 16.1044 8.89556 15.5 7.5 15.5C6.10444 15.5 3 15.5 3 15.5M14.5 21C14.5 21 14.5 18.8956 14.5 17.5C14.5 16.1044 15.1044 15.5 16.5 15.5C17.8956 15.5 21 15.5 21 15.5"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 38. LockIcon — padlock closed (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const LockIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      opacity="0.4"
      d="M4.26781 18.8447C4.49269 20.515 5.87612 21.8235 7.55965 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.8789 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55965 9.09909C5.87612 9.17649 4.49268 10.485 4.26781 12.1553C4.12104 13.2453 3.99999 14.3624 3.99999 15.5C3.99999 16.6376 4.12104 17.7547 4.26781 18.8447Z"
      fill="currentColor"
    />
    <path fill="none" d="M12 16.5V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path
      fill="none"
      d="M4.2678 18.8447C4.49268 20.515 5.87612 21.8235 7.55965 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.8789 17.7547 20 16.6376 20 15.5C20 14.3624 19.8789 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55965 9.09909C5.87612 9.17649 4.49268 10.485 4.2678 12.1553C4.12104 13.2453 3.99999 14.3624 3.99999 15.5C3.99999 16.6376 4.12104 17.7547 4.2678 18.8447Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      fill="none"
      d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5V9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 39. LockOpenIcon — padlock open (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const LockOpenIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      opacity="0.4"
      d="M4.26781 18.8447C4.49269 20.515 5.87612 21.8235 7.55965 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.8789 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55965 9.09909C5.87612 9.17649 4.49268 10.485 4.26781 12.1553C4.12104 13.2453 3.99999 14.3624 3.99999 15.5C3.99999 16.6376 4.12104 17.7547 4.26781 18.8447Z"
      fill="currentColor"
    />
    <path fill="none" d="M12 16.5V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path
      fill="none"
      d="M4.2678 18.8447C4.49268 20.515 5.87612 21.8235 7.55965 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.8789 17.7547 20 16.6376 20 15.5C20 14.3624 19.8789 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55965 9.09909C5.87612 9.17649 4.49268 10.485 4.2678 12.1553C4.12104 13.2453 3.99999 14.3624 3.99999 15.5C3.99999 16.6376 4.12104 17.7547 4.2678 18.8447Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      fill="none"
      d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 40. MoreVertIcon — three dots vertical (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const MoreVertIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="none"
      opacity="0.4"
      d="M11.992 12H12.001"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      fill="none"
      d="M11.9842 18H11.9932"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      fill="none"
      d="M11.9998 6H12.0088"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 41. ConstructionIcon — wrench + gear (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const ConstructionIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M17.28 3.27C15.36 2.1 12.88 2.5 11.44 4.18L10.5 5.27L5.27 10.5L4.18 11.44C2.5 12.88 2.1 15.36 3.27 17.28C4.44 19.2 7.02 19.9 8.96 18.94L10.5 18.17L15.73 12.94L18.17 10.5L18.94 8.96C19.9 7.02 19.2 4.44 17.28 3.27Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 6L18 18M2.5 8.5L4 7L7 4L8.5 2.5M15.5 21.5L17 20L20 17L21.5 15.5M13 7L17 11"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 42. CircleIcon — filled circle status indicator (HugeIcons duotone)
// ---------------------------------------------------------------------------

export const CircleIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <circle fill="currentColor" opacity="0.4" cx="12" cy="12" r="10" />
    <circle fill="none" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 43. UserIcon — user circle (replaces @mui/icons-material/AccountCircle)
// ---------------------------------------------------------------------------

export const UserIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.2"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      d="M12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M12 13C13.66 13 15 11.66 15 10C15 8.34 13.66 7 12 7C10.34 7 9 8.34 9 10C9 11.66 10.34 13 12 13Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      d="M5.56 18.5C6.67 16.42 9.16 15 12 15C14.84 15 17.33 16.42 18.44 18.5"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 44. ChipIcon — processor/microchip (Omnitron system context)
// ---------------------------------------------------------------------------

export const ChipIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      fillRule="evenodd"
      d="M5.17157 5.17157C4 6.34315 4 8.22876 4 12C4 15.7712 4 17.6569 5.17157 18.8284C6.34315 20 8.22876 20 12 20C15.7712 20 17.6569 20 18.8284 18.8284C20 17.6569 20 15.7712 20 12C20 8.22876 20 6.34315 18.8284 5.17157C17.6569 4 15.7712 4 12 4C8.22876 4 6.34315 4 5.17157 5.17157ZM12 17C9.64298 17 8.46447 17 7.73223 16.2678C7 15.5355 7 14.357 7 12C7 9.64298 7 8.46447 7.73223 7.73223C8.46447 7 9.64298 7 12 7C14.357 7 15.5355 7 16.2678 7.73223C17 8.46447 17 9.64298 17 12C17 12.7898 17 13.4473 16.9724 14L14 16.9724C13.4473 17 12.7898 17 12 17Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M4 12C4 8.22876 4 6.34315 5.17157 5.17157C6.34315 4 8.22876 4 12 4C15.7712 4 17.6569 4 18.8284 5.17157C20 6.34315 20 8.22876 20 12C20 15.7712 20 17.6569 18.8284 18.8284C17.6569 20 15.7712 20 12 20C8.22876 20 6.34315 20 5.17157 18.8284C4 17.6569 4 15.7712 4 12Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M7.73223 16.2678C8.46447 17 9.64298 17 12 17C12.7898 17 13.4473 17 14 16.9724L16.9724 14C17 13.4473 17 12.7898 17 12C17 9.64298 17 8.46447 16.2678 7.73223C15.5355 7 14.357 7 12 7C9.64298 7 8.46447 7 7.73223 7.73223C7 8.46447 7 9.64298 7 12C7 14.357 7 15.5355 7.73223 16.2678Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 2V4M16 2V4M12 2V4M8 20V22M12 20V22M16 20V22M22 16H20M4 8H2M4 16H2M4 12H2M22 8H20M22 12H20"
    />
  </SvgIcon>
);

// ---------------------------------------------------------------------------
// 45. FolderIcon — open folder (project context)
// ---------------------------------------------------------------------------

export const FolderIcon = (props?: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      opacity="0.4"
      d="M3.15802 15.5144L3.45643 14.7717C4.19029 12.9449 4.55723 12.0316 5.3224 11.5158C6.08757 11 7.07557 11 9.05157 11H17.1119C19.8004 11 21.1446 11 21.7422 11.8787C22.3397 12.7575 21.8405 14.0002 20.842 16.4856L20.5436 17.2283C19.8097 19.0551 19.4428 19.9684 18.6776 20.4842C17.9124 21 16.9244 21 14.9484 21H6.88812C4.19961 21 2.85535 21 2.25782 20.1213C1.66029 19.2425 2.15953 17.9998 3.15802 15.5144Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 19V7.54902C2 6.10516 2 5.38322 2.24332 4.81647C2.5467 4.10985 3.10985 3.5467 3.81647 3.24332C4.38322 3 5.09805 3 6.54902 3H7.04311C7.64819 3 8.22075 3.27394 8.60041 3.74509L10.4175 6M10.4175 6H16C17.4001 6 18.1002 6 18.635 6.27248C19.1054 6.51217 19.4878 6.89462 19.7275 7.36502C20 7.8998 20 8.59987 20 10V11M10.4175 6H7"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      d="M3.15802 15.5144L3.45643 14.7717C4.19029 12.9449 4.55723 12.0316 5.3224 11.5158C6.08757 11 7.07557 11 9.05157 11H17.1119C19.8004 11 21.1446 11 21.7422 11.8787C22.3397 12.7575 21.8405 14.0002 20.842 16.4856L20.5436 17.2283C19.8097 19.0551 19.4428 19.9684 18.6776 20.4842C17.9124 21 16.9244 21 14.9484 21H6.88812C4.19961 21 2.85535 21 2.25782 20.1213C1.66029 19.2425 2.15953 17.9998 3.15802 15.5144Z"
    />
  </SvgIcon>
);
