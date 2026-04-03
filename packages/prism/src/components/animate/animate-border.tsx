import type { BoxProps } from '@mui/material/Box';
import type { Theme, SxProps, CSSObject } from '@mui/material/styles';

import { useRef, useState, useEffect } from 'react';
import { m, useTransform, useMotionValue, useAnimationFrame, useMotionTemplate } from 'framer-motion';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

import { createClasses } from '../../utils/create-classes.js';

// ----------------------------------------------------------------------

export const animateBorderClasses = {
  root: createClasses('animate__border__root'),
  primaryBorder: createClasses('animate__border__primary'),
  secondaryBorder: createClasses('animate__border__secondary'),
  svgWrapper: createClasses('animate__border__svg__wrapper'),
  movingShape: createClasses('animate__border__moving__shape'),
};

// ----------------------------------------------------------------------

/**
 * Portal-old compatible borderGradient mixin.
 * Uses CSS mask to create a ring from the padding area.
 * `currentColor` controls the ring color when no explicit color is given.
 */
function borderGradient(props?: { color?: string; padding?: string }): CSSObject {
  const { color, padding = '2px' } = props ?? {};

  return {
    padding,
    inset: 0,
    width: '100%',
    content: '""',
    height: '100%',
    margin: 'auto',
    position: 'absolute',
    borderRadius: 'inherit',
    mask: 'linear-gradient(#FFF 0 0) content-box, linear-gradient(#FFF 0 0)',
    WebkitMask: 'linear-gradient(#FFF 0 0) content-box, linear-gradient(#FFF 0 0)',
    maskComposite: 'exclude',
    WebkitMaskComposite: 'xor',
    ...(color && { background: color }),
  };
}

// ----------------------------------------------------------------------

type BorderStyleProps = {
  /** Border stroke width as CSS string (e.g. '1px', '2px'). Default '2px'. */
  width?: string;
  /** Size (px) of the radial gradient glow that moves along the border. */
  size?: number;
  sx?: SxProps<Theme>;
};

export type AnimateBorderProps = BoxProps & {
  /** Animation duration in seconds. Default 8. */
  duration?: number;
  slotProps?: {
    primaryBorder?: BorderStyleProps;
    secondaryBorder?: BorderStyleProps;
    /** Static outline color behind the animation. */
    outlineColor?: string | ((theme: Theme) => string);
    svgSettings?: {
      rx?: string;
      ry?: string;
    };
  };
};

// ----------------------------------------------------------------------

export function AnimateBorder({ sx, children, duration, slotProps, className, ...other }: AnimateBorderProps) {
  const theme = useTheme();

  const rootRef = useRef<HTMLDivElement>(null);
  const primaryBorderRef = useRef<HTMLSpanElement>(null);

  const [isHidden, setIsHidden] = useState(false);

  const secondaryBorderStyles = useComputedElementStyles(theme, primaryBorderRef);

  useEffect(() => {
    const handleVisibility = () => {
      if (rootRef.current) {
        const displayStyle = getComputedStyle(rootRef.current).display;
        setIsHidden(displayStyle === 'none');
      }
    };

    handleVisibility();

    window.addEventListener('resize', handleVisibility);

    return () => {
      window.removeEventListener('resize', handleVisibility);
    };
  }, []);

  const outlineColor =
    typeof slotProps?.outlineColor === 'function' ? slotProps?.outlineColor(theme) : slotProps?.outlineColor;

  const borderProps = {
    duration,
    isHidden,
    rx: slotProps?.svgSettings?.rx,
    ry: slotProps?.svgSettings?.ry,
  };

  const renderPrimaryBorder = () => (
    <MovingBorder
      {...borderProps}
      ref={primaryBorderRef}
      size={slotProps?.primaryBorder?.size}
      sx={[
        {
          ...borderGradient({ padding: slotProps?.primaryBorder?.width }),
        },
        ...(Array.isArray(slotProps?.primaryBorder?.sx)
          ? (slotProps!.primaryBorder!.sx as any[])
          : [slotProps?.primaryBorder?.sx]),
      ]}
    />
  );

  const renderSecondaryBorder = () =>
    slotProps?.secondaryBorder && (
      <MovingBorder
        {...borderProps}
        size={slotProps?.secondaryBorder?.size ?? slotProps?.primaryBorder?.size}
        sx={[
          {
            ...borderGradient({
              padding: slotProps?.secondaryBorder?.width ?? secondaryBorderStyles.padding,
            }),
            borderRadius: secondaryBorderStyles.borderRadius,
            transform: 'scale(-1, -1)',
          },
          ...(Array.isArray(slotProps?.secondaryBorder?.sx)
            ? (slotProps!.secondaryBorder!.sx as any[])
            : [slotProps?.secondaryBorder?.sx]),
        ]}
      />
    );

  return (
    <Box
      dir="ltr"
      ref={rootRef}
      className={[animateBorderClasses.root, className].filter(Boolean).join(' ')}
      sx={[
        {
          minWidth: 40,
          minHeight: 40,
          overflow: 'hidden',
          position: 'relative',
          width: 'fit-content',
          '&::before': borderGradient({
            color: outlineColor,
            padding: slotProps?.primaryBorder?.width,
          }),
          ...(!!children && {
            minWidth: 'unset',
            minHeight: 'unset',
          }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {renderPrimaryBorder()}
      {renderSecondaryBorder()}
      {children}
    </Box>
  );
}

// ----------------------------------------------------------------------

type MovingBorderProps = BoxProps<'span'> & {
  rx?: string;
  ry?: string;
  duration?: number;
  isHidden?: boolean;
  size?: BorderStyleProps['size'];
};

function MovingBorder({ sx, size, isHidden, rx = '30%', ry = '30%', duration = 8, ...other }: MovingBorderProps) {
  const svgRectRef = useRef<SVGRectElement>(null);
  const progress = useMotionValue<number>(0);

  const updateAnimationFrame = (time: number) => {
    if (!svgRectRef.current) return;
    try {
      const pathLength = svgRectRef.current.getTotalLength();
      const pixelsPerMs = pathLength / (duration * 1000);
      progress.set((time * pixelsPerMs) % pathLength);
    } catch {
      return;
    }
  };

  const calculateTransform = (val: number) => {
    if (!svgRectRef.current) return { x: 0, y: 0 };
    try {
      const point = svgRectRef.current.getPointAtLength(val);
      return point ? { x: point.x, y: point.y } : { x: 0, y: 0 };
    } catch {
      return { x: 0, y: 0 };
    }
  };

  useAnimationFrame((time) => (!isHidden ? updateAnimationFrame(time) : undefined));

  const x = useTransform(progress, (val) => calculateTransform(val).x);
  const y = useTransform(progress, (val) => calculateTransform(val).y);
  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`;

  return (
    <Box component="span" sx={[{ textAlign: 'initial' }, ...(Array.isArray(sx) ? sx : [sx])]} {...other}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        className={animateBorderClasses.svgWrapper}
        style={{ position: 'absolute' }}
      >
        <rect ref={svgRectRef} fill="none" width="100%" height="100%" rx={rx} ry={ry} />
      </svg>

      <Box
        component={m.span}
        style={{ transform }}
        className={animateBorderClasses.movingShape}
        sx={{
          width: size,
          height: size,
          filter: 'blur(8px)',
          position: 'absolute',
          background: 'radial-gradient(currentColor 40%, transparent 80%)',
        }}
      />
    </Box>
  );
}

// ----------------------------------------------------------------------

function useComputedElementStyles(theme: Theme, ref: React.RefObject<HTMLSpanElement | null>) {
  const [computedStyles, setComputedStyles] = useState<CSSObject | null>(null);

  const isRtl = theme.direction === 'rtl';

  useEffect(() => {
    if (ref.current) {
      const style = getComputedStyle(ref.current);
      setComputedStyles({
        paddingTop: style.paddingBottom,
        paddingBottom: style.paddingTop,
        paddingLeft: isRtl ? style.paddingLeft : style.paddingRight,
        paddingRight: isRtl ? style.paddingRight : style.paddingLeft,
        borderTopLeftRadius: isRtl ? style.borderBottomLeftRadius : style.borderBottomRightRadius,
        borderTopRightRadius: isRtl ? style.borderBottomRightRadius : style.borderBottomLeftRadius,
        borderBottomLeftRadius: isRtl ? style.borderTopLeftRadius : style.borderTopRightRadius,
        borderBottomRightRadius: isRtl ? style.borderTopRightRadius : style.borderTopLeftRadius,
      });
    }
  }, [ref, isRtl]);

  return {
    padding: `${computedStyles?.paddingTop} ${computedStyles?.paddingRight} ${computedStyles?.paddingBottom} ${computedStyles?.paddingLeft}`,
    borderRadius: `${computedStyles?.borderTopLeftRadius} ${computedStyles?.borderTopRightRadius} ${computedStyles?.borderBottomRightRadius} ${computedStyles?.borderBottomLeftRadius}`,
  };
}
