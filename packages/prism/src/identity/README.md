# Omnitron identity

Console and the Lumen website consume `@omnitron-dev/prism/identity`. The module extends Prism's existing MUI theme; it does not create another provider or state store. Pass `omnitronTheme` to `PrismProvider.themeOverrides`. Inter is the common interface and heading face; load its 400, 500, 600 and 700 weights in the application. Native monospace is reserved for code, identifiers and measurements.

`omnitronTokens` is the source for light/dark surfaces, foregrounds, semantic colours and geometry. `omnitronCssVariables(mode)` exposes the same values to server-rendered page CSS. Use `--omni-text-muted` for secondary content, `--omni-border` for surface separation and `--omni-control-border` for controls. `--omni-focus-ring` is a two-pixel accent outline with a three-pixel offset. Surfaces have six-pixel corners and one-pixel borders. Avoid gradients, glow, ornamental grids and additional accent palettes.

Use `OmnitronBrand` for the text lockup and `OmnitronMark` when space is limited. The mark is four interlocking triangular planes around a stable core. Its geometry is exported as `omnitronMarkGeometry`; the standalone asset is `omnitronMarkSvg`. Text remains text in the lockup. Set `label={null}` when adjacent text already supplies the accessible name. A single mark works from 16 pixels upward; navigation uses 36 pixels and app loading uses 72 pixels.

`OmnitronSplash` describes loading, success or error through visible text and accessible status messages. Omit `progress` unless a real completed/total measurement exists. An unknown session-validation time must never be represented by a guessed percentage. Supply the real failure message and an `action` when recovery is possible.

The static logo never animates. Loading animates only three facet translations over 2.4 seconds, with no JavaScript frame loop, filters, external SVG library or rotating page content. Reduced-motion users receive the static mark and the same text. Visibility and intersection observers pause activity in hidden documents and outside the viewport; listeners are removed when loading ends or the mark unmounts. Success and error use static check/cross cores as well as semantic colours.

The Console favicon at `apps/omnitron/webapp/public/logo.svg` is generated from `omnitronMarkSvg`; update the exported geometry first. Browser verification covers both themes, 320-pixel layouts, keyboard focus and normal/reduced/hidden motion. The shared palette tests enforce 4.5:1 for body text and semantic signals, and 3:1 for control boundaries and keyboard focus.
