/**
 * ICD-10-CM Lookup Module — thin client-side wrapper over the NIH
 * Clinical Table Search Service. Zero-key, no infra.
 *
 * Two tools:
 *   - icd10_search(query, limit?)   — description → candidate codes (primary)
 *   - icd10_lookup(code)             — code → description (validation)
 *
 * Primary use case: consulting workflow where the user names a clinical
 * finding in unstructured terms ("type 2 diabetes with kidney disease",
 * "fall on same level"), and needs the LLM to surface candidate codes
 * ranked by relevance so the most specific applicable code can be picked.
 *
 * API docs: https://clinicaltables.nlm.nih.gov/apidoc/icd10cm/v3/doc.html
 * The `sf=code,name` param is critical — default search targets code only,
 * which silently returns 0 results for description-based queries.
 */

const NIH_ICD10_URL = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';

interface Icd10Result {
    code: string;
    description: string;
}

async function nihSearch(params: Record<string, string>): Promise<{ total: number; results: Icd10Result[] }> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${NIH_ICD10_URL}?${qs}`);
    if (!res.ok) {
        throw new Error(`NIH ICD-10 API error ${res.status}: ${await res.text().catch(() => '')}`);
    }
    // NIH response shape: [totalCount, codes[], extraDataObj|null, displayFields[][]]
    // With df=code,name → displayFields[i] = [code, name]
    const [total, , , displayRows] = await res.json() as [number, string[], unknown, string[][]];
    const results: Icd10Result[] = (displayRows ?? []).map(row => ({
        code: row[0] ?? '',
        description: row[1] ?? '',
    }));
    return { total, results };
}

export function createIcd10Module() {
    return {
        id: 'icd10',
        name: 'ICD-10 Lookup',
        position: 60,

        system_msg: `You have access to ICD-10-CM (Clinical Modification) diagnosis code lookup via the NIH Clinical Table Search Service.

Primary workflow — DESCRIPTION → CODE:
When the user describes a clinical finding in unstructured language ("type 2 diabetes with kidney disease", "fall on same level from a chair", "essential hypertension"), call icd10_search with the clinical terminology. The API returns candidate codes ranked by relevance; you then pick the MOST SPECIFIC applicable code from the returned candidates and present it to the user.

Search tips:
- Multi-word queries work well ("essential hypertension", "type 2 diabetes kidney", "fall same level").
- Include distinguishing details for specificity: laterality (left/right), acuity (acute/chronic), episode of care (initial/subsequent/sequela — often encoded as ,XA / ,XD / ,XS suffixes).
- If the first search is too broad, refine with more specific terms and re-search.
- If a candidate list has unspecified codes (ending in "unspecified" or containing "other"), prefer more specific siblings when the clinical context supports it.

Validation workflow — CODE → DESCRIPTION:
When the user provides a code and asks what it means, or when you want to verify a code you just proposed, call icd10_lookup with the code. Returns the official description or indicates the code doesn't exist.

Style: when presenting results to the user, format as \`CODE — description\`. If multiple candidates are equally applicable, present the top 3-5 with a brief note on how they differ so the user can pick.`,

        functions: [
            {
                enabled: true,
                description: 'Search ICD-10-CM diagnosis codes by clinical description. Handles multi-word natural-language queries — searches both code and name fields. Returns candidates ranked by relevance for the LLM to filter and pick the most specific applicable code. Default limit 20 to give a broad candidate set; bump for very general searches, lower for narrow ones.',
                name: 'icd10_search',
                return_shape: `Success: { query, total, results: [{ code, description }] }. Total is the count of all matching codes; results is capped at limit. Empty results: total=0, results=[]. Error: { error: string }.`,
                parameters: { query: 'string', limit: 'number' },
                fn: async (ops: any) => {
                    const { query, limit } = ops.params;
                    const { log } = ops.util;
                    if (!query || typeof query !== 'string' || query.trim() === '') {
                        return { error: 'query is required (non-empty string)' };
                    }
                    const maxList = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 20;
                    try {
                        log(`icd10_search: "${query.slice(0, 80)}" (limit ${maxList})`);
                        const { total, results } = await nihSearch({
                            terms: query,
                            sf: 'code,name',
                            df: 'code,name',
                            maxList: String(maxList),
                        });
                        return { query, total, results };
                    } catch (err) {
                        return { error: (err as Error).message };
                    }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Look up a specific ICD-10-CM code by exact code. Use to verify a code proposed from search results, or when the user provides a code and asks what it means. Returns the official description, or indicates the code was not found.',
                name: 'icd10_lookup',
                return_shape: `Found: { code, description, exists: true }. Not found: { code, exists: false }. Error: { error: string }.`,
                parameters: { code: 'string' },
                fn: async (ops: any) => {
                    const { code } = ops.params;
                    const { log } = ops.util;
                    if (!code || typeof code !== 'string' || code.trim() === '') {
                        return { error: 'code is required (non-empty string)' };
                    }
                    const normalized = code.trim().toUpperCase();
                    try {
                        log(`icd10_lookup: ${normalized}`);
                        const { results } = await nihSearch({
                            terms: normalized,
                            sf: 'code',
                            df: 'code,name',
                            maxList: '5',
                        });
                        // Match exact (case-insensitive) since the API is prefix-search on code
                        const exact = results.find(r => r.code.toUpperCase() === normalized);
                        if (exact) return { code: exact.code, description: exact.description, exists: true };
                        return { code: normalized, exists: false };
                    } catch (err) {
                        return { error: (err as Error).message };
                    }
                },
                return_type: 'object',
            },
        ],
    };
}
