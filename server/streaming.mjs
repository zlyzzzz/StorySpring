// Parse provider SSE incrementally, including chunks split inside UTF-8 characters.
export async function consumeStoryStream(body, onDelta = () => {}) {
  if (!body) throw new Error("The AI stream was empty.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    finish = null,
    doneMarker = false;
  function line(value) {
    if (!value.startsWith("data:")) return;
    const payload = value.slice(5).trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      doneMarker = true;
      return;
    }
    const event = JSON.parse(payload);
    if (event.error) throw new Error("The AI stream reported an error.");
    const choice = event.choices?.[0];
    if (typeof choice?.delta?.content === "string") {
      text += choice.delta.content;
      onDelta(choice.delta.content, text);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
      if (chunk.done || doneMarker) break;
    }
    if (buffer.trim()) line(buffer.replace(/\r$/, ""));
    if (!doneMarker || finish !== "stop" || !text.trim()) {
      throw new Error(
        "The streamed story was incomplete. Your draft is saved; please retry.",
      );
    }
    return text.trim();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamComplete(
  messages,
  { maxTokens = 8000, onText = () => {}, fetchFn = fetch } = {},
) {
  if (!process.env.DEEPSEEK_API_KEY)
    throw new Error(
      "AI is not configured on this server. Your answers are saved.",
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onText("");
      const response = await fetchFn(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
            messages,
            thinking: { type: "disabled" },
            stream: true,
            max_tokens: maxTokens,
          }),
          signal: AbortSignal.timeout(240_000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(
          `DeepSeek request failed (${response.status}). Please retry.`,
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await consumeStoryStream(response.body, (_, text) => onText(text));
    } catch (error) {
      if (attempt === 1 || error.retryable === false) {
        throw new Error(
          error.retryable === false
            ? error.message
            : "The AI stream was interrupted or incomplete. Your answers are saved; please retry.",
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 + Math.random() * 500),
      );
    }
  }
}
