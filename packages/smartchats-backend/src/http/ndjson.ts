/**
 * NDJSON line reader for fetch streams. Yields parsed objects one per line.
 * Skips malformed lines so server heartbeats or partial chunks don't blow up
 * the iterator.
 */
export async function* readNdjson<T = unknown>(
    response: Response,
): AsyncGenerator<T, void, unknown> {
    if (!response.body) throw new Error('Response has no body stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (buffer.trim()) {
                    for (const line of buffer.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        try { yield JSON.parse(trimmed) as T; } catch { /* skip */ }
                    }
                }
                return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try { yield JSON.parse(trimmed) as T; } catch { /* skip */ }
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
    }
}

/** Decode base64 PCM16 → ArrayBuffer (owned, not a view into a larger buffer). */
export function base64ToPcmBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
