'use client';

import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined';
import Check from '@mui/icons-material/Check';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useTheme } from '@mui/material/styles';
import type { MathfieldElement, MathfieldOptions, MoveOutEvent } from 'mathlive';
import { sanitizeMathMarkup } from './math-markup.js';

export const defaultMathInputLabels = {
  field: 'Equation',
  source: 'LaTeX source',
  keyboard: 'Math keyboard',
  done: 'Return to document',
  loading: 'Loading equation editor…',
  unavailable: 'Visual input unavailable. LaTeX editing is available.',
  syntax: 'Check the LaTeX syntax. The source is retained.',
  limit: 'Equation exceeds the configured limit.',
};
export type MathInputLabels = typeof defaultMathInputLabels;
export type MathExit = MoveOutEvent['direction'];
export interface MathInputProps {
  value: string;
  /** Synchronous admission: return false to reject an edit and restore the accepted value. */
  onChange: (latex: string) => boolean | void;
  onExit?: (direction: MathExit) => void;
  onHistory?: (redo: boolean) => void;
  readOnly?: boolean;
  locale?: string;
  autoFocus?: boolean;
  entry?: 'start' | 'end';
  display?: boolean;
  maxLength?: number;
  labels?: Partial<MathInputLabels>;
  /** Initial host-owned input configuration (remount to replace); expressions never supply executable options. */
  options?: Partial<Pick<MathfieldOptions, 'macros' | 'inlineShortcuts' | 'keybindings' | 'mathVirtualKeyboardPolicy'>>;
}
let runtime: Promise<typeof import('mathlive')> | undefined;
function loadMathLive() {
  return (runtime ??= import('mathlive')
    .then((module) => {
      // Fonts are packaged by the host bundler. Never contact a CDN or load sounds.
      module.MathfieldElement.createHTML = sanitizeMathMarkup;
      module.MathfieldElement.fontsDirectory = null;
      module.MathfieldElement.soundsDirectory = null;
      return module;
    })
    .catch((error: unknown) => {
      runtime = undefined;
      throw error;
    }));
}

/** Controlled, local-only scientific input. Does not evaluate or certify mathematics. */
export function MathInput(props: MathInputProps) {
  const labels = { ...defaultMathInputLabels, ...props.labels };
  const theme = useTheme();
  const host = useRef<HTMLSpanElement>(null),
    field = useRef<MathfieldElement | undefined>(undefined);
  const editingSource = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const [source, setSource] = useState(false),
    [issue, setIssue] = useState<'syntax' | 'limit'>();
  function accept(value: string) {
    const p = latest.current;
    if (p.readOnly || value.length > (p.maxLength ?? 65536) || p.onChange(value) === false) {
      if (!p.readOnly) setIssue('limit');
      return false;
    }
    return true;
  }
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void loadMathLive()
      .then(({ MathfieldElement }) => {
        if (cancelled || !host.current) return;
        const p = latest.current;
        if (p.locale) MathfieldElement.locale = p.locale;
        const mf = new MathfieldElement({
          defaultMode: p.display ? 'math' : 'inline-math',
          mathVirtualKeyboardPolicy: 'manual',
          ...p.options,
        });
        field.current = mf;
        mf.smartFence = false;
        mf.removeExtraneousParentheses = false;
        mf.readOnly = !!p.readOnly;
        mf.setAttribute('aria-label', p.labels?.field ?? defaultMathInputLabels.field);
        mf.setValue(p.value, { silenceNotifications: true });
        const input = (event: Event) => {
          event.stopPropagation();
          const accepted = accept(mf.value);
          if (!accepted) mf.setValue(latest.current.value, { silenceNotifications: true });
          else setIssue(mf.errors.length ? 'syntax' : undefined);
        };
        const move = (event: CustomEvent<MoveOutEvent>) => {
          if (!latest.current.onExit) return;
          event.preventDefault();
          latest.current.onExit(event.detail.direction);
        };
        const key = (event: KeyboardEvent) => {
          if (event.isComposing) return;
          const p = latest.current;
          if (p.onHistory && (event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            event.stopImmediatePropagation();
            p.onHistory(event.shiftKey || event.key.toLowerCase() === 'y');
          } else if (p.onExit && (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey))) {
            // Let MathLive complete a command or navigate a matrix with Enter first.
            if (event.key === 'Enter' && mf.mode === 'latex') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            p.onExit('forward');
          }
        };
        const stop = (event: Event) => {
          event.stopPropagation();
          if (event.type === 'beforeinput' && latest.current.onHistory) {
            const type = (event as InputEvent).inputType;
            if (type === 'historyUndo' || type === 'historyRedo') {
              event.preventDefault();
              latest.current.onHistory(type === 'historyRedo');
            }
          }
        };
        for (const name of ['keydown', 'keyup', 'keypress', 'beforeinput', 'paste', 'cut', 'copy'])
          mf.addEventListener(name, stop);
        mf.addEventListener('input', input);
        mf.addEventListener('move-out', move);
        mf.addEventListener('keydown', key, true);
        dispose = () => {
          for (const name of ['keydown', 'keyup', 'keypress', 'beforeinput', 'paste', 'cut', 'copy'])
            mf.removeEventListener(name, stop);
          mf.removeEventListener('input', input);
          mf.removeEventListener('move-out', move);
          mf.removeEventListener('keydown', key, true);
          mf.remove();
          field.current = undefined;
        };
        host.current.replaceChildren(mf);
        mf.menuItems = [];
        setReady(true);
        if (mf.errors.length) {
          setIssue('syntax');
          editingSource.current = true;
          setSource(true);
        }
      })
      .catch(() => {
        dispose?.();
        if (!cancelled) {
          setFailed(true);
          setSource(true);
        }
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  useEffect(() => {
    const p = latest.current,
      mf = field.current;
    if (ready && mf && p.autoFocus && !p.readOnly && !editingSource.current) {
      mf.focus();
      mf.position = p.entry === 'start' ? 0 : -1;
    }
  }, [ready]);
  useEffect(() => {
    const mf = field.current;
    if (!mf) return;
    mf.readOnly = !!props.readOnly;
    mf.setAttribute('aria-label', labels.field);
    if (mf.value !== props.value) mf.setValue(props.value, { silenceNotifications: true });
  }, [props.value, props.readOnly, labels.field, ready]);
  useEffect(() => {
    if (props.locale && ready)
      void loadMathLive().then(({ MathfieldElement }) => {
        MathfieldElement.locale = props.locale!;
      });
  }, [props.locale, ready]);
  return (
    <Box
      component="span"
      className="prism-math-input"
      sx={{
        color: 'text.primary',
        bgcolor: 'background.paper',
        borderColor: 'divider',
        '--prism-editor-accent': theme.palette.primary.main,
        '--prism-editor-radius': `${theme.shape.borderRadius}px`,
      }}
    >
      <GlobalStyles
        styles={{
          '.ML__keyboard': {
            '--keyboard-background': theme.palette.background.default,
            '--keycap-background': theme.palette.background.paper,
            '--keycap-text': theme.palette.text.primary,
            '--keycap-background-hover': theme.palette.action.hover,
            '--keycap-text-hover': theme.palette.text.primary,
            '--keyboard-accent-color': theme.palette.primary.main,
            '--keyboard-toolbar-background': theme.palette.background.paper,
            '--keyboard-toolbar-text': theme.palette.text.secondary,
            '--keyboard-toolbar-text-active': theme.palette.primary.main,
            '--keycap-primary-background': theme.palette.primary.main,
            '--keycap-primary-text': theme.palette.primary.contrastText,
            '--keycap-secondary-background': theme.palette.action.hover,
            '--keycap-secondary-text': theme.palette.text.primary,
            '--keycap-border': `1px solid ${theme.palette.divider}`,
            '--keycap-secondary-border': `1px solid ${theme.palette.divider}`,
            '--keyboard-zindex': theme.zIndex.modal + 1,
          },
        }}
      />
      {!ready && (
        <Box component="span" role="status" sx={{ typography: 'caption' }}>
          {failed ? labels.unavailable : labels.loading}
        </Box>
      )}
      <span ref={host} className="prism-math-input__field" />
      <Box component="span" className="prism-math-input__tools">
        <Button
          type="button"
          size="small"
          aria-pressed={source}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSource(!source)}
        >
          LaTeX
        </Button>
        <Tooltip title={labels.keyboard}>
          <span>
            <IconButton
              aria-label={labels.keyboard}
              type="button"
              size="small"
              disabled={!ready || props.readOnly}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                field.current?.focus();
                field.current?.executeCommand('toggleVirtualKeyboard');
              }}
            >
              <KeyboardOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {props.onExit && (
          <Tooltip title={labels.done}>
            <IconButton type="button" size="small" aria-label={labels.done} onClick={() => props.onExit?.('forward')}>
              <Check fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {(source || !ready) && (
        <TextField
          fullWidth
          autoFocus={!ready && props.autoFocus}
          size="small"
          multiline
          maxRows={8}
          label={labels.source}
          value={props.value}
          onChange={(event) => {
            editingSource.current = true;
            setSource(true);
            if (accept(event.target.value)) setIssue(undefined);
          }}
          slotProps={{ input: { readOnly: props.readOnly }, htmlInput: { spellCheck: false } }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              props.onExit?.('forward');
            }
            if (props.onHistory && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
              event.preventDefault();
              event.stopPropagation();
              props.onHistory(event.shiftKey || event.key.toLowerCase() === 'y');
            }
          }}
          sx={{ flexBasis: '100%', mt: 1, '& textarea': { fontFamily: 'monospace' } }}
        />
      )}
      {issue && (
        <Box component="span" role="status" sx={{ typography: 'caption', color: 'text.secondary', flexBasis: '100%' }}>
          {labels[issue]}
        </Box>
      )}
    </Box>
  );
}
