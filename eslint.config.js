// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Logging goes through pino (src/logger.ts). The one console call, in config.ts,
      // runs before the logger exists and already carries a disable directive.
      "no-console": "error",

      // Event listeners (manager.on, collector.on) are async on purpose. A rejection
      // reaches the process-level unhandledRejection handler in src/index.ts and is
      // logged. Other promise misuse (in conditions, spreads, returns) stays checked.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],

      // An async listener with no await is not a mistake here: being async turns a
      // synchronous throw into a logged rejection instead of throwing into the
      // emitter. Dropping the keyword would change behaviour.
      "@typescript-eslint/require-await": "off",

      // Style only: redundant `as` casts are erased at compile time.
      // `eslint --fix` removes them all if this is turned back on.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // Here `any` comes from outside this code: dynamic import() of command/event
    // modules, lavalink-client's own typings (Player.play, Queue.add and
    // Queue.splice return `any`, though all three are async at runtime), and
    // discord.js's untyped "raw" gateway payload. Everywhere else stays checked.
    files: [
      "src/lib/loaders.ts",
      "src/deploy-commands.ts",
      "src/lavalink/fallback.ts",
      "src/commands/remove.ts",
      "src/index.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
