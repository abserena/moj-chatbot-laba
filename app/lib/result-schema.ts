import { APICallError, jsonSchema, NoObjectGeneratedError, UnsupportedFunctionalityError } from "ai";
import type { UIMessage } from "ai";
import { unsupportedAnalysisMessage } from "./model-capabilities";

export type StudioNovaResult = {
  category: "sales" | "support" | "billing" | "unknown";
  priority: "normal" | "high";
  draft: string;
  needs_review: boolean;
};

export type StudioNovaMessage = UIMessage<
  { fetchedAt?: string; usedTools?: ("web_search" | "aktualnyCzas")[]; modelId?: string; vision?: boolean; generatedImage?: boolean },
  { preview: { delta: string }; analysis: StudioNovaResult },
  {
    aktualnyCzas: { input: Record<string, never>; output: { data: string; dzienTygodnia: string; godzina: string; strefa: string } };
    web_search: { input: unknown; output: unknown };
  }
>;

export const studioNovaFacts = { consultationPricePLN: 150, consultationMinutes: 45 } as const;

const categories = ["sales", "support", "billing", "unknown"];
const priorities = ["normal", "high"];
const fields = ["category", "priority", "draft", "needs_review"];

// Ten sam kontrakt trafia do dostawcy i jest sprawdzany lokalnie przez AI SDK.
export const resultSchema = jsonSchema<StudioNovaResult>({
  type: "object",
  properties: {
    category: { type: "string", enum: categories },
    priority: { type: "string", enum: priorities },
    draft: { type: "string" },
    needs_review: { type: "boolean" },
  },
  required: fields,
  additionalProperties: false,
}, {
  validate(value) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      if (
        Object.keys(item).length === fields.length &&
        fields.every((key) => Object.hasOwn(item, key)) &&
        typeof item.category === "string" && categories.includes(item.category) &&
        typeof item.priority === "string" && priorities.includes(item.priority) &&
        typeof item.draft === "string" && typeof item.needs_review === "boolean"
      ) return { success: true, value: item as StudioNovaResult };
    }
    return { success: false, error: new Error("Wynik nie spełnia schematu Studio Nova.") };
  },
});

export class ResultError extends Error {
  readonly code: "refusal" | "truncated" | "format" | "aborted" | "unsupported" | "policy";
  constructor(code: "refusal" | "truncated" | "format" | "aborted" | "unsupported" | "policy") {
    super(code);
    this.code = code;
  }
}

export function assertAnalysisPolicy(result: StudioNovaResult): void {
  // Jedyną zweryfikowaną kwotą firmy jest cena konsultacji. Inne kwoty
  // wymagają pracownika; nie wolno ich publikować jako gotowego szkicu.
  // Jest to wąska kontrola zapisu liczbowego, nie detektor wszystkich injection.
  const amount = String.raw`(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?)`;
  const patterns = [
    new RegExp(amount + String.raw`\s*(?:z[lł](?:ot(?:y|e|ych))?|PLN)(?![a-ząćęłńóśźż0-9])`, "gi"),
    new RegExp(String.raw`\bPLN\s*` + amount, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of result.draft.matchAll(pattern)) {
      const value = Number(match[1].replace(/[ \u00a0\u202f]/g, "").replace(",", "."));
      if (value !== studioNovaFacts.consultationPricePLN) throw new ResultError("policy");
    }
  }
}

// OpenRouter przekazuje odmowę niektórych modeli w surowym delta.refusal.
export function hasRefusal(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const choices = (value as { choices?: unknown }).choices;
  return Array.isArray(choices) && choices.some((choice) => {
    const refusal = choice?.delta?.refusal ?? choice?.message?.refusal;
    return typeof refusal === "string" && refusal.trim().length > 0;
  });
}

export function openRouterErrorStatus(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  // Niektóre błędy przychodzą już po rozpoczęciu strumienia jako obiekt z kodem.
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") return error.code;
  return undefined;
}

export function openRouterErrorMessage(error: unknown): string {
  const status = openRouterErrorStatus(error);
  switch (status) {
    case 400:
    case 422: return `OpenRouter (${status}): model lub dostawca nie przyjął parametrów żądania. Sprawdź, czy obsługuje wymagane funkcje, w tym wyszukiwanie native w zwykłym czacie.`;
    case 401: return "OpenRouter (401): nieprawidłowy lub nieaktywny klucz API. Sprawdź OPENROUTER_API_KEY w ustawieniach Vercel i wykonaj nowe wdrożenie.";
    case 402: return "OpenRouter (402): brak dostępnych środków lub przekroczony budżet żądania. Sprawdź saldo i limity konta OpenRouter.";
    case 403: return "OpenRouter (403): dostęp do modelu lub żądania został zablokowany. Sprawdź uprawnienia klucza i zasady dostawcy.";
    case 404: return "OpenRouter (404): model lub zgodny dostawca nie jest dostępny. Sprawdź OPENROUTER_MODEL w ustawieniach Vercel.";
    case 408:
    case 504: return `OpenRouter (${status}): przekroczono czas oczekiwania. Spróbuj ponownie za chwilę.`;
    case 429: return "OpenRouter (429): przekroczono limit zapytań. Poczekaj chwilę i spróbuj ponownie.";
  }
  if (status && status >= 500 && status <= 599) return `OpenRouter (${status}): chwilowy błąd dostawcy modelu. Spróbuj ponownie za chwilę.`;
  return "Nie udało się połączyć z modelem lub odczytać odpowiedzi OpenRouter. Spróbuj ponownie; jeśli błąd wraca, sprawdź logi aplikacji na Vercel.";
}

export function resultErrorMessage(error: unknown): string {
  if (error instanceof ResultError) {
    switch (error.code) {
      case "refusal": return "Model odmówił odpowiedzi. Nie utworzono wyniku JSON. Sprawę powinien sprawdzić pracownik.";
      case "truncated": return "Odpowiedź została ucięta przez limit modelu. Nie zapisano częściowego JSON. Spróbuj krótszego pytania lub skontaktuj się z pracownikiem.";
      case "format": return "Odpowiedź ma nieprawidłowy format JSON lub nie spełnia schematu. Nie zapisano wyniku. Spróbuj ponownie.";
      case "aborted": return "Generowanie zostało przerwane. Nie zapisano wyniku. Spróbuj ponownie.";
      case "unsupported": return unsupportedAnalysisMessage;
      case "policy": return "Wynik jest niezgodny ze zweryfikowanymi zasadami firmy. Nie zatwierdzono analizy ani szkicu. Sprawę powinien sprawdzić pracownik.";
    }
  }
  if (UnsupportedFunctionalityError.isInstance(error)) return unsupportedAnalysisMessage;
  if (APICallError.isInstance(error)) {
    // Wskazujemy brak obsługi parametrów, nie ujawniając surowej treści błędu.
    if ([400, 404, 422].includes(error.statusCode ?? 0) && /response_format|json_schema|structured.?output|support.*parameter|no endpoints.*(found|available)/i.test(error.message)) return unsupportedAnalysisMessage;
  }
  if (error instanceof Error && error.name === "AbortError") return resultErrorMessage(new ResultError("aborted"));
  if (NoObjectGeneratedError.isInstance(error)) return resultErrorMessage(new ResultError("format"));
  if (openRouterErrorStatus(error) !== undefined) return openRouterErrorMessage(error);
  return "Nie udało się uzyskać wyniku. Sprawdź konfigurację, dostępność modelu obsługującego JSON Schema i saldo OpenRouter, a następnie spróbuj ponownie.";
}
