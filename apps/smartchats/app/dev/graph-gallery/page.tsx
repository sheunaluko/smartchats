'use client';

/**
 * Dev-only gallery page: /dev/graph-gallery
 * Showcases animated sigma.js + graphology graph designs.
 * Each design is a self-contained canvas — no auth, no store, no agent.
 * Sigma + graphology loaded via CDN in useEffect.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createStarGraph } from '../../lib/star_graph';

// Sigma requires this CSS for proper canvas layer sizing
const SIGMA_CSS = `
.sigma-container { width: 100% !important; height: 100% !important; position: relative !important; }
.sigma-container canvas { position: absolute !important; top: 0 !important; left: 0 !important; }
`;

// ── Graph data generators ──

function generateKGData() {
  return {
    nodes: [
      { id: 'user', label: 'current_user', group: 'center' },
      { id: 'meditation', label: 'meditation', group: 'interest' },
      { id: 'running', label: 'running', group: 'interest' },
      { id: 'cooking', label: 'cooking', group: 'interest' },
      { id: 'tidyscripts', label: 'tidyscripts', group: 'project' },
      { id: 'smartchats', label: 'smartchats', group: 'project' },
      { id: 'sf', label: 'san_francisco', group: 'place' },
      { id: 'acme', label: 'acme_corp', group: 'org' },
      { id: 'health', label: 'health', group: 'goal' },
      { id: 'marathon', label: 'marathon', group: 'goal' },
      { id: 'yoga', label: 'yoga', group: 'interest' },
      { id: 'python', label: 'python', group: 'skill' },
      { id: 'typescript', label: 'typescript', group: 'skill' },
      { id: 'alice', label: 'alice', group: 'person' },
      { id: 'bob', label: 'bob', group: 'person' },
    ],
    edges: [
      { source: 'user', target: 'meditation', kind: 'interested_in' },
      { source: 'user', target: 'running', kind: 'practices' },
      { source: 'user', target: 'cooking', kind: 'enjoys' },
      { source: 'user', target: 'tidyscripts', kind: 'created' },
      { source: 'tidyscripts', target: 'smartchats', kind: 'contains' },
      { source: 'user', target: 'sf', kind: 'lives_in' },
      { source: 'user', target: 'acme', kind: 'works_at' },
      { source: 'user', target: 'health', kind: 'goal_is' },
      { source: 'user', target: 'marathon', kind: 'training_for' },
      { source: 'running', target: 'marathon', kind: 'prepares_for' },
      { source: 'meditation', target: 'yoga', kind: 'related_to' },
      { source: 'yoga', target: 'health', kind: 'supports' },
      { source: 'user', target: 'python', kind: 'knows' },
      { source: 'user', target: 'typescript', kind: 'knows' },
      { source: 'typescript', target: 'tidyscripts', kind: 'used_in' },
      { source: 'user', target: 'alice', kind: 'knows' },
      { source: 'user', target: 'bob', kind: 'knows' },
      { source: 'alice', target: 'acme', kind: 'works_at' },
      { source: 'bob', target: 'sf', kind: 'lives_in' },
    ],
  };
}

function generateNetworkData() {
  const nodes: any[] = [];
  const edges: any[] = [];
  const services = [
    'api-gateway', 'auth-svc', 'user-svc', 'billing-svc', 'ml-pipeline',
    'cache-01', 'cache-02', 'db-primary', 'db-replica', 'queue-broker',
    'worker-01', 'worker-02', 'worker-03', 'cdn-edge', 'monitor',
    'log-ingest', 'alert-mgr', 'scheduler', 'config-svc', 'vault',
  ];
  const statuses = ['healthy', 'healthy', 'healthy', 'healthy', 'warning', 'healthy', 'critical', 'healthy'];
  services.forEach((s, i) => {
    nodes.push({ id: s, label: s, status: statuses[i % statuses.length], tier: i < 5 ? 0 : i < 10 ? 1 : 2 });
  });
  const connections = [
    ['api-gateway', 'auth-svc'], ['api-gateway', 'user-svc'], ['api-gateway', 'billing-svc'],
    ['api-gateway', 'cdn-edge'], ['auth-svc', 'cache-01'], ['auth-svc', 'vault'],
    ['user-svc', 'db-primary'], ['user-svc', 'cache-02'], ['billing-svc', 'db-primary'],
    ['billing-svc', 'queue-broker'], ['queue-broker', 'worker-01'], ['queue-broker', 'worker-02'],
    ['queue-broker', 'worker-03'], ['db-primary', 'db-replica'], ['ml-pipeline', 'db-replica'],
    ['ml-pipeline', 'queue-broker'], ['monitor', 'log-ingest'], ['monitor', 'alert-mgr'],
    ['monitor', 'api-gateway'], ['scheduler', 'worker-01'], ['scheduler', 'ml-pipeline'],
    ['config-svc', 'api-gateway'], ['config-svc', 'auth-svc'],
  ];
  connections.forEach(([s, t], i) => {
    edges.push({ source: s, target: t, id: `e${i}` });
  });
  return { nodes, edges };
}

// ── Design configs ──

interface GraphDesign {
  id: string;
  title: string;
  description: string;
  build: (graphology: any, Sigma: any, container: HTMLElement) => any;
}

const DESIGNS: GraphDesign[] = [
  {
    id: 'star-pulse',
    title: 'STAR PULSE // Command Relay',
    description: 'Click any node to expand its children. Central pulse, particles along edges, force-physics layout.',
    build: (graphology: any, Sigma: any, container: HTMLElement) => {
      const childrenMap: Record<string, { name: string; kind: string }[]> = {
        'CORE': [{ name: 'AUTH', kind: 'secures' }, { name: 'CACHE', kind: 'accelerates' }, { name: 'WORKER', kind: 'delegates' }, { name: 'DB', kind: 'persists' }, { name: 'QUEUE', kind: 'buffers' }],
        'AUTH': [{ name: 'OAUTH', kind: 'provider' }, { name: 'TOKENS', kind: 'issues' }, { name: 'SESSIONS', kind: 'tracks' }],
        'CACHE': [{ name: 'REDIS', kind: 'backend' }, { name: 'MEMCACHE', kind: 'backend' }],
        'WORKER': [{ name: 'CRON', kind: 'schedules' }, { name: 'ASYNC', kind: 'processes' }, { name: 'BATCH', kind: 'groups' }],
        'DB': [{ name: 'PRIMARY', kind: 'writes_to' }, { name: 'REPLICA', kind: 'reads_from' }, { name: 'BACKUP', kind: 'snapshots' }],
        'QUEUE': [{ name: 'BROKER', kind: 'routes' }, { name: 'DLQ', kind: 'catches' }, { name: 'CONSUMER', kind: 'drains' }],
        'OAUTH': [{ name: 'GOOGLE', kind: 'via' }, { name: 'GITHUB', kind: 'via' }],
        'REDIS': [{ name: 'CLUSTER_1', kind: 'shard' }, { name: 'CLUSTER_2', kind: 'shard' }],
        'PRIMARY': [{ name: 'SHARD_A', kind: 'partition' }, { name: 'SHARD_B', kind: 'partition' }],
      };

      const sg = createStarGraph({
        graphology, Sigma, container,
        theme: {
          accent: '#00ff88', accentDim: '#00ff8815', innerColor: '#003d1f',
          particleRGB: [68, 255, 204], bgRGB: [1, 13, 6],
          edgeColor: '#0a6a3a', edgeLabelColor: '#0a8a4a',
          labelColor: '#00ff88', expandableColor: '#44ffcc',
        },
        rootId: 'CORE', rootLabel: 'CORE',
        labelFont: '"JetBrains Mono", "Fira Code", monospace',
        onNodeClick: (nodeId: string) => {
          const children = childrenMap[nodeId];
          if (children && !sg.isExpanded(nodeId)) {
            sg.expandNode(nodeId, children);
          }
        },
      });

      sg.expandNode('CORE', childrenMap['CORE']);
      return { renderer: sg.renderer, cleanup: () => sg.destroy() };
    },
  },
  {
    id: 'neural-web',
    title: 'NEURAL WEB // Knowledge Graph',
    description: 'Organic neural network — color-coded entity groups, breathing node sizes, depth-based opacity',
    build: (graphology: any, Sigma: any, container: HTMLElement) => {
      const data = generateKGData();
      const graph = new graphology.Graph({ multi: false, type: 'directed' });

      const groupColors: Record<string, string> = {
        center: '#a855f7',
        interest: '#3b82f6',
        project: '#22d3ee',
        place: '#f97316',
        org: '#eab308',
        goal: '#10b981',
        skill: '#ec4899',
        person: '#6366f1',
      };

      // Force-directed-ish layout (precomputed spiral)
      data.nodes.forEach((n: any, i: number) => {
        const isCenter = n.group === 'center';
        const angle = (i / data.nodes.length) * Math.PI * 2 * 2.5 + i * 0.7;
        const radius = isCenter ? 0 : 1.5 + (i % 3) * 1.2;
        graph.addNode(n.id, {
          label: n.label,
          x: isCenter ? 0 : Math.cos(angle) * radius,
          y: isCenter ? 0 : Math.sin(angle) * radius,
          size: isCenter ? 18 : 8 + Math.random() * 4,
          color: groupColors[n.group] || '#888',
        });
      });

      data.edges.forEach((e: any, i: number) => {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          graph.addEdge(e.source, e.target, {
            label: e.kind,
            size: 1,
            color: '#ffffff18',
          });
        }
      });

      let frame = 0;
      const baseSizes = new Map<string, number>();
      graph.forEachNode((node: string, attrs: any) => baseSizes.set(node, attrs.size));

      const renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        zoomingRatio: 1.15,
        defaultEdgeType: 'arrow',
        edgeProgramClasses: { arrow: Sigma.rendering.EdgeArrowProgram },
        renderLabels: true,
        renderEdgeLabels: true,
        labelColor: { color: '#c4b5fd' },
        edgeLabelColor: { color: '#6366f166' },
        labelSize: 11,
        edgeLabelSize: 9,
        labelFont: 'system-ui, sans-serif',
        labelRenderedSizeThreshold: 0,
      });

      renderer.setSetting("nodeReducer", (node: string, attrs: any) => {
        const base = baseSizes.get(node) || 10;
        const breath = Math.sin(frame * 0.04 + (node.charCodeAt(0) * 0.5)) * 0.15 + 1;
        return { ...attrs, size: base * breath };
      });

      const interval = setInterval(() => { frame++; renderer.refresh({ skipIndexation: true }); }, 100);
      return { renderer, cleanup: () => clearInterval(interval) };
    },
  },
  {
    id: 'threat-matrix',
    title: 'THREAT MATRIX // Incident Graph',
    description: 'Red-team dashboard — alert propagation paths, severity heat, radar-sweep scanner effect',
    build: (graphology: any, Sigma: any, container: HTMLElement) => {
      const graph = new graphology.Graph({ multi: false, type: 'directed' });

      const threatNodes = [
        { id: 'perimeter', label: 'PERIMETER', severity: 0, x: 0, y: 3 },
        { id: 'firewall', label: 'FIREWALL', severity: 0, x: -2, y: 2 },
        { id: 'ids', label: 'IDS/IPS', severity: 1, x: 2, y: 2 },
        { id: 'waf', label: 'WAF', severity: 0, x: 0, y: 1.5 },
        { id: 'dmz', label: 'DMZ', severity: 1, x: -1.5, y: 0.5 },
        { id: 'proxy', label: 'REV-PROXY', severity: 0, x: 1.5, y: 0.5 },
        { id: 'app-1', label: 'APP-SRV-01', severity: 2, x: -2, y: -1 },
        { id: 'app-2', label: 'APP-SRV-02', severity: 0, x: 0, y: -1 },
        { id: 'app-3', label: 'APP-SRV-03', severity: 1, x: 2, y: -1 },
        { id: 'db-master', label: 'DB-MASTER', severity: 3, x: -1, y: -2.5 },
        { id: 'db-slave', label: 'DB-SLAVE', severity: 0, x: 1, y: -2.5 },
        { id: 'vault', label: 'VAULT', severity: 0, x: 0, y: -3.5 },
        { id: 'siem', label: 'SIEM', severity: 2, x: 3, y: -2 },
        { id: 'attacker', label: 'THREAT-ACTOR', severity: 3, x: 0, y: 5 },
      ];

      const sevColors = ['#22c55e', '#eab308', '#f97316', '#ef4444'];

      threatNodes.forEach((n) => {
        graph.addNode(n.id, {
          label: n.label,
          x: n.x, y: n.y,
          size: n.id === 'attacker' ? 16 : n.severity >= 2 ? 12 : 9,
          color: sevColors[n.severity],
          borderColor: sevColors[n.severity] + '44',
        });
      });

      const threatEdges = [
        ['attacker', 'perimeter'], ['perimeter', 'firewall'], ['perimeter', 'ids'],
        ['firewall', 'waf'], ['ids', 'waf'], ['waf', 'dmz'], ['waf', 'proxy'],
        ['dmz', 'app-1'], ['proxy', 'app-2'], ['proxy', 'app-3'],
        ['app-1', 'db-master'], ['app-2', 'db-master'], ['app-3', 'db-slave'],
        ['db-master', 'db-slave'], ['db-master', 'vault'], ['db-slave', 'vault'],
        ['app-1', 'siem'], ['ids', 'siem'], ['siem', 'db-master'],
      ];
      threatEdges.forEach(([s, t], i) => {
        graph.addEdge(s, t, { size: 1.5, color: '#ff224422' });
      });

      let frame = 0;

      // BFS from attacker — compute depths + ordered edge paths
      const nodeDepths = new Map<string, number>();
      const bfsEdges: { source: string; target: string; depth: number }[] = [];
      const queue = [{ id: 'attacker', depth: 0 }];
      const visited = new Set(['attacker']);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        nodeDepths.set(cur.id, cur.depth);
        graph.forEachOutNeighbor(cur.id, (neighbor: string) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            bfsEdges.push({ source: cur.id, target: neighbor, depth: cur.depth });
            queue.push({ id: neighbor, depth: cur.depth + 1 });
          }
        });
      }
      const maxDepth = Math.max(...nodeDepths.values());

      // Store node positions for particle interpolation
      const positions: Record<string, { x: number; y: number }> = {};
      threatNodes.forEach(n => { positions[n.id] = { x: n.x, y: n.y }; });

      // Add particles — one per BFS edge
      const particles: { id: string; source: string; target: string; depth: number }[] = [];
      bfsEdges.forEach((e, i) => {
        const pid = `_tp_${i}`;
        graph.addNode(pid, { label: '', x: positions[e.source].x, y: positions[e.source].y, size: 2, color: '#ff4466' });
        particles.push({ id: pid, source: e.source, target: e.target, depth: e.depth });
      });

      const baseSizes = new Map<string, number>();
      graph.forEachNode((node: string, attrs: any) => baseSizes.set(node, attrs.size));

      const renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        zoomingRatio: 1.15,
        defaultEdgeType: 'arrow',
        edgeProgramClasses: { arrow: Sigma.rendering.EdgeArrowProgram },
        renderLabels: true,
        labelColor: { color: '#ff6b6b' },
        labelSize: 9,
        labelFont: '"JetBrains Mono", "Fira Code", monospace',
        labelRenderedSizeThreshold: 4,
        zIndex: true,
      });

      renderer.setSetting("nodeReducer", (node: string, attrs: any) => {
        // Particle appearance — render behind real nodes
        const particle = particles.find(p => p.id === node);
        if (particle) {
          const cycleLen = (maxDepth + 2);
          const tGlobal = (frame * 0.008) % cycleLen;
          const tLocal = tGlobal - particle.depth;
          if (tLocal < 0 || tLocal > 1) return { ...attrs, size: 0, label: '', zIndex: 0 };
          const fade = tLocal < 0.1 ? tLocal / 0.1 : tLocal > 0.8 ? (1 - tLocal) / 0.2 : 1;
          const alpha = Math.floor(fade * 255).toString(16).padStart(2, '0');
          return { ...attrs, size: 1.5 + fade * 1.5, color: `#ff4466${alpha}`, label: '', zIndex: 0 };
        }

        // Real nodes — glow when wave passes, render on top
        const depth = nodeDepths.get(node);
        if (depth !== undefined) {
          const cycleLen = (maxDepth + 2);
          const tGlobal = (frame * 0.008) % cycleLen;
          const dist = Math.abs(tGlobal - depth);
          const glow = dist < 0.8 ? 1 - dist / 0.8 : 0;
          const base = baseSizes.get(node) || 9;
          return { ...attrs, size: base + glow * 5, borderColor: attrs.color + '33', borderSize: 3, zIndex: 1 };
        }

        return attrs;
      });

      renderer.setSetting("edgeReducer", (edge: string, attrs: any) => {
        const source = graph.source(edge);
        const depth = nodeDepths.get(source) || 0;
        const cycleLen = (maxDepth + 2);
        const tGlobal = (frame * 0.008) % cycleLen;
        const dist = Math.abs(tGlobal - depth);
        const intensity = dist < 1 ? Math.floor((1 - dist) * 200) : 20;
        const hex = intensity.toString(16).padStart(2, '0');
        return { ...attrs, color: `#ff2244${hex}` };
      });

      // Animation: move particles along their edge paths
      const interval = setInterval(() => {
        frame++;
        const cycleLen = (maxDepth + 2);
        const tGlobal = (frame * 0.008) % cycleLen;
        particles.forEach(p => {
          const tLocal = tGlobal - p.depth;
          const src = positions[p.source];
          const tgt = positions[p.target];
          if (!src || !tgt) return;
          const t = Math.max(0, Math.min(1, tLocal));
          graph.setNodeAttribute(p.id, 'x', src.x + (tgt.x - src.x) * t);
          graph.setNodeAttribute(p.id, 'y', src.y + (tgt.y - src.y) * t);
        });
        renderer.refresh();
      }, 50);

      return { renderer, cleanup: () => clearInterval(interval) };
    },
  },
  {
    id: 'constellation',
    title: 'CONSTELLATION // Living Memory',
    description: 'Force-physics layout cycles through configurations — nodes drift and settle, particles flow between connected entities',
    build: (graphology: any, Sigma: any, container: HTMLElement) => {
      const data = generateKGData();
      const graph = new graphology.Graph({ multi: false, type: 'undirected' });

      const groupColors: Record<string, string> = {
        center: '#e0e7ff',
        interest: '#818cf8',
        project: '#22d3ee',
        place: '#fb923c',
        org: '#facc15',
        goal: '#34d399',
        skill: '#f472b6',
        person: '#a78bfa',
      };

      // Initial circular layout
      data.nodes.forEach((n: any, i: number) => {
        const angle = (2 * Math.PI * i) / data.nodes.length;
        const radius = n.group === 'center' ? 0 : 3;
        graph.addNode(n.id, {
          label: n.label,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: n.group === 'center' ? 14 : 6,
          color: groupColors[n.group] || '#94a3b8',
        });
      });

      data.edges.forEach((e: any) => {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          graph.addEdge(e.source, e.target, { size: 0.4, color: '#334155' });
        }
      });

      // Add particles — one per edge
      const edgeList: { source: string; target: string }[] = [];
      data.edges.forEach((e: any) => {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          edgeList.push({ source: e.source, target: e.target });
        }
      });
      const particles: { id: string; source: string; target: string; phase: number; reverse: boolean }[] = [];
      edgeList.forEach((e, i) => {
        const pid = `_cp_${i}`;
        graph.addNode(pid, { label: '', x: 0, y: 0, size: 1.5, color: '#818cf8' });
        particles.push({ id: pid, source: e.source, target: e.target, phase: (i * 0.15) % 1, reverse: i % 3 === 0 });
      });

      // Simple force simulation — runs in JS, no web worker needed
      // Precompute layout configs that cycle over time
      const layoutConfigs = [
        { gravity: 0.5, repulsion: 2.0, attraction: 0.08 },   // tight cluster
        { gravity: 0.1, repulsion: 4.0, attraction: 0.02 },   // expanded
        { gravity: 1.0, repulsion: 1.0, attraction: 0.15 },   // collapsed
        { gravity: 0.3, repulsion: 3.0, attraction: 0.05 },   // medium spread
      ];
      let configIdx = 0;
      let physics = { ...layoutConfigs[0] };
      let configTimer = 0;
      const CONFIG_DURATION = 400; // frames per config

      let frame = 0;

      // Velocity storage
      const vx: Record<string, number> = {};
      const vy: Record<string, number> = {};
      const realNodes = data.nodes.map((n: any) => n.id);
      realNodes.forEach((id: string) => { vx[id] = 0; vy[id] = 0; });

      function stepPhysics() {
        const damping = 0.85;
        const dt = 0.3;

        // Repulsion between all real nodes
        for (let i = 0; i < realNodes.length; i++) {
          const a = realNodes[i];
          const ax = graph.getNodeAttribute(a, 'x');
          const ay = graph.getNodeAttribute(a, 'y');
          for (let j = i + 1; j < realNodes.length; j++) {
            const b = realNodes[j];
            const bx = graph.getNodeAttribute(b, 'x');
            const by = graph.getNodeAttribute(b, 'y');
            const dx = ax - bx;
            const dy = ay - by;
            const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
            const force = physics.repulsion / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            vx[a] += fx * dt; vy[a] += fy * dt;
            vx[b] -= fx * dt; vy[b] -= fy * dt;
          }
        }

        // Attraction along edges
        edgeList.forEach(e => {
          const sx = graph.getNodeAttribute(e.source, 'x');
          const sy = graph.getNodeAttribute(e.source, 'y');
          const tx = graph.getNodeAttribute(e.target, 'x');
          const ty = graph.getNodeAttribute(e.target, 'y');
          const dx = tx - sx;
          const dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const force = dist * physics.attraction;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          vx[e.source] += fx * dt; vy[e.source] += fy * dt;
          vx[e.target] -= fx * dt; vy[e.target] -= fy * dt;
        });

        // Gravity toward center
        realNodes.forEach((id: string) => {
          const x = graph.getNodeAttribute(id, 'x');
          const y = graph.getNodeAttribute(id, 'y');
          vx[id] -= x * physics.gravity * 0.01 * dt;
          vy[id] -= y * physics.gravity * 0.01 * dt;
        });

        // Apply velocity
        realNodes.forEach((id: string) => {
          vx[id] *= damping;
          vy[id] *= damping;
          const x = graph.getNodeAttribute(id, 'x') + vx[id];
          const y = graph.getNodeAttribute(id, 'y') + vy[id];
          graph.setNodeAttribute(id, 'x', x);
          graph.setNodeAttribute(id, 'y', y);
        });
      }

      const renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        zoomingRatio: 1.15,
        renderLabels: true,
        renderEdgeLabels: false,
        labelColor: { color: '#94a3b8' },
        labelSize: 10,
        labelFont: 'system-ui, sans-serif',
        labelRenderedSizeThreshold: 4,
        zIndex: true,
      });

      renderer.setSetting("nodeReducer", (node: string, attrs: any) => {
        // Particles — behind real nodes
        const particle = particles.find(p => p.id === node);
        if (particle) {
          const speed = 0.006;
          const raw = ((frame * speed) + particle.phase) % 1;
          const t = particle.reverse ? 1 - raw : raw;
          const fade = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
          const alpha = Math.floor(fade * 200).toString(16).padStart(2, '0');
          return { ...attrs, size: 1.2 + fade * 1, color: `#818cf8${alpha}`, label: '', zIndex: 0 };
        }

        // Real nodes — twinkle + group color
        const twinkle = Math.sin(frame * 0.04 + node.charCodeAt(0) * 1.7) * 0.3 + 0.7;
        const nodeData = data.nodes.find((n: any) => n.id === node);
        const isCenter = nodeData?.group === 'center';
        const baseSize = isCenter ? 14 : 6;
        return {
          ...attrs,
          size: baseSize * (0.85 + twinkle * 0.3),
          zIndex: 1,
        };
      });

      renderer.setSetting("edgeReducer", (_edge: string, attrs: any) => {
        const pulse = Math.sin(frame * 0.02) * 0.3 + 0.5;
        const alpha = Math.floor(pulse * 50 + 20).toString(16).padStart(2, '0');
        return { ...attrs, color: `#64748b${alpha}`, size: 0.4 };
      });

      // Main loop: physics + particle positions + render
      const interval = setInterval(() => {
        frame++;
        configTimer++;

        // Cycle physics config
        if (configTimer >= CONFIG_DURATION) {
          configTimer = 0;
          configIdx = (configIdx + 1) % layoutConfigs.length;
          // Smooth transition to new config
          const target = layoutConfigs[configIdx];
          physics = { ...target };
        }

        // Step physics
        stepPhysics();

        // Move particles along edges (read current node positions)
        particles.forEach(p => {
          const sx = graph.getNodeAttribute(p.source, 'x');
          const sy = graph.getNodeAttribute(p.source, 'y');
          const tx = graph.getNodeAttribute(p.target, 'x');
          const ty = graph.getNodeAttribute(p.target, 'y');
          const speed = 0.006;
          const raw = ((frame * speed) + p.phase) % 1;
          const t = p.reverse ? 1 - raw : raw;
          graph.setNodeAttribute(p.id, 'x', sx + (tx - sx) * t);
          graph.setNodeAttribute(p.id, 'y', sy + (ty - sy) * t);
        });

        renderer.refresh();
      }, 50);

      return { renderer, cleanup: () => clearInterval(interval) };
    },
  },
  {
    id: 'neon-grid',
    title: 'NEON GRID // System Topology',
    description: 'Cyberpunk grid — neon outlines, data-flow edge pulses, glitch-style label rendering',
    build: (graphology: any, Sigma: any, container: HTMLElement) => {
      const data = generateNetworkData();
      const graph = new graphology.Graph({ multi: false, type: 'directed' });

      const tierColors = ['#06b6d4', '#8b5cf6', '#f43f5e'];

      data.nodes.forEach((n: any, i: number) => {
        const tier = n.tier;
        const nodesInTier = data.nodes.filter((x: any) => x.tier === tier);
        const idx = nodesInTier.indexOf(n);
        const spread = nodesInTier.length;
        // Hexagonal offset
        const x = (idx - (spread - 1) / 2) * 2.8 + (tier % 2) * 0.7;
        const y = -tier * 3.5;

        graph.addNode(n.id, {
          label: n.id.replace(/-/g, '_').toUpperCase(),
          x, y,
          size: 10 - tier * 2,
          color: tierColors[tier],
        });
      });

      data.edges.forEach((e: any) => {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          graph.addEdge(e.source, e.target, {
            size: 1,
            color: '#06b6d422',
          });
        }
      });

      let frame = 0;
      const baseSizes = new Map<string, number>();
      graph.forEachNode((node: string, attrs: any) => baseSizes.set(node, attrs.size));

      const renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        zoomingRatio: 1.15,
        defaultEdgeType: 'arrow',
        edgeProgramClasses: { arrow: Sigma.rendering.EdgeArrowProgram },
        renderLabels: true,
        labelColor: { color: '#67e8f9' },
        labelSize: 9,
        labelFont: '"JetBrains Mono", "Fira Code", monospace',
        labelRenderedSizeThreshold: 0,
      });

      renderer.setSetting("nodeReducer", (node: string, attrs: any) => {
        const base = baseSizes.get(node) || 8;
        const glow = Math.sin(frame * 0.03 + node.length * 2) * 0.15 + 1;
        return { ...attrs, size: base * glow, borderColor: attrs.color + '44', borderSize: 2 };
      });
      renderer.setSetting("edgeReducer", (edge: string, attrs: any) => {
        const source = graph.source(edge);
        const srcIdx = data.nodes.findIndex((n: any) => n.id === source);
        const phase = (frame * 0.05 + srcIdx * 0.3) % 1;
        const intensity = Math.sin(phase * Math.PI);
        const alpha = Math.floor(20 + intensity * 180);
        const hex = alpha.toString(16).padStart(2, '0');
        const srcTier = data.nodes[srcIdx]?.tier || 0;
        const baseColor = tierColors[srcTier].slice(0, 7);
        return { ...attrs, color: `${baseColor}${hex}`, size: 0.5 + intensity * 2 };
      });

      const interval = setInterval(() => { frame++; renderer.refresh({ skipIndexation: true }); }, 100);
      return { renderer, cleanup: () => clearInterval(interval) };
    },
  },
];

// ── Gallery Component ──

function GraphCard({ design }: { design: GraphDesign }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<any>(null);
  const builtRef = useRef(false);

  // Only build sigma when the card scrolls into view — avoids hitting WebGL context limit
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const buildGraph = () => {
      if (builtRef.current) return;
      if (typeof (window as any).graphology === 'undefined' || typeof (window as any).Sigma === 'undefined') return;
      builtRef.current = true;
      try {
        const result = design.build((window as any).graphology, (window as any).Sigma, container);
        rendererRef.current = result?.renderer;
        cleanupRef.current = result?.cleanup || null;
      } catch (e) {
        console.error(`Failed to build ${design.id}:`, e);
      }
    };

    const destroyGraph = () => {
      if (!builtRef.current) return;
      if (cleanupRef.current) cleanupRef.current();
      if (rendererRef.current) { try { rendererRef.current.kill(); } catch {} }
      cleanupRef.current = null;
      rendererRef.current = null;
      builtRef.current = false;
      container.innerHTML = '';
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          requestAnimationFrame(buildGraph);
        } else {
          destroyGraph();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(container);

    return () => {
      observer.disconnect();
      destroyGraph();
    };
  }, [design]);

  return (
    <div style={{
      background: '#0a0a0f',
      border: '1px solid #1e293b',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
        <div style={{
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 14,
          fontWeight: 700,
          color: '#e2e8f0',
          letterSpacing: '0.05em',
        }}>
          {design.title}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          {design.description}
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 420,
          overflow: 'hidden',
          position: 'relative',
          background: design.id === 'constellation' ? '#020617' :
                     design.id === 'threat-matrix' ? '#0f0208' :
                     design.id === 'star-pulse' ? '#010d06' :
                     '#050510',
        }}
      />
    </div>
  );
}

export default function GraphGalleryPage() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Load sigma + graphology from CDN
    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      });

    // Inject sigma CSS
    const style = document.createElement('style');
    style.textContent = SIGMA_CSS;
    document.head.appendChild(style);

    (async () => {
      await loadScript('https://cdn.jsdelivr.net/npm/graphology@0.25/dist/graphology.umd.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/sigma@3/dist/sigma.min.js');
      setLoaded(true);
    })();

    return () => { document.head.removeChild(style); };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#030308',
      color: '#e2e8f0',
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '0.08em',
          color: '#e2e8f0',
          marginBottom: 8,
        }}>
          GRAPH GALLERY
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 40 }}>
          Sigma.js + Graphology animated graph designs — candidates for KG Explorer and system dashboards
        </p>

        {!loaded && (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>
            Loading sigma.js + graphology...
          </div>
        )}

        {loaded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {DESIGNS.map((d) => (
              <GraphCard key={d.id} design={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
