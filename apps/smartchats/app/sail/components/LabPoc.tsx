'use client';

/**
 * LabPoc — proof-of-concept that the new tech stacks load correctly:
 *
 *   1. Rust → WASM (`sail-dsp`): module loads, `add(2,3)` returns 5,
 *      `rms(testBuffer)` returns expected value, `version()` reports the
 *      compiled identifier (catches stale-cache mismatches).
 *
 *   2. Three.js: a small canvas mounts a spinning wireframe cube via
 *      vanilla three.js (imperative API, not R3F). Proves the renderer
 *      initializes, the animation loop runs, and the bundle is wired.
 *      Will become the foundation of the 3D spectrogram surface in a
 *      later phase.
 *
 *      Note: R3F was evaluated first but its global JSX namespace
 *      augmentation conflicted with the codebase's existing complex
 *      MUI-based JSX (tivi/CalibrationViz). Raw three.js gives us the
 *      same proof of concept without the type pollution; can revisit
 *      R3F if/when the codebase tolerates it or R3F v9+ ships with
 *      scoped types.
 *
 * Render this only on /sail (not /app) — both libraries add bundle
 * weight we don't want in production-facing surfaces yet.
 */

import React, { useEffect, useRef, useState } from 'react';
import init, { add, rms, version } from 'sail-dsp';
import * as THREE from 'three';

type WasmStatus =
    | { kind: 'loading' }
    | { kind: 'ready'; version: string; addResult: number; rmsResult: number; loadMs: number }
    | { kind: 'error'; message: string };

export function LabPoc() {
    const [wasm, setWasm] = useState<WasmStatus>({ kind: 'loading' });

    useEffect(() => {
        let cancelled = false;
        async function load() {
            const t0 = performance.now();
            try {
                // wasm-bindgen's default init() handles fetching the .wasm next to
                // the JS glue. URL resolution Just Works under webpack/Next bundling.
                await init();
                if (cancelled) return;

                const addResult = add(2, 3); // expect 5
                const testBuf = new Float32Array([0.5, -0.5, 0.5, -0.5]);
                const rmsResult = rms(testBuf); // expect 0.5
                const v = version();

                setWasm({
                    kind: 'ready',
                    version: v,
                    addResult,
                    rmsResult,
                    loadMs: performance.now() - t0,
                });
            } catch (err) {
                if (cancelled) return;
                setWasm({
                    kind: 'error',
                    message: (err as Error)?.message ?? String(err),
                });
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    return (
        <div
            style={{
                display: 'grid', gap: 10,
                gridTemplateColumns: '1fr auto',
                padding: '10px 12px',
                color: '#dcdcdc', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                background: '#11111a', border: '1px solid #2a2a3a',
                borderRadius: 8,
            }}
        >
            <div>
                <div style={{ color: '#a0a0c0', marginBottom: 6 }}>
                    lab poc — rust + 3d toolchains
                </div>
                <WasmStatusBlock status={wasm} />
            </div>
            <SpinningCube size={110} />
        </div>
    );
}

function WasmStatusBlock({ status }: { status: WasmStatus }) {
    if (status.kind === 'loading') {
        return <div style={{ color: '#888' }}>sail-dsp loading…</div>;
    }
    if (status.kind === 'error') {
        return (
            <div style={{ color: '#ff7070' }}>
                sail-dsp failed: {status.message}
            </div>
        );
    }
    const addOk = status.addResult === 5;
    const rmsOk = Math.abs(status.rmsResult - 0.5) < 1e-6;
    const allOk = addOk && rmsOk;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 2 }}>
            <span style={{ color: '#666' }}>status</span>
            <span style={{ color: allOk ? '#88dd88' : '#ffcc66' }}>
                {allOk ? '✓ loaded · all checks pass' : '⚠ loaded, but some checks failed'}
            </span>
            <span style={{ color: '#666' }}>version</span>
            <span>{status.version}</span>
            <span style={{ color: '#666' }}>load time</span>
            <span>{status.loadMs.toFixed(1)} ms</span>
            <span style={{ color: '#666' }}>add(2,3)</span>
            <span style={{ color: addOk ? '#88dd88' : '#ff7070' }}>
                {status.addResult} {addOk ? '✓' : '✗ expected 5'}
            </span>
            <span style={{ color: '#666' }}>rms([.5,-.5,.5,-.5])</span>
            <span style={{ color: rmsOk ? '#88dd88' : '#ff7070' }}>
                {status.rmsResult.toFixed(6)} {rmsOk ? '✓' : '✗ expected 0.5'}
            </span>
        </div>
    );
}

/**
 * Vanilla three.js spinning wireframe cube. Imperative — sets up scene,
 * camera, renderer in a useEffect, runs an rAF loop, tears down cleanly
 * on unmount. ~30 lines, no extra abstractions.
 *
 * Phase later: replace with a 3D spectrogram surface that takes
 * Float32Array frequency bins and renders height × time × intensity.
 */
function SpinningCube({ size }: { size: number }) {
    const mountRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x06060c);

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(2, 2, 2);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(size, size);
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(3, 3, 3);
        scene.add(dirLight);

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            wireframe: true,
        });
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);

        let raf = 0;
        let lastT = performance.now();
        const tick = () => {
            const now = performance.now();
            const delta = (now - lastT) / 1000;
            lastT = now;
            cube.rotation.x += delta * 0.6;
            cube.rotation.y += delta * 0.9;
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        tick();

        return () => {
            cancelAnimationFrame(raf);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            if (renderer.domElement.parentElement === mount) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, [size]);

    return (
        <div
            ref={mountRef}
            style={{
                width: size, height: size, borderRadius: 6,
                overflow: 'hidden', background: '#06060c',
                border: '1px solid #1d1d2c',
            }}
        />
    );
}
