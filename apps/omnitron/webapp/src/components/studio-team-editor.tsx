import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  MenuItem,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import {
  STUDIO_PROVIDERS,
  STUDIO_PROVIDER_LIMIT,
  STUDIO_ROLES,
  STUDIO_ROLE_POLICY,
  selectStudioModel,
  studioRoleRequirements,
  type StudioCostTier,
  type StudioMemberInput,
  type StudioModelCatalog,
  type StudioProvider,
  type StudioRole,
  type StudioRoomRef,
  type StudioTeamPolicy,
} from '@omnitron-dev/omnitron/dto/services';
import { studioProviderName, studioProviderOptions } from 'src/utils/studio-provider';
import { studio } from 'src/netron/client';
import { StudioConnectorDetails } from './studio-connector-details';

const tiers: StudioCostTier[] = ['economy', 'standard', 'premium'];
const small = { size: 'small', fullWidth: true } as const;

interface Props {
  mode: 'create' | 'policy' | 'member';
  room: StudioRoomRef;
  stack: string | null;
  catalogs: StudioModelCatalog[];
  policy: StudioTeamPolicy | null;
  account: string;
  leadProvider?: StudioProvider;
  onSaved: (threadId: string) => Promise<void>;
  onClose?: () => void;
}

export function StudioTeamEditor({
  mode,
  room,
  stack,
  catalogs,
  policy: previous,
  account,
  leadProvider,
  onSaved,
  onClose,
}: Props) {
  const [baseline] = useState(previous);
  const [policy, setPolicy] = useState<StudioTeamPolicy>(
    () =>
      previous ?? {
        providers: [...STUDIO_PROVIDERS],
        maxMembers: 4,
        maxDelegations: 6,
        maxCostTier: 'economy',
      }
  );
  const [title, setTitle] = useState('');
  const [name, setName] = useState(mode === 'create' ? 'Lead' : '');
  const [role, setRole] = useState<StudioRole>('analyst');
  const [provider, setProvider] = useState<StudioProvider>(
    () =>
      catalogs.find((item) => policy.providers.includes(item.provider) && (mode !== 'create' || item.teamTools))
        ?.provider ??
      policy.providers[0] ??
      'codex'
  );
  const [model, setModel] = useState('');
  const [memberId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const catalog = catalogs.find((item) => item.provider === provider);
  const providerOptions = studioProviderOptions(catalogs, policy.providers);
  const selection: StudioMemberInput = {
    name: name.trim(),
    provider,
    preferences: {
      role,
      result: STUDIO_ROLE_POLICY[role].result,
      requirements: studioRoleRequirements(role, { maxCostTier: policy.maxCostTier }, !!model),
      ...(model && { model }),
    },
  };
  const choice =
    catalog &&
    selectStudioModel(catalog, {
      provider,
      connector: catalog.connector,
      requirements: selection.preferences.requirements,
      ...(model && { model }),
    });
  const policyValid =
    policy.providers.length > 0 &&
    policy.providers.length <= STUDIO_PROVIDER_LIMIT &&
    Number.isInteger(policy.maxMembers) &&
    policy.maxMembers >= 1 &&
    policy.maxMembers <= 12 &&
    Number.isInteger(policy.maxDelegations) &&
    policy.maxDelegations >= 0 &&
    policy.maxDelegations <= 24;
  const leadReady =
    mode === 'member' || Boolean(catalogs.find((item) => item.provider === (leadProvider ?? provider))?.teamTools);
  const valid =
    leadReady &&
    policyValid &&
    (mode === 'policy' || Boolean(name.trim() && policy.providers.includes(provider) && choice?.ok)) &&
    (mode !== 'create' || Boolean(title.trim()));
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'create')
        await studio.createTeam({ ...room, ...selection, ...(stack && { stack }), title: title.trim(), policy });
      else if (mode === 'member') await studio.addMember({ ...room, ...selection, memberId });
      else await studio.configureTeam({ ...room, policy, previous: baseline });
      await onSaved(room.threadId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const policyFields = (
    <Stack spacing={1.5}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Allowed adapters">
        {providerOptions.map((id) => (
          <FormControlLabel
            key={id}
            label={studioProviderName(id)}
            sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            control={
              <Checkbox
                size="small"
                checked={policy.providers.includes(id)}
                disabled={
                  (mode === 'policy' && id === leadProvider) ||
                  (!policy.providers.includes(id) && policy.providers.length >= STUDIO_PROVIDER_LIMIT)
                }
                onChange={(_, checked) => {
                  const providers = checked
                    ? [...policy.providers, id]
                    : policy.providers.filter((item) => item !== id);
                  setPolicy({ ...policy, providers });
                  if (!providers.includes(provider) && providers[0]) {
                    setProvider(providers[0]);
                    setModel('');
                  }
                }}
              />
            }
          />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          {...small}
          type="number"
          label="Maximum members"
          value={policy.maxMembers}
          slotProps={{ htmlInput: { min: 1, max: 12 } }}
          onChange={(event) => setPolicy({ ...policy, maxMembers: Number(event.target.value) })}
        />
        <TextField
          {...small}
          type="number"
          label="Maximum delegations"
          value={policy.maxDelegations}
          slotProps={{ htmlInput: { min: 0, max: 24 } }}
          onChange={(event) => setPolicy({ ...policy, maxDelegations: Number(event.target.value) })}
        />
        <TextField
          {...small}
          select
          label="Maximum cost tier"
          value={policy.maxCostTier}
          onChange={(event) => setPolicy({ ...policy, maxCostTier: event.target.value as StudioCostTier })}
        >
          {tiers.map((tier) => (
            <MenuItem key={tier} value={tier}>
              {tier}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  );
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Box component="fieldset" disabled={busy} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Stack spacing={1.75}>
          {mode === 'create' && (
            <TextField
              {...small}
              required
              autoFocus
              label="Team name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
          {mode !== 'policy' && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  {...small}
                  required
                  autoFocus={mode === 'member'}
                  label={mode === 'create' ? 'Lead name' : 'Member name'}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <TextField
                  {...small}
                  select
                  label="Responsibility"
                  value={role}
                  onChange={(event) => setRole(event.target.value as StudioRole)}
                >
                  {STUDIO_ROLES.map((id) => (
                    <MenuItem key={id} value={id}>
                      {id}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  {...small}
                  select
                  label="Adapter"
                  value={provider}
                  onChange={(event) => {
                    const selected = event.target.value as StudioProvider;
                    if (mode === 'create' && !policy.providers.includes(selected)) {
                      setPolicy({ ...policy, providers: [...policy.providers, selected] });
                    }
                    setProvider(selected);
                    setModel('');
                  }}
                >
                  {(mode === 'create' ? providerOptions : policy.providers).map((id) => (
                    <MenuItem
                      key={id}
                      value={id}
                      disabled={!policy.providers.includes(id) && policy.providers.length >= STUDIO_PROVIDER_LIMIT}
                      sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    >
                      {studioProviderName(id)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  {...small}
                  select
                  label="Model"
                  value={model || '@auto'}
                  onChange={(event) => setModel(event.target.value === '@auto' ? '' : event.target.value)}
                >
                  <MenuItem value="@auto">Automatic · within team budget</MenuItem>
                  {catalog?.models.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              {choice?.ok && (
                <Typography variant="caption" color="text.secondary">
                  {choice.selection.model} · {choice.selection.costTier}
                </Typography>
              )}
              {choice && !choice.ok && <Alert severity="warning">{choice.message}</Alert>}
              {!catalog && <StudioConnectorDetails project={room.project} account={account} provider={provider} />}
            </>
          )}
          {mode === 'create' && (
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary>Team limits</AccordionSummary>
              <AccordionDetails>{policyFields}</AccordionDetails>
            </Accordion>
          )}
          {mode === 'policy' && policyFields}
          {!leadReady && catalogs.length > 0 && (
            <Alert severity="info">
              Choose a connected lead adapter with Studio team tools to coordinate this team.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            {onClose && (
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            )}
            <Button variant="contained" type="submit" disabled={!valid || busy}>
              {mode === 'create' ? 'Create team' : mode === 'policy' ? 'Save limits' : 'Add member'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
