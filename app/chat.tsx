"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { StudioNovaMessage, StudioNovaResult } from "./lib/result-schema";
import type { AnalysisCapability } from "./lib/model-capabilities";

type Mode = "chat" | "analysis";
const categoryLabels = { sales: "Oferta i cena", support: "Problem techniczny", billing: "Płatność lub zwrot", unknown: "Nierozpoznana sprawa" };

async function sessionFetch(url: RequestInfo | URL, options?: RequestInit) {
  try {
    const response = await fetch(url, options);
    if (response.status === 401) window.location.assign("/");
    return response;
  } catch {
    throw new Error("Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.");
  }
}

function AnalysisResult({ result }: { result: StudioNovaResult }) {
  return (
    <article className="analysis-result" aria-label="Wynik analizy wiadomości">
      <strong>Szkic — nic nie zostało wysłane</strong>
      <dl>
        <dt>Kategoria</dt><dd>{categoryLabels[result.category]} ({result.category})</dd>
        <dt>Priorytet</dt><dd className={result.priority === "high" ? "priority-high" : undefined}>{result.priority === "high" ? "Wysoki (high)" : "Normalny (normal)"}</dd>
        <dt>Status sprawdzenia</dt><dd>{result.needs_review ? "Wymaga sprawdzenia przez pracownika" : "Nie wymaga sprawdzenia — nadal wyłącznie szkic"}</dd>
        <dt>Szkic odpowiedzi</dt><dd className="draft">{result.draft}</dd>
      </dl>
      <details><summary>Pokaż JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </article>
  );
}

function ChatPanel({ mode, active }: { mode: Mode; active: boolean }) {
  const analysis = mode === "analysis";
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [capability, setCapability] = useState<AnalysisCapability | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: { mode }, fetch: sessionFetch }), [mode]);
  const { messages, sendMessage, stop, status, error, clearError } = useChat<StudioNovaMessage>({
    transport,
    onData(part) {
      if (part.type === "data-preview") setPreview((text) => text + part.data.delta);
    },
    onFinish({ isAbort }) {
      setPreview("");
      if (isAbort) setInterrupted(true);
    },
    onError: () => setPreview(""),
  });
  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!analysis || !active) return;
    const controller = new AbortController();
    setChecking(true);
    void sessionFetch("/api/chat", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("capability");
        return await response.json() as AnalysisCapability;
      })
      .then((value) => { if (!controller.signal.aborted) setCapability(value); })
      .catch(() => {
        if (!controller.signal.aborted) setCapability({ model: "", supported: null, message: "Nie udało się sprawdzić możliwości modelu. Spróbuj ponownie. Zwykły czat pozostaje dostępny." });
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [analysis, active, checkVersion]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isBusy || (analysis && (checking || capability?.supported !== true))) return;
    clearError();
    setPreview("");
    setInterrupted(false);
    void sendMessage({ text });
    setMessage("");
  }

  return (
    <section hidden={!active} aria-label={analysis ? "Analiza wiadomości Studio Nova" : "Zwykły czat"}>
      {analysis && (
        <>
          <p>Wklej jedną wiadomość klienta. Każda analiza tworzy osobny szkic odpowiedzi; niczego nie wysyła ani nie rezerwuje.</p>
          <div className="capability" role="status">
            {checking ? "Sprawdzam obsługę analizy przez ustawiony model…" : capability?.message}
            {!checking && capability?.model && <p>Ustawiony model: <code>{capability.model}</code></p>}
            {!checking && capability?.supported !== true && <button type="button" onClick={() => setCheckVersion((value) => value + 1)}>Sprawdź ponownie</button>}
          </div>
        </>
      )}
      <section className="conversation" role="log" aria-label={analysis ? "Historia analiz" : "Rozmowa"} aria-live="polite">
        {messages.map((item) => (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? (analysis ? "Wiadomość klienta" : "Ty") : (analysis ? "Analiza Studio Nova" : "Chatbot")}</strong>
            {item.parts.map((part, index) => {
              if (part.type === "data-analysis") return <AnalysisResult key={index} result={part.data} />;
              return part.type === "text" ? <span key={index}>{part.text}</span> : null;
            })}
            {item.role === "assistant" && item.parts.some((part) => part.type === "source-url" && /^https?:\/\//i.test(part.url)) && (
              <section aria-label="Źródła">
                <strong>Źródła</strong>
                <ul>
                  {item.parts.filter((part) => part.type === "source-url" && /^https?:\/\//i.test(part.url)).map((part, index) => part.type === "source-url" && (
                    <li key={`${part.sourceId}-${index}`}>
                      <a href={part.url} target="_blank" rel="noopener noreferrer">{part.title || part.url}</a>
                    </li>
                  ))}
                </ul>
                {item.metadata?.fetchedAt && <small>pobrano: <time dateTime={item.metadata.fetchedAt}>{new Date(item.metadata.fetchedAt).toLocaleString("pl-PL", { timeZone: "Europe/Dublin", dateStyle: "short", timeStyle: "short" })}</time> (Europe/Dublin)</small>}
              </section>
            )}
          </div>
        ))}
      </section>
      {isBusy && <p role="status">{analysis ? (preview ? "Trwa analiza i walidacja — wynik nie jest jeszcze zatwierdzony." : "Czekam na analizę…") : (status === "submitted" ? "Czekam na odpowiedź…" : "Chatbot pisze…")}</p>}
      {interrupted && <p role="alert" className="error">{analysis ? "Analiza została przerwana. Nie utworzono wyniku. Możesz spróbować ponownie." : "Odpowiedź została przerwana i może być niepełna."}</p>}
      {error && <p className="error" role="alert">{error.message || "Nie udało się uzyskać odpowiedzi. Spróbuj ponownie."}</p>}
      <form onSubmit={handleSubmit}>
        <label htmlFor={`message-${mode}`}>{analysis ? "Wiadomość klienta do analizy" : "Wiadomość"}</label>
        <div className="composer">
          <textarea id={`message-${mode}`} rows={analysis ? 4 : 2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={analysis ? "Wklej wiadomość klienta…" : "Napisz wiadomość…"} autoComplete="off" disabled={isBusy} />
          <button type="submit" disabled={isBusy || !message.trim() || (analysis && (checking || capability?.supported !== true))}>{analysis ? "Analizuj" : "Wyślij"}</button>
        </div>
      </form>
      {isBusy && <button className="cancel" type="button" onClick={() => { void stop(); setPreview(""); setInterrupted(true); }}>Przerwij</button>}
    </section>
  );
}

export default function Chat() {
  const [mode, setMode] = useState<Mode>("chat");
  const [logoutError, setLogoutError] = useState("");
  return (
    <main>
      <h1>Mój chatbot</h1>
      <button type="button" onClick={async () => {
        try {
          const response = await fetch("/api/session", { method: "DELETE" });
          if (!response.ok) throw new Error();
          window.location.assign("/");
        } catch { setLogoutError("Nie udało się wyjść. Spróbuj ponownie."); }
      }}>Wyjdź</button>
      {logoutError && <p role="alert" className="error">{logoutError}</p>}
      <div className="mode-switch" role="group" aria-label="Tryb pracy">
        <button type="button" aria-pressed={mode === "chat"} onClick={() => setMode("chat")}>Zwykły czat</button>
        <button type="button" aria-pressed={mode === "analysis"} onClick={() => setMode("analysis")}>Analiza wiadomości</button>
      </div>
      <ChatPanel mode="chat" active={mode === "chat"} />
      <ChatPanel mode="analysis" active={mode === "analysis"} />
    </main>
  );
}
