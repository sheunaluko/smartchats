import { HandMap } from './types';

const STORAGE_KEY = 'lab_handmap_v1';

export function loadHandMap(): HandMap | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && parsed.fingers) return parsed as HandMap;
        return null;
    } catch {
        return null;
    }
}

export function saveHandMap(map: HandMap): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (err) {
        console.warn('[handmap] saveHandMap failed:', err);
    }
}

export function clearHandMap(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
}
