import { useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * Voice messages (2.3): recorded on the device, sent as an encrypted audio
 * attachment like any file (the server sees only ciphertext), and played with
 * a compact player with playback speed.
 */

/** Attachments named like this are voice messages. */
export const VOICE_PREFIX = 'voice-message';
const MAX_SECONDS = 15 * 60;
const SPEEDS = [1, 1.5, 2] as const;

export function isVoiceMessage(name: string, mime: string): boolean {
  return name.startsWith(VOICE_PREFIX) && mime.startsWith('audio/');
}

/** The best recording format this device supports, and the file type to send it as. */
function recordingFormat(): { mime: string; type: string; ext: string } | null {
  const R = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!R) return null;
  const options = [
    { mime: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', type: 'audio/ogg', ext: 'ogg' },
    { mime: 'audio/webm', type: 'audio/webm', ext: 'webm' },
  ];
  return options.find((o) => R.isTypeSupported?.(o.mime)) ?? null;
}

export function canRecordVoice(): boolean {
  return recordingFormat() !== null && !!navigator.mediaDevices?.getUserMedia;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The mic button; while recording, a bar with the timer, cancel and send. */
export function VoiceRecorder(props: {
  onRecorded(file: File): void;
  disabled?: boolean;
}): ReactElement | null {
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const keep = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if ((Date.now() - recording.startedAt) / 1000 >= MAX_SECONDS) stop(true);
    }, 250);
    return () => window.clearInterval(t);
  }, [recording]);

  useEffect(() => () => stop(false), []);

  if (!canRecordVoice()) return null;

  async function start(): Promise<void> {
    setError(null);
    const format = recordingFormat();
    if (!format) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError('River needs your microphone to record. Allow it in your system settings.');
      return;
    }
    const r = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 32_000 });
    chunks.current = [];
    keep.current = false;
    const startedAt = Date.now();
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    r.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      recorder.current = null;
      setRecording(null);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (!keep.current || seconds < 1 || !chunks.current.length) return;
      const blob = new Blob(chunks.current, { type: format.type });
      props.onRecorded(new File([blob], `${VOICE_PREFIX}-${seconds}s.${format.ext}`, { type: format.type }));
    };
    r.start(1000);
    recorder.current = r;
    setNow(startedAt);
    setRecording({ startedAt });
  }

  function stop(send: boolean): void {
    keep.current = send;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }

  if (recording) {
    return (
      <div className="voice-rec" role="status" aria-live="polite">
        <span className="voice-rec__dot" aria-hidden="true" />
        <span className="voice-rec__time">{formatDuration((now - recording.startedAt) / 1000)}</span>
        <span className="muted small voice-rec__hint">Recording</span>
        <button type="button" className="icon-btn" aria-label="Cancel recording" onClick={() => stop(false)}>
          ✕
        </button>
        <button
          type="button"
          className="voice-rec__send"
          aria-label="Send voice message"
          onClick={() => stop(true)}
        >
          ➤
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="icon-btn composer__mic"
        aria-label="Record a voice message"
        title={error ?? 'Record a voice message'}
        disabled={props.disabled}
        onClick={() => void start()}
      >
        🎤
      </button>
      {error && (
        <span className="field__error small" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** A voice message: play/pause, a seekable progress bar, duration and playback speed. */
export function VoiceNote(props: { url: string; name: string }): ReactElement {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(() => {
    const m = /-(\d+)s\./.exec(props.name);
    return m ? Number(m[1]) : 0;
  });
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const progress = duration ? Math.min(1, time / duration) : 0;
  return (
    <div className="voice-note">
      <button
        type="button"
        className="voice-note__play"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play().catch(() => undefined);
          else el.pause();
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        className="voice-note__bar"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        aria-label="Position"
        aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
        style={{ ['--progress' as string]: `${progress * 100}%` }}
        onChange={(e) => {
          const el = audio.current;
          if (el && duration) el.currentTime = (Number(e.target.value) / 1000) * duration;
        }}
      />
      <span className="voice-note__time muted small">
        {formatDuration(playing || time ? time : duration)}
      </span>
      <button
        type="button"
        className="voice-note__speed"
        aria-label={`Playback speed ${speed}×`}
        title="Playback speed"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          setSpeed(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
      >
        {speed}×
      </button>
      <audio
        ref={audio}
        src={props.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          e.currentTarget.playbackRate = speed;
        }}
      />
    </div>
  );
}
