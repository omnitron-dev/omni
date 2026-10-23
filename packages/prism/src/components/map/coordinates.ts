/** WGS84 geographic coordinates. Camera constraints never alter the stored point. */
export interface MapPointPickerValue {
  lng: number;
  lat: number;
}
export function isMapPoint(value: MapPointPickerValue): boolean {
  return (
    Number.isFinite(value.lng) &&
    Number.isFinite(value.lat) &&
    value.lng >= -180 &&
    value.lng <= 180 &&
    value.lat >= -90 &&
    value.lat <= 90
  );
}
/** MapLibre may emit a longitude in another world copy after panning. */
export function normalizeMapPoint(lng: number, lat: number): MapPointPickerValue | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  return { lng: lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180, lat };
}
export function mapCameraLatitude(latitude: number): number {
  return Math.max(-85.0511287798066, Math.min(85.0511287798066, latitude));
}
