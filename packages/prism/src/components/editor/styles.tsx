import { styled, alpha } from '@mui/material/styles';

import { editorClasses } from './classes.js';

const MARGIN = '0.75em';

export const EditorRoot = styled('div')(({ theme }) => ({
  minHeight: 240,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: Number(theme.shape.borderRadius) * 1.5,
  border: `solid 1px ${alpha(theme.palette.grey[500], 0.2)}`,
  transition: theme.transitions.create(['border-color', 'box-shadow'], {
    duration: theme.transitions.duration.short,
  }),
  '&:focus-within': {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
  },

  // ---------------------------------------------------------------------------
  // State: error
  // ---------------------------------------------------------------------------
  [`&.${editorClasses.state.error}`]: {
    borderColor: theme.palette.error.main,
    [`& .${editorClasses.content.root}`]: {
      backgroundColor: alpha(theme.palette.error.main, 0.04),
    },
  },

  // ---------------------------------------------------------------------------
  // State: disabled
  // ---------------------------------------------------------------------------
  [`&.${editorClasses.state.disabled}`]: {
    opacity: 0.48,
    pointerEvents: 'none',
  },

  // ---------------------------------------------------------------------------
  // State: fullscreen
  // ---------------------------------------------------------------------------
  [`&.${editorClasses.state.fullscreen}`]: {
    top: 16,
    left: 16,
    position: 'fixed',
    maxHeight: 'unset',
    width: 'calc(100% - 32px)',
    height: 'calc(100% - 32px)',
    zIndex: theme.zIndex.modal,
    borderRadius: Number(theme.shape.borderRadius) * 2,
    backgroundColor: theme.palette.background.default,
    boxShadow: theme.shadows[24],
  },

  // ---------------------------------------------------------------------------
  // Placeholder
  // ---------------------------------------------------------------------------
  [`& .${editorClasses.content.placeholder}`]: {
    '&:first-of-type::before': {
      ...theme.typography.body2,
      height: 0,
      float: 'left',
      pointerEvents: 'none',
      content: 'attr(data-placeholder)',
      color: theme.palette.text.disabled,
    },
  },

  // ---------------------------------------------------------------------------
  // Content area
  // ---------------------------------------------------------------------------
  [`& .${editorClasses.content.root}`]: {
    display: 'flex',
    flex: '1 1 auto',
    overflowY: 'auto',
    flexDirection: 'column',
    borderBottomLeftRadius: 'inherit',
    borderBottomRightRadius: 'inherit',
    backgroundColor: alpha(theme.palette.grey[500], 0.04),

    '& .tiptap': {
      '> * + *': { marginTop: 0, marginBottom: MARGIN },
      '&.ProseMirror': {
        flex: '1 1 auto',
        outline: 'none',
        padding: theme.spacing(0, 2),
      },

      // Headings
      h1: { ...theme.typography.h1, marginTop: 40, marginBottom: 8 },
      h2: { ...theme.typography.h2, marginTop: 40, marginBottom: 8 },
      h3: { ...theme.typography.h3, marginTop: 24, marginBottom: 8 },
      h4: { ...theme.typography.h4, marginTop: 24, marginBottom: 8 },
      h5: { ...theme.typography.h5, marginTop: 24, marginBottom: 8 },
      h6: { ...theme.typography.h6, marginTop: 24, marginBottom: 8 },
      p: { ...theme.typography.body1, marginBottom: '1.25rem' },

      // Link
      [`& .${editorClasses.content.link}`]: {
        color: theme.palette.primary.main,
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
      },

      // Horizontal rule
      [`& .${editorClasses.content.hr}`]: {
        flexShrink: 0,
        borderWidth: 0,
        margin: '2em 0',
        borderStyle: 'solid',
        borderBottomWidth: 'thin',
        borderColor: theme.palette.divider,
      },

      // Image
      [`& .${editorClasses.content.image}`]: {
        width: '100%',
        height: 'auto',
        maxWidth: '100%',
        borderRadius: theme.shape.borderRadius,
        margin: 'auto auto 1.25em',
        '&.ProseMirror-selectednode': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      },

      // Lists
      [`& .${editorClasses.content.bulletList}`]: {
        paddingLeft: 16,
        listStyleType: 'disc',
      },
      [`& .${editorClasses.content.orderedList}`]: {
        paddingLeft: 16,
      },
      [`& .${editorClasses.content.listItem}`]: {
        lineHeight: 2,
        '& > p': { margin: 0 },
      },

      // Task list
      [`& .${editorClasses.content.taskList}`]: {
        listStyle: 'none',
        padding: 0,
        '& li': {
          display: 'flex',
          alignItems: 'flex-start',
          gap: theme.spacing(1),
          '& > label': {
            marginTop: 4,
            flexShrink: 0,
          },
          '& > div': { flex: 1 },
        },
      },

      // Blockquote
      [`& .${editorClasses.content.blockquote}`]: {
        lineHeight: 1.5,
        fontSize: '1.5em',
        margin: '24px auto',
        position: 'relative',
        fontFamily: 'Georgia, serif',
        padding: theme.spacing(3, 3, 3, 8),
        color: theme.palette.text.secondary,
        borderLeft: `solid 8px ${alpha(theme.palette.grey[500], 0.08)}`,
        [theme.breakpoints.up('md')]: { width: '100%', maxWidth: 640 },
        '& p': { margin: 0, fontSize: 'inherit', fontFamily: 'inherit' },
        '&::before': {
          left: 16,
          top: -8,
          display: 'block',
          fontSize: '3em',
          content: '"\\201C"',
          position: 'absolute',
          color: theme.palette.text.disabled,
        },
      },

      // Inline code
      [`& .${editorClasses.content.codeInline}`]: {
        padding: theme.spacing(0.25, 0.5),
        color: theme.palette.text.secondary,
        fontSize: theme.typography.body2.fontSize,
        borderRadius: Number(theme.shape.borderRadius) / 2,
        backgroundColor: alpha(theme.palette.grey[500], 0.16),
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      },

      // Code block
      [`& .${editorClasses.content.codeBlock}`]: {
        position: 'relative',
        '& pre': {
          overflowX: 'auto',
          color: theme.palette.common.white,
          padding: theme.spacing(5, 3, 3, 3),
          borderRadius: theme.shape.borderRadius,
          backgroundColor: theme.palette.grey[900],
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          '& code': { fontSize: theme.typography.body2.fontSize },
        },
        [`& .${editorClasses.content.langSelect}`]: {
          top: 8,
          right: 8,
          zIndex: 1,
          padding: 4,
          outline: 'none',
          borderRadius: 4,
          position: 'absolute',
          color: theme.palette.common.white,
          fontWeight: theme.typography.fontWeightMedium,
          borderColor: alpha(theme.palette.grey[500], 0.08),
          backgroundColor: alpha(theme.palette.grey[500], 0.08),
        },
      },
    },
  },
}));
