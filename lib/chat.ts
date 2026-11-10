export type ChatMessage = { role: "user" | "assistant"; content: string };

export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ANSWER_LENGTH = 16_000;
export const MAX_HISTORY_MESSAGES = 6;
export const MAX_HISTORY_CHARACTERS = 12_000;
// Enough for the bounded text even when JSON escapes each character.
export const MAX_BODY_BYTES = 96 * 1024;

export function isValidHistory(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_MESSAGES || value.length % 2 !== 0) {
    return false;
  }

  let characters = 0;
  for (let index = 0; index < value.length; index += 1) {
    const message: unknown = value[index];
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (typeof message !== "object" || message === null ||
        !("role" in message) || message.role !== expectedRole ||
        !("content" in message) || typeof message.content !== "string" || !message.content.trim()) {
      return false;
    }

    const limit = expectedRole === "user" ? MAX_QUESTION_LENGTH : MAX_ANSWER_LENGTH;
    if (message.content.length > limit) return false;
    characters += message.content.length;
  }

  return characters <= MAX_HISTORY_CHARACTERS;
}

// Input contains completed user/assistant pairs. Drop whole oldest pairs only.
export function getRecentHistory(messages: ChatMessage[]): ChatMessage[] {
  let recent = messages.slice(-MAX_HISTORY_MESSAGES);
  let characters = recent.reduce((total, message) => total + message.content.length, 0);

  while (recent.length > 0 && characters > MAX_HISTORY_CHARACTERS) {
    characters -= recent[0].content.length + recent[1].content.length;
    recent = recent.slice(2);
  }

  return recent;
}
