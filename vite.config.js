import { defineConfig } from "vite";
import { execSync } from "child_process";

function getGitVersion() {
  try {
    const count = execSync("git rev-list --count HEAD", {
      encoding: "utf-8",
    }).trim();
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
    }).trim();
    return `${count}.${sha}`;
  } catch {
    return null;
  }
}

const appVersion = getGitVersion() ?? "—";

export default defineConfig({
  base: "/flashback/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
