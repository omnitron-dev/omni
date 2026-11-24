import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Stack, TextField, Typography } from '@omnitron-dev/prism/ui';
import { FormAlert } from '@omnitron-dev/prism/components/alert';
import type { OwnerRecoveryReview } from '@omnitron-dev/omnitron/dto/services';
import { ownerApproval, popupProtocol, receiveReview, usePrivateOwnerPage, verifyOwner } from 'src/auth/owner-approval';

export default function OwnerRecoveryPage() {
  usePrivateOwnerPage();
  const [params] = useSearchParams();
  const operationId = params.get('operation') ?? '';
  const [review, setReview] = useState<OwnerRecoveryReview>();
  const token = useRef('');
  const abort = useRef<AbortController | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const opener: Window | null = window.opener;
    setReview(undefined);
    setCode('');
    setError('');
    setDone(false);
    if (!opener || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(operationId)) {
      setError('Open recovery from your application to review a request.');
      return undefined;
    }
    if (!window.isSecureContext || !window.PublicKeyCredential) {
      setError('Open the Console in a secure browser with passkey support.');
      return undefined;
    }
    let active = true;
    const receive = async (event: MessageEvent) => {
      const reviewToken = receiveReview(event, opener, operationId);
      if (!reviewToken || token.current) return;
      token.current = reviewToken;
      try {
        const result = await ownerApproval.getChallenge({ operationId, reviewToken });
        if (!active) return;
        if (result.applicationOrigin !== event.origin) throw new Error();
        setReview(result);
      } catch {
        if (active) setError('This recovery request is unavailable. Start again in your application.');
      }
    };
    window.addEventListener('message', receive);
    // The readiness signal contains only public correlation data. The opener's
    // origin is confirmed from the authenticated challenge before any approval.
    opener.postMessage({ protocol: popupProtocol, type: 'ready', operationId }, '*');
    return () => {
      active = false;
      token.current = '';
      abort.current?.abort();
      window.removeEventListener('message', receive);
    };
  }, [operationId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!review || !code || abort.current) return;
    const request = new AbortController();
    abort.current = request;
    setBusy(true);
    setError('');
    try {
      const assertion = await verifyOwner(review.publicKey, request.signal);
      const result = await ownerApproval.approve({ operationId, reviewToken: token.current, assertion, recoveryCode: code });
      if (request.signal.aborted) return;
      if (result.applicationOrigin !== review.applicationOrigin || !window.opener || window.opener.closed) {
        throw new Error();
      }
      window.opener.postMessage({ protocol: popupProtocol, type: 'approved', operationId, continuation: result.continuation }, review.applicationOrigin);
      token.current = '';
      setDone(true);
      window.close();
    } catch {
      if (!request.signal.aborted) setError('Approval could not be confirmed. Check the request in your application.');
    } finally {
      if (!request.signal.aborted) {
        setBusy(false);
        setCode('');
      }
      if (abort.current === request) abort.current = null;
    }
  }

  return (
    <Stack spacing={2.5}>
      <Typography component="h1" variant="h4">Approve owner recovery</Typography>
      {error && <FormAlert>{error}</FormAlert>}
      {done ? <Typography role="status">Return to your application to choose a new password.</Typography> : review ? (
        <Stack component="form" spacing={2} onSubmit={submit}>
          <Typography>Replace the password for <strong>{review.accountLabel}</strong> in <strong>{review.applicationLabel}</strong> on <strong>{review.installationLabel}</strong>.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{review.applicationOrigin}</Typography>
          <TextField label="One-time offline code" type="password" autoComplete="off" required
            value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
          <Button type="submit" variant="contained" disabled={!code || busy}>
            {busy ? 'Waiting for confirmation…' : 'Confirm with passkey'}
          </Button>
        </Stack>
      ) : !error && <Typography role="status">Waiting for the application…</Typography>}
    </Stack>
  );
}
