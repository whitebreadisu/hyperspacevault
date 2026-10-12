import { expect, measureEach, test } from "./helpers";

test.afterEach(measureEach);

// S1-10: fixtures answer, .m-app renders, zero failed requests / console errors.
test("s1-10-harness-boots", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone harness");
  await page.goto("/");
  await expect(page.locator(".m-app")).toBeVisible();
  const status = await page.evaluate(async () => {
    const get = async (u: string) => {
      const r = await fetch(u);
      return {
        status: r.status,
        body: r.headers.get("content-type")?.includes("json") ? await r.json() : null,
      };
    };
    return {
      cards: await get("/api/base-cards"),
      sets: await get("/api/sets"),
      qty: await get("/api/inventory/quantities"),
      limits: await get("/api/settings/limits"),
      img: (await fetch("/images/cards/x_320.webp")).status,
    };
  });
  expect(status.cards.body).toHaveLength(53);
  // PORT (BL-258 FR2-05): 28 prototype sets + hand-added HMW and HMWP.
  expect(status.sets.body).toHaveLength(30);
  expect(status.qty.status).toBe(200);
  expect(status.limits.body.limits).toHaveLength(30);
  expect(status.img).toBe(200);
  // auth.setup.ts's signed-in session came through storageState (IndexedDB).
  const signedIn = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("firebaseLocalStorageDb");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("firebaseLocalStorage")) return resolve(false);
          const all = db
            .transaction("firebaseLocalStorage")
            .objectStore("firebaseLocalStorage")
            .getAll();
          all.onsuccess = () =>
            resolve(
              all.result.some(
                (r: { value?: { email?: string } }) => r.value?.email === "e2e@hsv.test"
              )
            );
          all.onerror = () => resolve(false);
        };
      })
  );
  expect(signedIn).toBe(true);
});
