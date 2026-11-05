export type AnalysisCapability = {
  model: string;
  supported: boolean | null;
  message: string;
};

export const unsupportedAnalysisMessage = "Tryb analizy wymaga modelu obsługującego JSON Schema (structured_outputs) i zgodnego dostawcy OpenRouter. Ustaw OPENROUTER_MODEL na uzgodniony model z tą obsługą, a następnie uruchom ponownie serwer lub wdróż aplikację ponownie. Nie zmieniono modelu ani kosztu konfiguracji. Zwykły czat jest nadal dostępny.";

// Publiczne metadane, bez klucza API i bez generowania odpowiedzi modelu.
// Krótki cache obejmuje wyłącznie publiczny katalog modeli.
let cached: { expires: number; models: unknown[] } | undefined;
export async function getAnalysisCapability(model: string, fetcher: typeof fetch = fetch): Promise<AnalysisCapability> {
  if (!model) return { model, supported: false, message: "Brak OPENROUTER_MODEL. Uzupełnij konfigurację modelu na serwerze." };
  try {
    let models = fetcher === fetch && cached && cached.expires > Date.now() ? cached.models : undefined;
    if (!models) {
      const response = await fetcher("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(8000), cache: "no-store",
      });
      if (!response.ok) throw new Error("catalog");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) throw new Error("catalog");
      models = (body as { data: unknown[] }).data;
      if (fetcher === fetch) cached = { expires: Date.now() + 60_000, models };
    }
    const entry = models.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === model) as { supported_parameters?: unknown } | undefined;
    const supported = Array.isArray(entry?.supported_parameters) && entry.supported_parameters.includes("structured_outputs");
    return {
      model, supported,
      message: supported
        ? "Model deklaruje obsługę JSON Schema. Dostępność zgodnego dostawcy zostanie sprawdzona przy analizie."
        : unsupportedAnalysisMessage,
    };
  } catch {
    return { model, supported: null, message: "Nie udało się sprawdzić możliwości modelu w OpenRouter. Nie uruchomiono analizy. Sprawdź połączenie i spróbuj ponownie. Zwykły czat jest nadal dostępny." };
  }
}
