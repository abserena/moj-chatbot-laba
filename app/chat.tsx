"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const transport = new DefaultChatTransport({
  api: "/api/chat",
  fetch: async (url, options) => {
    try {
      const response = await fetch(url, options);
      if (response.status === 401) window.location.assign("/");
      return response;
    } catch {
      throw new Error("Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.");
    }
  },
});

export default function Chat() {
  const [logoutError, setLogoutError] = useState("");
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isBusy) return;
    clearError();
    void sendMessage({ text });
    setMessage("");
  }

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
      <section className="conversation" role="log" aria-label="Rozmowa" aria-live="polite">
        {messages.map((item) => (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? "Ty" : "Chatbot"}</strong>
            {item.parts.map((part, index) =>
              part.type === "text" ? <span key={index}>{part.text}</span> : null
            )}
          </div>
        ))}
      </section>
      {isBusy && (
        <p role="status">{status === "submitted" ? "Czekam na odpowiedź…" : "Chatbot pisze…"}</p>
      )}
      {error && (
        <p className="error" role="alert">{error.message || "Nie udało się uzyskać odpowiedzi. Spróbuj ponownie."}</p>
      )}
      <form onSubmit={handleSubmit}>
        <label htmlFor="message">Wiadomość</label>
        <div className="composer">
          <input
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Napisz wiadomość…"
            autoComplete="off"
            disabled={isBusy}
          />
          <button type="submit" disabled={isBusy || !message.trim()}>Wyślij</button>
        </div>
      </form>
    </main>
  );
}
