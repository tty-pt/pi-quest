import { check } from "./check.ts";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

Deno.test("bundle packaging generates pi-quest-bundle.zip", async () => {
  const PKG = resolve(new URL("..", import.meta.url).pathname);
  const OUT = join(PKG, "pi-quest-bundle.zip");
  const INPUTS = [
    "index.ts",
    "package.json",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "cover.png",
    "thumb.png",
    "src",
    "tests",
    "scripts",
    "docs",
    "skills",
  ];

  const cmd = new Deno.Command("zip", {
    args: ["-r", "-q", OUT, ...INPUTS],
    cwd: PKG,
  });
  const res = await cmd.output();
  check(res.code === 0, "zip packaging must exit with 0");
  check(existsSync(OUT), "pi-quest-bundle.zip must exist");
});
