import { useEffect, useRef, useState } from 'react';
import { Button, Stack, TextField, Typography } from '@omnitron-dev/prism/ui';
import { FormAlert } from '@omnitron-dev/prism/components/alert';
import type { OwnerPairingProof } from '@omnitron-dev/omnitron/dto/services';
import { createCommissioningCredential, ownerApproval, popupProtocol, usePrivateOwnerPage, verifyOwner } from 'src/auth/owner-approval';

type Review = Awaited<ReturnType<typeof ownerApproval.enrollmentChallenge>>;

export default function OwnerEnrollmentPage() {
  usePrivateOwnerPage();
  const [token, setToken] = useState('');
  const [review, setReview] = useState<Review>();
  const [proof, setProof] = useState<OwnerPairingProof>();
  const [descriptor, setDescriptor] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const life = useRef(new AbortController());
  useEffect(() => {
    life.current = new AbortController();
    return () => life.current.abort();
  }, []);

  useEffect(() => {
    if (!review || !window.opener) return undefined;
    const opener = window.opener as Window;
    const receive = (event: MessageEvent) => {
      if (event.source !== opener || event.origin !== review.applicationOrigin || event.data?.protocol !== popupProtocol ||
          event.data.type !== 'paired' || event.data.nonce !== review.pairingChallenge.payload.nonce ||
          event.data.proof?.payload?.nonce !== review.pairingChallenge.payload.nonce ||
          typeof event.data.proof.signature !== 'string') return;
      setProof(event.data.proof);
    };
    window.addEventListener('message', receive);
    opener.postMessage({ protocol: popupProtocol, type: 'pair', challenge: review.pairingChallenge }, review.applicationOrigin);
    return () => window.removeEventListener('message', receive);
  }, [review]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch { if (!life.current.signal.aborted) setError('Enrollment could not be confirmed. Check your commissioning details.'); }
    finally {
      pending.current = false;
      if (!life.current.signal.aborted) setBusy(false);
    }
  }
  async function complete() {
    if (!review || !proof) return;
    const assertion = await verifyOwner(review.publicKey, life.current.signal);
    const result = await ownerApproval.enroll({ pairingProof: proof, enrollmentToken: token, assertion });
    if (life.current.signal.aborted) return;
    setCodes(result.recoveryCodes);
    setToken('');
    setProof(undefined);
    setReview(undefined);
    window.opener?.postMessage({ protocol: popupProtocol, type: 'enrolled', nonce: review.pairingChallenge.payload.nonce }, review.applicationOrigin);
  }

  return <Stack spacing={2.5}>
    <Typography component="h1" variant="h4">Enroll the installation owner</Typography>
    {error && <FormAlert>{error}</FormAlert>}
    {codes.length ? <>
      <Typography>Store these single-use recovery codes offline, separately from your passkey. They are shown once.</Typography>
      <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{codes.join('\n')}</Typography>
      <Button onClick={() => { setCodes([]); window.close(); }}>I have saved the codes</Button>
    </> : !window.opener ? <>
      <Typography>Create the owner passkey on this Console origin. Give the public registration details to the installation commissioner.</Typography>
      {descriptor ? <TextField label="Public registration details" multiline value={descriptor} slotProps={{ input: { readOnly: true } }} />
        : <Button variant="contained" disabled={busy} onClick={() => void run(async () => {
          const key = await createCommissioningCredential();
          if (!life.current.signal.aborted) setDescriptor(JSON.stringify(key, null, 2));
        })}>Create passkey</Button>}
    </> : !review ? <Stack component="form" spacing={2} onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const result = await ownerApproval.enrollmentChallenge({ enrollmentToken: token });
        if (!life.current.signal.aborted) setReview(result);
      });
    }}>
      <TextField label="Commissioning token" type="password" autoComplete="off" value={token}
        required disabled={busy} onChange={event => setToken(event.target.value)} />
      <Button type="submit" variant="contained" disabled={busy || !token}>Review enrollment</Button>
    </Stack> : <>
      <Typography>Enroll <strong>{review.accountLabel}</strong> in <strong>{review.applicationLabel}</strong> on <strong>{review.installationLabel}</strong>.</Typography>
      <Typography variant="body2" color="text.secondary">{review.applicationOrigin}</Typography>
      {proof ? <Button variant="contained" disabled={busy} onClick={() => void run(complete)}>Enroll with passkey</Button>
        : <Typography role="status">Confirm your current password in the application, then return here.</Typography>}
    </>}
  </Stack>;
}
