import { describe, expect, it } from "vitest";
import { OFFICIAL_CDN, namesOfficialCdn } from "./officialCdn.mjs";

describe("namesOfficialCdn", () => {
  it.each([
    `<img src="https://${OFFICIAL_CDN}//card_x.png">`,
    `<a href="//${OFFICIAL_CDN}/x">`,
    `background:url(https://${OFFICIAL_CDN}/a.png)`,
    `fallback('https://${OFFICIAL_CDN}//x.png')`,
    `"front_image_url":"https:\\/\\/${OFFICIAL_CDN}\\/\\/x.png"`,
    `images from ${OFFICIAL_CDN}.`,
    `<img src="https://CDN.StarWarsUnlimited.COM/x.png">`,
    `https://img.${OFFICIAL_CDN}/x.png`,
    `<loc>https://${OFFICIAL_CDN}</loc>`,
  ])("finds the host in %s", (text) => {
    expect(namesOfficialCdn(text)).toBe(true);
  });

  it.each([
    `<img src="/images/cards/card_x_640.webp">`,
    `https://www.hyperspacevault.com/images/cards/card_x.png`,
    `starwarsunlimited.com/cards`,
    `https://notcdn.starwarsunlimited.community/x`,
    "",
  ])("passes %s", (text) => {
    expect(namesOfficialCdn(text)).toBe(false);
  });
});
