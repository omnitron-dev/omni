/**
 * A lightweight reference to a service {@link Definition} by its unique id — a
 * proxy used in service discovery and late binding. Marshalled across the wire,
 * so the titan server and the browser client share this one class.
 */
export class Reference {
  /**
   * @param defId Unique id of the referenced service definition.
   * @throws {Error} if `defId` is empty or not a string.
   */
  constructor(public defId: string) {
    if (!defId || typeof defId !== 'string') {
      // Dependency-free: a plain Error. titan historically threw a TitanError
      // (Errors.badRequest) here, but this is an unreachable internal invariant
      // guard — defIds are always minted UUIDs / received from the wire — and
      // no caller or test depends on the error type (only `instanceof Reference`).
      throw new Error('Service definition ID must be a non-empty string');
    }
  }
}
