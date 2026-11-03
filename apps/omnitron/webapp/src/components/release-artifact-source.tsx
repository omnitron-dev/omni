import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ArtifactSourceReading } from '@omnitron-dev/omnitron/dto/services';
import { releaseTargetLabel } from '@omnitron-dev/omnitron/release-reading';

/** Build provenance is intentionally separate from the stack's current launch observations. */
export function ReleaseArtifactSource({ source }: { source?: ArtifactSourceReading }) {
  if (!source || source.state === 'invalid') return (
    <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
      {source?.reason ?? 'Per-application provenance unavailable from this daemon'}
    </Typography>
  );
  return (
    <Box component="details" sx={{ minWidth: 0, overflowWrap: 'anywhere', '& > summary': {
      cursor: 'pointer', fontSize: 12, color: 'text.secondary', borderRadius: 0.5,
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
    } }}>
      <Box component="summary">{source.via.length ? `Imported · ${source.producerApp}` : 'Built in this release'}</Box>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Typography variant="caption">{source.releaseId}</Typography>
        <Typography variant="caption">Project · {source.project.repo}<br />{source.project.commit}</Typography>
        {source.packageDirectory && <Typography variant="caption">Package · {source.packageDirectory}</Typography>}
        <Typography variant="caption">SDK · {source.framework.repo}<br />{source.framework.commit}</Typography>
        <Typography variant="caption">{releaseTargetLabel(source.target)}</Typography>
        {source.via.map((hop, index) => (
          <Typography variant="caption" key={`${index}:${hop.manifestSha256}:${hop.app}`}>
            Via {hop.release}/{hop.app}<br />Manifest · {hop.manifestSha256}
          </Typography>
        ))}
        <Typography variant="caption" color="text.secondary">Recorded build inputs; current execution is shown in Deployment state.</Typography>
      </Stack>
    </Box>
  );
}
