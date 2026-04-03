import { useLocation } from 'react-router-dom';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import { ConstructionIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron-dev/prism';

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  const section = pathname.split('/').filter(Boolean).pop() ?? 'Page';
  const title = section.charAt(0).toUpperCase() + section.slice(1);

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: title }]}
      />

      <Card variant="outlined">
        <CardContent>
          <Stack alignItems="center" spacing={2} sx={{ py: 6 }}>
            <ConstructionIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="h6" color="text.secondary">
              Under Construction
            </Typography>
            <Typography variant="body2" color="text.disabled">
              This section is not yet implemented. Check back soon.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
