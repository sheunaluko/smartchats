'use client';

/**
 * Spectrogram3D — 3D "audio terrain" spectrogram. Mic frequency data drives
 * the Y-height of a scrolling mesh: X axis = frequency, Z axis = time
 * (front edge = now), Y = magnitude. Sibling of Spectrogram.tsx — same
 * private AudioContext + AnalyserNode pattern, same teardown rules.
 *
 * Rendering: vanilla three.js (LabPoc.tsx pattern). No R3F to avoid the
 * JSX namespace pollution issue we hit before. Per-vertex colors instead
 * of a material color so the height-encoded heatmap pops without a shader.
 *
 * Phase: cool-viz first. Mouse-drag orbit + axis labels are easy adds if
 * needed later.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeBinMapper, detectPitch, hzToNoteName, type FreqScale } from './spectrogram_utils';

type Props = {
    /** Optional CSS height in px; if omitted, fills the parent container. */
    height?: number;
    /** dB floor — values below this clip to background. */
    minDb?: number;
    /** dB ceiling — values above this clip to max color. */
    maxDb?: number;
    /** Optional title shown top-left. */
    label?: string;
    /** Frequency axis scale: linear (default) or log. */
    scale?: FreqScale;
    /** Lower display bound in Hz. */
    minFreqHz?: number;
    /** Upper display bound in Hz. */
    maxFreqHz?: number;
    /** Scroll-rate multiplier. 1 = one row per animation frame (default). */
    speed?: number;
    /** Camera azimuth in degrees around the world Y axis. 0 = front (default). */
    azimuthDeg?: number;
    /** When true, the camera orbits at `autorotateDegPerSec`. The
     *  `azimuthDeg` value still acts as the starting angle whenever it
     *  changes; rotation continues from there. */
    autorotate?: boolean;
    /** Degrees per second when autorotate is on. Default 15. */
    autorotateDegPerSec?: number;
    /** FFT window size (power of 2). Default 2048. */
    fftSize?: number;
    /** Contrast curve exponent applied to normalized magnitudes before
     *  vertex height + color mapping. 1 = linear, 2 = squared,
     *  3 = cubed. 0 and 1 stay fixed; mids get pushed down. */
    contrast?: number;
    /** When true, overlays a bright sphere marker at the detected pitch
     *  (peak in [minFreqHz, maxFreqHz]) on the front edge of the mesh. */
    showPitchMarker?: boolean;
    /** Harmonic-rescue threshold for pitch detection. If a lower-freq local
     *  peak has ≥ this ratio of the global peak's contrasted magnitude, it
     *  wins (F0 candidate). 0 disables the rescue. Default 0.3. */
    harmonicRescueThreshold?: number;
    /** Scale multiplier for the pitch marker sphere. 1 = default size. */
    pitchMarkerSize?: number;
    /** Show a fading trail of past pitch positions extending back along
     *  the time axis. Aligned to the mesh time slices so it scrolls in
     *  step with the spectrogram. */
    showPitchTrail?: boolean;
};

// Mesh density. NW × NT triangles, doubled. Keep modest — 96×80 ≈ 15k tris
// runs comfortably at 60fps with vertex-color updates each frame.
const NW = 96;   // frequency bins (width)
const NT = 80;   // time slices (depth) — older slices live at the back
const WORLD_W = 4;
const WORLD_D = 3;
const MAX_Y = 1.2; // peak height when bin == 255

export function Spectrogram3D({
    height, minDb = -100, maxDb = -10, label = 'Microphone (3D)',
    scale = 'linear', minFreqHz = 0, maxFreqHz = 24000, speed = 1,
    azimuthDeg = 0, autorotate = false, autorotateDegPerSec = 15, fftSize = 2048,
    contrast = 1, showPitchMarker = false, harmonicRescueThreshold = 0.3,
    pitchMarkerSize = 1, showPitchTrail = false,
}: Props) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const stoppedRef = useRef(false);
    // Exposed at component scope so the fftSize-change effect can mutate
    // them without remounting the whole scene.
    const analyserRef = useRef<AnalyserNode | null>(null);
    const fftDataRef = useRef<Uint8Array | null>(null);

    // Live-tunable knobs — refs so the rAF loop reads current values
    // without re-running the full mount effect (which would tear down
    // the mic stream + scene).
    const scaleRef = useRef<FreqScale>(scale);
    const minHzRef = useRef(minFreqHz);
    const maxHzRef = useRef(maxFreqHz);
    const speedRef = useRef(speed);
    const autorotateRef = useRef(autorotate);
    const autoSpeedRef = useRef(autorotateDegPerSec);
    const contrastRef = useRef(contrast);
    const showPitchRef = useRef(showPitchMarker);
    const rescueRef = useRef(harmonicRescueThreshold);
    const markerSizeRef = useRef(pitchMarkerSize);
    const showTrailRef = useRef(showPitchTrail);
    // DOM ref for the live pitch-text overlay (updated imperatively to avoid
    // re-rendering React every frame).
    const pitchTextRef = useRef<HTMLDivElement | null>(null);
    // currentAngleRef holds the live azimuth (advanced by autorotate when
    // active). When the parent `azimuthDeg` prop changes, we snap it to
    // the new value — manual slider sets the new starting angle.
    const currentAngleRef = useRef(azimuthDeg);
    useEffect(() => { scaleRef.current = scale; }, [scale]);
    useEffect(() => { minHzRef.current = minFreqHz; }, [minFreqHz]);
    useEffect(() => { maxHzRef.current = maxFreqHz; }, [maxFreqHz]);
    useEffect(() => { speedRef.current = speed; }, [speed]);
    useEffect(() => { autorotateRef.current = autorotate; }, [autorotate]);
    useEffect(() => { autoSpeedRef.current = autorotateDegPerSec; }, [autorotateDegPerSec]);
    useEffect(() => { currentAngleRef.current = azimuthDeg; }, [azimuthDeg]);
    useEffect(() => { contrastRef.current = contrast; }, [contrast]);
    useEffect(() => { showPitchRef.current = showPitchMarker; }, [showPitchMarker]);
    useEffect(() => { rescueRef.current = harmonicRescueThreshold; }, [harmonicRescueThreshold]);
    useEffect(() => { markerSizeRef.current = pitchMarkerSize; }, [pitchMarkerSize]);
    useEffect(() => { showTrailRef.current = showPitchTrail; }, [showPitchTrail]);

    // Live fftSize change — mutate the analyser + reallocate the buffer.
    // Web Audio resets internal FFT state on assignment; smoothing kicks
    // back in within a few frames.
    useEffect(() => {
        const a = analyserRef.current;
        if (!a) return;
        try {
            a.fftSize = fftSize;
            fftDataRef.current = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
        } catch (err) {
            console.warn('[sail/spectrogram3d] invalid fftSize, keeping previous', fftSize, err);
        }
    }, [fftSize]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;
        stoppedRef.current = false;
        let cancelled = false;

        // ─── Audio setup ─────────────────────────────────────────────
        let audioCtx: AudioContext | null = null;
        let stream: MediaStream | null = null;
        // analyser + fftData live on refs so the fftSize change effect can
        // swap them out. We read via the refs below.

        // ─── three.js setup ─────────────────────────────────────────
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a14);

        // Soft fog behind the mesh to fade old time slices into the bg.
        scene.fog = new THREE.Fog(0x0a0a14, 3.0, 5.5);

        const rect = mount.getBoundingClientRect();
        const w = Math.max(rect.width || 600, 200);
        const h = Math.max(rect.height || (height ?? 200), 100);

        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 50);
        camera.position.set(0, 1.7, 3.2);
        camera.lookAt(0, 0.2, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        mount.appendChild(renderer.domElement);

        // OrbitControls: drag = orbit, scroll = zoom, right-drag = pan, touch
        // gestures (1-finger orbit, 2-finger pinch+pan). Damped for smooth feel.
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.2, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.minDistance = 0.8;
        controls.maxDistance = 10;

        // Set camera azimuth without relying on OrbitControls.setAzimuthalAngle
        // (only added in newer three releases — our @types don't have it).
        // Rebuild position from spherical coords with the controls' existing
        // polar angle + radius, then update() resyncs the internal spherical.
        function applyAzimuth(deg: number) {
            const offset = camera.position.clone().sub(controls.target);
            const radius = offset.length();
            const polar = controls.getPolarAngle();
            const az = (deg * Math.PI) / 180;
            offset.set(
                radius * Math.sin(polar) * Math.sin(az),
                radius * Math.cos(polar),
                radius * Math.sin(polar) * Math.cos(az),
            );
            camera.position.copy(controls.target).add(offset);
            controls.update();
        }
        if (azimuthDeg) applyAzimuth(azimuthDeg);
        controls.update();

        // Build grid geometry: NW × NT vertices arranged in a flat XZ grid,
        // Y will be driven by FFT magnitude every frame.
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(NW * NT * 3);
        const colors = new Float32Array(NW * NT * 3);
        const indices: number[] = [];

        for (let z = 0; z < NT; z++) {
            for (let x = 0; x < NW; x++) {
                const i = z * NW + x;
                positions[i * 3 + 0] = (x / (NW - 1) - 0.5) * WORLD_W;
                positions[i * 3 + 1] = 0;
                // z=0 (now) at front (positive Z toward camera), oldest at back
                positions[i * 3 + 2] = (0.5 - z / (NT - 1)) * WORLD_D;
                colors[i * 3 + 0] = 0.04;
                colors[i * 3 + 1] = 0.04;
                colors[i * 3 + 2] = 0.08;
            }
        }
        for (let z = 0; z < NT - 1; z++) {
            for (let x = 0; x < NW - 1; x++) {
                const i0 = z * NW + x;
                const i1 = z * NW + (x + 1);
                const i2 = (z + 1) * NW + x;
                const i3 = (z + 1) * NW + (x + 1);
                indices.push(i0, i2, i1, i1, i2, i3);
            }
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            wireframe: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Faint wireframe overlay for that "topographic" look
        const wireMat = new THREE.MeshBasicMaterial({
            color: 0x223344, wireframe: true, transparent: true, opacity: 0.25,
        });
        const wireMesh = new THREE.Mesh(geometry, wireMat);
        scene.add(wireMesh);

        // Pitch marker — flat-shaded sphere matching the trail color (the
        // user vetoed the glossy/lit look; trail-style coloring is more
        // legible against the data-driven terrain anyway).
        const SPHERE_BASE_RADIUS = 0.05;
        const pitchSphereGeo = new THREE.SphereGeometry(SPHERE_BASE_RADIUS, 32, 24);
        const pitchSphereMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
        const pitchSphere = new THREE.Mesh(pitchSphereGeo, pitchSphereMat);
        pitchSphere.visible = false;
        scene.add(pitchSphere);

        // Trail — one Line vertex per mesh time slice. Front slot (index 0)
        // is "now"; each frame we shift past values one slot back. Per-vertex
        // RGB colors handle silence: silent frames get the scene background
        // color so the line through them blends invisibly without needing a
        // custom shader.
        const TRAIL_LEN = NT;
        const trailPositions = new Float32Array(TRAIL_LEN * 3);
        const trailColors = new Float32Array(TRAIL_LEN * 3);
        for (let i = 0; i < TRAIL_LEN; i++) {
            trailPositions[i * 3 + 0] = 0;
            trailPositions[i * 3 + 1] = 0;
            // Z matches the mesh row at the same time slice
            trailPositions[i * 3 + 2] = (0.5 - i / (TRAIL_LEN - 1)) * WORLD_D;
            // Start silent — blend into background
            trailColors[i * 3 + 0] = 10 / 255;
            trailColors[i * 3 + 1] = 10 / 255;
            trailColors[i * 3 + 2] = 20 / 255;
        }
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
        const trailMat = new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.9,
        });
        const trailLine = new THREE.Line(trailGeo, trailMat);
        trailLine.visible = false;
        scene.add(trailLine);
        // Color constants for trail color updates
        const TRAIL_VOICED_R = 1.0;
        const TRAIL_VOICED_G = 0.88;
        const TRAIL_VOICED_B = 0.4;
        const TRAIL_SILENT_R = 10 / 255;
        const TRAIL_SILENT_G = 10 / 255;
        const TRAIL_SILENT_B = 20 / 255;

        // ─── Mic acquisition (async) ────────────────────────────────
        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                audioCtx = new AudioContext();
                const src = audioCtx.createMediaStreamSource(stream);
                const a = audioCtx.createAnalyser();
                a.fftSize = fftSize;
                a.smoothingTimeConstant = 0.8;
                a.minDecibels = minDb;
                a.maxDecibels = maxDb;
                src.connect(a);
                analyserRef.current = a;
                fftDataRef.current = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
            } catch (err) {
                console.error('[sail/spectrogram3d] mic setup failed', err);
            }
        })();

        // ─── Frame loop ─────────────────────────────────────────────
        let raf = 0;
        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const colAttr = geometry.attributes.color as THREE.BufferAttribute;

        function colorFor(v: number): [number, number, number] {
            // Match Spectrogram.tsx's HSL ramp, expressed in RGB 0-1.
            if (v < 1) return [0.04, 0.04, 0.08];
            const t = v / 255;
            const hueDeg = (1 - t) * 240; // 240 (blue) → 0 (red)
            const sat = 0.8;
            const light = 0.10 + t * 0.50;
            return hslToRgb(hueDeg / 360, sat, light);
        }

        let scrollAccum = 0; // accumulates `speed` per frame; scroll when ≥ 1

        // Track last applied azimuth prop so we can re-aim the camera on slider
        // change without overriding mid-drag user input.
        let lastAzimuthApplied = azimuthDeg;

        const tick = () => {
            if (stoppedRef.current) {
                raf = requestAnimationFrame(tick);
                return;
            }

            // Bridge React props (via refs) into OrbitControls state. Cheap.
            controls.autoRotate = autorotateRef.current;
            // OrbitControls' autoRotateSpeed = "6× speed per second" — multiplier
            // such that speed=1.0 ≈ 6°/s. So degrees-per-second / 6.
            controls.autoRotateSpeed = autoSpeedRef.current / 6;
            // If parent changed the explicit azimuth, snap camera there.
            if (currentAngleRef.current !== lastAzimuthApplied) {
                applyAzimuth(currentAngleRef.current);
                lastAzimuthApplied = currentAngleRef.current;
            }
            controls.update();

            scrollAccum += speedRef.current;
            const shouldScroll = scrollAccum >= 1;
            if (shouldScroll) scrollAccum = Math.min(scrollAccum, 2) - 1;

            const analyser = analyserRef.current;
            const fftData = fftDataRef.current;
            if (shouldScroll && analyser && fftData) {
                analyser.getByteFrequencyData(fftData as unknown as Uint8Array<ArrayBuffer>);

                // Scroll: shift every slice's Y + color back by one row.
                // z=0 is the front (newest); we move each row's data to z+1.
                // Iterate from the back to front to avoid clobbering.
                const posArr = posAttr.array as Float32Array;
                const colArr = colAttr.array as Float32Array;
                for (let z = NT - 1; z > 0; z--) {
                    const srcRow = (z - 1) * NW;
                    const dstRow = z * NW;
                    for (let x = 0; x < NW; x++) {
                        posArr[(dstRow + x) * 3 + 1] = posArr[(srcRow + x) * 3 + 1];
                        colArr[(dstRow + x) * 3 + 0] = colArr[(srcRow + x) * 3 + 0];
                        colArr[(dstRow + x) * 3 + 1] = colArr[(srcRow + x) * 3 + 1];
                        colArr[(dstRow + x) * 3 + 2] = colArr[(srcRow + x) * 3 + 2];
                    }
                }

                // Write the new front row (z=0). Use the live scale + freq
                // range to pick which FFT bin lights each X position, and
                // apply the contrast curve to both height + color.
                const sr = audioCtx?.sampleRate ?? 48000;
                const mapper = makeBinMapper(scaleRef.current, minHzRef.current, maxHzRef.current, sr, analyser.fftSize);
                const p = contrastRef.current;
                const applyContrast = p !== 1;
                for (let x = 0; x < NW; x++) {
                    const binIdx = mapper(x / Math.max(1, NW - 1));
                    let v = fftData[binIdx];
                    if (applyContrast) v = Math.pow(v / 255, p) * 255;
                    const y = (v / 255) * MAX_Y;
                    posArr[x * 3 + 1] = y;
                    const [r, g, b] = colorFor(v);
                    colArr[x * 3 + 0] = r;
                    colArr[x * 3 + 1] = g;
                    colArr[x * 3 + 2] = b;
                }

                posAttr.needsUpdate = true;
                colAttr.needsUpdate = true;

                // ─── Pitch marker overlay ─────────────────────────────
                // Shift trail backward by one slot regardless of pitch
                // detection — the front slot will be (re)written below.
                if (showPitchRef.current && showTrailRef.current) {
                    const tPos = trailGeo.attributes.position.array as Float32Array;
                    const tCol = trailGeo.attributes.color.array as Float32Array;
                    for (let i = TRAIL_LEN - 1; i > 0; i--) {
                        tPos[i * 3 + 0] = tPos[(i - 1) * 3 + 0];
                        tPos[i * 3 + 1] = tPos[(i - 1) * 3 + 1];
                        // Z stays at slot's preset value
                        tCol[i * 3 + 0] = tCol[(i - 1) * 3 + 0];
                        tCol[i * 3 + 1] = tCol[(i - 1) * 3 + 1];
                        tCol[i * 3 + 2] = tCol[(i - 1) * 3 + 2];
                    }
                }

                if (showPitchRef.current) {
                    const pitch = detectPitch(
                        fftData, analyser.fftSize, sr,
                        minHzRef.current, maxHzRef.current,
                        rescueRef.current, contrastRef.current,
                    );
                    if (pitch) {
                        // Map pitchHz to X position on the mesh using the
                        // SAME freq-to-bin mapping the front row uses. The
                        // mesh clamps minBin to ≥ 1 (log(0) is -Infinity);
                        // we have to use bin-aligned Hz here too, otherwise
                        // minHz=0 + log scale yields NaN and the sphere
                        // jumps off-screen.
                        const minHz = minHzRef.current;
                        const maxHz = maxHzRef.current;
                        const binHz = sr / analyser.fftSize;
                        const binCount = analyser.fftSize / 2;
                        const minBin = Math.max(1, Math.floor(minHz / binHz));
                        const maxBin = Math.min(binCount - 1, Math.ceil(maxHz / binHz));
                        const minBinHz = minBin * binHz;
                        const maxBinHz = Math.max(maxBin * binHz, minBinHz + binHz);
                        const t = scaleRef.current === 'log'
                            ? (Math.log(pitch.pitchHz) - Math.log(minBinHz)) / (Math.log(maxBinHz) - Math.log(minBinHz))
                            : (pitch.pitchHz - minBinHz) / (maxBinHz - minBinHz);
                        const tClamped = Math.max(0, Math.min(1, t));
                        const markerX = (tClamped - 0.5) * WORLD_W;
                        const meshCol = Math.round(tClamped * (NW - 1));
                        const meshY = posArr[meshCol * 3 + 1]; // current height of that column
                        // Marker sits slightly above the mesh peak so it
                        // stays visible even when the column is tall.
                        const markerY = meshY + 0.08;
                        const frontZ = (0.5) * WORLD_D;
                        pitchSphere.position.set(markerX, markerY, frontZ);
                        pitchSphere.scale.setScalar(markerSizeRef.current);
                        pitchSphere.visible = true;

                        // Write trail front slot (voiced).
                        if (showTrailRef.current) {
                            const tPos = trailGeo.attributes.position.array as Float32Array;
                            const tCol = trailGeo.attributes.color.array as Float32Array;
                            tPos[0] = markerX;
                            tPos[1] = markerY;
                            // tPos[2] already = WORLD_D/2 from init
                            tCol[0] = TRAIL_VOICED_R;
                            tCol[1] = TRAIL_VOICED_G;
                            tCol[2] = TRAIL_VOICED_B;
                        }

                        if (pitchTextRef.current) {
                            pitchTextRef.current.textContent = `${pitch.pitchHz.toFixed(1)} Hz · ${hzToNoteName(pitch.pitchHz)}`;
                            pitchTextRef.current.style.opacity = '1';
                        }
                    } else {
                        pitchSphere.visible = false;
                        // Silent frame: trail's front slot fades to bg color
                        // so the line segment through silence visually
                        // disappears against the scene background.
                        if (showTrailRef.current) {
                            const tPos = trailGeo.attributes.position.array as Float32Array;
                            const tCol = trailGeo.attributes.color.array as Float32Array;
                            // Hold last Y so the line segment doesn't dive
                            // — color alpha takes care of hiding it.
                            tPos[0] = tPos[3];
                            tPos[1] = tPos[4];
                            tCol[0] = TRAIL_SILENT_R;
                            tCol[1] = TRAIL_SILENT_G;
                            tCol[2] = TRAIL_SILENT_B;
                        }
                        if (pitchTextRef.current) {
                            pitchTextRef.current.textContent = '— silence —';
                            pitchTextRef.current.style.opacity = '0.4';
                        }
                    }
                    // Trail visible only when both pitch + trail toggles on.
                    trailLine.visible = showTrailRef.current;
                    if (showTrailRef.current) {
                        trailGeo.attributes.position.needsUpdate = true;
                        trailGeo.attributes.color.needsUpdate = true;
                    }
                } else {
                    pitchSphere.visible = false;
                    trailLine.visible = false;
                    if (pitchTextRef.current) pitchTextRef.current.style.opacity = '0';
                }
            }

            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        tick();

        // ─── Resize handling ─────────────────────────────────────────
        // ResizeObserver tracks container size — works for flex changes,
        // sibling collapses, and window resize without separate listeners.
        const ro = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const nw = Math.max(Math.floor(entry.contentRect.width), 200);
            const nh = Math.max(Math.floor(entry.contentRect.height), 100);
            renderer.setSize(nw, nh);
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
        });
        ro.observe(mount);

        // Pause rendering when tab is hidden — same contract as the 2D version.
        function onVisChange() {
            stoppedRef.current = document.visibilityState === 'hidden';
        }
        document.addEventListener('visibilitychange', onVisChange);

        return () => {
            cancelled = true;
            stoppedRef.current = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            document.removeEventListener('visibilitychange', onVisChange);
            stream?.getTracks().forEach(t => t.stop());
            audioCtx?.close().catch(() => {});
            analyserRef.current = null;
            fftDataRef.current = null;
            controls.dispose();
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            wireMat.dispose();
            pitchSphereGeo.dispose();
            pitchSphereMat.dispose();
            trailGeo.dispose();
            trailMat.dispose();
            if (renderer.domElement.parentElement === mount) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, [height, minDb, maxDb]);

    return (
        <div style={{ position: 'relative', width: '100%', height: height ?? '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', background: '#0a0a14' }} />
            <div style={{
                position: 'absolute', top: 8, left: 12,
                color: '#a0a0c0', fontSize: 11, fontFamily: 'ui-monospace, monospace',
                pointerEvents: 'none',
            }}>
                {label} · FFT {fftSize} · {minDb}..{maxDb} dB
            </div>
            <div
                ref={pitchTextRef}
                style={{
                    position: 'absolute', top: 8, right: 12,
                    color: '#ffe066', fontSize: 16, fontWeight: 500,
                    fontFamily: 'ui-monospace, monospace',
                    pointerEvents: 'none',
                    textShadow: '0 0 6px rgba(0,0,0,0.7)',
                    opacity: 0,
                    transition: 'opacity 120ms',
                }}
            />
        </div>
    );
}

// HSL→RGB (all values 0-1). Inline because we don't want a util dep.
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l];
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
