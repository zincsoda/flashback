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
  plugins: [
    {
      name: "version-endpoint",
      enforce: "pre",
      configureServer(server) {
        const base = server.config.base?.replace(/\/$/, "") || "";
        server.middlewares.use((req, res, next) => {
          const path = base ? req.url?.replace(base, "") || req.url : req.url;
          if (path === "/__version__" || path === "__version__") {
            res.setHeader("Content-Type", "text/plain");
            res.end(getGitVersion() ?? "—");
            return;
          }
          next();
        });
      },
    },
  ],
});
