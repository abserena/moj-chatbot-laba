import { jsonSchema, tool } from "ai";
import { studioNovaFacts } from "./result-schema";
import type { StudioNovaAvailability, StudioNovaOffer } from "./result-schema";
import { studioNovaSchedule } from "./studio-nova-schedule";

const bezArgumentow = jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }, {
  validate: (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0
    ? { success: true, value: value as Record<string, never> }
    : { success: false, error: new Error("To narzędzie nie przyjmuje argumentów.") },
});

export const ofertaKonsultacji = tool({
  description: "Sprawdź ofertę konsultacji online Studio Nova. Użyj przy pytaniach o cenę, koszt, czas trwania lub opis konsultacji. Zwraca zatwierdzone lokalne dane firmy; nie wylicza rabatów ani nie sprawdza wolnych terminów.",
  inputSchema: bezArgumentow,
  execute: async (): Promise<StudioNovaOffer> => ({
    nazwa: "Konsultacja online Studio Nova",
    opis: "Konsultacja prowadzona online przez Studio Nova.",
    cenaBrutto: studioNovaFacts.consultationPricePLN,
    waluta: "PLN",
    czasTrwaniaMinuty: studioNovaFacts.consultationMinutes,
    zrodlo: "Lokalna konfiguracja Studio Nova",
    pobrano: new Date().toISOString(),
  }),
});

export const sprawdzDostepneTerminy = tool({
  description: "Sprawdź przyszłe wolne terminy konsultacji online Studio Nova na lokalnej liście przekazanej przez właściciela. Użyj, gdy klient pyta o dostępność, najbliższy termin lub możliwość spotkania konkretnego dnia. Zwraca daty i godziny w Europe/Warsaw; nie rezerwuje, nie blokuje i nie potwierdza spotkania. Nie szukaj terminów Studio Nova w internecie i nie wymyślaj innych godzin.",
  inputSchema: bezArgumentow,
  execute: async (): Promise<StudioNovaAvailability> => {
    const now = new Date();
    const timeZone = studioNovaSchedule.timeZone;
    const terminy = studioNovaSchedule.startsAt.filter((start) => new Date(start).getTime() > now.getTime())
      .map((start) => ({
        start,
        data: new Intl.DateTimeFormat("pl-PL", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start)),
        godzina: new Intl.DateTimeFormat("pl-PL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(start)),
      }))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return {
      terminy,
      strefa: timeZone,
      czasTrwaniaMinuty: studioNovaFacts.consultationMinutes,
      zrodlo: "Lokalna lista terminów przekazana przez właściciela Studio Nova",
      pobrano: now.toISOString(),
      rezerwacja: false,
      komunikat: terminy.length ? "Terminy z udostępnionej listy. Rezerwację musi potwierdzić pracownik Studio Nova."
        : "Na udostępnionej liście nie ma przyszłych wolnych terminów. Poproś pracownika Studio Nova o aktualną dostępność.",
    };
  },
});
