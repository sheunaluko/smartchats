/**
 * Star Graph — reusable animated graph visualization.
 *
 * Force physics, bordered nodes with inner pulse, particles along edges,
 * click-to-expand. Works with sigma v3 + graphology UMD or npm imports.
 *
 * Usage (TypeScript):
 *   import { createStarGraph } from './star_graph';
 *   const sg = createStarGraph({ graphology, Sigma, container, theme, ... });
 *
 * Usage (iframe injection):
 *   import { getStarGraphSource } from './star_graph';
 *   const html = `<script>${getStarGraphSource()}</script>`;
 */

export interface StarGraphTheme {
    accent: string
    accentDim: string
    innerColor: string
    particleRGB: [number, number, number]
    edgeColor: string
    edgeLabelColor: string
    labelColor: string
    bgRGB: [number, number, number]
    expandableColor: string
}

export interface StarGraphConfig {
    graphology: any
    Sigma: any
    container: HTMLElement
    theme: StarGraphTheme
    rootId: string
    rootLabel: string
    rootSize?: number
    nodeSize?: number
    innerRootSize?: number
    innerNodeSize?: number
    onNodeClick?: (nodeId: string) => void
    labelFont?: string
    particleBlend?: number
    spawnRadius?: number
    zoomingRatio?: number
}

export interface StarGraphChild {
    name: string
    label?: string
    kind: string
}

export interface StarGraphInstance {
    renderer: any
    graph: any
    expandNode: (nodeId: string, children: StarGraphChild[]) => void
    addNode: (name: string, parent: string, edgeLabel?: string, index?: number, count?: number) => void
    markExpanded: (nodeId: string) => void
    isExpanded: (nodeId: string) => boolean
    destroy: () => void
}

/**
 * Create a star-pulse graph visualization.
 * Fully self-contained — no closures over module scope.
 * Safe to serialize via .toString() for iframe injection.
 */
export function createStarGraph(config: any): any {
    var graphology = config.graphology;
    var Sigma = config.Sigma;
    var container = config.container;
    var theme = config.theme;
    // rendering programs — from config.rendering (npm) or Sigma.rendering (UMD CDN)
    var rendering = config.rendering || Sigma.rendering || {};
    var rootId = config.rootId || 'root';
    var rootLabel = config.rootLabel || rootId;
    var rootSize = config.rootSize || 20;
    var nodeSize = config.nodeSize || 8;
    var innerRootSize = config.innerRootSize || Math.floor(rootSize / 2);
    var innerNodeSize = config.innerNodeSize || Math.floor(nodeSize / 2);
    var onNodeClick = config.onNodeClick || null;
    var labelFont = config.labelFont || 'system-ui, sans-serif';
    var particleBlend = config.particleBlend || 0.5;
    var spawnRadius = config.spawnRadius || 3;
    var zoomingRatio = config.zoomingRatio || 1.15;

    var graph = new graphology.Graph({ multi: false, type: 'directed' });

    // Internal state
    var realNodes = new Set();
    var edgeList: any[] = [];
    var innerNodes: string[] = [];
    var particles: any[] = [];
    var expandedNodes = new Set();
    var vx: any = {};
    var vy: any = {};
    var particleCounter = 0;
    var frame = 0;
    var interval: any = null;

    // ── Add node ──

    function addNode(name: string, parentName: string, edgeLabel?: string, childIndex?: number, childCount?: number, reverse?: boolean) {
        if (graph.hasNode(name)) return;

        var px = graph.hasNode(parentName) ? graph.getNodeAttribute(parentName, 'x') : 0;
        var py = graph.hasNode(parentName) ? graph.getNodeAttribute(parentName, 'y') : 0;
        var isRoot = name === rootId;
        var ci = childIndex || 0;
        var cc = childCount || 1;
        var angle = (2 * Math.PI * ci) / cc + Math.random() * 0.2;
        var x = isRoot ? 0 : px + Math.cos(angle) * spawnRadius;
        var y = isRoot ? 0 : py + Math.sin(angle) * spawnRadius;

        graph.addNode(name, {
            label: isRoot ? rootLabel : (name),
            x: x, y: y,
            size: isRoot ? rootSize : nodeSize,
            color: theme.accent,
        });
        realNodes.add(name);
        vx[name] = isRoot ? 0 : Math.cos(angle) * 0.1;
        vy[name] = isRoot ? 0 : Math.sin(angle) * 0.1;

        // Inner circle overlay
        var innerId = '_inner_' + name;
        graph.addNode(innerId, { label: '', x: x, y: y, size: isRoot ? innerRootSize : innerNodeSize, color: theme.innerColor });
        innerNodes.push(innerId);

        // Edge from parent (or reversed if child.reverse is set)
        if (parentName && parentName !== name && graph.hasNode(parentName)) {
            var edgeSrc = reverse ? name : parentName;
            var edgeTgt = reverse ? parentName : name;
            graph.addEdge(edgeSrc, edgeTgt, { size: 1, color: theme.edgeColor, label: edgeLabel || '' });
            edgeList.push({ source: edgeSrc, target: edgeTgt });

            for (var p = 0; p < 2; p++) {
                var pid = '_p_' + (particleCounter++);
                var phase = (edgeList.length * 0.13 + p * 0.5) % 1;
                graph.addNode(pid, { label: '', x: px, y: py, size: 1, color: theme.innerColor });
                particles.push({ id: pid, source: edgeSrc, target: edgeTgt, phase: phase });
            }
        }
    }

    // ── Expand node ──

    function expandNode(nodeId: string, children: any[]) {
        if (expandedNodes.has(nodeId)) return;
        // Create the node itself if it doesn't exist yet (e.g. root on first call)
        if (!graph.hasNode(nodeId)) {
            addNode(nodeId, nodeId);
        }
        expandedNodes.add(nodeId);
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            addNode(child.name, nodeId, child.kind, i, children.length, child.reverse);
        }
    }

    // ── Physics ──

    function stepPhysics() {
        var repulsion = 3.0;
        var attraction = 0.06;
        var gravity = 0.02;
        var damping = 0.82;
        var dt = 0.4;
        var all = Array.from(realNodes) as string[];

        for (var i = 0; i < all.length; i++) {
            var a = all[i];
            var ax = graph.getNodeAttribute(a, 'x');
            var ay = graph.getNodeAttribute(a, 'y');
            for (var j = i + 1; j < all.length; j++) {
                var b = all[j];
                var bx = graph.getNodeAttribute(b, 'x');
                var by = graph.getNodeAttribute(b, 'y');
                var dx = ax - bx; var dy = ay - by;
                var dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
                var force = repulsion / (dist * dist);
                var fx = (dx / dist) * force * dt;
                var fy = (dy / dist) * force * dt;
                vx[a] += fx; vy[a] += fy;
                vx[b] -= fx; vy[b] -= fy;
            }
        }

        for (var ei = 0; ei < edgeList.length; ei++) {
            var e = edgeList[ei];
            var sx = graph.getNodeAttribute(e.source, 'x');
            var sy = graph.getNodeAttribute(e.source, 'y');
            var tx = graph.getNodeAttribute(e.target, 'x');
            var ty = graph.getNodeAttribute(e.target, 'y');
            var edx = tx - sx; var edy = ty - sy;
            var edist = Math.sqrt(edx * edx + edy * edy) + 0.01;
            var eforce = edist * attraction * dt;
            var efx = (edx / edist) * eforce;
            var efy = (edy / edist) * eforce;
            vx[e.source] += efx; vy[e.source] += efy;
            vx[e.target] -= efx; vy[e.target] -= efy;
        }

        for (var ai = 0; ai < all.length; ai++) {
            var id = all[ai];
            var nx = graph.getNodeAttribute(id, 'x');
            var ny = graph.getNodeAttribute(id, 'y');
            vx[id] -= nx * gravity * dt;
            vy[id] -= ny * gravity * dt;
            vx[id] *= damping; vy[id] *= damping;
            graph.setNodeAttribute(id, 'x', nx + vx[id]);
            graph.setNodeAttribute(id, 'y', ny + vy[id]);
        }
    }

    // ── Sigma setup ──

    var NodeBorderProgram = rendering.createNodeBorderProgram({
        borders: [
            { size: { value: 0.2, mode: 'relative' }, color: { attribute: 'borderColor' } },
        ],
    });

    var renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        zoomingRatio: zoomingRatio,
        defaultEdgeType: 'arrow',
        defaultNodeType: 'bordered',
        edgeProgramClasses: { arrow: rendering.EdgeArrowProgram },
        nodeProgramClasses: { bordered: NodeBorderProgram, circle: rendering.NodeCircleProgram },
        renderLabels: true,
        renderEdgeLabels: true,
        labelColor: { color: theme.labelColor },
        edgeLabelColor: { color: theme.edgeLabelColor },
        labelSize: 10,
        edgeLabelSize: 9,
        labelFont: labelFont,
        labelRenderedSizeThreshold: 4,
        zIndex: true,
    });

    // Click to expand
    renderer.on('clickNode', function(event: any) {
        var node = event.node;
        if (realNodes.has(node) && onNodeClick) {
            onNodeClick(node);
        }
    });
    renderer.on('enterNode', function(event: any) {
        if (realNodes.has(event.node) && !expandedNodes.has(event.node)) {
            container.style.cursor = 'pointer';
        }
    });
    renderer.on('leaveNode', function() { container.style.cursor = 'default'; });

    // ── Reducers ──

    renderer.setSetting('nodeReducer', function(node: string, attrs: any) {
        // Root ring
        if (node === rootId) {
            return Object.assign({}, attrs, { type: 'bordered', size: rootSize, color: theme.accentDim, borderColor: theme.accent, zIndex: 2 });
        }
        // Inner overlays
        if (node === '_inner_' + rootId) {
            var pulse = Math.sin(frame * 0.06) * 0.5 + 0.5;
            var alpha = Math.floor(pulse * 200 + 30).toString(16);
            if (alpha.length < 2) alpha = '0' + alpha;
            return Object.assign({}, attrs, { type: 'circle', size: innerRootSize, color: theme.innerColor + alpha, label: '', zIndex: 3 });
        }
        if (node.indexOf('_inner_') === 0) {
            var parentName = node.slice(7);
            var nearness = 0;
            for (var pi = 0; pi < particles.length; pi++) {
                if (particles[pi].target === parentName) {
                    var pt = ((frame * 0.008) + particles[pi].phase) % 1;
                    var pn = pt > 0.85 ? (pt - 0.85) / 0.15 : 0;
                    if (pn > nearness) nearness = pn;
                }
            }
            var ia = Math.floor(nearness * 220 + 20).toString(16);
            if (ia.length < 2) ia = '0' + ia;
            return Object.assign({}, attrs, { type: 'circle', size: innerNodeSize, color: theme.innerColor + ia, label: '', zIndex: 3 });
        }
        // Particles
        for (var pj = 0; pj < particles.length; pj++) {
            if (particles[pj].id === node) {
                var t = ((frame * 0.008) + particles[pj].phase) % 1;
                var fade = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
                var pr = Math.floor(theme.bgRGB[0] + fade * (particleBlend * (theme.particleRGB[0] - theme.bgRGB[0])));
                var pg = Math.floor(theme.bgRGB[1] + fade * (particleBlend * (theme.particleRGB[1] - theme.bgRGB[1])));
                var pb = Math.floor(theme.bgRGB[2] + fade * (particleBlend * (theme.particleRGB[2] - theme.bgRGB[2])));
                var phex = '#' + (pr < 16 ? '0' : '') + pr.toString(16) + (pg < 16 ? '0' : '') + pg.toString(16) + (pb < 16 ? '0' : '') + pb.toString(16);
                return Object.assign({}, attrs, { type: 'circle', size: 1 + fade * 0.8, color: phex, label: '', zIndex: 1 });
            }
        }
        // Real nodes
        if (realNodes.has(node)) {
            var canExpand = !expandedNodes.has(node);
            var borderColor = canExpand ? theme.expandableColor : theme.accent;
            return Object.assign({}, attrs, { type: 'bordered', size: nodeSize, color: theme.accentDim, borderColor: borderColor, zIndex: 2 });
        }
        return attrs;
    });

    renderer.setSetting('edgeReducer', function(_edge: string, attrs: any) {
        var ep = Math.sin(frame * 0.04) * 0.3 + 0.5;
        var ea = Math.floor(ep * 50 + 30).toString(16);
        if (ea.length < 2) ea = '0' + ea;
        return Object.assign({}, attrs, { color: theme.edgeColor + ea, size: 1 });
    });

    // ── Animation loop ──

    interval = setInterval(function() {
        frame++;
        stepPhysics();

        // Sync inner overlays
        for (var ii = 0; ii < innerNodes.length; ii++) {
            var innerId = innerNodes[ii];
            var parentId = innerId.slice(7);
            if (graph.hasNode(parentId)) {
                graph.setNodeAttribute(innerId, 'x', graph.getNodeAttribute(parentId, 'x'));
                graph.setNodeAttribute(innerId, 'y', graph.getNodeAttribute(parentId, 'y'));
            }
        }

        // Move particles
        for (var pi = 0; pi < particles.length; pi++) {
            var p = particles[pi];
            if (!graph.hasNode(p.source) || !graph.hasNode(p.target)) continue;
            var sx = graph.getNodeAttribute(p.source, 'x');
            var sy = graph.getNodeAttribute(p.source, 'y');
            var tx = graph.getNodeAttribute(p.target, 'x');
            var ty = graph.getNodeAttribute(p.target, 'y');
            var t = ((frame * 0.008) + p.phase) % 1;
            graph.setNodeAttribute(p.id, 'x', sx + (tx - sx) * t);
            graph.setNodeAttribute(p.id, 'y', sy + (ty - sy) * t);
        }

        renderer.refresh();
    }, 50);

    // ── Public API ──

    function destroy() {
        if (interval) { clearInterval(interval); interval = null; }
        if (renderer) { try { renderer.kill(); } catch(e) {} }
    }

    return {
        renderer: renderer,
        graph: graph,
        expandNode: expandNode,
        addNode: addNode,
        markExpanded: function(nodeId: string) { expandedNodes.add(nodeId); },
        isExpanded: function(nodeId: string) { return expandedNodes.has(nodeId); },
        destroy: destroy,
    };
}

/**
 * Returns a JS source string that, when evaluated in an iframe, exposes
 * `createStarGraph` as a global. For injection into iframe srcdoc.
 *
 * We can't rely on `createStarGraph.toString()` defining the function under
 * its original name — production bundlers minify function names (the
 * exported `createStarGraph` may end up as `e` or `t` in the bundle, and
 * `.toString()` returns the post-mangle source). Wrapping in an explicit
 * assignment to `createStarGraph` defeats the rename.
 */
export function getStarGraphSource(): string {
    return `var createStarGraph = ${createStarGraph.toString()};`;
}
