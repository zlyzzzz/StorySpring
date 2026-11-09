export async function complete(
  messages,
  { json = false, maxTokens = 1800, attempt = 0 } = {},
) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "AI is not configured on this server. Your answers are saved.",
    );
  }
  let response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
        messages,
        thinking: { type: "disabled" },
        stream: false,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch {
    if (attempt < 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 + Math.random() * 1000),
      );
      return complete(messages, { json, maxTokens, attempt: attempt + 1 });
    }
    throw new Error(
      "The AI connection was interrupted. Your answers are saved; please retry.",
    );
  }
  if (!response.ok) {
    if (attempt < 1 && (response.status === 429 || response.status >= 500)) {
      await response.body?.cancel();
      await new Promise((resolve) =>
        setTimeout(resolve, 1500 + Math.random() * 1000),
      );
      return complete(messages, { json, maxTokens, attempt: attempt + 1 });
    }
    // Do not forward provider response bodies or credentials to the browser.
    throw new Error(
      `DeepSeek request failed (${response.status}). Please retry.`,
    );
  }
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop" || !choice.message?.content?.trim()) {
    throw new Error(
      "The AI response was incomplete. Please retry; your answers are saved.",
    );
  }
  return choice.message.content.trim();
}
