#!/usr/bin/env bun

import solidPlugin from "@opentui/solid/bun-plugin"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

process.chdir(__dirname)

import pkg from "./package.json"

console.log("Building for npm publish...")

await Bun.$`mkdir -p dist`

// Build a JavaScript bundle for npm (not a binary)
const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  target: "node",
  minify: false,
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  format: "esm",
  define: {
    VERSION: `'${pkg.version}'`,
  },
})

if (!result.success) {
  console.error("Build failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("NPM build complete!")
console.log("Output: dist/index.js")
