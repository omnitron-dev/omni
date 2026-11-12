/** Shared styling for the static filetree directive. Disclosure is native HTML. */
export const FILE_TREE_CSS = `
.lumen-file-tree{margin:1.5rem 0;padding:1rem 1.25rem;border:1px solid var(--lumen-border);border-radius:6px;background:var(--lumen-surface);font:13px/1.6 var(--lumen-font-sans);color:var(--lumen-fg)}
.lumen-file-tree figcaption{font:600 13px/1.5 var(--lumen-font-mono);margin-block-end:1rem;overflow-wrap:anywhere}
.lumen-file-tree ul{list-style:none;margin:0;padding:0}
.lumen-file-tree ul ul{margin-inline-start:.45rem;padding-inline-start:1.25rem;border-inline-start:1px solid var(--lumen-border)}
.lumen-file-tree li{position:relative;margin:0;padding:.25rem 0}
.lumen-file-tree ul ul>li::before{content:'';position:absolute;inset-inline-start:-1.25rem;top:1rem;width:.75rem;border-block-start:1px solid var(--lumen-border)}
.lumen-file-tree-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 .5rem;min-width:0}
.lumen-file-tree-icon{flex:none;align-self:center;color:var(--lumen-muted)}
.lumen-file-tree-name{min-width:0;overflow-wrap:anywhere}
.lumen-file-tree .lumen-file-tree-name code{background:none;border:0;padding:0;font:inherit;font-family:var(--lumen-font-mono);white-space:normal;color:var(--lumen-fg)}
.lumen-file-tree-description{flex:1 1 12rem;color:var(--lumen-muted);overflow-wrap:anywhere}
.lumen-file-tree summary{position:relative;cursor:pointer;list-style:none}
.lumen-file-tree summary::-webkit-details-marker{display:none}
.lumen-file-tree summary::before{content:'';position:absolute;inset-inline-start:-.8rem;top:.55rem;border:.25rem solid transparent;border-inline-start-color:var(--lumen-muted);transform-origin:25% 50%}
.lumen-file-tree details[open]>summary::before{transform:rotate(90deg)}
.lumen-file-tree:dir(rtl) details[open]>summary::before{transform:rotate(-90deg)}
.lumen-file-tree summary:focus-visible{outline:2px solid var(--lumen-accent);outline-offset:3px;border-radius:2px}
@media(max-width:480px){.lumen-file-tree{padding:.875rem 1rem}.lumen-file-tree ul ul{padding-inline-start:.875rem}.lumen-file-tree ul ul>li::before{inset-inline-start:-.875rem;width:.5rem}.lumen-file-tree-description{flex-basis:100%;padding-inline-start:1.5rem}}
`;
