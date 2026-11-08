/** Models offered in the "Przepytaj mnie" form (kept apart from oral.ts so the form doesn't load the SDK). */
export const ORAL_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 – najszybszy i najtańszy" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 – dokładniejsze oceny" },
] as const;
export type OralModel = (typeof ORAL_MODELS)[number]["id"];
export const DEFAULT_ORAL_MODEL: OralModel = "claude-haiku-5-5";
export const isOralModel = (id: unknown): id is OralModel => ORAL_MODELS.some((m) => m.id === id);
