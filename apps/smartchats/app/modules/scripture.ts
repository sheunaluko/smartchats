/**
 * Scripture functions — time-based scripture reflection.
 *
 * Pipeline: read a time → find a Bible verse whose reference matches that
 * time (e.g. 5:42 → Proverbs/Psalms/etc. 5:42) → caller pairs the verse text
 * with semantic log search to surface a reflection.
 */

import { z } from 'zod'
import { getBackend } from '@/lib/backend'

const HARDCODED_FALLBACK = {
    reference: 'Proverbs 3:5',
    verse_text: 'Trust in the LORD with all your heart, and do not lean on your own understanding.',
    source_url: 'https://www.biblegateway.com/passage/?search=Proverbs+3%3A5',
}

function normalizeTime(input: string | undefined): { hour: number; minute: number; display: string } {
    let h: number
    let m: number
    if (input && /^\d{1,2}:\d{1,2}$/.test(input.trim())) {
        const [hs, ms] = input.trim().split(':')
        h = Number(hs)
        m = Number(ms)
    } else {
        const now = new Date()
        h = now.getHours()
        m = now.getMinutes()
    }
    if (h === 0) h = 12
    if (h > 12) h = h - 12
    const display = `${h}:${m.toString().padStart(2, '0')}`
    return { hour: h, minute: m, display }
}

const ExtractionSchema = z.object({
    reference: z.string().describe('Canonical Bible reference, e.g. "Proverbs 5:42" or "" if no plausible match.'),
    verse_text: z.string().describe('The verse text exactly as it appears in the source, or "" if no plausible match.'),
    source_url: z.string().describe('URL the verse was taken from, or "" if none.'),
    confidence: z.enum(['high', 'low', 'none']).describe('high = clear match with verse text. low = reference exists but text uncertain. none = no plausible verse found.'),
})

async function extractVerseFromSearch(args: {
    timeDisplay: string
    query: string
    util: any
}): Promise<z.infer<typeof ExtractionSchema>> {
    const { timeDisplay, query, util } = args

    let results: any[] = []
    try {
        const resp: any = await getBackend().tools.search({ query })
        results = Array.isArray(resp?.results) ? resp.results : []
    } catch (e: any) {
        util.log(`tools.search threw: ${e?.message || e}`)
        return { reference: '', verse_text: '', source_url: '', confidence: 'none' }
    }

    if (results.length === 0) {
        return { reference: '', verse_text: '', source_url: '', confidence: 'none' }
    }

    util.log(`tools.search returned ${results.length} results; first: "${(results[0]?.title || '').slice(0, 80)}" — ${(results[0]?.snippet || '').slice(0, 120)}`)

    const top = results.slice(0, 8).map((r: any, i: number) =>
        `[${i + 1}] ${r.title || ''}\n${r.url || ''}\n${r.snippet || ''}`
    ).join('\n\n')

    const systemMsg = `You extract a single Bible verse whose reference matches the time ${timeDisplay} (interpreted as chapter:verse). If you can identify a verse with both a reference and quoted text in the snippets, return confidence "high". If only a reference is identifiable, return "low". If nothing plausible appears, return "none". Never invent verse text — only return text quoted in the snippets.`

    const userMsg = `Time: ${timeDisplay}\n\nSearch results:\n\n${top}`

    try {
        return await util.run_structured_completion({
            schema: ExtractionSchema,
            schema_name: 'ScriptureExtraction',
            messages: [
                { role: 'system' as const, content: systemMsg },
                { role: 'user' as const, content: userMsg },
            ],
        })
    } catch (e: any) {
        util.log(`run_structured_completion threw: ${e?.message || e}`)
        return { reference: '', verse_text: '', source_url: '', confidence: 'none' }
    }
}

export function createScriptureModule() {
    return {
        id: 'scripture_functions',
        name: 'Scripture Functions',
        position: 47,
        system_msg: `## Scripture-of-the-moment reflection

When the user asks for a time-based scripture, a "scripture of the moment", a verse for the current time, or asks to reflect on a scripture in light of their logs, you MUST use the tools below. Do NOT recite a verse from memory — the user wants the verse tied to the current clock time, which only \`find_scripture_for_time\` can resolve. Quoting a verse without calling the tool is a failure mode.

Required recipe:

1. Call \`find_scripture_for_time({})\` (or pass an explicit \`time\` if the user named one). Returns \`{ time, reference, verse_text, source_url, confidence, fallback_used }\`.
2. Call \`search_logs_semantic({ text: verse_text, limit: 3 })\` to find the three log entries most resonant with the verse.
3. Present the verse (with its reference and source_url) and reflect on how it may relate to the matched logs — quote brief log fragments where useful.

If \`fallback_used\` is set or \`confidence\` is "low", mention to the user that no verse was found for that exact reference and that you are sharing a fallback. If \`confidence\` is "high", present the verse normally.`,
        functions: [
            {
                enabled: true,
                description: `Find a Bible verse whose chapter:verse reference matches a given time (defaults to the current time). Prefers wisdom books (Proverbs, Psalms). Always returns a verse — falls back to Proverbs 3:5 when no plausible match is surfaced. Returns { time, reference, verse_text, source_url, confidence, fallback_used }.`,
                name: 'find_scripture_for_time',
                return_shape: `{ time: string (H:MM), reference: string (e.g. "Proverbs 3:5"), verse_text: string, source_url: string, confidence: 'high' | 'medium' | 'low' | 'none', fallback_used: 'hardcoded' | null }. ALWAYS returns a verse — falls back to a hardcoded verse with confidence='none' if no match found.`,
                parameters: {
                    time: 'string (optional, format "H:MM"; defaults to current local time)',
                },
                fn: async (ops: any) => {
                    const { log, event } = ops.util
                    const { time } = ops.params

                    const { display: timeDisplay } = normalizeTime(time)
                    log(`find_scripture_for_time: ${timeDisplay}`)

                    const primaryQuery = `bible verse ${timeDisplay}`
                    let extracted = await extractVerseFromSearch({ timeDisplay, query: primaryQuery, util: ops.util })

                    if (extracted.confidence === 'none' || !extracted.verse_text) {
                        log(`Primary pass empty; retrying with book hint`)
                        const broadQuery = `bible scripture ${timeDisplay} Psalms Proverbs`
                        extracted = await extractVerseFromSearch({ timeDisplay, query: broadQuery, util: ops.util })
                    }

                    if (extracted.confidence === 'none' || !extracted.verse_text) {
                        log(`No verse surfaced for ${timeDisplay} — using hardcoded fallback`)
                        event({ type: 'scripture_for_time', data: { time: timeDisplay, fallback_used: 'hardcoded' } })
                        return {
                            time: timeDisplay,
                            reference: HARDCODED_FALLBACK.reference,
                            verse_text: HARDCODED_FALLBACK.verse_text,
                            source_url: HARDCODED_FALLBACK.source_url,
                            confidence: 'none',
                            fallback_used: 'hardcoded',
                        }
                    }

                    event({ type: 'scripture_for_time', data: { time: timeDisplay, reference: extracted.reference, confidence: extracted.confidence } })
                    return {
                        time: timeDisplay,
                        reference: extracted.reference,
                        verse_text: extracted.verse_text,
                        source_url: extracted.source_url,
                        confidence: extracted.confidence,
                        fallback_used: null,
                    }
                },
                return_type: 'object',
            },
        ],
    }
}
