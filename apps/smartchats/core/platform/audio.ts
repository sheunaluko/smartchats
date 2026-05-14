/**
 * Platform-agnostic audio interface.
 *
 * Web implementation uses MediaRecorder / Web Audio API.
 * Native implementation (future) would use platform-specific APIs.
 */

export type AudioCapabilities = {
  recording: boolean;
  playback: boolean;
  backgroundSafe: boolean;
};

export interface SmartChatsAudio {
  startRecording(): Promise<void>;
  stopRecording(): Promise<Blob | ArrayBuffer | null>;
  playAudio(source: string | ArrayBuffer): Promise<void>;
  stopPlayback(): Promise<void>;
  getCapabilities(): AudioCapabilities;
}
