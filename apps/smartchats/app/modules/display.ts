/**
 * Display functions: display_code, display_html
 */

export function createDisplayModule() {
    return {
        id: 'display_functions',
        name: 'Display Functions',
        position: 50,
        functions: [
            {
                enabled: true,
                description: `Display code to the user. Supports: json, ts, js, python, html, css, markdown, sh, go, rust, swift.`,
                name: 'display_code',
                parameters: { code: 'string', language: 'string' },
                fn: async (ops: any) => {

                    let { event, log } = ops.util;

                    log(`got params:`); log(ops.params);

                    let { code, language } = ops.params;


                    let code_params = { code, mode: language }
                    event({ 'type': 'code_update', code_params });
                    return "done"
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Render interactive HTML in the display panel. Scripts can call store_in_workspace(data) (pass an object) and complete_html_interaction(result). Use CSS vars for theme (--sc-*). Do not hardcode light-only or dark-only colors. IMPORTANT: escape backticks in HTML strings as \\\` to avoid breaking the code block.`,
                name: 'display_html',
                parameters: { html: 'string' },
                fn: async (ops: any) => {
                    let { html } = ops.params;
                    let { event } = ops.util;
                    event({ 'type': 'html_update', html });
                    return "done"
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Dismiss active display content. Target: 'all' (default), 'viz', 'html', or 'code'.`,
                name: 'dismiss_display',
                parameters: { target: 'string' },
                fn: async (ops: any) => {
                    const target = ops.params.target || 'all';
                    const { event } = ops.util;
                    if (target === 'all' || target === 'viz') {
                        event({ type: 'clear_visualizations' });
                    }
                    if (target === 'all' || target === 'html') {
                        event({ type: 'clear_html' });
                    }
                    if (target === 'all' || target === 'code') {
                        event({ type: 'clear_code' });
                    }
                    return `Dismissed ${target} display content`;
                },
                return_type: 'string'
            },
        ],
    }
}
