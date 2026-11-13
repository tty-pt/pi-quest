// Complexity gate (re-derived, self-contained, fail-closed per RD2):
// file <350 LOC, function <80 LOC. Any violation fails the build.

async function* walkTs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkTs(p);
    } else if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.includes(".test.")
    ) {
      yield p;
    }
  }
}

const SRC = new URL("../src", import.meta.url).pathname;
const BUDGET_FILE_LOC = 350;
const BUDGET_FN_LOC = 80;

function estimateFnSize(
  text: string,
): Array<{ name: string; loc: number }> {
  const lines = text.split("\n");
  const fns: Array<{ name: string; start: number; end: number }> = [];
  const re =
    /^\s*(export\s+)?(async\s+)?function\s+(\w+)|^\s*(export\s+)?(async\s+)?(const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(.*?\)\s*(?::\s*[^=]+)?=>|^\s*(export\s+)?(async\s+)?(const|let)\s+(\w+)\s*=\s*(?:async\s*)?function/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const name = m[3] || m[7] || m[11] || `anon@${i + 1}`;
    let depth = 0;
    let foundOpen = false;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === "{") {
          depth++;
          foundOpen = true;
        } else if (ch === "}") {
          depth--;
          if (foundOpen && depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (foundOpen && depth === 0) break;
    }
    fns.push({ name, start: i, end: Math.max(i, end) });
  }
  return fns.map((f) => ({
    name: f.name,
    loc: f.end - f.start + 1,
  }));
}

let failures = 0;
for await (const path of walkTs(SRC)) {
  const short = path.slice(SRC.length + 1);
  if (short === "auren-bootstrap.ts") continue; // Vendored byte-identical utility with pi-mm
  const text = await Deno.readTextFile(path);
  const loc = text.split("\n").length;
  if (loc > BUDGET_FILE_LOC) {
    console.error(`FAIL file ${short}: ${loc} LOC > ${BUDGET_FILE_LOC}`);
    failures++;
  }
  for (const fn of estimateFnSize(text)) {
    if (fn.loc > BUDGET_FN_LOC) {
      console.error(
        `FAIL func ${fn.name} in ${short}: ${fn.loc} LOC > ${BUDGET_FN_LOC}`,
      );
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`complexity: ${failures} violation(s)`);
  Deno.exit(1);
}
console.log("complexity: ok");
