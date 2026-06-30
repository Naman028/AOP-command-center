import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules", "dist", "build", "coverage"]
  },
  {
    files: ["client/src/**/*.{js,jsx}", "server/src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest
      }
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-console": ["error", { "allow": ["warn", "error"] }]
    }
  },
  {
    files: ["client/src/**/*.jsx"],
    rules: {
      "no-unused-vars": "off"
    }
  }
];
