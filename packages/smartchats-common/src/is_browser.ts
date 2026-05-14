export function is_browser(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}
