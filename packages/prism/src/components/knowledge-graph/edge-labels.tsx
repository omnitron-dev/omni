import { ZoomInIcon, ZoomOutIcon } from '../../icons/controls.js';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Controls,
  ControlButton,
  EdgeLabelRenderer,
  useNodes,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import Box from '@mui/material/Box';
import { FitViewIcon as FitScreenIcon } from '../../icons/controls.js';
import { EdgeLabelStore } from './label-store.js';
import { enclosingRect, placeEdgeLabels, type LabelAnchor, type LabelRect } from './label-layout.js';

export const EdgeLabelsContext = createContext<EdgeLabelStore | null>(null);
export function useEdgeLabel(anchor: LabelAnchor | undefined) {
  const store = useContext(EdgeLabelsContext);
  useLayoutEffect(() => {
    if (!store || !anchor) return;
    store.set(anchor);
    return () => store.remove(anchor.id);
  }, [store, anchor?.id, anchor?.text, anchor?.x, anchor?.y]);
}
type Size = { width: number; height: number };
function MeasuredLabel({
  anchor,
  box,
  maxWidth,
  onSize,
}: {
  anchor: LabelAnchor;
  box?: LabelRect;
  maxWidth: number;
  onSize: (id: string, size: Size | undefined) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number, height: number) => {
      if (width > 0 && height > 0) onSize(anchor.id, { width: Math.ceil(width), height: Math.ceil(height) });
    };
    measure(element.offsetWidth, element.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const border = entries[0]?.borderBoxSize?.[0];
      measure(border?.inlineSize ?? element.offsetWidth, border?.blockSize ?? element.offsetHeight);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      onSize(anchor.id, undefined);
    };
  }, [anchor.id, onSize]);
  return (
    <Box
      component="span"
      ref={ref}
      aria-hidden="true"
      data-edge-label={anchor.id}
      className="nodrag nopan prism-knowledge__edge-label"
      sx={{
        position: 'absolute',
        left: box?.x ?? anchor.x,
        top: box?.y ?? anchor.y,
        visibility: box ? 'visible' : 'hidden',
        width: 'max-content',
        maxWidth,
        bgcolor: 'var(--prism-graph-bg)',
        color: 'var(--prism-graph-text)',
        borderRadius: 0.5,
        px: 0.75,
        py: 0.25,
        fontSize: 12,
        lineHeight: 1.4,
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {anchor.text}
    </Box>
  );
}

/** One measured, collision-aware label plane for the entire incidence graph. */
export function EdgeLabels({
  store,
  gap,
  maxWidth,
  fitLabel,
  zoomInLabel,
  zoomOutLabel,
}: {
  store: EdgeLabelStore;
  gap: number;
  maxWidth: number;
  fitLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const anchors = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const nodes = useNodes();
  const initialized = useNodesInitialized();
  const { fitBounds, zoomIn, zoomOut } = useReactFlow();
  const atMinZoom = useStore((state) => state.transform[2] <= state.minZoom);
  const atMaxZoom = useStore((state) => state.transform[2] >= state.maxZoom);
  const initialFit = useRef(false);
  const onSize = useCallback(
    (id: string, size: Size | undefined) =>
      setSizes((prior) => {
        const old = prior.get(id);
        if (old?.width === size?.width && old?.height === size?.height) return prior;
        const next = new Map(prior);
        if (size) next.set(id, size);
        else next.delete(id);
        return next;
      }),
    []
  );
  const obstacles = useMemo(
    () =>
      nodes.flatMap((node) => {
        const width = node.measured?.width,
          height = node.measured?.height;
        return width && height && !node.hidden ? [{ ...node.position, width, height }] : [];
      }),
    [nodes]
  );
  const placements = useMemo(
    () =>
      placeEdgeLabels(
        anchors.flatMap((anchor) => {
          const size = sizes.get(anchor.id);
          return size ? [{ ...anchor, ...size }] : [];
        }),
        obstacles,
        gap
      ),
    [anchors, sizes, obstacles, gap]
  );
  const boxes = useMemo(() => new Map(placements.map((l) => [l.id, l.box])), [placements]);
  const bounds = useMemo(() => enclosingRect([...obstacles, ...placements.map((l) => l.box)]), [obstacles, placements]);
  const fit = useCallback(() => {
    if (bounds) void fitBounds(bounds, { padding: 0.12, duration: 0 });
  }, [bounds, fitBounds]);
  useLayoutEffect(() => {
    // Wait for measured labels as well as nodes. Subsequent edits/drags preserve
    // the user's viewport; the explicit fit command always includes every label.
    if (!initialFit.current && initialized && anchors.length && placements.length === anchors.length) {
      initialFit.current = true;
      fit();
    }
  }, [initialized, anchors.length, placements.length, fit]);
  return (
    <>
      <EdgeLabelRenderer>
        <svg
          aria-hidden="true"
          width="1"
          height="1"
          style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }}
        >
          {placements.map(({ id, x, y, box }) => {
            const endX = Math.max(box.x, Math.min(x, box.x + box.width));
            const endY = Math.max(box.y, Math.min(y, box.y + box.height));
            if (endX === x && endY === y) return null;
            return (
              <g key={id} data-edge-label-leader={id} stroke="var(--prism-graph-muted)" strokeWidth="1">
                <path d={`M ${x} ${y} L ${endX} ${endY}`} fill="none" strokeDasharray="3 3" />
                <circle cx={x} cy={y} r="2" fill="var(--prism-graph-bg)" />
              </g>
            );
          })}
        </svg>
        {anchors.map((anchor) => (
          <MeasuredLabel
            key={anchor.id}
            anchor={anchor}
            box={boxes.get(anchor.id)}
            maxWidth={maxWidth}
            onSize={onSize}
          />
        ))}
      </EdgeLabelRenderer>
      <Controls showInteractive={false} showFitView={false} showZoom={false}>
        <ControlButton
          disabled={atMaxZoom}
          onClick={() => void zoomIn({ duration: 200 })}
          title={zoomInLabel}
          aria-label={zoomInLabel}
        >
          <ZoomInIcon />
        </ControlButton>
        <ControlButton
          disabled={atMinZoom}
          onClick={() => void zoomOut({ duration: 200 })}
          title={zoomOutLabel}
          aria-label={zoomOutLabel}
        >
          <ZoomOutIcon />
        </ControlButton>
        <ControlButton onClick={fit} title={fitLabel} aria-label={fitLabel}>
          <FitScreenIcon />
        </ControlButton>
      </Controls>
    </>
  );
}
