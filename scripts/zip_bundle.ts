import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

// Minimal bundle renderer (re-derived): zips the package source tree +
// docs into pi-quest-bundle.zip at the project root. Quest-state rendering
// (run manifest, quest view, session range) lands with the views slice (S3).

const PKG = resolve(new URL("..", import.meta.url).pathname);

function resolveProjectRoot(pkgDir: string): string {
  // 1. Env override
  const envRoot = Deno.env.get("PI_PROJECT_ROOT") || Deno.env.get("PROJECT_ROOT");
  if (envRoot && existsSync(envRoot)) return resolve(envRoot);

  // 2. Check current working directory
  const cwd = Deno.cwd();
  if (existsSync(join(cwd, ".pi")) || existsSync(join(cwd, ".git"))) {
    return resolve(cwd);
  }

  // 3. Known project root
  if (existsSync("/home/quirinpa/site")) return "/home/quirinpa/site";

  // 4. Walk upwards from pkgDir until we find .git or .pi
  let curr = resolve(pkgDir);
  while (curr !== dirname(curr)) {
    if (existsSync(join(curr, ".git")) || existsSync(join(curr, ".pi"))) {
      return curr;
    }
    curr = dirname(curr);
  }

  return pkgDir;
}

const ROOT = resolveProjectRoot(PKG);
const OUT = join(ROOT, "pi-quest-bundle.zip");
const INPUTS = [
  "index.ts",
  "package.json",
  "AGENTS.md",
  "README.md",
  "src",
  "tests",
  "scripts",
  "docs",
  "skills",
];

let code = 1;
let stderr = new Uint8Array();

try {
  const cmd = new Deno.Command("zip", {
    args: ["-r", "-q", OUT, ...INPUTS],
    cwd: PKG,
    stdout: "piped",
    stderr: "piped",
  });
  const res = await cmd.output();
  code = res.code;
  stderr = res.stderr;
} catch {
  // Fallback to python3 -m zipfile if zip executable is not available
  const pyCmd = new Deno.Command("python3", {
    args: ["-m", "zipfile", "-c", OUT, ...INPUTS],
    cwd: PKG,
    stdout: "piped",
    stderr: "piped",
  });
  const res = await pyCmd.output();
  code = res.code;
  stderr = res.stderr;
}
if (code !== 0) {
  const err = new TextDecoder().decode(stderr).trim();
  console.error(`bundle zip packaging failed: ${err || `exit ${code}`}`);
  Deno.exit(1);
}
console.log(`pi-quest-bundle.zip: ${OUT}`);
if (ROOT !== "/home/quirinpa/site" && existsSync("/home/quirinpa/site")) {
  try {
    Deno.copyFileSync(OUT, "/home/quirinpa/site/pi-quest-bundle.zip");
    console.log(`pi-quest-bundle.zip copied to: /home/quirinpa/site/pi-quest-bundle.zip`);
  } catch { /* best effort */ }
}
