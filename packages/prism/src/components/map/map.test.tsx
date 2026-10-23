import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapPlaceSearch, type MapPlace } from './MapPlaceSearch.js';
import { normalizeMapPoint, isMapPoint, mapCameraLatitude } from './coordinates.js';
afterEach(cleanup);
const alpha: MapPlace = { id: 'osm:N1', label: 'Alpha town', point: { lng: 12, lat: 34 } };
const beta: MapPlace = { id: 'osm:R2', label: 'Beta city', point: { lng: -10, lat: 8 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function enter(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}
describe('geographic coordinate contract', () => {
  it('wraps repeated worlds without moving a point; preserves poles and rejects invalid coordinates', () => {
    for (let lng = -179; lng <= 179; lng += 7)
      for (let turns = -30; turns < 30; turns++) {
        expect(normalizeMapPoint(lng + 360 * turns, 89)).toEqual({ lng, lat: 89 });
      }
    for (const n of [NaN, Infinity, -Infinity]) expect(normalizeMapPoint(n, 0)).toBeNull();
    expect(normalizeMapPoint(0, 91)).toBeNull();
    expect(normalizeMapPoint(180, -90)).toEqual({ lng: 180, lat: -90 });
    expect(isMapPoint({ lng: 181, lat: 0 })).toBe(false);
    expect(mapCameraLatitude(90)).toBeLessThan(90);
  });
});
describe('provider-neutral place search', () => {
  it('requires explicit search by default and preserves provider choice and coordinates', async () => {
    const search = vi.fn(async () => [alpha, beta]),
      select = vi.fn();
    render(<MapPlaceSearch search={search} onSelect={select} />);
    enter('Alpha');
    expect(search).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Alpha town' }));
    expect(select).toHaveBeenCalledWith(alpha);
    expect(search.mock.calls).toHaveLength(1);
  });
  it('cancels old requests and discards late responses even when the provider ignores abort', async () => {
    const old = deferred<MapPlace[]>(),
      fresh = deferred<MapPlace[]>();
    const search = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise);
    render(<MapPlaceSearch search={search} onSelect={vi.fn()} />);
    enter('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const signal = search.mock.calls[0][1].signal as AbortSignal;
    enter('Beta');
    expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => fresh.resolve([beta]));
    expect(await screen.findByRole('option', { name: 'Beta city' })).toBeVisible();
    await act(async () => old.resolve([alpha]));
    expect(screen.queryByRole('option', { name: 'Alpha town' })).toBeNull();
  });
  it('exposes a provider error and never presents invalid geography as a result', async () => {
    render(<MapPlaceSearch search={async () => [{ ...alpha, point: { lng: 200, lat: 20 } }]} onSelect={vi.fn()} />);
    enter('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByRole('option')).toBeNull();
  });
  it('aborts when unmounted or disabled, with translated labels', async () => {
    const pending = deferred<MapPlace[]>(),
      search = vi.fn(() => pending.promise),
      select = vi.fn();
    const { rerender, unmount } = render(
      <MapPlaceSearch search={search} onSelect={select} labels={{ label: 'Место рождения', search: 'Найти' }} />
    );
    enter('Москва');
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    const signal = (search.mock.calls as unknown as [string, { signal: AbortSignal }][])[0][1].signal;
    rerender(<MapPlaceSearch search={search} onSelect={select} disabled />);
    await waitFor(() => expect(signal.aborted).toBe(true));
    unmount();
    await act(async () => pending.resolve([alpha]));
    expect(select).not.toHaveBeenCalled();
  });
  it('supports provider-approved autocomplete and keyboard selection', async () => {
    const search = vi.fn(async () => [beta]),
      select = vi.fn();
    render(<MapPlaceSearch search={search} onSelect={select} mode="autocomplete" debounceMs={1} />);
    enter('Beta');
    await screen.findByRole('option', { name: 'Beta city' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(select).toHaveBeenCalledWith(beta);
  });
});
