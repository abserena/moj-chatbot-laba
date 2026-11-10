"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { FileUIPart } from "ai";
import type { StudioNovaMessage, StudioNovaResult } from "./lib/result-schema";
import type { AnalysisCapability } from "./lib/model-capabilities";

type Mode = "chat" | "analysis";
const categoryLabels = { sales: "Oferta i cena", support: "Problem techniczny", billing: "Płatność lub zwrot", unknown: "Nierozpoznana sprawa" };

async function preparePhoto(file: File): Promise<FileUIPart> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Wybierz zdjęcie JPG, PNG lub WebP.");
  if (file.size > 4 * 1024 * 1024) throw new Error("Zdjęcie może mieć najwyżej 4 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Nie można odczytać tego zdjęcia. Wybierz inny plik."); });
  try {
    if (file.size <= 2.5 * 1024 * 1024) {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Nie można odczytać zdjęcia."));
        reader.readAsDataURL(file);
      });
      return { type: "file", mediaType: file.type, filename: file.name, url };
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nie można przygotować zdjęcia.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    if (url.length > 3.5 * 1024 * 1024) throw new Error("Zdjęcie jest zbyt duże do wysłania. Wybierz mniejsze.");
    return { type: "file", mediaType: "image/jpeg", filename: file.name, url };
  } finally { bitmap.close(); }
}

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
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const transport = useMemo(() => new DefaultChatTransport<StudioNovaMessage>({
    api: "/api/chat", body: { mode }, fetch: sessionFetch,
    prepareSendMessagesRequest: ({ messages, body }) => {
      const lastPhoto = messages.findLastIndex((item) => item.role === "user" && item.parts.some((part) => part.type === "file"));
      const outgoing = messages.map((item, index) => ({ ...item, parts: item.parts.filter((part) => part.type !== "file" || (item.role === "user" && index === lastPhoto)) })).filter((item) => item.parts.length > 0);
      const payload = { ...body, messages: outgoing };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 4 * 1024 * 1024) throw new Error("Wiadomość jest za duża. Wybierz mniejsze zdjęcie lub odśwież rozmowę.");
      return { body: payload };
    },
  }), [mode]);
  const { messages, setMessages, sendMessage, stop, status, error, clearError } = useChat<StudioNovaMessage>({
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
  const isBusy = status === "submitted" || status === "streaming" || imageBusy || photoBusy;

  async function generatePicture() {
    const prompt = message.trim();
    if (isBusy || !prompt) return;
    if ([...prompt].length > 500) { setMediaError("Opis obrazu może mieć najwyżej 500 znaków."); return; }
    setMediaError(""); clearError(); setImageBusy(true);
    try {
      const response = await sessionFetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const result = await response.json().catch(() => { throw new Error("Usługa obrazów zwróciła nieprawidłową odpowiedź lub przekroczono limit rozmiaru. Spróbuj ponownie."); });
      if (!response.ok) throw new Error(result.error || "Nie udało się wygenerować obrazu.");
      if (typeof result.modelId !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(result.url)) throw new Error("Dostawca zwrócił nieprawidłowy obraz.");
      setMessages((items) => [...items,
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: `Wygeneruj obraz: ${prompt}` }] },
        { id: crypto.randomUUID(), role: "assistant", metadata: { generatedImage: true, modelId: result.modelId }, parts: [{ type: "text", text: `Wygenerowany obraz: ${prompt}` }, { type: "file", mediaType: result.url.slice(5, result.url.indexOf(";")), url: result.url }] },
      ]);
      setMessage("");
    } catch (error) { setMediaError(error instanceof Error ? error.message : "Nie udało się wygenerować obrazu."); }
    finally { setImageBusy(false); }
  }

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
    setMediaError("");
    setPreview("");
    setInterrupted(false);
    void sendMessage({ text, files: photo ? [photo] : undefined });
    setPhoto(null);
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
            {item.role === "assistant" && (item.metadata?.usedTools?.length ?? 0) > 0 && (
              <div className="tool-badges" aria-label="Użyte narzędzia">
                {item.metadata?.usedTools?.includes("web_search") && <small className="tool-badge">🔎 wyszukiwanie</small>}
                {item.metadata?.usedTools?.includes("aktualnyCzas") && <small className="tool-badge">🕒 aktualnyCzas</small>}
              </div>
            )}
            {item.parts.map((part, index) => {
              if (part.type === "data-analysis") return <AnalysisResult key={index} result={part.data} />;
              if (part.type === "file" && /^data:image\/(jpeg|png|webp);base64,/.test(part.url)) return <img key={index} className={item.metadata?.generatedImage ? "generated-image" : "photo-thumbnail"} src={part.url} alt={item.metadata?.generatedImage ? "Wygenerowany obraz" : "Wysłane zdjęcie"} />;
              return part.type === "text" ? <span key={index}>{part.text}</span> : null;
            })}
            {item.role === "assistant" && (item.metadata?.vision || item.metadata?.generatedImage) && item.metadata.modelId && <small className="model-caption">Model: {item.metadata.modelId}</small>}
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
      {isBusy && <p role="status">{imageBusy ? "Generuję obraz…" : photoBusy ? "Przygotowuję zdjęcie…" : analysis ? (preview ? "Trwa analiza i walidacja — wynik nie jest jeszcze zatwierdzony." : "Czekam na analizę…") : (status === "submitted" ? "Czekam na odpowiedź…" : "Chatbot pisze…")}</p>}
      {interrupted && <p role="alert" className="error">{analysis ? "Analiza została przerwana. Nie utworzono wyniku. Możesz spróbować ponownie." : "Odpowiedź została przerwana i może być niepełna."}</p>}
      {error && <p className="error" role="alert">{error.message || "Nie udało się uzyskać odpowiedzi. Spróbuj ponownie."}</p>}
      {mediaError && <p className="error" role="alert">{mediaError}</p>}
      <form onSubmit={handleSubmit}>
        <label htmlFor={`message-${mode}`}>{analysis ? "Wiadomość klienta do analizy" : "Wiadomość"}</label>
        <div className="composer">
          <textarea id={`message-${mode}`} rows={analysis ? 4 : 2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={analysis ? "Wklej wiadomość klienta…" : "Napisz wiadomość…"} autoComplete="off" disabled={isBusy} />
          <button type="submit" disabled={isBusy || !message.trim() || (analysis && (checking || capability?.supported !== true))}>{analysis ? "Analizuj" : "Wyślij"}</button>
        </div>
      </form>
      {!analysis && <div className="media-actions">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          setPhotoBusy(true); setMediaError("");
          try { setPhoto(await preparePhoto(file)); } catch (error) { setMediaError(error instanceof Error ? error.message : "Nie można dodać zdjęcia."); }
          finally { setPhotoBusy(false); }
        }} />
        <button type="button" disabled={isBusy} onClick={() => fileInput.current?.click()}>Dodaj zdjęcie</button>
        <button type="button" disabled={isBusy || !message.trim() || Boolean(photo)} onClick={() => { void generatePicture(); }}>Wygeneruj obraz</button>
        <small>JPG, PNG, WebP — do 4 MB. Opis generowanego obrazu: do 500 znaków.</small>
        {photo && <div><img className="photo-thumbnail" src={photo.url} alt="Zdjęcie gotowe do wysłania" /><button type="button" disabled={isBusy} onClick={() => setPhoto(null)}>Usuń zdjęcie</button></div>}
      </div>}
      {(status === "submitted" || status === "streaming") && <button className="cancel" type="button" onClick={() => { void stop(); setPreview(""); setInterrupted(true); }}>Przerwij</button>}
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
