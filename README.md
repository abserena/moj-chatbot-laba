# Mój chatbot

## Konfiguracja lokalna

W `.env.local` ustaw `CHAT_PASSWORD` na własne, długie hasło warsztatowe.
Nie dodawaj prefiksu `NEXT_PUBLIC_` do żadnego sekretu.
`SESSION_SECRET` został wygenerowany kryptograficznie i zapisany lokalnie.
Nie publikuj `.env.local` ani nie wklejaj sekretów do czatu.
Puste pola wszystkich zmiennych znajdują się w `.env.example`.
OpenRouter używa `OPENROUTER_API_KEY` i `OPENROUTER_MODEL`.
Po zmianach uruchom ponownie `npm.cmd run dev`.

## Ochrona

Hasło jest sprawdzane na serwerze. Podpis HMAC-SHA256 chroni token z losowym
identyfikatorem i terminem ważności; token nie zawiera hasła.
Sesja trwa 2 godziny. Cookie: HttpOnly, SameSite=Strict, Path=/,
Secure w produkcji, Max-Age=7200. Brak konfiguracji zamyka dostęp.
Zmiana hasła lub SESSION_SECRET unieważnia wcześniejsze tokeny.
Wyjście usuwa cookie i przeładowuje stronę, usuwając rozmowę z widoku.
Sesje są bezstanowe: wcześniej skopiowany token pozostaje ważny do wygaśnięcia
lub zmiany sekretu/hasła. Nie ma centralnej listy unieważnionych sesji.
POST/DELETE wymagają zgodnego nagłówka Origin.

## Limit prób i hosting

Limit aplikacji: 5 żądań logowania na minutę dla całej instancji, także po
usunięciu cookie. Szósta próba zwraca 429 z Retry-After.
To dodatkowa ochrona lokalna: restart zeruje licznik, a wiele instancji ma
oddzielne liczniki. NIE jest to globalna ochrona hostingu.

Przed udostępnieniem na Vercel ustaw w Firewall regułę Rate Limit:
ścieżka `/api/session`, metoda POST, 5 żądań/minutę/IP, akcja blokowania.
Na innym hostingu ustaw równoważny limit w jego reverse proxy/firewallu.
W produkcji korzystaj z HTTPS i ustaw wszystkie cztery zmienne środowiskowe
w panelu hostingu. Nowy SESSION_SECRET generuj lokalnie kryptograficznie;
nie używaj przykładowej wartości ani hasła jako sekretu podpisu.

Dokumentacja:
- https://nextjs.org/docs/app/guides/authentication
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting

## Sprawdzenia

`npm.cmd run typecheck` i `npm.cmd run build` sprawdzają kompilację.
`npm.cmd run test:auth` po buildzie uruchamia izolowany serwer testowy
na porcie 3001 z fikcyjną konfiguracją i wyłączonym OpenRouter.
Sprawdza hasło, cookie, limit prób, wyjście, ochronę API i wygaśnięcie sesji.
Ręcznie: sprawdź w przeglądarce ekran hasła, błędne i poprawne hasło,
odświeżenie strony po wejściu oraz przycisk Wyjdź. Test odpowiedzi AI
wykonuje właściciel, bo może wiązać się z opłatą.

## Publikacja na GitHub i Vercel

Publikuj wyłącznie we własnym repozytorium. Zachowaj `package-lock.json`.
Nie dodawaj `.env.local`, innych plików `.env` z wartościami ani `.vercel`.
Jedynym szablonem w repozytorium jest `.env.example` z pustymi polami.

W Vercel zaimportuj własne repozytorium, wybierz Next.js i Node.js 24.x.
Komenda instalacji: `npm ci`, komenda budowania: `npm run build`.
Katalog główny projektu: katalog zawierający `package.json`.
Przed wdrożeniem ustaw zmienne środowiskowe (bez prefiksu NEXT_PUBLIC_):

- OPENROUTER_API_KEY
- OPENROUTER_MODEL
- CHAT_PASSWORD
- SESSION_SECRET

Wartości ustawiaj bezpośrednio w panelu Vercel. Do produkcji wygeneruj nowy
losowy sekret (minimum 32 znaki); nie zapisuj go w repozytorium.
Zmiany zmiennych wymagają nowego wdrożenia. Ustaw też globalny limit logowania
w firewallu opisany wyżej.

Po wdrożeniu pod adresem HTTPS koniecznie sprawdź:

1. W oknie prywatnym widać ekran hasła, a POST `/api/chat` bez cookie zwraca 401.
2. Błędne hasło jest odrzucane; poprawne wpuszcza do czatu.
3. Odświeżenie zachowuje sesję, a cookie ma Secure, HttpOnly i SameSite=Strict.
4. Wyjdź usuwa cookie i po odświeżeniu wraca ekran hasła.
5. Właściciel wysyła jedną wiadomość i sprawdza strumieniową odpowiedź.

Nie uznawaj publikacji za zakończoną przed sprawdzeniem ochrony hasłem
na wdrożonym adresie.
