import { getBackend } from "@/lib/backend"

export function createWebSearchModule() {
    return {
        id: 'search_functions',
        name: 'Search Functions',
        position: 45,
        functions: [
            {
                enabled: true,
                description: 'Searches the web via Google. Returns organic results, knowledge graph, and answer box when available. Use when the user asks about current events, facts you are unsure about, or anything that benefits from up-to-date web information.',
                name: 'web_search',
                parameters: { query: 'string' },
                fn: async (ops: any) => {
                    const { query } = ops.params
                    const { log, event } = ops.util
                    log(`Web search: "${query}"`)
                    const { results, billing } = await getBackend().tools.search({ query })
                    if (billing && typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('smartchats:billing_update', { detail: billing })
                        )
                    }
                    event({ type: 'web_search', data: { query, result_count: results.length } })
                    return results
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Fetches a web page and extracts its readable text content. Use after web_search to read the full content of a relevant URL. Returns the page title and extracted text.',
                name: 'get_text_from_url',
                parameters: { url: 'string', max_chars: 'number (optional, default ~7500)' },
                fn: async (ops: any) => {
                    const { url, max_chars } = ops.params
                    const { log, event } = ops.util
                    log(`Fetching text from: "${url}"`)
                    const { text, title, billing } = await getBackend().tools.fetchUrl({
                        url,
                        ...(typeof max_chars === 'number' && { maxChars: max_chars }),
                    })
                    if (billing && typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('smartchats:billing_update', { detail: billing })
                        )
                    }
                    event({ type: 'get_text_from_url', data: { url, text_length: text.length } })
                    return { title, text }
                },
                return_type: 'object',
            }
        ],
    }
}
