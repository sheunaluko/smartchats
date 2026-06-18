/**
 * Clean WebSpeech API wrapper for speech recognition
 */

export interface SpeechRecognitionConfig {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  verbose?: boolean;
  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  /** Structured variant of onError — fires with the raw event.error code
   *  ('network', 'not-allowed', 'service-not-allowed', etc.) so consumers
   *  can emit a typed insights event without parsing the wrapped message.
   *  Fires alongside onError for non-expected errors. */
  onErrorDetail?: (info: { code: string; message: string }) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export class SpeechRecognitionManager {
  private recognition: any = null;
  private isActive: boolean = false;
  private config: SpeechRecognitionConfig;

  // Preroll: an optional MediaStreamTrack (typically a DelayNode-fed
  // MediaStreamAudioDestinationNode track) handed to start(audioTrack) so the
  // recognizer hears the audio that preceded the start trigger. Owned here so
  // every start path (power trigger, VAD, continuous restart, language change)
  // uses it uniformly. start(audioTrack) is Chrome 135+; on engines without it
  // we transparently fall back to the bare microphone.
  private prerollTrack: MediaStreamTrack | null = null;
  private prerollDisabled: boolean = false;   // set after a failed track-start; sticks for the session
  private usingAudioTrack: boolean = false;    // whether the live session was started on the track
  private audioTrackConfirmed: boolean = false; // track has produced a result → known-good
  private stopped: boolean = false;             // set by stop(); blocks the deferred auto-restart

  constructor(config: SpeechRecognitionConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    // Check browser support
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error('SpeechRecognition not supported in this browser');
    }

    this.recognition = new SpeechRecognition();

    // Configure
    this.recognition.continuous = this.config.continuous ?? true;
    this.recognition.interimResults = this.config.interimResults ?? true;
    this.recognition.lang = this.config.language || 'en-US';
    this.recognition.maxAlternatives = this.config.maxAlternatives || 1;

    // Set up event handlers
    this.recognition.onresult = (event: any) => this.handleResult(event);
    this.recognition.onerror = (event: any) => this.handleError(event);
    this.recognition.onstart = () => this.handleStart();
    this.recognition.onend = () => this.handleEnd();
  }

  private handleResult(event: any): void {
    // Any result proves the preroll track is being recognized correctly.
    if (this.usingAudioTrack) this.audioTrackConfirmed = true;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      const isFinal = result.isFinal;

      this.config.onResult?.(transcript, isFinal);
    }
  }

  private handleError(event: any): void {
    // A preroll-track start the engine can't honour typically surfaces as
    // 'audio-capture'. If that happens on a track that has never produced a
    // result, disable preroll for the session and retry on the bare microphone
    // so recognition still works (degrading to pre-preroll behaviour) instead
    // of being silently swallowed by the expected-error path below.
    if (event.error === 'audio-capture' && this.usingAudioTrack && !this.audioTrackConfirmed) {
      if (this.config.verbose) {
        console.debug('[SpeechRecognition] audio-capture on preroll track — disabling preroll, retrying on mic');
      }
      this.prerollDisabled = true;
      this.usingAudioTrack = false;
      this.isActive = false;
      // Defer so the current session finishes tearing down before we restart.
      // Bail if stop() ran in the meantime (user stopped / unmounted) or another
      // path already restarted — otherwise we'd resurrect recognition after stop.
      setTimeout(() => {
        if (this.stopped || this.isActive) return;
        try { this.start(); } catch { /* next trigger will restart */ }
      }, 0);
      return;
    }

    // Expected errors that should be handled silently
    const expectedErrors = ['no-speech', 'audio-capture', 'aborted'];

    if (expectedErrors.includes(event.error)) {
      // Log for debugging if verbose mode enabled
      if (this.config.verbose) {
        console.debug(`[SpeechRecognition] Expected error: ${event.error} (auto-recovering)`);
      }
      // These are recoverable - recognition will restart via onend
      // Don't surface as errors to the user
      return;
    }

    // Only report actual errors
    const error = new Error(`Speech recognition error: ${event.error}`);
    this.config.onError?.(error);
    this.config.onErrorDetail?.({ code: event.error, message: error.message });
  }

  private handleStart(): void {
    this.isActive = true;
    this.config.onStart?.();
  }

  private handleEnd(): void {
    this.isActive = false;
    this.config.onEnd?.();
    // No auto-restart - let VAD control when to start
  }

  /**
   * Set (or clear with null) the preroll MediaStreamTrack used by subsequent
   * start() calls. Resets the per-session fallback/confirmation state.
   */
  setPrerollTrack(track: MediaStreamTrack | null): void {
    this.prerollTrack = track;
    this.prerollDisabled = false;
    this.audioTrackConfirmed = false;
  }

  start(): void {
    if (this.isActive) return;
    this.stopped = false;

    // Use the preroll track if we have a live one and haven't disabled it after
    // a prior failure. Older engines ignore the extra argument (→ bare mic), so
    // passing it is safe; ones that throw are caught and retried bare below.
    const track =
      this.prerollTrack && !this.prerollDisabled && this.prerollTrack.readyState === 'live'
        ? this.prerollTrack
        : null;

    if (track) {
      this.usingAudioTrack = true;
      try {
        this.recognition.start(track);
        return;
      } catch (error: any) {
        if (error?.name === 'InvalidStateError') return; // already started
        // Track overload rejected synchronously — disable preroll and fall
        // through to a bare-mic start so recognition still works.
        this.prerollDisabled = true;
        this.usingAudioTrack = false;
        if (this.config.verbose) {
          console.debug('[SpeechRecognition] start(audioTrack) threw, falling back to mic', error);
        }
      }
    } else {
      this.usingAudioTrack = false;
    }

    try {
      this.recognition.start();
    } catch (error: any) {
      // Ignore if already started
      if (error.name !== 'InvalidStateError') {
        this.config.onError?.(error as Error);
      }
    }
  }

  stop(): void {
    // Mark stopped so any deferred preroll-fallback retry becomes a no-op,
    // even if recognition wasn't active at the moment of the call.
    this.stopped = true;
    if (this.recognition && this.isActive) {
      this.recognition.stop();
    }
  }

  pause(): void {
    if (this.recognition && this.isActive) {
      this.recognition.abort();
    }
  }

  isRunning(): boolean {
    return this.isActive;
  }

  updateLanguage(language: string): void {
    const wasActive = this.isActive;
    if (wasActive) this.stop();

    this.config.language = language;
    this.recognition.lang = language;

    if (wasActive) this.start();
  }
}
