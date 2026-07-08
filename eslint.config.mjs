import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores: files and directories ESLint should never look at
  {
    ignores: [
      "dist/",
      "coverage/",
      "node_modules/",
      ".changeset/",
      "*.config.*", // tsup, vitest, etc. config files (checked by tsc instead)
    ],
  },

  // Base JavaScript rules from ESLint core
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    rules: {
      // Allow console.log in CLI code (it's a CLI tool — logging is the point)
      "no-console": "off",

      // Discourage `any` but don't forbid it absolutely (sometimes needed for
      // third-party types or incremental migration)
      "@typescript-eslint/no-explicit-any": "warn",

      // Unused variables are bugs; enforce removal
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_", // Allow _prefix for intentionally unused args
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
