import { describe, it, expect } from 'vitest';
import { AccessFilterService } from '../src/access/access-filter.service.js';

describe('AccessFilterService', () => {
  const service = new AccessFilterService();

  it('allows public access unconditionally', () => {
    expect(service.isAllowed([], 'public')).toBe(true);
    expect(service.isAllowed(['anonymous'], 'public')).toBe(true);
    expect(service.isAllowed(['anonymous'], undefined)).toBe(true);
  });

  it('restricts internal access to staff and admin', () => {
    expect(service.isAllowed(['anonymous'], 'internal')).toBe(false);
    expect(service.isAllowed(['staff'], 'internal')).toBe(true);
    expect(service.isAllowed(['admin'], 'internal')).toBe(true);
  });

  it('restricts confidential access to security_officer and admin', () => {
    expect(service.isAllowed(['anonymous'], 'confidential')).toBe(false);
    expect(service.isAllowed(['staff'], 'confidential')).toBe(false);
    expect(service.isAllowed(['security_officer'], 'confidential')).toBe(true);
    expect(service.isAllowed(['admin'], 'confidential')).toBe(true);
  });

  it('denies unknown or non-standard clearance levels by default', () => {
    expect(service.isAllowed(['admin'], 'top-secret-clearance')).toBe(false);
    expect(service.isAllowed(['anonymous'], 'unknown')).toBe(false);
  });

  it('filters sections based on caller role', () => {
    const sections = [
      { id: '1', access: 'public', title: 'Open' },
      { id: '2', access: 'internal', title: 'Staff only' },
      { id: '3', access: 'confidential', title: 'Admin only' },
    ];

    expect(service.filterSections(sections, ['anonymous']).map((s) => s.id)).toEqual(['1']);
    expect(service.filterSections(sections, ['staff']).map((s) => s.id)).toEqual(['1', '2']);
    expect(service.filterSections(sections, ['admin']).map((s) => s.id)).toEqual(['1', '2', '3']);
  });
});
