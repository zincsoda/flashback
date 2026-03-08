import { defineConfig } from "vite";
import { execSync } from "child_process";

function getGitCommitCount() {
  try {
    return execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const appVersion = getGitCommitCount() ?? "—";

export default defineConfig({
  base: "/flashback/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
