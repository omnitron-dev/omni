# PDF fonts

These font files are inputs to the Node-only [Typst PDF compiler](../src/typst/index.ts). They provide New Computer Modern text and mathematics, plus DejaVu Sans Mono for code. The compiler uses these bundled bytes rather than discovering fonts on the host or downloading them.

[manifest.json](manifest.json) records the immutable Typst assets source revision and SHA-256 of each file. The fonts are unmodified copies from that revision. Pass explicit `fontData` when a document needs additional glyph coverage; unsupported glyphs produce a compilation error.

The fonts have their own licenses, separate from the package license:

- New Computer Modern: GUST Font License, with the LaTeX Project Public License terms.
- DejaVu Sans Mono: Bitstream Vera and Arev notices; DejaVu changes are in the public domain.

Preserve [NOTICE.txt](NOTICE.txt), [LPPL-1.3c.txt](LPPL-1.3c.txt), and the manifest when redistributing these assets. The full notices, attribution, and modification conditions are in those files.
