import { expect } from "@playwright/test";
import {
  closeCard,
  decrement,
  increment,
  journeyTest,
  openCard,
  readQuantity,
  reloadCard,
  settled,
  signedInVault,
} from "./_helpers";

// BL-279 WS-3 W3-08, journey J2 (the @smoke): a returning user, signed in on a
// clean browser (the setup project's fresh-context sign-in), adds one copy of
// a card and finds it still there after a reload. Seed: tenant A from
// seed-a.csv; the J2 card, SOR 200 Spark of Rebellion, is not in it, so it
// starts at 0. The journey removes its own copy at the end (the catalogue's
// terminal step), so a run leaves tenant A as the seed left it.
const J2_CARD = { set: "SOR", number: 200, name: "Spark of Rebellion" };

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j2 @smoke a signed-in user adds a copy and it survives a reload",
  async ({ page }, info) => {
    await signedInVault(page, info);

    await openCard(page, info, J2_CARD);
    await expect(readQuantity(page, info)).toHaveText("0");

    await increment(page, info, J2_CARD);
    await expect(readQuantity(page, info)).toHaveText("1");
    await settled(page, info);

    await reloadCard(page, info, J2_CARD);
    await expect(readQuantity(page, info)).toHaveText("1");

    await decrement(page, info, J2_CARD);
    await expect(readQuantity(page, info)).toHaveText("0");
    await settled(page, info);
    await closeCard(page, info);
  }
);
