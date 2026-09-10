#!/usr/bin/env node

/**
 * build.mjs — thin wrapper delegating to @comity-dev/build binary.
 *
 * This script preserves the original community package build interface
 * while delegating implementation to the development-owned package.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, ".."); // community root
const CWD = process.cwd();

function exec(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args.filter((a) => a !== ""), {
      stdio: "inherit",
      cwd: CWD,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");

  // Delegate to comity-build binary (available at repo root node_modules/.bin)
  const binaryPath = resolve(ROOT, "node_modules", ".bin", "comity-build");
  
  try {
    await exec(binaryPath, watch ? ["--watch"] : []);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();