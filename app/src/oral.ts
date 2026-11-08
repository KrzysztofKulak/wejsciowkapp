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

Zadajesz ${total} pytań otwartych, po jednym w każdej turze. Każde pytanie wymaga jednej odpowiedzi na jedną rzecz – nie dopisuj drugiej części („…i jakie…”, „…oraz kto…”, „…i od czego zależy…”); jeśli temat ma dwa aspekty, zapytaj tylko o jeden. Na przykład (przykłady celowo z innych dziedzin – pokazują tylko formę, nie zadawaj ich):
- zamiast „Czym jest fotosynteza i gdzie zachodzi?” → „Gdzie w komórce zachodzi fotosynteza?”,
- zamiast „Czym jest inflacja i czym różni się od deflacji?” → „Czym różni się inflacja od deflacji?”. Nie każ podawać nazwisk autorów ani lat: wolno ich użyć w pytaniu, żeby wskazać zagadnienie, ale student ma wyjaśniać treść, nie pamiętać, kto to opisał. Pytaj wyłącznie o to, co jest w materiale, i rozłóż pytania na cały materiał, bez powtarzania tematów. Mieszaj rodzaje: definicja, przykład, porównanie dwóch pojęć, zastosowanie do krótkiej sytuacji, wyjaśnienie wyniku badania. Pytanie ma być krótkie, jednoznaczne i nie może zdradzać odpowiedzi.

Treść pytań i poprawne odpowiedzi bierzesz z materiału, ale student go nie widzi – pytania mają brzmieć jak na prawdziwym egzaminie. Każde pytanie musi samo wskazywać zagadnienie: przez nazwę pojęcia, definicję, autora, rok, nazwę badania albo krótki opis jego przebiegu, tak żeby student, który uczył się tematu, wiedział, o co chodzi. Nigdy nie wskazuj zagadnienia odwołaniem do materiału, notatek, ściągawki, rozdziału, slajdów czy tekstu (żadnego „według materiału”, „opisane w notatkach”, „wymienione w tekście”, „z omawianego badania”). Na przykład (znów tylko forma, z innych dziedzin):
- zamiast „Czym według materiału jest inflacja?” → „Czym jest inflacja?”,
- zamiast „Co wykazał eksperyment opisany w materiale?” → „Co wykazał eksperyment Millera i Ureya (1953), w którym przez mieszaninę gazów przepuszczano wyładowania elektryczne?”,
- zamiast „Jakie trzy rodzaje skał wymieniono?” → „Na jakie trzy rodzaje dzieli się skały ze względu na sposób powstania?”.
W uzasadnieniach też nie wspominaj materiału – po prostu napisz, co jest poprawne.

Oceniasz odpowiedź na to konkretne pytanie, które zadałeś (jego treść jest powtórzona w wiadomości studenta). Odpowiedź na inny temat niż pytanie to „źle”, nawet jeśli sama w sobie jest prawdziwa. Każdą odpowiedź oceniasz jako „dobrze”, „częściowo” albo „źle” i uzasadniasz ocenę w 1–3 krótkich zdaniach: co było trafne, czego zabrakło albo co było błędne. Za poprawne uznajesz to, co zgadza się z materiałem; jeśli materiał ujmuje coś inaczej niż popularne źródła, obowiązuje wersja z materiału. Oceniasz merytorykę, nie styl; odpowiedź może być potoczna, skrótowa albo żartobliwa. Jeśli student nie zna odpowiedzi, oceń „źle” i w uzasadnieniu podaj w skrócie poprawną odpowiedź.

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
  /** The question currently awaiting an answer; repeated next to the answer so grading stays anchored to it. */
  private pendingQuestion: string | null = null;

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
    return this.singleQuestion(this.turn(`Zaczynamy. Zadaj pytanie 1 z ${this.total}.`));
  }

  /** Grades the answer to question `index` (1-based) and asks the next one, unless it was the last. */
  answer(index: number, text: string): Promise<ExaminerTurn> {
    const next = index < this.total ? `Oceń i zadaj pytanie ${index + 1} z ${this.total}.` : "Oceń. To było ostatnie pytanie – nie zadawaj kolejnego (question: null).";
    const q = this.pendingQuestion ? `Pytanie ${index}: ${this.pendingQuestion}\n` : "";
    return this.singleQuestion(this.turn(`${q}Moja odpowiedź na pytanie ${index}:\n${text.trim() || "(brak odpowiedzi)"}\n\n${next}`));
  }

  /**
   * Models sometimes glue a second ask onto a question („Czym jest X i jakie…”) despite the prompt.
   * If the question looks two-part, ask once for a single-part version, keeping this turn's grade.
   */
  private async singleQuestion(pending: Promise<ExaminerTurn>): Promise<ExaminerTurn> {
    const out = await pending;
    const problem = out.question && (looksCompound(out.question) ? "compound" : asksForAuthor(out.question) ? "author" : null);
    if (!problem) return out;
    try {
      const fix = await this.turn(
        problem === "compound"
          ? "To pytanie łączy dwie rzeczy. Zadaj zamiast niego jedno pytanie o jedną z nich (bez drugiej części po „i”/„oraz”). verdict i justification ustaw na null."
          : "To pytanie każe podać autora. Zadaj zamiast niego pytanie o treść tego zagadnienia (autora możesz wymienić w pytaniu). verdict i justification ustaw na null.",
      );
      const question = fix.question ?? out.question;
      this.pendingQuestion = question;
      return { ...out, question };
    } catch {
      return out; // the original question is still usable
    }
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
    this.pendingQuestion = out.question;
    return out;
  }
}

/** „…? … i jak/jaki/czym/dlaczego/kto/gdzie/kiedy/w jakim/od czego/co …” or „oraz” joining a second ask. */
export function looksCompound(q: string): boolean {
  return /[,\s](i|oraz|a także)\s+(jak\w*|czym|czy|dlaczego|kto|kogo|gdzie|kiedy|co|ile|od czego|w jaki\w*|na czym|po co|z czego)\b/i.test(q);
}

/** „Kto sformułował/opisał/stworzył…?” – asks for a name instead of content. */
export function asksForAuthor(q: string): boolean {
  return /^\s*(kto|który badacz|jaki badacz|czyim)\b.*\b(sformułował|opisał|stworzył|zaproponował|autorem|przeprowadził|wprowadził|odkrył|badał|twórc)/i.test(q);
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
