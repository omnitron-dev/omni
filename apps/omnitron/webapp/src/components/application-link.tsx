import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import type { RpcPermission } from 'src/auth/access';
import { appHref, stackHref } from 'src/routes/workspace';

interface ApplicationDestination {
  href: string;
  stack?: string;
}

export function applicationDestination(
  name: string,
  handle: string,
  owner: { project: string; stack: string } | null | undefined,
  remote: boolean,
  can: (permission: RpcPermission) => boolean,
): ApplicationDestination | null {
  if (remote) {
    return owner && can('OmnitronProject.listStacks')
      ? { href: stackHref(owner.project, owner.stack), stack: owner.stack }
      : null;
  }
  if (!can('OmnitronDaemon.getApp')) return null;
  return { href: owner ? appHref(owner.project, owner.stack, name) : '/processes/' + encodeURIComponent(handle) };
}

export function ApplicationLink({ name, destination }: { name: string; destination: ApplicationDestination | null }) {
  if (!destination) return name;
  if (!destination.stack) return <Link component={RouterLink} to={destination.href}>{name}</Link>;
  return (
    <>
      <span>{name}</span>
      <Link
        component={RouterLink}
        to={destination.href}
        variant="caption"
        sx={{ display: 'block', width: 'fit-content', whiteSpace: 'nowrap' }}
        aria-label={`Open stack ${destination.stack} for ${name}`}
      >
        Open stack
      </Link>
    </>
  );
}
