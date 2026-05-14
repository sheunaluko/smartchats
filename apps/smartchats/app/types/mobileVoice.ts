export type MobileVoiceState =
  | 'idle'
  | 'ready'
  | 'loading'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'interrupted'
  | 'error';

export const voiceFeedbackVariants = [
  'orb',
  'orbit-dots',
  'inner-dots',
  'meter-dots',
] as const;

export type VoiceFeedbackVariant = (typeof voiceFeedbackVariants)[number];

export function isVoiceFeedbackVariant(value: string): value is VoiceFeedbackVariant {
  return voiceFeedbackVariants.includes(value as VoiceFeedbackVariant);
}

export const voiceFeedbackVariantOptions: { value: VoiceFeedbackVariant; label: string }[] = [
  { value: 'orb', label: 'Orb' },
  { value: 'orbit-dots', label: 'Orbit Dots' },
  { value: 'inner-dots', label: 'Inner Dots' },
  { value: 'meter-dots', label: 'Meter Dots' },
];

export type VoiceMomentKind =
  | 'result'
  | 'confirmation'
  | 'media'
  | 'action'
  | 'info';

export type VoiceMoment = {
  id: string;
  kind: VoiceMomentKind;
  title?: string;
  body?: string;
  meta?: string;
};

export type MobileVoiceViewModel = {
  state: MobileVoiceState;
  interimTranscript: string;
  finalTranscript: string;
  assistantText: string;
  moments: VoiceMoment[];
  canInterrupt: boolean;
  canType: boolean;
  isConnected?: boolean;
  level?: number;
};
