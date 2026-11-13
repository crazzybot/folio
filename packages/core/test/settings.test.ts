import { describe, expect, it } from "vitest";
import { reviewIntroSetting } from "../src/settings";

describe("reviewIntroSetting", () => {
  it("gives the saved wording, null when turned off, undefined for the default", () => {
    expect(reviewIntroSetting({})).toBeUndefined();
    expect(reviewIntroSetting({ reviewIntro: "  " })).toBeUndefined();
    expect(reviewIntroSetting({ reviewIntro: "Notes on {documents}:" })).toBe("Notes on {documents}:");
    expect(reviewIntroSetting({ reviewIntroOn: false, reviewIntro: "Notes:" })).toBeNull();
    // Malformed: the default
    expect(reviewIntroSetting({ reviewIntroOn: "no", reviewIntro: 3 })).toBeUndefined();
  });
});
