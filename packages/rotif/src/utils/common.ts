/**
 * Parses an array of field-value pairs into an object.
 * The input array should contain alternating field names and values.
 * @param {string[]} raw - Array of field-value pairs
 * @returns {Record<string, string>} Object with field-value pairs
 * @example
 * parseFields(['field1', 'value1', 'field2', 'value2'])
 * // Returns: { field1: 'value1', field2: 'value2' }
 */
export function parseFields(raw: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const value = raw[i + 1];
    if (key !== undefined && value !== undefined) {
      obj[key] = value;
    }
  }
  return obj;
}