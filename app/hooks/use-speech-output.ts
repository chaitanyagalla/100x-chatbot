"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "starting" | "speaking";

function playbackErrorMessage(code: string): string {
  if (code === "not-allowed") {
    return "Your browser blocked audio. Tap the green face to hear the answer.";
  }
  if (code === "voice-unavailable" || code === "language-unavailable" || code === "synthesis-unavailable") {
    return "A suitable speech voice is unavailable. You can still read the reply.";
  }
  if (code === "text-too-long") {
    return "This reply is too long for the browser to read aloud. The full text is still available.";
  }
  return "Audio could not play. Tap the green face to retry, or read the answer instead.";
}

// Higher is better. Browsers ship both old robotic voices and newer natural ones;
// the names are the only hint we get about which is which.
function voiceScore(voice: SpeechSynthesisVoice): number {
  let score = 0;
  if (/natural|neural|premium|enhanced/i.test(voice.name)) score += 8;
  if (/^Google (US|UK) English/i.test(voice.name)) score += 4;
  if (/aria|jenny|ava|samantha|allison|zira/i.test(voice.name)) score += 2;
  if (/^en[-_]US$/i.test(voice.lang)) score += 1;
  return score;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voices
    .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}

// Reading one sentence at a time gives natural pauses, and avoids some browsers
// cutting off a long reply part-way through.
function splitIntoSentences(text: string): string[] {
  const parts = text.match(/[\s\S]+?(?:[.!?]+(?=\s|$)|$)/g) ?? [text];
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function useSpeechOutput() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Checking spoken reply support…");
  const [error, setError] = useState<string | null>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  // The sentences of the reply being read. An empty list means nothing is playing.
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function releaseUtterances(cancel: boolean) {
    const utterances = utterancesRef.current;
    utterancesRef.current = [];
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (utterances.length === 0) return;

    for (const utterance of utterances) {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    if (cancel) {
      try { synthesisRef.current?.cancel(); } catch { /* Text remains usable if the audio engine fails. */ }
    }
  }

  useEffect(() => {
    if (window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function") {
      synthesisRef.current = window.speechSynthesis;
      // Some browsers load their voice list only after it is first requested.
      window.speechSynthesis.getVoices();
      setSupported(true);
      setStatus("New replies are read aloud.");
    } else {
      setSupported(false);
      setStatus("Spoken replies are unavailable in this browser. You can still read every reply.");
    }

    return () => {
      releaseUtterances(true);
      synthesisRef.current = null;
    };
  }, []);

  function stop() {
    const wasActive = utterancesRef.current.length > 0;
    releaseUtterances(true);
    setPhase("idle");
    setError(null);
    if (wasActive) setStatus("Audio stopped.");
  }

  function speak(text: string) {
    const synthesis = synthesisRef.current;
    if (!synthesis || !text.trim()) return;
    releaseUtterances(true);
    setError(null);

    try {
      const voice = pickVoice(synthesis.getVoices());
      const utterances = splitIntoSentences(text).map((sentence) => {
        const utterance = new window.SpeechSynthesisUtterance(sentence);
        utterance.lang = voice?.lang ?? "en-US";
        if (voice) utterance.voice = voice;
        // Slightly slower and quieter than the default sounds calmer.
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 0.9;
        return utterance;
      });
      utterancesRef.current = utterances;

      const isCurrent = () => utterancesRef.current === utterances;
      utterances[0].onstart = () => {
        if (!isCurrent()) return;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
        setPhase("speaking");
        setStatus("Reading an AI reply aloud…");
      };
      utterances[utterances.length - 1].onend = () => {
        if (!isCurrent()) return;
        releaseUtterances(false);
        setPhase("idle");
        setStatus("Finished reading.");
      };
      for (const utterance of utterances) {
        utterance.onerror = (event) => {
          if (!isCurrent()) return;
          releaseUtterances(true);
          setPhase("idle");
          if (event.error === "canceled" || event.error === "interrupted") {
            setStatus("Audio stopped.");
          } else {
            setStatus("The reply text is still available.");
            setError(playbackErrorMessage(event.error));
          }
        };
      }

      setPhase("starting");
      setStatus("Starting spoken reply…");
      timerRef.current = setTimeout(() => {
        if (!isCurrent()) return;
        releaseUtterances(true);
        setPhase("idle");
        setStatus("The reply text is still available.");
        setError("Audio did not start. Tap the green face to try again, or read the answer.");
      }, 10_000);
      if (synthesis.paused) synthesis.resume();
      // The browser queues these and reads them one after another.
      for (const utterance of utterances) synthesis.speak(utterance);
    } catch {
      releaseUtterances(true);
      setPhase("idle");
      setStatus("The reply text is still available.");
      setError("Audio could not start. Tap the green face to retry, or read the answer instead.");
    }
  }

  return { supported, phase, isActive: phase !== "idle", status, error, speak, stop };
}
