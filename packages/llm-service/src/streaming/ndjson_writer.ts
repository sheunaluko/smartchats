/**
 * Server-side NDJSON streaming helpers.
 *
 * Every handler that streams JSON lines over an HTTP response does the same
 * two things: (1) set a specific set of headers so the browser/proxy doesn't
 * buffer, and (2) write `JSON.stringify(obj) + '\n'` per frame. Centralized
 * here so the framing contract lives in exactly one place.
 *
 * Designed to be framework-agnostic. Any object with a `setHeader(name, val)`
 * method and a `write(chunk)` method satisfies `NdjsonStreamResponse` — works
 * with Express `Response` and Firebase onRequest `Response` interchangeably.
 */

export interface NdjsonStreamResponse {
    setHeader(name: string, value: string): unknown
    write(chunk: string | Buffer): unknown
}

/**
 * Set the response headers required for chunked NDJSON streaming.
 * Call once before writing any frames.
 *
 * - `text/plain; charset=utf-8` — avoids aggressive proxy transforms.
 * - `Transfer-Encoding: chunked` — opens the door for incremental delivery.
 * - `Cache-Control: no-cache` — prevents intermediaries from caching partials.
 * - `X-Content-Type-Options: nosniff` — stops browsers from MIME-sniffing.
 */
export function beginNdjsonStream(res: NdjsonStreamResponse): void {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Transfer-Encoding', 'chunked')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Type-Options', 'nosniff')
}

/** Write a single NDJSON line (`JSON.stringify(obj) + "\n"`) to the response. */
export function writeNdjsonLine(res: NdjsonStreamResponse, obj: unknown): void {
    res.write(JSON.stringify(obj) + '\n')
}
