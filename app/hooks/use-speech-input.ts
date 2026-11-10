"use client";

import { useEffect, useRef, useState } from "react";

// Only the browser API members used by this feature are described here.
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechResultEvent = { results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onnomatch: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};
type Phase = "idle" | "starting" | "listening" | "stopping";

function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech access was denied. You can allow access in your browser or keep typing.";
    case "audio-capture":
      return "No working microphone was found. Check your microphone or type your question.";
    case "no-speech":
      return "No speech was heard. Try again or type your question.";
    case "network":
      return "The speech service could not be reached. Check your connection or keep typing.";
    case "language-not-supported":
      return "English speech recognition is unavailable in this browser. Please type your question.";
    case "aborted":
      return "Listening was cancelled. You can try again or keep typing.";
    default:
      return "Voice input could not finish. Try again or type your question.";
  }
}

export function useSpeechInput(onTranscript: (text: string) => boolean) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Checking voice input support…");
  const [error, setError] = useState<string | null>(null);
  const constructorRef = useRef<RecognitionConstructor | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptCallback = useRef(onTranscript);
  // Everything recognized so far in the current session. It is delivered when the session ends.
  const heardRef = useRef("");

  useEffect(() => {
    transcriptCallback.current = onTranscript;
  }, [onTranscript]);

  // Ends the session and hands over whatever was heard.
  function finishListening() {
    const text = heardRef.current;
    heardRef.current = "";
    releaseRecognition(true);
    setPhase("idle");
    if (!text) {
      setStatus("No speech was captured. Tap the face to try again, or type your question.");
      return;
    }
    const sent = transcriptCallback.current(text);
    setStatus(sent
      ? "Question sent. Tap the face to ask another."
      : "The question was not sent. Tap the face and try a shorter one.");
  }

  function releaseRecognition(abort: boolean) {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!recognition) return;

    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onnomatch = null;
    if (abort) {
      try { recognition.abort(); } catch { /* It may already have ended. */ }
    }
  }

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    const constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!window.isSecureContext) {
      setSupported(false);
      setStatus("Voice input needs HTTPS or localhost. You can still type your question.");
    } else if (!constructor) {
      setSupported(false);
      setStatus("Voice input is unavailable in this browser. You can still type your question.");
    } else {
      constructorRef.current = constructor;
      setSupported(true);
      setStatus("Tap the face, ask your question, then tap again to send it.");
    }

    return () => releaseRecognition(true);
  }, []);

  function startListening() {
    const Constructor = constructorRef.current;
    if (!Constructor || recognitionRef.current) return;
    setError(null);
    heardRef.current = "";

    try {
      const recognition = new Constructor();
      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      // Keep listening through pauses; the interviewer taps again to finish.
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      const isCurrent = () => recognitionRef.current === recognition;
      recognition.onstart = () => {
        if (!isCurrent()) return;
        setPhase("listening");
        setStatus("Listening… tap again when you have finished speaking.");
      };
      recognition.onresult = (event) => {
        if (!isCurrent()) return;
        // The browser reports every result of the session each time, so this replaces the stored text.
        heardRef.current = Array.from(event.results)
          .filter((result) => result.isFinal)
          .map((result) => result[0].transcript.trim())
          .filter(Boolean)
          .join(" ");
      };
      recognition.onerror = (event) => {
        if (!isCurrent()) return;
        releaseRecognition(true);
        setPhase("idle");
        setStatus("You can keep typing or try the microphone again.");
        setError(speechErrorMessage(event.error));
      };
      recognition.onend = () => {
        if (!isCurrent()) return;
        finishListening();
      };
      recognition.onnomatch = () => {
        if (!isCurrent()) return;
        releaseRecognition(true);
        setPhase("idle");
        setError("The words were not clear enough. Try again or type your question.");
        setStatus("You can keep typing or try the microphone again.");
      };

      setPhase("starting");
      setStatus("Starting microphone… Allow access if your browser asks.");
      timerRef.current = setTimeout(() => {
        if (!isCurrent()) return;
        if (heardRef.current) {
          finishListening();
          return;
        }
        releaseRecognition(true);
        setPhase("idle");
        setStatus("The microphone session ended. You can keep typing.");
        setError("Voice input timed out. Try a shorter question or type it instead.");
      }, 60_000);
      recognition.start();
    } catch (cause) {
      releaseRecognition(true);
      setPhase("idle");
      setStatus("You can keep typing or try the microphone again.");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? speechErrorMessage("not-allowed")
        : "The microphone could not start. Please try again or type your question.");
    }
  }

  function stopListening() {
    const recognition = recognitionRef.current;
    if (!recognition || phase === "stopping") return;
    if (phase !== "listening") {
      releaseRecognition(true);
      setPhase("idle");
      setStatus("Microphone cancelled. You can keep typing.");
      return;
    }

    try {
      setPhase("stopping");
      setStatus("Finishing… your question is about to be sent.");
      recognition.stop();
    } catch {
      releaseRecognition(true);
      setPhase("idle");
      setStatus("You can keep typing or try the microphone again.");
      setError("The microphone could not finish. Please type your question or try again.");
    }
  }

  return { supported, phase, isActive: phase !== "idle", status, error, startListening, stopListening };
}
