/** Test-only cleanup: preserve the failed assertion and attempt every resource. */
export async function cleanupFixture(directory, primaryFailure, cleanup) {
  const errors = [];
  const attempt = async (resource, release) => {
    try { await release(); }
    catch (cause) { errors.push(new Error(`Could not clean up ${resource}`, { cause })); }
  };
  await attempt('fixture cleanup coordinator', () => cleanup(attempt));
  if (primaryFailure || errors.length) {
    throw new AggregateError(
      primaryFailure ? [primaryFailure.error, ...errors] : errors,
      `Runtime fixture failed; retained diagnostics: ${directory}`,
      { cause: primaryFailure ? primaryFailure.error : errors[0] },
    );
  }
}
