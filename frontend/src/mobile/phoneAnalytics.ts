import { capture } from "../analytics/analytics";
import type {
  AnalyticsEvent,
  AnalyticsProperties,
  ScreenViewedScreen,
  ViewModeChangedMode,
} from "../analytics/analytics";

// BL-244 / BL-247 S1-27: the phone's analytics calls. Same events and
// property shapes as the desktop call sites (App.tsx screen_viewed,
// CardsPage sort_changed / finish_scope_changed / search_performed,
// FilterPanel filters_cleared, FeedbackModal feedback_submitted,
// InventorySummary view_mode_changed); every phone event also carries
// `layout: "phone"` explicitly (the registered super-property says the
// same; the explicit copy keeps the shape visible at the call site and in
// tests). Enums and counts only -- nothing user-typed.

export function capturePhone(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  capture(event, { ...properties, layout: "phone" });
}

export function phoneScreenViewed(screen: ScreenViewedScreen): void {
  capturePhone("screen_viewed", { screen });
}

export function phoneViewMode(mode: ViewModeChangedMode): void {
  capturePhone("view_mode_changed", { mode });
}
