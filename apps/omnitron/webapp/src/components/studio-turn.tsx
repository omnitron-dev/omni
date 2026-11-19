import { memo, useState } from 'react';
import { Button, Chip, Divider, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Markdown } from '@omnitron-dev/prism/components/content-renderer';
import { readProjectSuggestion, type StudioTurn } from '@omnitron-dev/omnitron/dto/services';

const ResponseMarkdown = memo(Markdown);
const plain = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
const blocked = {
  authorization: 'Authorization changed before delivery.',
  'model-changed': 'The approved model or its cost changed. Review the current catalog.',
  'scope-unavailable': 'The assigned stack could not be verified before dispatch.',
  disconnected: 'The connector disconnected. The outcome of an in-flight request may be unknown.',
  provider: 'The provider could not finish the turn.',
  protocol: 'The provider returned an incomplete or incompatible response.',
  'sign-in': 'Sign in to the local provider CLI and reconnect.',
  timeout: 'The provider exceeded the turn deadline.',
};

function starterLink(answer: string) {
  const n = readProjectSuggestion(answer);
  return n
    ? '/projects?' +
        new URLSearchParams({
          create: '1',
          automation: n.automation ? '1' : '0',
          persistence: n.persistence,
          service: n.service,
        })
    : null;
}

export function StudioTurnCard({
  turn,
  onReview,
  onStarter,
  author = 'You',
  recipient = 'Agent',
  onCancel,
  related,
}: {
  turn: StudioTurn;
  onReview?: ((outcome: 'accepted' | 'needs-work', note: string, previous: number | null) => Promise<void>) | undefined;
  author?: string;
  recipient?: string;
  onCancel?: (() => Promise<void>) | undefined;
  related?: string | undefined;
  onStarter?: ((href: string) => void) | undefined;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [reviewAt, setReviewAt] = useState<number | null>(null);
  const proposal = turn.status === 'completed' ? starterLink(turn.answer) : null;
  return (
    <Stack id={'studio-turn-' + turn.id} spacing={1.25} sx={{ minWidth: 0 }}>
      <Divider />
      <Typography variant="caption" color="text.secondary">
        {author} → {recipient}
        {turn.kind === 'task' ? ' · Task' : turn.kind === 'summary' ? ' · Summary' : ''}
      </Typography>
      <Typography variant="body2" sx={plain}>
        {turn.prompt}
      </Typography>
      {(turn.answer || turn.failure) && (
        <Typography variant="caption" color="text.secondary">
          {recipient}
        </Typography>
      )}
      {turn.answer &&
        (turn.status === 'running' ? (
          <Typography variant="body2" sx={plain}>
            {turn.answer}
          </Typography>
        ) : (
          <ResponseMarkdown compact embeddedMedia="text">
            {turn.answer}
          </ResponseMarkdown>
        ))}
      {turn.failure && <Alert severity="warning">{blocked[turn.failure]}</Alert>}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" role="status" label={turn.status} variant="outlined" />
        {turn.usage && (
          <Typography variant="caption" color="text.secondary">
            Input {turn.usage.inputTokens ?? '—'} · output {turn.usage.outputTokens ?? '—'} tokens
          </Typography>
        )}
        {turn.review && (
          <Chip size="small" label={turn.review.outcome === 'accepted' ? 'Accepted' : 'Changes requested'} />
        )}
        {onCancel && (
          <Button size="small" onClick={() => void onCancel()}>
            Stop turn
          </Button>
        )}
        {related && (
          <Button size="small" component="a" href={'#studio-turn-' + related}>
            Original request
          </Button>
        )}
        {turn.status === 'completed' && onReview && (
          <Button
            size="small"
            onClick={() => {
              setNote(turn.review?.note ?? '');
              setReviewAt(turn.review?.at ?? null);
              setReviewing(!reviewing);
            }}
          >
            Review result
          </Button>
        )}
        {proposal && onStarter && (
          <Button size="small" variant="outlined" onClick={() => onStarter(proposal)}>
            Review project starter
          </Button>
        )}
      </Stack>
      {turn.review?.note && (
        <Typography variant="body2" sx={plain}>
          {turn.review.note}
        </Typography>
      )}
      {reviewing && onReview && (
        <Stack spacing={1}>
          <TextField
            label="Review note"
            size="small"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
          />
          <Stack direction="row" spacing={1}>
            {(['accepted', 'needs-work'] as const).map((value) => (
              <Button
                size="small"
                key={value}
                onClick={async () => {
                  await onReview(value, note, reviewAt);
                  setReviewing(false);
                }}
              >
                {value === 'accepted' ? 'Accept result' : 'Request changes'}
              </Button>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
