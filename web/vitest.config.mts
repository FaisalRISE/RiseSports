import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    /* The engine modules carry `import "server-only"`, which throws on import
       unless the `react-server` export condition is set — that is precisely how
       it fails the build when a Client Component reaches for one. The test
       runner is a server, so set the condition here or every engine test dies
       on an import it is supposed to be allowed to make. */
    conditions: ["react-server", "node", "import", "default"],
  },
  /* Vitest externalises node_modules and resolves them through the SSR
     resolver, so the condition has to be set there as well — setting it only on
     `resolve` leaves `server-only` resolving to the throwing entry point. */
  ssr: {
    resolve: {
      conditions: ["react-server", "node", "import", "default"],
      externalConditions: ["react-server", "node", "import", "default"],
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
