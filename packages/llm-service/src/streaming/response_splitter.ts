/**
 * Response-splitter utilities for combined LLM + TTS streaming.
 *
 * `ResponseSplitter` watches a text buffer and fires the first chunk the
 * moment it crosses a word-count threshold AND hits a sentence boundary.
 * The remainder is collected in-buffer and released via `flushRemainder()`
 * once the upstream source finishes. This is the mechanism that lets a
 * downstream TTS provider start speaking before the LLM has finished
 * generating — a critical lever for first-audio latency.
 *
 * Pure functions; no I/O, no time source outside Date.now(), easy to unit test.
 */

/** Word count for threshold checks — splits on whitespace, ignores empties. */
export function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Character position just after the Nth word.
 * Returns −1 if the text contains fewer than N words.
 */
export function nthWordEndPosition(text: string, n: number): number {
    let count = 0
    let inWord = false
    for (let i = 0; i < text.length; i++) {
        const isSpace = /\s/.test(text[i])
        if (!isSpace && !inWord) {
            inWord = true
        } else if (isSpace && inWord) {
            count++
            inWord = false
            if (count >= n) return i
        }
    }
    if (inWord) count++
    return count >= n ? text.length : -1
}

/**
 * Find the next sentence-ish boundary at or after `fromPos`.
 * Matches punctuation (.!?,:;(), em-dash, newline) followed by whitespace.
 * Returns the split index (after the delimiter + whitespace), or −1.
 */
export function findBoundaryAfter(text: string, fromPos: number): number {
    const tail = text.slice(fromPos)
    const match = tail.match(/(?:[.!?\n,:;(]|--)\s+/)
    if (!match || match.index === undefined) return -1
    return fromPos + match.index + match[0].length
}

export interface ResponseSplitterOptions {
    /** Fire the first chunk once this many words have accumulated. */
    wordThreshold: number
    /** Alternate trigger: elapsed time in ms. `0` disables. */
    timeThresholdMs: number
    /** Reference time for the time trigger (typically request start ms). */
    startTime: number
    /** Callback fired once with the trimmed first chunk when a trigger hits. */
    onFirstChunk: (text: string) => void
}

/**
 * Accumulates streaming text. Fires `onFirstChunk` once the word threshold is
 * met AND a sentence boundary is reached. After the first chunk fires, further
 * `feed()` calls just append to the internal buffer — the remainder is
 * released when the caller invokes `flushRemainder()`.
 */
export class ResponseSplitter {
    private buffer = ''
    private firstFired = false
    private readonly startTime: number
    private readonly wordThreshold: number
    private readonly timeThresholdMs: number
    private readonly onFirstChunk: (text: string) => void

    constructor(opts: ResponseSplitterOptions) {
        this.wordThreshold = opts.wordThreshold
        this.timeThresholdMs = opts.timeThresholdMs
        this.startTime = opts.startTime
        this.onFirstChunk = opts.onFirstChunk
    }

    feed(text: string): void {
        this.buffer += text
        if (this.firstFired) return

        const wordsReady = wordCount(this.buffer) >= this.wordThreshold
        const timeReady = this.timeThresholdMs > 0 && Date.now() - this.startTime >= this.timeThresholdMs
        if (!wordsReady && !timeReady) return

        const thresholdPos = wordsReady ? nthWordEndPosition(this.buffer, this.wordThreshold) : 0
        if (thresholdPos === -1) return

        const splitIdx = findBoundaryAfter(this.buffer, thresholdPos)
        if (splitIdx === -1) return

        const firstChunk = this.buffer.slice(0, splitIdx).trim()
        this.buffer = this.buffer.slice(splitIdx)
        this.firstFired = true
        if (firstChunk.length > 0) this.onFirstChunk(firstChunk)
    }

    /**
     * Release any text still in the buffer. Returns null if empty.
     * Safe to call even if the first chunk never fired — in that case it
     * returns the entire accumulated text.
     */
    flushRemainder(): string | null {
        const text = this.buffer.trim()
        this.buffer = ''
        return text.length > 0 ? text : null
    }

    get hasFiredFirst(): boolean {
        return this.firstFired
    }
}
