import { APICallError, jsonSchema, NoObjectGeneratedError, UnsupportedFunctionalityError } from "ai";
import type { UIMessage } from "ai";
import { unsupportedAnalysisMessage } from "./model-capabilities";

export type StudioNovaResult = {
  category: "sales" | "support" | "billing" | "unknown";
  priority: "normal" | "high";
  draft: string;
  needs_review: boolean;
};

export type StudioNovaMessage = UIMessage<unknown, { preview: { delta: string }; analysis: StudioNovaResult }>;

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
  return "Nie udało się uzyskać wyniku. Sprawdź konfigurację, dostępność modelu obsługującego JSON Schema i saldo OpenRouter, a następnie spróbuj ponownie.";
}
