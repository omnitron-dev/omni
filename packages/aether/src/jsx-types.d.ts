/**
 * JSX Type Definitions
 *
 * Global JSX namespace and intrinsic elements for TypeScript
 */

import type { JSXElement } from './jsxruntime/types.js';

declare global {
  namespace JSX {
    // Element type returned by JSX expressions
    type Element = JSXElement;

    // Props for intrinsic elements
    interface IntrinsicElements {
      // HTML Elements
      a: HTMLAttributes<HTMLAnchorElement>;
      abbr: HTMLAttributes<HTMLElement>;
      address: HTMLAttributes<HTMLElement>;
      area: HTMLAttributes<HTMLAreaElement>;
      article: HTMLAttributes<HTMLElement>;
      aside: HTMLAttributes<HTMLElement>;
      audio: HTMLAttributes<HTMLAudioElement>;
      b: HTMLAttributes<HTMLElement>;
      base: HTMLAttributes<HTMLBaseElement>;
      bdi: HTMLAttributes<HTMLElement>;
      bdo: HTMLAttributes<HTMLElement>;
      blockquote: HTMLAttributes<HTMLQuoteElement>;
      body: HTMLAttributes<HTMLBodyElement>;
      br: HTMLAttributes<HTMLBRElement>;
      button: HTMLAttributes<HTMLButtonElement>;
      canvas: HTMLAttributes<HTMLCanvasElement>;
      caption: HTMLAttributes<HTMLTableCaptionElement>;
      cite: HTMLAttributes<HTMLElement>;
      code: HTMLAttributes<HTMLElement>;
      col: HTMLAttributes<HTMLTableColElement>;
      colgroup: HTMLAttributes<HTMLTableColElement>;
      data: HTMLAttributes<HTMLDataElement>;
      datalist: HTMLAttributes<HTMLDataListElement>;
      dd: HTMLAttributes<HTMLElement>;
      del: HTMLAttributes<HTMLModElement>;
      details: HTMLAttributes<HTMLDetailsElement>;
      dfn: HTMLAttributes<HTMLElement>;
      dialog: HTMLAttributes<HTMLDialogElement>;
      div: HTMLAttributes<HTMLDivElement>;
      dl: HTMLAttributes<HTMLDListElement>;
      dt: HTMLAttributes<HTMLElement>;
      em: HTMLAttributes<HTMLElement>;
      embed: HTMLAttributes<HTMLEmbedElement>;
      fieldset: HTMLAttributes<HTMLFieldSetElement>;
      figcaption: HTMLAttributes<HTMLElement>;
      figure: HTMLAttributes<HTMLElement>;
      footer: HTMLAttributes<HTMLElement>;
      form: HTMLAttributes<HTMLFormElement>;
      h1: HTMLAttributes<HTMLHeadingElement>;
      h2: HTMLAttributes<HTMLHeadingElement>;
      h3: HTMLAttributes<HTMLHeadingElement>;
      h4: HTMLAttributes<HTMLHeadingElement>;
      h5: HTMLAttributes<HTMLHeadingElement>;
      h6: HTMLAttributes<HTMLHeadingElement>;
      head: HTMLAttributes<HTMLHeadElement>;
      header: HTMLAttributes<HTMLElement>;
      hgroup: HTMLAttributes<HTMLElement>;
      hr: HTMLAttributes<HTMLHRElement>;
      html: HTMLAttributes<HTMLHtmlElement>;
      i: HTMLAttributes<HTMLElement>;
      iframe: HTMLAttributes<HTMLIFrameElement>;
      img: HTMLAttributes<HTMLImageElement>;
      input: HTMLAttributes<HTMLInputElement>;
      ins: HTMLAttributes<HTMLModElement>;
      kbd: HTMLAttributes<HTMLElement>;
      label: HTMLAttributes<HTMLLabelElement>;
      legend: HTMLAttributes<HTMLLegendElement>;
      li: HTMLAttributes<HTMLLIElement>;
      link: HTMLAttributes<HTMLLinkElement>;
      main: HTMLAttributes<HTMLElement>;
      map: HTMLAttributes<HTMLMapElement>;
      mark: HTMLAttributes<HTMLElement>;
      meta: HTMLAttributes<HTMLMetaElement>;
      meter: HTMLAttributes<HTMLMeterElement>;
      nav: HTMLAttributes<HTMLElement>;
      noscript: HTMLAttributes<HTMLElement>;
      object: HTMLAttributes<HTMLObjectElement>;
      ol: HTMLAttributes<HTMLOListElement>;
      optgroup: HTMLAttributes<HTMLOptGroupElement>;
      option: HTMLAttributes<HTMLOptionElement>;
      output: HTMLAttributes<HTMLOutputElement>;
      p: HTMLAttributes<HTMLParagraphElement>;
      param: HTMLAttributes<HTMLParamElement>;
      picture: HTMLAttributes<HTMLPictureElement>;
      pre: HTMLAttributes<HTMLPreElement>;
      progress: HTMLAttributes<HTMLProgressElement>;
      q: HTMLAttributes<HTMLQuoteElement>;
      rp: HTMLAttributes<HTMLElement>;
      rt: HTMLAttributes<HTMLElement>;
      ruby: HTMLAttributes<HTMLElement>;
      s: HTMLAttributes<HTMLElement>;
      samp: HTMLAttributes<HTMLElement>;
      script: HTMLAttributes<HTMLScriptElement>;
      section: HTMLAttributes<HTMLElement>;
      select: HTMLAttributes<HTMLSelectElement>;
      slot: HTMLAttributes<HTMLSlotElement>;
      small: HTMLAttributes<HTMLElement>;
      source: HTMLAttributes<HTMLSourceElement>;
      span: HTMLAttributes<HTMLSpanElement>;
      strong: HTMLAttributes<HTMLElement>;
      style: HTMLAttributes<HTMLStyleElement>;
      sub: HTMLAttributes<HTMLElement>;
      summary: HTMLAttributes<HTMLElement>;
      sup: HTMLAttributes<HTMLElement>;
      table: HTMLAttributes<HTMLTableElement>;
      tbody: HTMLAttributes<HTMLTableSectionElement>;
      td: HTMLAttributes<HTMLTableCellElement>;
      template: HTMLAttributes<HTMLTemplateElement>;
      textarea: HTMLAttributes<HTMLTextAreaElement>;
      tfoot: HTMLAttributes<HTMLTableSectionElement>;
      th: HTMLAttributes<HTMLTableCellElement>;
      thead: HTMLAttributes<HTMLTableSectionElement>;
      time: HTMLAttributes<HTMLTimeElement>;
      title: HTMLAttributes<HTMLTitleElement>;
      tr: HTMLAttributes<HTMLTableRowElement>;
      track: HTMLAttributes<HTMLTrackElement>;
      u: HTMLAttributes<HTMLElement>;
      ul: HTMLAttributes<HTMLUListElement>;
      var: HTMLAttributes<HTMLElement>;
      video: HTMLAttributes<HTMLVideoElement>;
      wbr: HTMLAttributes<HTMLElement>;

      // SVG Elements
      svg: SVGAttributes<SVGSVGElement>;
      animate: SVGAttributes<SVGAnimateElement>;
      circle: SVGAttributes<SVGCircleElement>;
      clipPath: SVGAttributes<SVGClipPathElement>;
      defs: SVGAttributes<SVGDefsElement>;
      desc: SVGAttributes<SVGDescElement>;
      ellipse: SVGAttributes<SVGEllipseElement>;
      feBlend: SVGAttributes<SVGFEBlendElement>;
      feColorMatrix: SVGAttributes<SVGFEColorMatrixElement>;
      feComponentTransfer: SVGAttributes<SVGFEComponentTransferElement>;
      feComposite: SVGAttributes<SVGFECompositeElement>;
      feConvolveMatrix: SVGAttributes<SVGFEConvolveMatrixElement>;
      feDiffuseLighting: SVGAttributes<SVGFEDiffuseLightingElement>;
      feDisplacementMap: SVGAttributes<SVGFEDisplacementMapElement>;
      feDistantLight: SVGAttributes<SVGFEDistantLightElement>;
      feDropShadow: SVGAttributes<SVGFEDropShadowElement>;
      feFlood: SVGAttributes<SVGFEFloodElement>;
      feFuncA: SVGAttributes<SVGFEFuncAElement>;
      feFuncB: SVGAttributes<SVGFEFuncBElement>;
      feFuncG: SVGAttributes<SVGFEFuncGElement>;
      feFuncR: SVGAttributes<SVGFEFuncRElement>;
      feGaussianBlur: SVGAttributes<SVGFEGaussianBlurElement>;
      feImage: SVGAttributes<SVGFEImageElement>;
      feMerge: SVGAttributes<SVGFEMergeElement>;
      feMergeNode: SVGAttributes<SVGFEMergeNodeElement>;
      feMorphology: SVGAttributes<SVGFEMorphologyElement>;
      feOffset: SVGAttributes<SVGFEOffsetElement>;
      fePointLight: SVGAttributes<SVGFEPointLightElement>;
      feSpecularLighting: SVGAttributes<SVGFESpecularLightingElement>;
      feSpotLight: SVGAttributes<SVGFESpotLightElement>;
      feTile: SVGAttributes<SVGFETileElement>;
      feTurbulence: SVGAttributes<SVGFETurbulenceElement>;
      filter: SVGAttributes<SVGFilterElement>;
      foreignObject: SVGAttributes<SVGForeignObjectElement>;
      g: SVGAttributes<SVGGElement>;
      image: SVGAttributes<SVGImageElement>;
      line: SVGAttributes<SVGLineElement>;
      linearGradient: SVGAttributes<SVGLinearGradientElement>;
      marker: SVGAttributes<SVGMarkerElement>;
      mask: SVGAttributes<SVGMaskElement>;
      metadata: SVGAttributes<SVGMetadataElement>;
      path: SVGAttributes<SVGPathElement>;
      pattern: SVGAttributes<SVGPatternElement>;
      polygon: SVGAttributes<SVGPolygonElement>;
      polyline: SVGAttributes<SVGPolylineElement>;
      radialGradient: SVGAttributes<SVGRadialGradientElement>;
      rect: SVGAttributes<SVGRectElement>;
      stop: SVGAttributes<SVGStopElement>;
      switch: SVGAttributes<SVGSwitchElement>;
      symbol: SVGAttributes<SVGSymbolElement>;
      text: SVGAttributes<SVGTextElement>;
      textPath: SVGAttributes<SVGTextPathElement>;
      tspan: SVGAttributes<SVGTSpanElement>;
      use: SVGAttributes<SVGUseElement>;
      view: SVGAttributes<SVGViewElement>;
    }

    // Element attributes
    interface ElementChildrenAttribute {
      children: {};
    }

    // HTML element attributes
    interface HTMLAttributes<T = HTMLElement> extends DOMAttributes<T> {
      // React-like attributes
      dangerouslySetInnerHTML?: { __html: string };

      // Standard HTML Attributes
      accessKey?: string;
      className?: string;
      class?: string;
      contentEditable?: boolean | 'true' | 'false' | 'inherit';
      contextMenu?: string;
      dir?: 'ltr' | 'rtl' | 'auto';
      draggable?: boolean;
      hidden?: boolean;
      id?: string;
      lang?: string;
      slot?: string;
      spellCheck?: boolean;
      style?: Partial<CSSStyleDeclaration> | string;
      tabIndex?: number;
      title?: string;
      translate?: 'yes' | 'no';

      // WAI-ARIA
      role?: string;

      // RDFa Attributes
      about?: string;
      datatype?: string;
      inlist?: any;
      prefix?: string;
      property?: string;
      resource?: string;
      typeof?: string;
      vocab?: string;

      // Non-standard Attributes
      autoCapitalize?: string;
      autoCorrect?: string;
      autoSave?: string;
      color?: string;
      itemProp?: string;
      itemScope?: boolean;
      itemType?: string;
      itemID?: string;
      itemRef?: string;
      results?: number;
      security?: string;
      unselectable?: 'on' | 'off';

      // Living Standard
      /**
       * Hints at the type of data that might be entered by the user while editing the element or its contents
       * @see https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute
       */
      inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
      /**
       * Specify that a standard HTML element should behave like a defined custom built-in element
       * @see https://html.spec.whatwg.org/multipage/custom-elements.html#attr-is
       */
      is?: string;

      // Data attributes
      [key: `data-${string}`]: any;

      // Aria attributes
      [key: `aria-${string}`]: any;
    }

    // SVG element attributes
    interface SVGAttributes<T = SVGElement> extends DOMAttributes<T> {
      className?: string;
      class?: string;
      color?: string;
      height?: number | string;
      id?: string;
      lang?: string;
      max?: number | string;
      media?: string;
      method?: string;
      min?: number | string;
      name?: string;
      style?: Partial<CSSStyleDeclaration> | string;
      target?: string;
      type?: string;
      width?: number | string;

      // SVG Specific
      accentHeight?: number | string;
      accumulate?: 'none' | 'sum';
      additive?: 'replace' | 'sum';
      alignmentBaseline?:
        | 'auto'
        | 'baseline'
        | 'before-edge'
        | 'text-before-edge'
        | 'middle'
        | 'central'
        | 'after-edge'
        | 'text-after-edge'
        | 'ideographic'
        | 'alphabetic'
        | 'hanging'
        | 'mathematical'
        | 'inherit';
      allowReorder?: 'no' | 'yes';
      alphabetic?: number | string;
      amplitude?: number | string;
      arabicForm?: 'initial' | 'medial' | 'terminal' | 'isolated';
      ascent?: number | string;
      attributeName?: string;
      attributeType?: string;
      autoReverse?: boolean;
      azimuth?: number | string;
      baseFrequency?: number | string;
      baselineShift?: number | string;
      baseProfile?: number | string;
      bbox?: number | string;
      begin?: number | string;
      bias?: number | string;
      by?: number | string;
      calcMode?: number | string;
      capHeight?: number | string;
      clip?: number | string;
      clipPath?: string;
      clipPathUnits?: number | string;
      clipRule?: number | string;
      colorInterpolation?: number | string;
      colorInterpolationFilters?: 'auto' | 'sRGB' | 'linearRGB' | 'inherit';
      colorProfile?: number | string;
      colorRendering?: number | string;
      contentScriptType?: number | string;
      contentStyleType?: number | string;
      cursor?: number | string;
      cx?: number | string;
      cy?: number | string;
      d?: string;
      decelerate?: number | string;
      descent?: number | string;
      diffuseConstant?: number | string;
      direction?: number | string;
      display?: number | string;
      divisor?: number | string;
      dominantBaseline?: number | string;
      dur?: number | string;
      dx?: number | string;
      dy?: number | string;
      edgeMode?: number | string;
      elevation?: number | string;
      enableBackground?: number | string;
      end?: number | string;
      exponent?: number | string;
      externalResourcesRequired?: boolean;
      fill?: string;
      fillOpacity?: number | string;
      fillRule?: 'nonzero' | 'evenodd' | 'inherit';
      filter?: string;
      filterRes?: number | string;
      filterUnits?: number | string;
      floodColor?: number | string;
      floodOpacity?: number | string;
      focusable?: boolean | 'auto';
      fontFamily?: string;
      fontSize?: number | string;
      fontSizeAdjust?: number | string;
      fontStretch?: number | string;
      fontStyle?: number | string;
      fontVariant?: number | string;
      fontWeight?: number | string;
      format?: number | string;
      from?: number | string;
      fx?: number | string;
      fy?: number | string;
      g1?: number | string;
      g2?: number | string;
      glyphName?: number | string;
      glyphOrientationHorizontal?: number | string;
      glyphOrientationVertical?: number | string;
      glyphRef?: number | string;
      gradientTransform?: string;
      gradientUnits?: string;
      hanging?: number | string;
      horizAdvX?: number | string;
      horizOriginX?: number | string;
      href?: string;
      ideographic?: number | string;
      imageRendering?: number | string;
      in2?: number | string;
      in?: string;
      intercept?: number | string;
      k1?: number | string;
      k2?: number | string;
      k3?: number | string;
      k4?: number | string;
      k?: number | string;
      kernelMatrix?: number | string;
      kernelUnitLength?: number | string;
      kerning?: number | string;
      keyPoints?: number | string;
      keySplines?: number | string;
      keyTimes?: number | string;
      lengthAdjust?: number | string;
      letterSpacing?: number | string;
      lightingColor?: number | string;
      limitingConeAngle?: number | string;
      local?: number | string;
      markerEnd?: string;
      markerHeight?: number | string;
      markerMid?: string;
      markerStart?: string;
      markerUnits?: number | string;
      markerWidth?: number | string;
      mask?: string;
      maskContentUnits?: number | string;
      maskUnits?: number | string;
      mathematical?: number | string;
      mode?: number | string;
      numOctaves?: number | string;
      offset?: number | string;
      opacity?: number | string;
      operator?: number | string;
      order?: number | string;
      orient?: number | string;
      orientation?: number | string;
      origin?: number | string;
      overflow?: number | string;
      overlinePosition?: number | string;
      overlineThickness?: number | string;
      paintOrder?: number | string;
      panose1?: number | string;
      path?: string;
      pathLength?: number | string;
      patternContentUnits?: string;
      patternTransform?: number | string;
      patternUnits?: string;
      pointerEvents?: number | string;
      points?: string;
      pointsAtX?: number | string;
      pointsAtY?: number | string;
      pointsAtZ?: number | string;
      preserveAlpha?: boolean;
      preserveAspectRatio?: string;
      primitiveUnits?: number | string;
      r?: number | string;
      radius?: number | string;
      refX?: number | string;
      refY?: number | string;
      renderingIntent?: number | string;
      repeatCount?: number | string;
      repeatDur?: number | string;
      requiredExtensions?: number | string;
      requiredFeatures?: number | string;
      restart?: number | string;
      result?: string;
      rotate?: number | string;
      rx?: number | string;
      ry?: number | string;
      scale?: number | string;
      seed?: number | string;
      shapeRendering?: number | string;
      slope?: number | string;
      spacing?: number | string;
      specularConstant?: number | string;
      specularExponent?: number | string;
      speed?: number | string;
      spreadMethod?: string;
      startOffset?: number | string;
      stdDeviation?: number | string;
      stemh?: number | string;
      stemv?: number | string;
      stitchTiles?: number | string;
      stopColor?: string;
      stopOpacity?: number | string;
      strikethroughPosition?: number | string;
      strikethroughThickness?: number | string;
      string?: number | string;
      stroke?: string;
      strokeDasharray?: string | number;
      strokeDashoffset?: string | number;
      strokeLinecap?: 'butt' | 'round' | 'square' | 'inherit';
      strokeLinejoin?: 'miter' | 'round' | 'bevel' | 'inherit';
      strokeMiterlimit?: number | string;
      strokeOpacity?: number | string;
      strokeWidth?: number | string;
      surfaceScale?: number | string;
      systemLanguage?: number | string;
      tableValues?: number | string;
      targetX?: number | string;
      targetY?: number | string;
      textAnchor?: string;
      textDecoration?: number | string;
      textLength?: number | string;
      textRendering?: number | string;
      to?: number | string;
      transform?: string;
      u1?: number | string;
      u2?: number | string;
      underlinePosition?: number | string;
      underlineThickness?: number | string;
      unicode?: number | string;
      unicodeBidi?: number | string;
      unicodeRange?: number | string;
      unitsPerEm?: number | string;
      vAlphabetic?: number | string;
      values?: string;
      vectorEffect?: number | string;
      version?: string;
      vertAdvY?: number | string;
      vertOriginX?: number | string;
      vertOriginY?: number | string;
      vHanging?: number | string;
      vIdeographic?: number | string;
      viewBox?: string;
      viewTarget?: number | string;
      visibility?: number | string;
      vMathematical?: number | string;
      widths?: number | string;
      wordSpacing?: number | string;
      writingMode?: number | string;
      x1?: number | string;
      x2?: number | string;
      x?: number | string;
      xChannelSelector?: string;
      xHeight?: number | string;
      xlinkActuate?: string;
      xlinkArcrole?: string;
      xlinkHref?: string;
      xlinkRole?: string;
      xlinkShow?: string;
      xlinkTitle?: string;
      xlinkType?: string;
      xmlBase?: string;
      xmlLang?: string;
      xmlns?: string;
      xmlnsXlink?: string;
      xmlSpace?: string;
      y1?: number | string;
      y2?: number | string;
      y?: number | string;
      yChannelSelector?: string;
      z?: number | string;
      zoomAndPan?: string;
    }

    // DOM event attributes
    interface DOMAttributes<T = Element> {
      children?: any;
      ref?: { current: T | null } | ((element: T | null) => void);

      // Clipboard Events
      onCopy?: (event: ClipboardEvent) => void;
      onCut?: (event: ClipboardEvent) => void;
      onPaste?: (event: ClipboardEvent) => void;

      // Composition Events
      onCompositionEnd?: (event: CompositionEvent) => void;
      onCompositionStart?: (event: CompositionEvent) => void;
      onCompositionUpdate?: (event: CompositionEvent) => void;

      // Focus Events
      onFocus?: (event: FocusEvent) => void;
      onBlur?: (event: FocusEvent) => void;

      // Form Events
      onChange?: (event: Event) => void;
      onInput?: (event: Event) => void;
      onReset?: (event: Event) => void;
      onSubmit?: (event: Event) => void;
      onInvalid?: (event: Event) => void;

      // Image Events
      onLoad?: (event: Event) => void;
      onError?: (event: Event) => void;

      // Keyboard Events
      onKeyDown?: (event: KeyboardEvent) => void;
      onKeyPress?: (event: KeyboardEvent) => void;
      onKeyUp?: (event: KeyboardEvent) => void;

      // Media Events
      onAbort?: (event: Event) => void;
      onCanPlay?: (event: Event) => void;
      onCanPlayThrough?: (event: Event) => void;
      onDurationChange?: (event: Event) => void;
      onEmptied?: (event: Event) => void;
      onEncrypted?: (event: Event) => void;
      onEnded?: (event: Event) => void;
      onLoadedData?: (event: Event) => void;
      onLoadedMetadata?: (event: Event) => void;
      onLoadStart?: (event: Event) => void;
      onPause?: (event: Event) => void;
      onPlay?: (event: Event) => void;
      onPlaying?: (event: Event) => void;
      onProgress?: (event: Event) => void;
      onRateChange?: (event: Event) => void;
      onSeeked?: (event: Event) => void;
      onSeeking?: (event: Event) => void;
      onStalled?: (event: Event) => void;
      onSuspend?: (event: Event) => void;
      onTimeUpdate?: (event: Event) => void;
      onVolumeChange?: (event: Event) => void;
      onWaiting?: (event: Event) => void;

      // MouseEvents
      onClick?: (event: MouseEvent) => void;
      onContextMenu?: (event: MouseEvent) => void;
      onDoubleClick?: (event: MouseEvent) => void;
      onDrag?: (event: DragEvent) => void;
      onDragEnd?: (event: DragEvent) => void;
      onDragEnter?: (event: DragEvent) => void;
      onDragExit?: (event: DragEvent) => void;
      onDragLeave?: (event: DragEvent) => void;
      onDragOver?: (event: DragEvent) => void;
      onDragStart?: (event: DragEvent) => void;
      onDrop?: (event: DragEvent) => void;
      onMouseDown?: (event: MouseEvent) => void;
      onMouseEnter?: (event: MouseEvent) => void;
      onMouseLeave?: (event: MouseEvent) => void;
      onMouseMove?: (event: MouseEvent) => void;
      onMouseOut?: (event: MouseEvent) => void;
      onMouseOver?: (event: MouseEvent) => void;
      onMouseUp?: (event: MouseEvent) => void;

      // Selection Events
      onSelect?: (event: Event) => void;

      // Touch Events
      onTouchCancel?: (event: TouchEvent) => void;
      onTouchEnd?: (event: TouchEvent) => void;
      onTouchMove?: (event: TouchEvent) => void;
      onTouchStart?: (event: TouchEvent) => void;

      // Pointer Events
      onPointerDown?: (event: PointerEvent) => void;
      onPointerMove?: (event: PointerEvent) => void;
      onPointerUp?: (event: PointerEvent) => void;
      onPointerCancel?: (event: PointerEvent) => void;
      onPointerEnter?: (event: PointerEvent) => void;
      onPointerLeave?: (event: PointerEvent) => void;
      onPointerOver?: (event: PointerEvent) => void;
      onPointerOut?: (event: PointerEvent) => void;

      // UI Events
      onScroll?: (event: Event) => void;

      // Wheel Events
      onWheel?: (event: WheelEvent) => void;

      // Animation Events
      onAnimationStart?: (event: AnimationEvent) => void;
      onAnimationEnd?: (event: AnimationEvent) => void;
      onAnimationIteration?: (event: AnimationEvent) => void;

      // Transition Events
      onTransitionEnd?: (event: TransitionEvent) => void;
    }
  }
}

export {};
