/**
 * Alert / InlineAlert / FormAlert.
 *
 * `FormAlert` is the platform's canonical surface for form-submission
 * failures — 54 call sites in the DAOS portal — and the reason it exists
 * rather than a plain `<Alert>` is accessibility: an error a sighted user can
 * see and a screen-reader user cannot is the failure mode it was built to
 * prevent. That is what these tests pin.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Alert, InlineAlert, FormAlert } from './alert.js';

describe('FormAlert', () => {
  it('announces itself assertively and as a whole', () => {
    render(<FormAlert>Could not save the order</FormAlert>);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    // Without aria-atomic a reader may announce only the changed fragment,
    // reading the detail without the heading that gives it meaning.
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(alert).toHaveTextContent('Could not save the order');
  });

  it('is assertive regardless of severity', () => {
    // MUI picks role/aria-live from severity; a form-level failure warrants
    // an assertive announcement even when it is styled as a warning.
    render(<FormAlert severity="warning">Check the highlighted fields</FormAlert>);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders a title above the message', () => {
    render(<FormAlert title="Couldn't save">The server rejected two fields</FormAlert>);

    expect(screen.getByText("Couldn't save")).toBeInTheDocument();
    expect(screen.getByText('The server rejected two fields')).toBeInTheDocument();
  });

  it('offers a close affordance only when a handler is given', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { unmount } = render(<FormAlert>No handler</FormAlert>);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    unmount();

    render(<FormAlert onClose={onClose}>With handler</FormAlert>);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays rendered with empty children so the slot can be kept', () => {
    // Documented behaviour: `null` children keep the slot without unmounting,
    // which callers rely on for conditional rendering without layout shift.
    render(<FormAlert>{null}</FormAlert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('renders its message and severity', () => {
    render(<Alert severity="success">Saved</Alert>);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('renders a title when given one', () => {
    render(
      <Alert severity="error" title="Upload failed">
        The file exceeds 10 MB
      </Alert>
    );

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('The file exceeds 10 MB')).toBeInTheDocument();
  });

  it('shows the close button only when explicitly closable', async () => {
    // `Alert` requires `closable` in addition to `onClose` — unlike
    // `FormAlert`, where passing a handler is enough. The asymmetry is
    // deliberate (a form alert with a handler is always dismissible) but easy
    // to trip over, so it is pinned here.
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { unmount } = render(<Alert onClose={onClose}>Handler only</Alert>);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    unmount();

    render(
      <Alert closable onClose={onClose}>
        Dismiss me
      </Alert>
    );
    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('InlineAlert', () => {
  it('renders the message', () => {
    render(<InlineAlert severity="warning" message="Two items are out of stock" />);
    expect(screen.getByText('Two items are out of stock')).toBeInTheDocument();
  });
});
