// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ArtifactSourceReading } from '../../src/shared/dto/releases.js';
import { ReleaseArtifactSource } from '../../webapp/src/components/release-artifact-source.js';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('src/netron/client', () => ({ releases: { get }, audit: {} }));
import { releaseApi } from '../../webapp/src/netron/release-wire.js';

afterEach(cleanup);
describe('release source details', () => {
  it('keeps imported project, SDK and manifest visible in an accessible disclosure', () => {
    const source: ArtifactSourceReading = {
      app: 'collector', state: 'recorded', releaseId: 'upstream', producerApp: 'worker',
      project: { repo: 'upstream-project', commit: 'a'.repeat(40) },
      framework: { repo: 'upstream-sdk', commit: 'b'.repeat(40) },
      via: [{ release: 'upstream', app: 'worker', manifestSha256: 'c'.repeat(64) }],
    };
    const { container } = render(<ReleaseArtifactSource source={source} />);
    expect(container.querySelector('summary')).toHaveTextContent('Imported · worker');
    expect(container.querySelector('details')).toHaveTextContent('Project · upstream-project');
    expect(container.querySelector('details')).toHaveTextContent('SDK · upstream-sdk');
    expect(container.querySelector('details')).toHaveTextContent('Manifest · ' + 'c'.repeat(64));
    expect(container.querySelector('details')).toHaveTextContent('Recorded build inputs');
  });
  it('does not show a consumer origin when the daemon cannot resolve application evidence', () => {
    const { rerender } = render(<ReleaseArtifactSource />);
    expect(screen.getByText(/provenance unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Built in this release')).toBeNull();
    rerender(<ReleaseArtifactSource source={{ app: 'collector', state: 'invalid', reason: 'Pinned manifest changed' }} />);
    expect(screen.getByText('Pinned manifest changed')).toBeInTheDocument();
    expect(screen.queryByText('Built in this release')).toBeNull();
  });
  it('keeps source metadata across the Netron view and marks older replies as unreported', async () => {
    const source = { app: 'collector', state: 'invalid' as const, reason: 'Pinned manifest changed' };
    get.mockResolvedValueOnce({ id: 'release', manifestSha256: 'c'.repeat(64), artifactSources: [source] });
    expect(await releaseApi.get('release')).toMatchObject({ manifestSha256: 'c'.repeat(64), artifactSources: [source] });
    get.mockResolvedValueOnce({ id: 'legacy' });
    expect(await releaseApi.get('legacy')).toMatchObject({ manifestSha256: null, artifactSources: null });
  });
});
