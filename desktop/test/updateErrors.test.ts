import { describe, expect, it } from "vitest";
import { describeUpdateError, isNetworkError } from "../src/updateErrors";

describe("update errors", () => {
  it("tells network errors from others", () => {
    expect(isNetworkError(new Error("net::ERR_TIMED_OUT"))).toBe(true);
    expect(isNetworkError(new Error("Error: net::ERR_CONNECTION_RESET at SimpleURLLoaderWrapper"))).toBe(true);
    expect(isNetworkError(new Error("HttpError: 404 Not Found"))).toBe(false);
    expect(isNetworkError(new Error("Code signature at URL … did not pass validation"))).toBe(false);
  });

  it("explains a network error in plain words, keeping its code", () => {
    const { message, detail } = describeUpdateError(new Error("Error: net::ERR_TIMED_OUT\n    at SimpleURLLoaderWrapper"));
    expect(message).toBe("Couldn't reach GitHub to check for updates");
    expect(detail).toMatch(/internet connection/);
    expect(detail).toMatch(/\(net::ERR_TIMED_OUT\)$/);
  });

  it("shows other errors as they are", () => {
    expect(describeUpdateError(new Error("HttpError: 404 Not Found"))).toEqual({
      message: "Couldn't check for updates",
      detail: "HttpError: 404 Not Found",
    });
  });
});
