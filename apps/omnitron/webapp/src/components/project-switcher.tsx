/**
 * ProjectSwitcher — Header bar project/context selector
 *
 * The list always starts with "Omnitron" — the system-level context.
 * When Omnitron is selected (activeProject = null), the drawer shows
 * system sections: Dashboard, Settings, System Info.
 *
 * When a registered project is selected, the drawer shows
 * project-scoped sections: Apps, Stacks, Logs, Metrics, etc.
 */

import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Button, { buttonClasses } from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { CustomPopover, usePopover, Label } from '@omnitron-dev/prism';
import { PlusIcon, ChipIcon, FolderIcon } from '../assets/icons';
import { useProjectStore, useActiveProject } from '../stores/project.store';

export function ProjectSwitcher() {
  const { open, anchorEl, onClose, onOpen } = usePopover();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const projects = useProjectStore((s) => s.projects);
  const activeProject = useActiveProject();
  const selectProject = useProjectStore((s) => s.selectProject);
  const deselectProject = useProjectStore((s) => s.deselectProject);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSelectOmnitron = useCallback(() => {
    const targetRoute = deselectProject(pathname);
    navigate(targetRoute);
    onClose();
  }, [deselectProject, navigate, pathname, onClose]);

  const handleSelectProject = useCallback(
    (name: string) => {
      const targetRoute = selectProject(name, pathname);
      navigate(targetRoute);
      onClose();
    },
    [selectProject, navigate, pathname, onClose]
  );

  const activeInfo = projects.find((p) => p.name === activeProject);
  const isOmnitron = !activeProject;

  const buttonBg: SxProps<Theme> = {
    height: 1,
    zIndex: -1,
    opacity: 0,
    content: "''",
    borderRadius: 1,
    position: 'absolute',
    visibility: 'hidden',
    bgcolor: 'action.hover',
    width: 'calc(100% + 8px)',
    transition: (theme) =>
      theme.transitions.create(['opacity', 'visibility'], {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.shorter,
      }),
    ...(open && { opacity: 1, visibility: 'visible' }),
  };

  // Icon style for menu items — consistent 24x24 box
  const menuIconSx = { fontSize: 22, color: 'text.secondary' } as const;
  const menuIconActiveSx = { fontSize: 22, color: 'primary.main' } as const;

  return (
    <>
      {/* Trigger button */}
      <ButtonBase
        disableRipple
        onClick={onOpen}
        sx={{ py: 0.5, gap: { xs: 0.5, sm: 1 }, '&::before': buttonBg }}
      >
        <Box sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isOmnitron
            ? <ChipIcon sx={{ fontSize: 20 }} />
            : <FolderIcon sx={{ fontSize: 20 }} />
          }
        </Box>

        <Box
          component="span"
          sx={{
            typography: 'subtitle2',
            display: { xs: 'none', sm: 'inline-flex' },
          }}
        >
          {isOmnitron ? 'Omnitron' : activeInfo?.displayName ?? activeProject}
        </Box>

        {activeInfo && (
          <Label
            color={activeInfo.runningStacks > 0 ? 'success' : 'default'}
            sx={{ height: 22, cursor: 'inherit', display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {activeInfo.runningStacks}/{activeInfo.totalStacks} stacks
          </Label>
        )}

        <Box
          component="svg"
          viewBox="0 0 16 16"
          sx={{ width: 16, height: 16, color: 'text.disabled', flexShrink: 0 }}
        >
          <path fill="currentColor" d="M11.2 5.6L8 2.4 4.8 5.6m0 4.8L8 13.6l3.2-3.2" />
        </Box>
      </ButtonBase>

      {/* Popover menu */}
      <CustomPopover
        open={open}
        anchorEl={anchorEl}
        onClose={onClose}
        arrow={{ placement: 'top-left' }}
        slotProps={{ paper: { sx: { mt: 0.5, ml: -1.55, width: 280 } } }}
      >
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          <MenuList>
            {/* Omnitron — always first, system-level context */}
            <MenuItem
              selected={isOmnitron}
              onClick={handleSelectOmnitron}
              sx={{ height: 48, gap: 1.5 }}
            >
              <ChipIcon sx={isOmnitron ? menuIconActiveSx : menuIconSx} />

              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap variant="body2" sx={{ fontWeight: 'fontWeightMedium' }}>
                  Omnitron
                </Typography>
                <Typography noWrap variant="caption" color="text.disabled">
                  System
                </Typography>
              </Box>
            </MenuItem>

            {projects.length > 0 && <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />}

            {/* Registered projects */}
            {projects.map((p) => {
              const isActive = p.name === activeProject;

              return (
                <Tooltip key={p.name} title={p.path} placement="right" arrow enterDelay={500}>
                  <MenuItem
                    selected={isActive}
                    onClick={() => handleSelectProject(p.name)}
                    sx={{ height: 48, gap: 1.5 }}
                  >
                    <FolderIcon sx={isActive ? menuIconActiveSx : menuIconSx} />

                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography noWrap variant="body2" sx={{ fontWeight: 'fontWeightMedium' }}>
                        {p.displayName}
                      </Typography>
                    </Box>

                    <Label color={p.runningStacks > 0 ? 'success' : 'default'}>
                      {p.runningStacks > 0 ? `${p.runningStacks} live` : 'idle'}
                    </Label>
                  </MenuItem>
                </Tooltip>
              );
            })}
          </MenuList>
        </Box>

        <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />

        <Button
          fullWidth
          startIcon={<PlusIcon sx={{ fontSize: 18 }} />}
          onClick={onClose}
          sx={{
            gap: 2,
            justifyContent: 'flex-start',
            fontWeight: 'fontWeightMedium',
            [`& .${buttonClasses.startIcon}`]: {
              m: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            },
          }}
        >
          Add project
        </Button>
      </CustomPopover>
    </>
  );
}
