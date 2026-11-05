import { jsonSchema, NoObjectGeneratedError } from "ai";
import type { UIMessage } from "ai";

export type StudioNovaResult = {
  category: "sales" | "support" | "billing" | "unknown";
  priority: "normal" | "high";
  draft: string;
  needs_review: boolean;
};

export type StudioNovaMessage = UIMessage<unknown, { preview: { delta: string } }>;

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
  readonly code: "refusal" | "truncated" | "format" | "aborted";
  constructor(code: "refusal" | "truncated" | "format" | "aborted") {
    super(code);
    this.code = code;
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
    }
  }
  if (NoObjectGeneratedError.isInstance(error)) return resultErrorMessage(new ResultError("format"));
  return "Nie udało się uzyskać wyniku. Sprawdź konfigurację, dostępność modelu obsługującego JSON Schema i saldo OpenRouter, a następnie spróbuj ponownie.";
}
