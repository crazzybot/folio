/**
 * updateErrors.ts — What to tell the user when checking for updates fails
 * (updater.ts), kept apart from Electron so it can be tested.
 *
 * Errors from Chromium's network stack ("net::ERR_TIMED_OUT", …) mean GitHub
 * couldn't be reached: often a passing problem, sometimes on GitHub's side,
 * so updater.ts retries once before reporting it, and the message says so in
 * plain words, with the error code kept for anyone who needs it.
 */

const NETWORK_ERROR = /\bnet::ERR_[A-Z_]+/;

/** Whether `error` means the network or GitHub couldn't be reached. */
export function isNetworkError(error: Error): boolean {
  return NETWORK_ERROR.test(error.message);
}

/** The message and detail of the "couldn't check" dialog. */
export function describeUpdateError(error: Error): { message: string; detail: string } {
  const code = NETWORK_ERROR.exec(error.message)?.[0];
  if (code !== undefined) {
    return {
      message: "Couldn't reach GitHub to check for updates",
      detail: `Check your internet connection, or try again in a few minutes: GitHub may be having trouble. (${code})`,
    };
  }
  return { message: "Couldn't check for updates", detail: error.message };
}
