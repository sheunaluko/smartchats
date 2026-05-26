//! sail-dsp — Rust→WASM audio DSP primitives for /sail.
//!
//! Phase 1 POC: two exports to prove the toolchain end-to-end and seed
//! the audio-analyzer toolkit the SmartChats Audio Intelligence Lab will
//! grow into. Keep functions allocation-free where possible — they run
//! in the JS audio path (potentially per-frame).
//!
//! Build:  `cd packages/sail-dsp && wasm-pack build --target web --release`
//! Output: `pkg/` (committed to git so consumers don't need rust to build).

use wasm_bindgen::prelude::*;

/// Canonical smoke-test: integer add. Used by /sail's Lab POC panel to
/// confirm the wasm module loaded + exported functions are callable.
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

/// Root-mean-square of an audio sample buffer. Standard amplitude
/// summary — used as the foundation for envelope followers, level
/// meters, and silence detection. Operates on the Float32Array directly
/// (no copy) thanks to wasm-bindgen's slice handling.
///
/// Returns 0.0 for an empty buffer rather than NaN.
#[wasm_bindgen]
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sum_sq: f64 = 0.0;
    for &s in samples {
        let v = s as f64;
        sum_sq += v * v;
    }
    (sum_sq / samples.len() as f64).sqrt() as f32
}

/// Build identifier — useful for confirming a fresh wasm artifact is
/// loaded vs a stale cached one. Bumped by hand when the crate's
/// behavior changes meaningfully.
#[wasm_bindgen]
pub fn version() -> String {
    String::from("sail-dsp 0.1.0 (phase-1 poc)")
}

// ─────────────────────────────────────────────────────────────────────
// Unit tests — run with `cargo test` (native, no wasm involved).
// These cover the pure-rust logic; the wasm boundary itself is covered
// by /sail's Lab POC integration test in playwright (sail.spec.ts).
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_works() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(-7, 7), 0);
        assert_eq!(add(0, 0), 0);
    }

    #[test]
    fn rms_empty_buffer_is_zero() {
        // Guards against NaN from division-by-zero. The wasm-side type
        // signature accepts &[f32] so an empty Float32Array from JS
        // resolves here.
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn rms_square_wave_is_amplitude() {
        // ±0.5 alternating samples → RMS == 0.5 exactly.
        // Matches the LabPoc smoke-test assertion in TS.
        assert_eq!(rms(&[0.5, -0.5, 0.5, -0.5]), 0.5);
    }

    #[test]
    fn rms_dc_signal() {
        // All-same-value buffer → RMS == |value|.
        assert!((rms(&[0.25, 0.25, 0.25, 0.25]) - 0.25).abs() < 1e-6);
    }

    #[test]
    fn rms_silence_is_zero() {
        assert_eq!(rms(&[0.0; 1024]), 0.0);
    }

    #[test]
    fn rms_sine_one_period() {
        // Single full period of sin(2π t / N) over N=1024 samples.
        // True RMS of a unit-amplitude sine wave = 1/√2 ≈ 0.7071068.
        let n = 1024;
        let buf: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * (i as f32) / (n as f32)).sin())
            .collect();
        let r = rms(&buf);
        let expected = 1.0 / 2.0_f32.sqrt();
        // Generous tolerance — discrete sine over 1024 samples is very
        // close to the analytical RMS but not exact.
        assert!((r - expected).abs() < 1e-4, "rms={} expected={}", r, expected);
    }

    #[test]
    fn rms_is_independent_of_sample_sign() {
        // RMS squares each sample, so flipping signs must not affect result.
        let pos = [0.1, 0.2, 0.3, 0.4];
        let neg = [-0.1, -0.2, -0.3, -0.4];
        assert!((rms(&pos) - rms(&neg)).abs() < 1e-7);
    }

    #[test]
    fn version_is_stable() {
        // Catches accidental edits — bump the string in lib.rs deliberately
        // when crate behavior changes, then update this test in the same commit.
        assert_eq!(version(), "sail-dsp 0.1.0 (phase-1 poc)");
    }
}
