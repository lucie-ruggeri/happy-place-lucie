import { useRef, useState } from "react";
import { logDictationEvent, transcribeWithWhisper, whisperErrorMessage } from "@/lib/whisper";

const MAX_SECONDS = 60;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(((reader.result as string) ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Orchestration MediaRecorder pour la dictée Whisper (optionnelle, derrière
 * le réglage admin dictation_engine). Logique imperative, non testée
 * unitairement (comme l'orchestration Web Speech de D80) ; les décisions
 * pures qu'elle utilise (message d'erreur, garde-fou de taille) vivent dans
 * src/lib/whisper.ts et sont testées là.
 */
export function useWhisperDictation() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(MAX_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [canFallback, setCanFallback] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeRef = useRef(0);
  const lastAttemptRef = useRef({ durationMs: 0, audioSeconds: 0 });

  function clearCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stop() {
    clearCountdown();
    stopTimeRef.current = Date.now();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  async function finish() {
    cleanupStream();
    setTranscribing(true);
    const audioSeconds = Math.min(MAX_SECONDS, Math.max(1, Math.round((Date.now() - stopTimeRef.current) / 1000) || 1));
    try {
      const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || "audio/webm" });
      const audio_base64 = await blobToBase64(blob);
      const outcome = await transcribeWithWhisper({
        audio_base64,
        mime_type: blob.type || "audio/webm",
        audio_seconds: audioSeconds,
      });
      const durationMs = Date.now() - stopTimeRef.current;
      lastAttemptRef.current = { durationMs, audioSeconds };

      if (outcome.ok) {
        void logDictationEvent({ event_type: "dictation_ok", engine: "whisper", duration_ms: durationMs, audio_seconds: audioSeconds });
        return outcome.text;
      }
      setError(whisperErrorMessage(outcome.code));
      setCanFallback(true);
      void logDictationEvent({ event_type: "dictation_failed", engine: "whisper", duration_ms: durationMs, audio_seconds: audioSeconds });
      return null;
    } finally {
      setTranscribing(false);
    }
  }

  const finishRef = useRef(finish);
  finishRef.current = finish;

  async function start(): Promise<string | null> {
    setError(null);
    setCanFallback(false);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Enregistrement audio indisponible sur ce navigateur.");
      setCanFallback(true);
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      const resultPromise = new Promise<string | null>((resolve) => {
        recorder.onstop = () => {
          void finishRef.current().then(resolve);
        };
      });
      recorder.start();
      setRecording(true);
      setRemainingSeconds(MAX_SECONDS);
      countdownRef.current = setInterval(() => {
        setRemainingSeconds((s) => {
          if (s <= 1) {
            stop();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return resultPromise;
    } catch {
      setError("Micro refusé : autorise l'accès au micro ou utilise la dictée intégrée.");
      setCanFallback(true);
      return null;
    }
  }

  /** L'auteur utilise effectivement le repli D80 après un échec Whisper. */
  function reportFallback() {
    const { durationMs, audioSeconds } = lastAttemptRef.current;
    void logDictationEvent({ event_type: "dictation_fallback", engine: "whisper", duration_ms: durationMs, audio_seconds: audioSeconds });
  }

  return { recording, transcribing, remainingSeconds, error, canFallback, start, stop, reportFallback };
}
