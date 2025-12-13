#!/usr/bin/env bun

import solidPlugin from "@opentui/solid/bun-plugin"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

process.chdir(__dirname)

import pkg from "./package.json"

const singleFlag = process.argv.includes("--single")

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
}[] = [
  // {
  //   os: "linux",
  //   arch: "arm64",
  // },
  {
    os: "linux",
    arch: "x64",
  },
  // {
  //   os: "linux",
  //   arch: "arm64",
  //   abi: "musl",
  // },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  // {
  //   os: "darwin",
  //   arch: "arm64",
  // },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => item.os === process.platform && item.arch === process.arch)
  : allTargets

await Bun.$`rm -rf dist`

// Install platform-specific native modules for all targets
const skipInstall = process.argv.includes("--skip-install")
if (!skipInstall) {
  console.log("Installing platform-specific native modules...")
  await Bun.$`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
}

for (const item of targets) {
  const name = [
    "effect-devtui",
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  
  console.log(`Building ${name}`)
  await Bun.$`mkdir -p dist/${name}`

  // Build the bun target string (e.g., bun-linux-x64)
  const bunTarget = [
    "bun",
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      target: bunTarget as any,
      outfile: `dist/${name}/${name}${item.os === "win32" ? ".exe" : ""}`,
      execArgv: ["--"],
    },
    entrypoints: ["./src/index.tsx"],
    define: {
      VERSION: `'${pkg.version}'`,
    },
  })

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: pkg.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
}

console.log("Build complete!")
