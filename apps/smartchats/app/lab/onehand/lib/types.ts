export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export type ArcName = 'inner' | 'middle' | 'outer' | 'thumb';

export type GestureType = 'tap' | 'swipe_up' | 'long_press';

export type LayerName = 'base' | 'numbers' | 'symbols';

export type KeyKind = 'letter' | 'command';

export interface KeyDef {
    id: string;
    finger: FingerName;
    arc: ArcName;
    kind: KeyKind;
    primary: string;
    x: number;
    y: number;
    r: number;
}

export interface TapEvent {
    seq: number;
    session_seq: number;
    t_rel_ms: number;
    finger: FingerName;
    arc: ArcName;
    keyId: string;
    intended_key: string;
    resolved_key: string;
    committed_char: string;
    gesture: GestureType;
    tap_x_norm: number;
    tap_y_norm: number;
    key_center_x_norm: number;
    key_center_y_norm: number;
    dwell_ms: number;
    inter_ms: number;
    is_backspace: boolean;
    layer: LayerName;
}

// Portrait iPad orientation — viewBox tall, palm rests in the lower
// portion of the screen, fingers fan upward.
export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 1600;
