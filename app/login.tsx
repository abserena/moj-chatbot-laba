"use client";
import { useState, type FormEvent } from "react";

export default function Login({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) { setError(await response.text()); return; }
      window.location.assign("/");
    } catch { setError("Nie można połączyć się z serwerem. Spróbuj ponownie."); }
    finally { setPassword(""); setPending(false); }
  }
  return (
    <main>
      <h1>Wpisz hasło</h1>
      {!configured && <p className="error" role="alert">Dostęp zablokowany. Ustaw CHAT_PASSWORD i SESSION_SECRET (minimum 32 znaki) w .env.local i uruchom ponownie serwer.</p>}
      <form onSubmit={submit}>
        <label htmlFor="password">Hasło warsztatowe</label>
        <div className="composer">
          <input id="password" type="password" autoComplete="current-password"
            value={password} onChange={event => setPassword(event.target.value)}
            disabled={!configured || pending} required maxLength={1024} />
          <button disabled={!configured || pending || !password.trim()}>{pending ? "Sprawdzam…" : "Wejdź"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
