import { buildQuestionPrompt, buildSystemPrompt } from "../../../lib/candidate-profile.ts";
import { isValidHistory, MAX_ANSWER_LENGTH, MAX_BODY_BYTES, MAX_QUESTION_LENGTH } from "../../../lib/chat.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const REQUESTS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

// A small, shared budget for this server process. It resets on restart.
let windowStartedAt = Date.now();
let requestsInWindow = 0;

function errorResponse(error: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error }, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;

      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }

      text += decoder.decode(value, { stream: true });
    }

    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse("Please send your question as JSON.", 415);
  }

  let body: unknown;
  try {
    body = await readBody(request);
  } catch (error) {
    return error instanceof RangeError
      ? errorResponse("That request is too large. Please shorten your question.", 413)
      : errorResponse("That request could not be read. Please try again.", 400);
  }

  if (typeof body !== "object" || body === null || !("question" in body) || typeof body.question !== "string") {
    return errorResponse("Please enter a question.", 400);
  }

  const question = body.question.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return errorResponse("Please enter a question between 1 and 2,000 characters.", 400);
  }

  const history = "history" in body ? body.history : [];
  if (!isValidHistory(history)) {
    return errorResponse("The conversation context is invalid or too long. Please refresh the page and try again.", 400);
  }

  // This value is read only on the server and never returned to the browser.
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse("AI replies are not configured yet. Please contact the site owner.", 503);
  }

  const now = Date.now();
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    requestsInWindow = 0;
  }

  if (requestsInWindow >= REQUESTS_PER_MINUTE) {
    const retryAfter = Math.max(1, Math.ceil((windowStartedAt + WINDOW_MS - now) / 1000));
    return errorResponse("Too many questions right now. Please wait a minute and try again.", 429, {
      "Retry-After": String(retryAfter),
    });
  }
  requestsInWindow += 1;

  const timeout = AbortSignal.timeout(30_000);

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          ...history.map((message) => ({ role: message.role, content: message.content.trim() })),
          { role: "user", content: buildQuestionPrompt(question) },
        ],
        max_tokens: 512,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      cache: "no-store",
      signal: AbortSignal.any([timeout, request.signal]),
    });

    if (response.status !== 200) {
      await response.body?.cancel();
      if (response.status === 429) {
        return errorResponse("The AI service is busy. Please try again in a minute.", 503);
      }
      if (response.status === 401 || response.status === 403) {
        return errorResponse("AI access is not configured correctly. Please contact the site owner.", 503);
      }
      if (response.status === 404 || response.status === 410) {
        return errorResponse("The configured AI model is unavailable. Please contact the site owner.", 503);
      }
      return errorResponse("The AI service could not answer right now. Please try again.", 502);
    }

    const data = await response.json() as { choices?: { message?: { content?: unknown } }[] } | null;
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim() || answer.length > MAX_ANSWER_LENGTH) {
      return errorResponse("The AI service returned an unexpected answer. Please try again.", 502);
    }

    return Response.json({ answer: answer.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return timeout.aborted
      ? errorResponse("The AI took too long to respond. Please try again.", 504)
      : errorResponse("The AI service could not be reached. Please try again.", 502);
  }
}
