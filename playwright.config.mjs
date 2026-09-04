import { defineConfig, devices } from "@playwright/test";

// Chromium ships in some sandboxes at a fixed path; honour it when set so the
// suite does not re-download a browser it already has.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests",
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...devices["Pixel 7"],
    launchOptions: executablePath ? { executablePath } : {}
  },
  webServer: {
    command: "python3 -m http.server 4173",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    stdout: "ignore"
  }
});
