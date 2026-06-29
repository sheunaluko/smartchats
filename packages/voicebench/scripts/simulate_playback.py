#!/usr/bin/env python3
"""
Reconstruct what a listener heard given a voicebench trial's captured PCM batches +
arrival times. Inserts silence wherever the next batch arrived AFTER the playback
cursor would have run out of buffered audio — that's where the user perceives stutter.

Each trial dir (from `voicebench --save-audio <dir>`) contains:
  - batch_NNN.pcm — raw PCM16 24kHz mono bytes for each batch
  - timing.json — per-batch arrival ms and sample-rate metadata

Output: two WAV files per trial
  - <trial>_clean.wav    — batches concatenated as if buffer never starved (reference)
  - <trial>_realistic.wav — playback with silence inserted at stutter points
                            (what the user actually heard)

Usage:
    python3 simulate_playback.py <trial_dir>
    python3 simulate_playback.py <parent_dir>      # process every trial dir below it

Standard library only. Uses Python's built-in `wave` module for WAV output.
"""

import json
import struct
import sys
import wave
from pathlib import Path


def write_wav(path: Path, pcm_bytes: bytes, sample_rate_hz: int = 24000) -> None:
    """Write PCM16 mono bytes to a standard RIFF WAV file."""
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # PCM16 = 2 bytes
        wf.setframerate(sample_rate_hz)
        wf.writeframes(pcm_bytes)


def silence_bytes(ms: float, sample_rate_hz: int = 24000) -> bytes:
    """Generate `ms` of silence as PCM16 mono. Each sample is 2 zero bytes."""
    num_samples = int(round(ms * sample_rate_hz / 1000))
    return b'\x00\x00' * num_samples


def process_trial(trial_dir: Path) -> bool:
    timing_path = trial_dir / 'timing.json'
    if not timing_path.exists():
        return False

    timing = json.loads(timing_path.read_text())
    sample_rate = int(timing.get('sampleRateHz', 24000))
    bytes_per_sec = int(timing.get('bytesPerSecond', 48000))
    batches_meta = timing['batches']
    ttfb = timing.get('timeToFirstByteMs')

    # Sort batches by index just in case
    batches_meta = sorted(batches_meta, key=lambda b: b['batchIndex'])

    # Load PCM payloads keyed by batchIndex
    pcm_by_idx: dict[int, bytes] = {}
    for f in sorted(trial_dir.glob('batch_*.pcm')):
        idx = int(f.stem.split('_')[1])
        pcm_by_idx[idx] = f.read_bytes()

    if not pcm_by_idx:
        print(f'  skip: no batch_*.pcm in {trial_dir.name}', file=sys.stderr)
        return False

    # ─── Clean reference: just concatenate ───
    clean = b''.join(pcm_by_idx[m['batchIndex']] for m in batches_meta if m['batchIndex'] in pcm_by_idx)

    # ─── Realistic playback simulation ───
    # Model: playback starts when first byte arrives (or at t=ttfb if we want to include
    # the wait — keeps the audio short by NOT prepending TTFB silence; the wait is invisible
    # to a listener who only hears audio, not silence-before-audio. Stutter == silence
    # INSIDE audio that the listener perceives as mid-utterance gap.)
    out = bytearray()
    playback_cursor_ms = batches_meta[0]['msFromStreamCall']  # time when first byte arrives

    for m in batches_meta:
        idx = m['batchIndex']
        if idx not in pcm_by_idx:
            continue
        pcm = pcm_by_idx[idx]
        arrival_ms = m['msFromStreamCall']
        # If this batch arrived AFTER the playback cursor (i.e. the buffer ran out
        # waiting for it), insert that much silence first.
        if arrival_ms > playback_cursor_ms:
            gap_ms = arrival_ms - playback_cursor_ms
            out.extend(silence_bytes(gap_ms, sample_rate))
            playback_cursor_ms = arrival_ms
        # Append this batch's audio. Playback cursor advances by the batch's duration.
        out.extend(pcm)
        playback_cursor_ms += (len(pcm) / bytes_per_sec) * 1000

    realistic = bytes(out)

    # ─── Write outputs ───
    base = trial_dir.name
    out_dir = trial_dir.parent
    clean_path = out_dir / f'{base}_clean.wav'
    realistic_path = out_dir / f'{base}_realistic.wav'
    write_wav(clean_path, clean, sample_rate)
    write_wav(realistic_path, realistic, sample_rate)

    clean_ms = round(len(clean) / bytes_per_sec * 1000)
    realistic_ms = round(len(realistic) / bytes_per_sec * 1000)
    stutter_inserted_ms = realistic_ms - clean_ms
    print(f'{base:50s}  clean={clean_ms:>6}ms  realistic={realistic_ms:>6}ms  stutter_inserted={stutter_inserted_ms:>5}ms  ttfb={ttfb}')
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(1)
    root = Path(sys.argv[1])
    if not root.exists():
        print(f'no such path: {root}', file=sys.stderr)
        sys.exit(2)

    # If root contains timing.json directly, treat it as a single trial dir
    if (root / 'timing.json').exists():
        ok = process_trial(root)
        sys.exit(0 if ok else 3)

    # Else: walk children, process every dir that looks like a trial
    any_processed = False
    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / 'timing.json').exists():
            if process_trial(child):
                any_processed = True
    if not any_processed:
        print(f'no trial dirs (with timing.json) found under {root}', file=sys.stderr)
        sys.exit(3)


if __name__ == '__main__':
    main()
