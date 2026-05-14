'use client';

import React, { useRef, useEffect } from 'react';
import { getStarGraphSource } from '../lib/star_graph';
import type { StarGraphProps } from './types';

// Same-origin scripts copied from node_modules into public/lib/ at build
// time (see apps/smartchats/package.json prebuild). Versions track package.json.
//
// The iframe is `srcdoc`, which creates an opaque origin — relative URLs
// resolve against `about:srcdoc`, not the parent. We absolutize at runtime
// by reading window.location.origin (set inside buildSrcdoc).
const SIGMA_PATH = '/lib/sigma.min.js';
const GRAPHOLOGY_PATH = '/lib/graphology.umd.min.js';

function buildSrcdoc(props: StarGraphProps): string {
  const { rootId, rootLabel, seeds, staggerMs } = props;
  const seedsJson = JSON.stringify(seeds || []);
  const stagger = staggerMs || 0;

  // Resolve same-origin script paths to absolute URLs against the parent's
  // origin. Required because srcdoc creates an opaque origin where `/lib/...`
  // would resolve to `about:srcdoc/lib/...` and 404.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const graphologyUrl = `${origin}${GRAPHOLOGY_PATH}`;
  const sigmaUrl = `${origin}${SIGMA_PATH}`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
  #graph { width: 100%; height: 100%; }
  .sigma-container { width: 100% !important; height: 100% !important; position: relative !important; }
  .sigma-container canvas { position: absolute !important; top: 0 !important; left: 0 !important; }
</style>
<script src="${graphologyUrl}"></script>
<script src="${sigmaUrl}"></script>
</head><body>
<div id="graph"></div>
<script>${getStarGraphSource()}</script>
<script>
(function() {
  var rootId = ${JSON.stringify(rootId)};
  var rootLabel = ${JSON.stringify(rootLabel)};
  var seeds = ${seedsJson};
  var staggerMs = ${stagger};

  // Read theme from parent via CSS custom properties (inherited into iframe)
  var s = getComputedStyle(document.documentElement);
  // Fallback to dark theme defaults
  var accent = '#6366f1';
  var bg = '#0d1117';
  var border = '#333';
  var textMuted = '#888';

  // Try to get from parent
  try {
    var ps = window.parent.getComputedStyle(window.parent.document.documentElement);
    accent = ps.getPropertyValue('--sc-accent').trim() || accent;
    bg = ps.getPropertyValue('--sc-background').trim() || bg;
    border = ps.getPropertyValue('--sc-border').trim() || border;
    textMuted = ps.getPropertyValue('--sc-text-muted').trim() || textMuted;
  } catch(e) {}

  function hexToRGB(hex) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [parseInt(hex.substr(0,2),16), parseInt(hex.substr(2,2),16), parseInt(hex.substr(4,2),16)];
  }
  function blendHex(fg, bg, t) {
    return fg.map(function(f,i){ return Math.floor(f*t + bg[i]*(1-t)); });
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function(c){ return (c<16?'0':'') + c.toString(16); }).join('');
  }

  var accentRGB = hexToRGB(accent);
  var bgRGB = hexToRGB(bg);
  var accentDim = rgbToHex(blendHex(accentRGB, bgRGB, 0.15));
  var innerColor = rgbToHex(blendHex(accentRGB, bgRGB, 0.25));

  var sg = createStarGraph({
    graphology: graphology, Sigma: Sigma,
    container: document.getElementById('graph'),
    theme: {
      accent: accent, accentDim: accentDim, innerColor: innerColor,
      particleRGB: accentRGB, bgRGB: bgRGB,
      edgeColor: border, edgeLabelColor: textMuted,
      labelColor: accent, expandableColor: textMuted,
    },
    rootId: rootId, rootLabel: rootLabel,
    rootSize: 18, nodeSize: 12,
  });

  // Expand with seed data — supports multi-level (seeds can reference each other)
  if (seeds.length > 0) {
    sg.expandNode(rootId, []);
    // Split into levels: first seeds where subject is root, then the rest
    var firstLevel = [];
    var later = [];
    for (var i = 0; i < seeds.length; i++) {
      if (seeds[i].subject === rootId) { firstLevel.push(seeds[i]); }
      else { later.push(seeds[i]); }
    }
    var allOrdered = firstLevel.concat(later);
    var delay = 0;
    for (var i = 0; i < allOrdered.length; i++) {
      (function(s, d) {
        var fn = function() {
          var parent = s.subject;
          var child = s.object;
          // Ensure parent exists (for multi-level)
          if (!sg.graph.hasNode(parent)) {
            sg.addNode(parent, rootId, '');
          }
          sg.addNode(child, parent, s.predicate);
        };
        if (staggerMs > 0) { setTimeout(fn, d); }
        else { fn(); }
      })(allOrdered[i], delay);
      if (staggerMs > 0) delay += staggerMs;
    }
  }

  // Listen for new triples from parent — only add if source or target already in graph
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'kg_update') return;
    var edges = e.data.edges || [];
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      var src = edge.source || edge.subject;
      var tgt = edge.target || edge.object;
      var label = edge.label || edge.predicate || '';
      // Only add if the parent node exists in the graph — prevents stray disconnected nodes
      if (sg.graph.hasNode(src)) {
        sg.addNode(tgt, src, label);
      } else if (sg.graph.hasNode(tgt)) {
        sg.addNode(src, tgt, label, undefined, undefined, true);
      }
      // else: neither endpoint in graph — skip to avoid stray nodes
    }
  });
})();
</script>
</body></html>`;
}

export function StarGraphViz({ props }: { props: StarGraphProps }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for KG updates and forward to iframe
  useEffect(() => {
    const handler = (e: Event) => {
      const graphData = (e as CustomEvent).detail;
      if (!graphData || !iframeRef.current?.contentWindow) return;

      // Convert KGGraphData edges to simple format
      const edges = (graphData.edges || []).map((edge: any) => ({
        source: edge.source,
        target: edge.target,
        label: edge.label,
      }));

      if (edges.length > 0) {
        iframeRef.current.contentWindow.postMessage({ type: 'kg_update', edges }, '*');
      }
    };

    window.addEventListener('smartchats:kg_update', handler);
    return () => window.removeEventListener('smartchats:kg_update', handler);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(props)}
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height: 260,
        border: 'none',
        borderRadius: 12,
        background: 'var(--sc-background, #0d1117)',
      }}
    />
  );
}
