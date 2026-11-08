/**
 * "Przepytaj mnie": an oral open-question quiz run by Claude straight from the browser.
 * The user pastes their own API key; it goes only from this page to api.anthropic.com
 * (the site has no backend). Material = the cheatsheets of the selected scope.
 * Loaded with a dynamic import so the SDK isn't part of the main bundle.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { OralModel } from "./oral-models";

/** One examiner turn: the grade of the previous answer (absent on the first turn) and the next question (absent after the last). */
const Turn = z.object({
  verdict: z.enum(["dobrze", "częściowo", "źle"]).nullable(),
  justification: z.string().nullable(),
  question: z.string().nullable(),
});
export type ExaminerTurn = z.infer<typeof Turn>;
export type Verdict = NonNullable<ExaminerTurn["verdict"]>;
export type MaterialPart = { title: string; markdown: string };

function systemPrompt(total: number): string {
  return `Jesteś egzaminatorem, który przepytuje studenta psychologii ustnie z materiału podanego w <material>. Cała rozmowa jest po polsku.

Zadajesz ${total} pytań otwartych, po jednym w każdej turze. Każde pytanie dotyczy jednej rzeczy – nie łącz kilku pytań w jedno, bo student odpowiada na jedno naraz. Pytaj wyłącznie o to, co jest w materiale, i rozłóż pytania na cały materiał, bez powtarzania tematów. Mieszaj rodzaje: definicja, przykład, porównanie dwóch pojęć, zastosowanie do krótkiej sytuacji, wyjaśnienie wyniku badania. Pytanie ma być krótkie i jednoznaczne.

Materiał to tylko Twoje źródło wiedzy i miara poprawności – student go nie widzi, a pytania mają brzmieć jak na prawdziwym egzaminie. Dlatego ani w pytaniach, ani w uzasadnieniach nie odwołuj się do materiału, notatek, ściągawki, rozdziału czy slajdów (żadnego „według materiału”, „w notatkach”, „w tekście”). Zamiast „Czym według materiału jest atrybucja?” zapytaj po prostu „Czym jest atrybucja?”. Nazwisko autora badania lub teorii możesz podać, jeśli pomaga wskazać, o co chodzi.

Oceniasz każdą odpowiedź jako „dobrze”, „częściowo” albo „źle” i uzasadniasz ocenę w 1–3 krótkich zdaniach: co było trafne, czego zabrakło albo co było błędne. Oceniasz merytorykę, nie styl; odpowiedź może być potoczna, skrótowa albo żartobliwa. Jeśli student nie zna odpowiedzi, oceń „źle” i w uzasadnieniu podaj w skrócie poprawną odpowiedź.

Odpowiadasz zawsze w ustalonym formacie JSON: verdict i justification oceniają poprzednią odpowiedź (null w pierwszej turze), question to następne pytanie (null, gdy pytań już nie ma).`;
}

function materialBlock(parts: MaterialPart[]): string {
  return `<material>\n${parts.map((p) => `<rozdzial tytul="${p.title.replace(/"/g, "'")}">\n${p.markdown.trim()}\n</rozdzial>`).join("\n\n")}\n</material>`;
}

/** Thrown for problems the user can act on; `message` is shown as is. */
export class OralError extends Error {}

export class OralExam {
  private client: Anthropic;
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  private system: Anthropic.Beta.BetaTextBlockParam[];

  constructor(apiKey: string, parts: MaterialPart[], readonly total: number, private model: OralModel) {
    // The key is the user's own and is typed into this page, so a browser client is the intended setup here.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    this.system = [
      { type: "text", text: systemPrompt(total) },
      // The material is identical on every turn: cache it.
      { type: "text", text: materialBlock(parts), cache_control: { type: "ephemeral" } },
    ];
  }

  /** First question. */
  start(): Promise<ExaminerTurn> {
    return this.turn(`Zaczynamy. Zadaj pytanie 1 z ${this.total}.`);
  }

  /** Grades the answer to question `index` (1-based) and asks the next one, unless it was the last. */
  answer(index: number, text: string): Promise<ExaminerTurn> {
    const next = index < this.total ? `Oceń i zadaj pytanie ${index + 1} z ${this.total}.` : "Oceń. To było ostatnie pytanie – nie zadawaj kolejnego (question: null).";
    return this.turn(`Moja odpowiedź na pytanie ${index}:\n${text.trim() || "(brak odpowiedzi)"}\n\n${next}`);
  }

  /** One request. The user message joins the history only after a successful reply, so a failed call can simply be retried. */
  private async turn(userText: string): Promise<ExaminerTurn> {
    const userMsg: Anthropic.Beta.BetaMessageParam = { role: "user", content: userText };
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4000,
        // Sonnet 5.5 supports the server-side "default" fallback (a declined request is retried on its fallback model);
        // Haiku 5.5 has no server-side fallback, so a refusal there just shows the refusal message below.
        ...(this.model === "claude-sonnet-5-5" && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        system: this.system,
        messages: [...this.messages, userMsg],
        output_config: { effort: "low", format: betaZodOutputFormat(Turn) },
      });
    } catch (e) {
      throw new OralError(describeError(e));
    }
    if (response.stop_reason === "refusal") throw new OralError("Claude odmówił odpowiedzi na to pytanie. Spróbuj ponownie albo zakończ przepytkę.");
    if (response.stop_reason === "max_tokens") throw new OralError("Odpowiedź Claude'a została ucięta. Spróbuj ponownie.");
    const out = response.parsed_output;
    if (!out) throw new OralError("Nie udało się odczytać odpowiedzi Claude'a. Spróbuj ponownie.");
    // Keep the full assistant content (thinking blocks included) so the conversation stays valid for the next turn.
    this.messages.push(userMsg, { role: "assistant", content: response.content });
    return out;
  }
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Nieprawidłowy klucz API – sprawdź, czy skopiowałeś go w całości.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Ten klucz API nie ma dostępu do modelu. Sprawdź uprawnienia w konsoli Anthropic.";
  if (e instanceof Anthropic.RateLimitError) return "Przekroczony limit zapytań albo brak środków na koncie. Odczekaj chwilę i spróbuj ponownie.";
  if (e instanceof Anthropic.BadRequestError) return `Błędne zapytanie: ${e.message}`;
  if (e instanceof Anthropic.InternalServerError) return "Serwery Anthropic są chwilowo przeciążone. Spróbuj ponownie za chwilę.";
  if (e instanceof Anthropic.APIConnectionError) return "Brak połączenia z api.anthropic.com. Sprawdź internet i spróbuj ponownie.";
  if (e instanceof Anthropic.APIError) return `Błąd API (${e.status}): ${e.message}`;
  return `Nieoczekiwany błąd: ${(e as Error)?.message ?? e}`;
}
