module.exports = (path, options) => {
  // If the import has a .js extension and we're in a workspace package
  if (path.endsWith('.js')) {
    // Try to resolve as .ts first
    const tsPath = path.replace(/\.js$/, '.ts');
    try {
      return options.defaultResolver(tsPath, options);
    } catch {
      // If .ts doesn't exist, try .tsx
      try {
        const tsxPath = path.replace(/\.js$/, '.tsx');
        return options.defaultResolver(tsxPath, options);
      } catch {
        // Fall back to default resolution
      }
    }
  }

  // Default resolution
  return options.defaultResolver(path, options);
};