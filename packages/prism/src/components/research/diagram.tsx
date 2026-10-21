'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import type { ResearchLabels } from './document.js';
import { researchLimits } from './parse.js';
// Mermaid has mutable process-wide configuration. Serialise its configure/render
// pair; document-local widgets and source code never get a configuration hook.
let pending:Promise<unknown>=Promise.resolve();
export function diagramSourceAllowed(source:string,engine:string) {
  return engine==='mermaid' && source.length<=researchLimits.block && !/^\s*---/m.test(source) && !/%%\s*\{/.test(source);
}
export function ResearchDiagram({source,engine,labels}:{source:string;engine:string;labels:ResearchLabels}) {
  const id=`diagram-${useId().replace(/[^\w-]/g,'')}`;
  const container=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const theme=useTheme(), mode=theme.palette.mode;
  useEffect(()=>{
    let cancelled=false;
    setState('loading');
    const target=container.current;
    const run=async()=>{
      if(cancelled || !target) return;
      if(!diagramSourceAllowed(source,engine)){setState('error');return;}
      let scratch:HTMLDivElement|undefined;
      try {
        const [{default:mermaid},{default:purify}]=await Promise.all([import('mermaid'),import('dompurify')]);
        if(cancelled) return;
        scratch=document.createElement('div');
        scratch.style.cssText='position:absolute;visibility:hidden;pointer-events:none;width:1000px';
        target.append(scratch);
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,maxTextSize:researchLimits.block,maxEdges:256,suppressErrorRendering:true,theme:mode==='dark'?'dark':'neutral',flowchart:{htmlLabels:false},secure:['securityLevel','startOnLoad','maxTextSize','maxEdges','htmlLabels','theme','themeCSS','themeVariables']});
        const result=await mermaid.render(id,source,scratch);
        const safe=purify.sanitize(result.svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['style','foreignObject','image','a','script'],FORBID_ATTR:['style','href','xlink:href'],RETURN_DOM_FRAGMENT:true});
        // No external paint servers, including SVG attributes outside href.
        safe.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{
          if(/url\s*\(/i.test(a.value) && !/^url\(#[\w-]+\)$/.test(a.value)) el.removeAttribute(a.name);
        }));
        if(!cancelled){target.replaceChildren(safe);setState('ready');}
      } catch {if(!cancelled) setState('error');}
      finally{scratch?.remove();}
    };
    pending=pending.catch(()=>undefined).then(run);
    return()=>{cancelled=true;target?.replaceChildren();};
  },[source,engine,id,mode]);
  return <figure className="prism-research__diagram">
    {state!=='ready' && <p role="status">{state==='error'?labels.invalid:labels.loading}</p>}
    <div ref={container} aria-hidden={state!=='ready'} />
    <details open={state==='error'}><summary>{labels.source} · {engine}</summary><pre>{source}</pre></details>
  </figure>;
}
