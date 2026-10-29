import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, streamText, validateUIMessages } from "ai";
import { requestHasSession, sameOrigin } from "../../lib/auth.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const modelError = "Nie udało się uzyskać odpowiedzi. Sprawdź klucz API, identyfikator modelu i saldo OpenRouter, a następnie spróbuj ponownie.";

export async function POST(request: Request) {
  if (!requestHasSession(request)) {
    return new Response("Sesja wygasła lub nie jesteś zalogowany. Wpisz hasło ponownie.", { status: 401 });
  }
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403 });
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return new Response(
      "Brak konfiguracji OpenRouter. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a następnie uruchom ponownie serwer.",
      { status: 503 }
    );
  }

  let messages;
try {
  const body = await request.json();
  messages = await validateUIMessages({ messages: body.messages });
  const lastMessage = messages.at(-1);

  if (
    !lastMessage ||
    lastMessage.role !== "user" ||
    !lastMessage.parts.some(
      (part) => part.type === "text" && part.text.trim()
    ) ||
    messages.some(
      (message) =>
        !["user", "assistant"].includes(message.role) ||
        message.parts.some(
          (part) =>
            part.type !== "text" &&
            !(message.role === "assistant" && part.type === "step-start")
        )
    )
  ) {
    return new Response("Wpisz niepustą wiadomość tekstową.", {
      status: 400,
    });
  }
} catch {
  return new Response(
    "Nieprawidłowa historia rozmowy. Odśwież stronę i spróbuj ponownie.",
    { status: 400 }
  );
}

  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter(model),
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      maxRetries: 0,
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: () => modelError,
    });
  } catch {
    return new Response(modelError, { status: 502 });
  }
}
