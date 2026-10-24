# Wejściówka — quiz A–D z notatek

Statyczna apka quizowa (Vite + TypeScript) hostowana na GitHub Pages. Bank pytań jest generowany w Claude Code przez skill `quiz-bank` z opublikowanych notatek Notion i kalibrowany na prawdziwych pytaniach z wejściówek.

**Apka:** https://krzysztofkulak.github.io/wejsciowkapp/

## Jak to działa
1. `npm run fetch-notes` pobiera każdą publiczną stronę Notion z listy `sources` w `quiz.config.json` do `source/<tytuł-strony>.md`.
2. `npm run outline` pokazuje podział na książki i rozdziały (liczba słów, hash).
3. W Claude Code: `/quiz-bank update` (albo „wygeneruj pytania do rozdziału X”). Skill czyta notatki i `examples/`, pisze `app/public/data/bank/<książka>/<rozdział>.json` i `index.json`.
4. `npm run build-index` odświeża `index.json`, `npm run check-bank` waliduje bank. `git push` na `main` buduje i publikuje stronę przez GitHub Actions.

Każde pytanie przechowuje kilka wersji trzonu, kilka sformułowań poprawnej odpowiedzi i 6–12 dystraktorów. Apka losuje 1 poprawną + 3 błędne i tasuje je do A–D, więc nie da się nauczyć „na pamięć pozycji”.

## Skrypty
| polecenie | co robi |
| --- | --- |
| `npm run dev` | serwer deweloperski |
| `npm run build` | build do `dist/` |
| `npm test` | testy (vitest) |
| `npm run fetch-notes` | pobiera notatki z Notion |
| `npm run outline` | podział notatek na rozdziały |
| `npm run build-index` | odbudowa `index.json` z plików banku |
| `npm run check-bank` | walidacja banku pytań |

## Apka
- Wybór rozdziałów, liczba pytań, zapamiętany ostatni wybór.
- Klawisze 1–4 / A–D, Enter = dalej. Tryb ciemny wg systemu.
- Podsumowanie z podziałem na rozdziały, lista pomyłek, „powtórz pomyłki”.
- „Skup się na słabych”: częściej losuje pytania, które mylisz (statystyki w `localStorage`).
- „Enhanced learning methods” (domyślnie włączone; etykieta celowo po angielsku): po każdej odpowiedzi obok wyjaśnienia pojawia się kot, smutny przy błędzie, wesoły przy trafieniu.
- `?seed=123` w adresie daje powtarzalny zestaw.

## Układ repo
```
.claude/skills/quiz-bank/SKILL.md   skill generujący pytania
quiz.config.json                    linki Notion + reguła podziału na rozdziały
examples/                           prawdziwe pytania + STYLE.md
source/*.md                         pobrane notatki, plik na stronę (commitowane)
scripts/                            fetch-notes, outline, check-bank
app/                                Vite; app/public/data = bank pytań
.github/workflows/deploy.yml        GitHub Pages
```
