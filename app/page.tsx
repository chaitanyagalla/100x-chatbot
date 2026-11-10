"use client";

import { useState, type FormEvent } from "react";
import { getRecentHistory, MAX_QUESTION_LENGTH, type ChatMessage } from "../lib/chat.ts";
import { useSpeechInput } from "./hooks/use-speech-input.ts";
import { useSpeechOutput } from "./hooks/use-speech-output.ts";

// One hand-drawn style face. The two dashed rings are the "lines" that appear
// around the face while it is listening, thinking, or answering.
function Face() {
  return (
    <svg className="face-art" viewBox="0 0 200 200" aria-hidden="true">
      <g className="face-lines">
        <circle cx="100" cy="100" r="80" pathLength={400} strokeDasharray="30 70" strokeDashoffset={-35} />
        <circle cx="100" cy="100" r="94" pathLength={400} strokeDasharray="18 82" strokeDashoffset={-41} />
      </g>
      <circle cx="100" cy="100" r="62" />
      <path d="M74 90h16M110 90h16" />
      <path d="M76 114q24 20 48 0" />
    </svg>
  );
}

export default function Home() {
  const [draft, setDraft] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [lastAnswer, setLastAnswer] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playback = useSpeechOutput();

  // Spoken questions are sent straight to the AI when the interviewer taps to stop.
  const voice = useSpeechInput((text) => {
    if (text.length > MAX_QUESTION_LENGTH) {
      setError("That question was longer than 2,000 characters. Please ask a shorter one.");
      return false;
    }
    void ask(text);
    return true;
  });

  async function ask(question: string) {
    playback.stop();
    setLastQuestion(question);
    setLastAnswer("");
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = await response.json() as { answer?: unknown; error?: unknown } | null;

      if (!response.ok) {
        setError(typeof data?.error === "string" ? data.error : "Your question could not be answered. Please try again.");
        setDraft(question);
        return;
      }
      if (typeof data?.answer !== "string" || !data.answer.trim()) {
        setError("The chat service returned an unexpected reply. Please try again.");
        setDraft(question);
        return;
      }

      const answer = data.answer;
      setLastAnswer(answer);
      setHistory((previous) => getRecentHistory([
        ...previous,
        { role: "user", content: question },
        { role: "assistant", content: answer },
      ]));
      playback.speak(answer);
    } catch {
      setError("The request failed or timed out. Please check your connection and try again.");
      setDraft(question);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || question.length > MAX_QUESTION_LENGTH || isSending || voice.isActive) return;
    void ask(question);
  }

  const aiState = isSending ? "thinking" : playback.isActive ? "speaking" : "idle";
  const aiStatus = isSending ? "Thinking about your question…"
    : playback.isActive ? "Answering… tap to stop the audio."
    : playback.supported === false ? "Spoken replies are unavailable in this browser. Read the answer below."
    : lastAnswer ? "Tap to hear the answer again."
    : "I will answer here once you ask.";

  return (
    <main className="stage-shell">
      <h1 className="eyebrow">Chaitanya · AI voice bot</h1>

      <section className="stage" aria-label="Voice conversation">
        <div className="side">
          <button
            className="face face-ai"
            type="button"
            data-state={aiState}
            aria-label={playback.isActive ? "Stop the spoken answer" : "Replay the last answer"}
            aria-describedby="ai-status"
            disabled={!playback.isActive && (!lastAnswer || playback.supported !== true || isSending || voice.isActive)}
            onClick={() => {
              if (playback.isActive) playback.stop();
              else playback.speak(lastAnswer);
            }}
          >
            <Face />
          </button>
          <p className="side-name">Chaitanya (AI)</p>
          <p id="ai-status" className="side-status" role="status">{aiStatus}</p>
        </div>

        <div className="side">
          <button
            className="face face-user"
            type="button"
            data-state={voice.phase}
            aria-label={voice.isActive ? "Stop listening and send my question" : "Start speaking a question"}
            aria-pressed={voice.isActive}
            aria-describedby="voice-status"
            disabled={voice.supported !== true || isSending || voice.phase === "stopping"}
            onClick={() => {
              if (voice.isActive) voice.stopListening();
              else {
                playback.stop();
                setError(null);
                voice.startListening();
              }
            }}
          >
            <Face />
          </button>
          <p className="side-name">You</p>
          <p id="voice-status" className="side-status" role="status">{voice.status}</p>
        </div>
      </section>

      <section className="transcript" aria-label="Latest question and answer" aria-live="polite">
        {!lastQuestion && <p className="transcript-empty">Your question and the answer will appear here.</p>}
        {lastQuestion && <p><span className="who who-user">You</span>{lastQuestion}</p>}
        {lastAnswer && <p><span className="who who-ai">Chaitanya</span>{lastAnswer}</p>}
      </section>

      {voice.error && <p className="notice" role="alert">{voice.error}</p>}
      {playback.error && <p className="notice" role="alert">{playback.error}</p>}
      {error && <p className="notice" role="alert">{error}</p>}

      <form className="type-row" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="question">Type a question instead</label>
        <input
          id="question"
          name="question"
          type="text"
          placeholder="Or type a question…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_QUESTION_LENGTH}
          disabled={isSending}
        />
        <button className="send-button" type="submit" disabled={!draft.trim() || isSending || voice.isActive}>
          Send
        </button>
      </form>
    </main>
  );
}
