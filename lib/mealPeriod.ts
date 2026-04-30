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

export function getCurrentMealPeriod(date: Date = new Date()): MealPeriod | null {
  // Convert to IST regardless of server tz.
  const istMs = date.getTime() + (5 * 60 + 30 - date.getTimezoneOffset()) * 60_000;
  const ist   = new Date(istMs);
  const h     = ist.getUTCHours();
  if (h >= 7  && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 15 && h < 18) return "snacks";
  if (h >= 18 && h < 22) return "dinner";
  return null;
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
