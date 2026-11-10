import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, NoImageGeneratedError } from "ai";
import { requestHasSession, sameOrigin } from "../../lib/auth.server";
import { openRouterErrorMessage, openRouterErrorStatus } from "../../lib/result-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!requestHasSession(request)) return Response.json({ error: "Sesja wygasła. Wpisz hasło ponownie." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania." }, { status: 403 });
  let prompt: string;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > 8192) return Response.json({ error: "Opis obrazu może mieć najwyżej 500 znaków." }, { status: 413 });
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "prompt") || typeof body.prompt !== "string") throw new Error("prompt");
    prompt = body.prompt.trim();
    if (!prompt || [...prompt].length > 500) throw new Error("prompt");
  } catch {
    return Response.json({ error: "Wpisz opis obrazu od 1 do 500 znaków." }, { status: 400 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "Brak klucza OpenRouter w konfiguracji serwera." }, { status: 503 });
  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = await generateImage({
      model: openrouter.imageModel("google/gemini-3.1-flash-image-preview"),
      prompt,
      n: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
    });
    const modelId = result.responses[0]?.modelId;
    if (!modelId || !["image/png", "image/jpeg", "image/webp"].includes(result.image.mediaType)) {
      return Response.json({ error: "Dostawca zwrócił niepełną odpowiedź obrazu. Spróbuj ponownie." }, { status: 502 });
    }
    return Response.json({ url: `data:${result.image.mediaType};base64,${result.image.base64}`, modelId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = openRouterErrorStatus(error);
    console.error(JSON.stringify({ event: "image_generation_error", status: status ?? "unknown" }));
    const message = NoImageGeneratedError.isInstance(error)
      ? "Model nie wygenerował obrazu. Spróbuj zmienić opis; usługa może być chwilowo niedostępna."
      : status === 404 || status === 400 || status === 422
        ? "Model generowania obrazów jest niedostępny lub dostawca nie obsługuje tego żądania. Spróbuj ponownie później."
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "Generowanie obrazu zostało przerwane lub trwało zbyt długo. Spróbuj ponownie."
          : openRouterErrorMessage(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
