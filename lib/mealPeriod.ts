// ─── Meal-period helpers ────────────────────────────────────────────────
// The student menu hides items whose vendor-assigned category does not match
// the current meal window. This is a UI-only restriction — backend order
// validation remains the source of truth (cart/check, slot capacity, etc.).
//
// Windows (IST, 24h):
//   breakfast 07:00–11:00
//   lunch     11:00–15:00
//   snacks    15:00–18:00
//   dinner    18:00–22:00
// Outside any window → return null (caller should NOT filter so the menu
// stays usable; canteen-open guard handles "after hours").

export type MealPeriod = "breakfast" | "lunch" | "snacks" | "dinner";

export interface MealWindow { start: string; end: string }
export interface MealWindows {
  breakfast: MealWindow | null;
  lunch:     MealWindow | null;
  snacks:    MealWindow | null;
  dinner:    MealWindow | null;
}

export const DEFAULT_WINDOWS: MealWindows = {
  breakfast: { start: "07:00", end: "11:00" },
  lunch:     { start: "11:00", end: "15:00" },
  snacks:    { start: "15:00", end: "18:00" },
  dinner:    { start: "18:00", end: "22:00" },
};

function istHourMinutes(date: Date): number {
  const istMs = date.getTime() + 330 * 60_000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function getCurrentMealPeriod(
  date: Date = new Date(),
  windows: MealWindows = DEFAULT_WINDOWS,
): MealPeriod | null {
  const nowMin = istHourMinutes(date);
  const order: MealPeriod[] = ["breakfast", "lunch", "snacks", "dinner"];
  for (const p of order) {
    const w = windows[p];
    if (!w) continue;
    const s = toMin(w.start), e = toMin(w.end);
    if (nowMin >= s && nowMin < e) return p;
  }
  return null;
}

export function mealLabel(p: MealPeriod, w: MealWindow | null): string {
  const base = { breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner" }[p];
  if (!w) return base;
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const h12 = ((h + 11) % 12) + 1;
    const ap = h < 12 ? "AM" : "PM";
    return m ? `${h12}:${String(m).padStart(2, "0")} ${ap}` : `${h12} ${ap}`;
  };
  return `${base} (${fmt(w.start)}–${fmt(w.end)})`;
}

// Vendor stores meal type as the `category` column with values like
// "🌅 Breakfast" / "☀️ Lunch" / "🌙 Dinner" / "🥡 Packed snacks". Normalise
// any of those (or raw "breakfast"/"lunch" strings) to a MealPeriod.
export function categoryToMealPeriod(category: string | null | undefined): MealPeriod | null {
  if (!category) return null;
  const norm = category.toLowerCase();
  if (norm.includes("breakfast"))                   return "breakfast";
  if (norm.includes("lunch"))                       return "lunch";
  if (norm.includes("snack") || norm.includes("packed")) return "snacks";
  if (norm.includes("dinner"))                      return "dinner";
  return null;
}

export const MEAL_LABEL: Record<MealPeriod, string> = {
  breakfast: "Breakfast (7–11 AM)",
  lunch:     "Lunch (11 AM–3 PM)",
  snacks:    "Snacks (3–6 PM)",
  dinner:    "Dinner (6–10 PM)",
};
