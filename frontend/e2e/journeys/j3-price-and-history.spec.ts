import { expect } from "@playwright/test";
import {
  activePrice,
  closeCard,
  historyPanel,
  isPhone,
  journeyTest,
  openCardInSet,
  signedInVault,
} from "./_helpers";

// BL-279 WS-3 W3-09, journey J3: a card opened from the vault shows its price
// plate (the active printing's price in the rail) and its price history
// renders for that printing. Seed: SOR 5 Luke Skywalker (owned 1). Whether the
// target database holds a price row for it is not part of the seed: the journey
// asserts whichever state the product shows and that the two agree (a priced
// printing draws a chart or the sparse-data note; an unpriced printing shows
// the em-dash and the explicit "No price data" state), and it reports which one
// it saw through an annotation.
const J3_CARD = { set: "SOR", number: 5, name: "Luke Skywalker" };

journeyTest.describe.configure({ mode: "serial" });

journeyTest("j3 a card shows its price plate and its history renders", async ({ page }, info) => {
  await signedInVault(page, info);
  await openCardInSet(page, info, J3_CARD);

  const price = activePrice(page, info);
  // Wait for a settled value (a price or the explicit dash), not a placeholder.
  await expect(price).toHaveText(/^(\$\d+\.\d{2}|—)$/, { timeout: 20_000 });
  const shown = ((await price.textContent()) ?? "").trim();

  const panel = historyPanel(page);
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  // The panel leaves its loading state.
  await expect(panel.getByText("Loading price history…")).toHaveCount(0, { timeout: 20_000 });

  if (shown === "—") {
    info.annotations.push({ type: "j3-state", description: "no price on this target" });
    await expect(panel.getByTestId("price-history-empty")).toBeVisible();
    await expect(panel.getByText("No price data for this printing")).toBeVisible();
  } else {
    info.annotations.push({ type: "j3-state", description: `priced ${shown}` });
    expect(shown).toMatch(/^\$\d+\.\d{2}$/);
    await expect(panel.getByTestId("price-history-empty")).toHaveCount(0);
    // Priced: the chart's line (a single dated point shows the sparse note).
    const chart = isPhone(info) ? panel.locator(".m-chart__svg") : panel.locator(".php-chart");
    const sparse = panel.getByTestId("price-history-sparse");
    await expect(chart.or(sparse).first()).toBeVisible();
    if (isPhone(info)) await expect(panel.locator(".m-chart__price")).toHaveText(/^\$\d/);
  }

  await closeCard(page, info);
});
