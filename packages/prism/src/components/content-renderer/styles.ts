'use client';

import { styled, alpha } from '@mui/material/styles';
import { contentClasses } from './classes.js';

// ---------------------------------------------------------------------------
// Shared content root — applies rich typography and element styling.
// Used by both TipTapRenderer (for TipTap JSON) and Markdown (for MD strings).
// ---------------------------------------------------------------------------

const MARGIN = '0.75em';
const CODE_FONT = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace";

export const ContentRoot = styled('div')(({ theme }) => ({
  // General spacing between adjacent elements
  '> * + *': {
    marginTop: 0,
    marginBottom: MARGIN,
  },

  // ─── Headings ───────────────────────────────────────────────
  '& h1, & h2, & h3, & h4, & h5, & h6': {
    scrollMarginTop: 100, // Account for sticky header on anchor jump
  },
  // Heading margins. Top margins are applied via the adjacent-sibling
  // combinator (`* + hN`) rather than a `:first-child` reset: a heading
  // takes its top margin ONLY when it follows another element, so a
  // heading at the very top of its container carries none. This is
  // SSR-safe (avoids Emotion's `:first-child` warning) and yields the
  // same result the previous `& > :first-child:is(h1,h2,h3)` reset did.
  h1: { ...theme.typography.h1, marginTop: 0, marginBottom: 12 },
  h2: { ...theme.typography.h2, marginTop: 0, marginBottom: 12 },
  h3: { ...theme.typography.h3, marginTop: 0, marginBottom: 8 },
  h4: { ...theme.typography.h4, marginTop: 0, marginBottom: 8 },
  h5: { ...theme.typography.h5, marginTop: 0, marginBottom: 8 },
  h6: { ...theme.typography.h6, marginTop: 0, marginBottom: 8 },
  '& * + h1, & * + h2': { marginTop: 40 },
  '& * + h3': { marginTop: 32 },
  '& * + h4, & * + h5, & * + h6': { marginTop: 24 },

  // ─── Paragraph ──────────────────────────────────────────────
  p: {
    ...theme.typography.body1,
    marginBottom: '1.25rem',
    lineHeight: 1.8,
  },

  // ─── Horizontal rule ───────────────────────────────────────
  hr: {
    flexShrink: 0,
    borderWidth: 0,
    margin: '2em 0',
    borderStyle: 'solid',
    borderBottomWidth: 'thin',
    borderColor: theme.palette.divider,
  },

  // ─── Images ─────────────────────────────────────────────────
  [`& .${contentClasses.image}`]: {
    width: '100%',
    height: 'auto',
    maxWidth: '100%',
    margin: 'auto auto 1.25em',
    borderRadius: Number(theme.shape.borderRadius) * 2,
  },
  // Plain img fallback
  '& img:not([class])': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: Number(theme.shape.borderRadius) * 2,
    marginBottom: '1.25em',
  },

  // ─── Links ──────────────────────────────────────────────────
  '& a': {
    color: theme.palette.primary.main,
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },

  // ─── Lists ──────────────────────────────────────────────────
  '& ul': {
    listStyleType: 'disc',
  },
  '& ul, & ol': {
    paddingLeft: 24,
    marginBottom: '1.25rem',
    '& > li': {
      lineHeight: 2,
      // Markdown wraps every list-item body in a `<p>`. With
      // `display: inline-block` (the previous setting), Chromium
      // refuses to render the `<li>`'s ::marker at all — the
      // disc/decimal vanishes and the list looks like a series of
      // bullet-less paragraphs. `display: inline` collapses the
      // `<p>` into inline flow so the marker positions normally;
      // `margin: 0` keeps the LI height tight against the marker
      // baseline. Multi-paragraph list items (rare here, but
      // possible) still render — subsequent `<p>` siblings get a
      // line break by the inline-flow rules.
      '& > p': {
        margin: 0,
        display: 'inline',
      },
    },
  },
  // Nested lists
  '& ul ul, & ol ol, & ul ol, & ol ul': {
    marginBottom: 0,
  },

  // ─── Task list (TipTap taskList / GFM checkboxes) ──────────
  '& ul[data-type="taskList"]': {
    listStyle: 'none',
    paddingLeft: 4,
    '& li': {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      '& > label': {
        marginTop: 4,
      },
    },
  },

  // ─── Blockquote ─────────────────────────────────────────────
  '& blockquote': {
    lineHeight: 1.6,
    fontSize: '1em',
    margin: '24px 0',
    position: 'relative',
    padding: theme.spacing(2.5, 3, 2.5, 7),
    color: theme.palette.text.secondary,
    borderLeft: `4px solid ${theme.palette.primary.main}`,
    borderRadius: Number(theme.shape.borderRadius) * 2,
    backgroundColor: alpha(theme.palette.primary.main, 0.04),
    '& p': {
      margin: 0,
      fontSize: 'inherit',
    },
    '& p + p': {
      marginTop: 8,
    },
    '&::before': {
      left: 16,
      top: 8,
      display: 'block',
      fontSize: '2.5em',
      content: '"\\201C"',
      position: 'absolute',
      color: alpha(theme.palette.primary.main, 0.3),
      lineHeight: 1,
    },
  },

  // ─── Inline code ────────────────────────────────────────────
  [`& .${contentClasses.codeInline}`]: {
    padding: theme.spacing(0.25, 0.75),
    color: theme.palette.text.secondary,
    fontSize: theme.typography.body2.fontSize,
    borderRadius: Number(theme.shape.borderRadius) / 2,
    backgroundColor: alpha(theme.palette.grey[500], 0.2),
    fontFamily: CODE_FONT,
  },
  // Fallback for code not inside pre
  '& :not(pre) > code:not([class])': {
    padding: theme.spacing(0.25, 0.75),
    color: theme.palette.text.secondary,
    fontSize: theme.typography.body2.fontSize,
    borderRadius: Number(theme.shape.borderRadius) / 2,
    backgroundColor: alpha(theme.palette.grey[500], 0.2),
    fontFamily: CODE_FONT,
  },

  // ─── Code block ─────────────────────────────────────────────
  [`& .${contentClasses.codeBlock}`]: {
    position: 'relative',
    marginBottom: '1.25rem',
    '& pre': {
      overflowX: 'auto',
      padding: theme.spacing(3),
      color: theme.palette.common.white,
      borderRadius: Number(theme.shape.borderRadius) * 1.5,
      fontFamily: CODE_FONT,
      fontSize: theme.typography.body2.fontSize,
      lineHeight: 1.7,
      backgroundColor: theme.palette.grey[900],
      ...(theme.palette.mode === 'dark' && {
        backgroundColor: alpha(theme.palette.grey[800], 0.9),
      }),
      '& code': {
        fontSize: 'inherit',
        fontFamily: 'inherit',
        backgroundColor: 'transparent',
        padding: 0,
        borderRadius: 0,
        color: 'inherit',
      },
    },
  },
  // Fallback for bare pre blocks
  '& pre:not([class])': {
    overflowX: 'auto',
    padding: theme.spacing(3),
    color: theme.palette.common.white,
    borderRadius: Number(theme.shape.borderRadius) * 1.5,
    fontFamily: CODE_FONT,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: 1.7,
    backgroundColor: theme.palette.grey[900],
    marginBottom: '1.25rem',
    ...(theme.palette.mode === 'dark' && {
      backgroundColor: alpha(theme.palette.grey[800], 0.9),
    }),
    '& code': {
      fontSize: 'inherit',
      fontFamily: 'inherit',
      backgroundColor: 'transparent',
      padding: 0,
      color: 'inherit',
    },
  },

  // ─── Table ──────────────────────────────────────────────────
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.body2.fontSize,
    border: `1px solid ${theme.palette.divider}`,
    marginBottom: '1.25rem',
    '& th, & td': {
      padding: theme.spacing(1, 1.5),
      border: `1px solid ${theme.palette.divider}`,
      verticalAlign: 'top',
    },
    '& th': {
      fontWeight: 700,
      backgroundColor: alpha(theme.palette.grey[500], 0.08),
    },
    // Zebra rows. `:nth-of-type` (not `:nth-child`) is SSR-safe and
    // exactly equivalent here — a `<tbody>` contains only `<tr>`
    // children, so type-position and child-position coincide.
    '& tbody tr:nth-of-type(odd)': {
      backgroundColor: alpha(theme.palette.grey[500], 0.04),
    },
  },

  // ─── Checkbox (GFM task lists) ──────────────────────────────
  [`& .${contentClasses.checkbox}`]: {
    cursor: 'pointer',
    position: 'relative',
    '&:before': {
      content: '""',
      top: -2,
      left: -2,
      width: 17,
      height: 17,
      borderRadius: 3,
      position: 'absolute',
      backgroundColor: theme.palette.grey[300],
      ...(theme.palette.mode === 'dark' && {
        backgroundColor: theme.palette.grey[700],
      }),
    },
    '&:checked': {
      '&:before': {
        backgroundColor: theme.palette.primary.main,
      },
      '&:after': {
        top: 1,
        left: 5,
        width: 4,
        height: 9,
        content: '""',
        position: 'absolute',
        borderStyle: 'solid',
        transform: 'rotate(45deg)',
        borderWidth: '0 2px 2px 0',
        borderColor: theme.palette.common.white,
      },
    },
  },

  // ─── Details / Summary ──────────────────────────────────────
  '& details': {
    marginBottom: '1rem',
    '& summary': {
      cursor: 'pointer',
      fontWeight: 600,
      marginBottom: 8,
    },
  },

  // ─── Definition list ────────────────────────────────────────
  '& dl': {
    marginBottom: '1.25rem',
    '& dt': {
      fontWeight: 700,
      marginTop: 12,
    },
    '& dd': {
      marginLeft: 24,
      marginBottom: 4,
    },
  },

  // ─── Kbd (keyboard shortcut) ────────────────────────────────
  '& kbd': {
    display: 'inline-block',
    padding: theme.spacing(0.25, 0.5),
    fontSize: '0.8em',
    fontFamily: CODE_FONT,
    borderRadius: 4,
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: `0 1px 0 ${alpha(theme.palette.grey[500], 0.1)}`,
    backgroundColor: alpha(theme.palette.grey[500], 0.06),
  },

  // ─── Mark (highlight) ──────────────────────────────────────
  '& mark': {
    padding: theme.spacing(0, 0.5),
    borderRadius: 2,
    backgroundColor: alpha(theme.palette.warning.main, 0.3),
  },

  // ─── Sup / Sub ──────────────────────────────────────────────
  '& sup, & sub': {
    fontSize: '0.75em',
  },

  // ─── Spoiler (||hidden text||) ────────────────────────────
  [`& .${contentClasses.spoiler}`]: {
    backgroundColor: theme.palette.text.primary,
    color: theme.palette.text.primary,
    borderRadius: 4,
    padding: theme.spacing(0, 0.5),
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    '&:hover, &[data-revealed="true"]': {
      backgroundColor: 'transparent',
      color: 'inherit',
      userSelect: 'auto',
    },
  },

  // ─── Admonition (callout) ─────────────────────────────────
  [`& .${contentClasses.admonition}`]: {
    margin: theme.spacing(2, 0),
    padding: theme.spacing(1.5, 2),
    borderRadius: theme.shape.borderRadius,
    borderLeft: `4px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
    '& > :last-child': { marginBottom: 0 },
  },
  [`& .${contentClasses.admonitionTitle}`]: {
    fontWeight: 600,
    textTransform: 'uppercase',
    fontSize: '0.75rem',
    letterSpacing: '0.05em',
    marginBottom: theme.spacing(0.75),
    opacity: 0.85,
  },
  [`& .${contentClasses.admonitionContent}`]: {
    '& p:last-child': { marginBottom: 0 },
  },
  [`& .${contentClasses.admonitionNote}`]: {
    borderLeftColor: theme.palette.text.secondary,
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
  },
  [`& .${contentClasses.admonitionTip}`]: {
    borderLeftColor: theme.palette.success.main,
    backgroundColor: alpha(theme.palette.success.main, 0.08),
  },
  [`& .${contentClasses.admonitionWarning}`]: {
    borderLeftColor: theme.palette.warning.main,
    backgroundColor: alpha(theme.palette.warning.main, 0.08),
  },
  [`& .${contentClasses.admonitionDanger}`]: {
    borderLeftColor: theme.palette.error.main,
    backgroundColor: alpha(theme.palette.error.main, 0.08),
  },
  [`& .${contentClasses.admonitionInfo}`]: {
    borderLeftColor: theme.palette.info.main,
    backgroundColor: alpha(theme.palette.info.main, 0.08),
  },
  [`& .${contentClasses.admonitionCaution}`]: {
    borderLeftColor: theme.palette.warning.dark,
    backgroundColor: alpha(theme.palette.warning.dark, 0.08),
  },

  // ─── Tabs ───────────────────────────────────────────────────
  [`& .${contentClasses.tabs}`]: {
    margin: theme.spacing(2, 0),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
  },
  [`& .${contentClasses.tabsHeader}`]: {
    display: 'flex',
    gap: 0,
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.text.primary, 0.03),
  },
  [`& .${contentClasses.tabsTab}`]: {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    padding: theme.spacing(1, 2),
    fontFamily: 'inherit',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'all 0.15s ease',
    '&:hover': { color: theme.palette.text.primary },
  },
  [`& .${contentClasses.tabsTabActive}`]: {
    color: theme.palette.text.primary,
    borderBottomColor: theme.palette.primary.main,
  },
  [`& .${contentClasses.tabsPanel}`]: {
    padding: theme.spacing(2),
    // No `:first-child` reset needed: headings only take a top margin
    // when preceded by a sibling (see heading rules above) and
    // paragraphs carry only a bottom margin, so the panel's first
    // child never has an excess top margin. (SSR-safe.)
    '& > :last-child': { marginBottom: 0 },
  },

  // ─── Code block — title + copy button ───────────────────────
  [`& .${contentClasses.codeBlockTitle}`]: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1.5),
    fontSize: '0.75rem',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    color: theme.palette.text.secondary,
    backgroundColor: alpha(theme.palette.text.primary, 0.06),
    borderTopLeftRadius: theme.shape.borderRadius,
    borderTopRightRadius: theme.shape.borderRadius,
  },
  [`& .${contentClasses.codeBlockCopy}`]: {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    padding: theme.spacing(0.25, 0.75),
    fontSize: '0.875rem',
    borderRadius: theme.shape.borderRadius,
    '&:hover': { backgroundColor: alpha(theme.palette.text.primary, 0.08) },
  },

  // ─── Figure ─────────────────────────────────────────────────
  [`& .${contentClasses.figure}`]: {
    margin: theme.spacing(2, 0),
    textAlign: 'center',
  },
  [`& .${contentClasses.figcaption}`]: {
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.75),
  },

  // ─── kbd ────────────────────────────────────────────────────
  [`& .${contentClasses.kbd}`]: {
    display: 'inline-block',
    padding: theme.spacing(0, 0.5),
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '0.8em',
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderBottomWidth: 2,
    borderRadius: 4,
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
    boxShadow: `0 1px 0 ${alpha(theme.palette.text.primary, 0.15)}`,
    minWidth: '1.5em',
    textAlign: 'center',
  },

  // ─── Compact mode (chat messages, comments, etc.) ─────────
  [`&.${contentClasses.compact}`]: {
    '> * + *': { marginTop: 0, marginBottom: 2 },
    // (Dropped an SSR-unsafe `& > :first-child:not(p)` 4px top-margin
    // tweak — cosmetically negligible in compact mode, and `:first-child`
    // triggered Emotion's SSR warning.)
    '& h1, & h2, & h3, & h4, & h5, & h6': { marginTop: 0, marginBottom: 2 },
    h1: { fontSize: '1.25rem', fontWeight: 600, marginTop: 0, marginBottom: 2 },
    h2: { fontSize: '1.125rem', fontWeight: 600, marginTop: 0, marginBottom: 2 },
    h3: { fontSize: '1rem', fontWeight: 600, marginTop: 0, marginBottom: 2 },
    'h4, h5, h6': { fontSize: '0.875rem', fontWeight: 600, marginTop: 0, marginBottom: 2 },
    p: {
      fontSize: '0.8125rem',
      lineHeight: 1.5,
      marginBottom: 2,
      '&:last-child': { marginBottom: 0 },
    },
    hr: { margin: '4px 0' },
    '& blockquote': {
      margin: '4px 0',
      padding: theme.spacing(0.5, 0, 0.5, 1.5),
      borderRadius: 0,
      backgroundColor: 'transparent',
      '&::before': { display: 'none' },
    },
    '& ul, & ol': {
      paddingLeft: 20,
      marginBottom: 2,
      '& > li': { lineHeight: 1.5, fontSize: '0.8125rem' },
    },
    '& img:not([class])': { marginBottom: 4 },
    [`& .${contentClasses.codeBlock}`]: { marginBottom: 4 },
    [`& .${contentClasses.codeBlock} pre, & pre:not([class])`]: {
      padding: theme.spacing(1.5),
      fontSize: '0.75rem',
      lineHeight: 1.5,
      marginBottom: 4,
    },
    [`& .${contentClasses.codeInline}, & :not(pre) > code:not([class])`]: {
      fontSize: '0.75rem',
    },
    '& table': {
      fontSize: '0.75rem',
      marginBottom: 4,
    },
  },
}));
