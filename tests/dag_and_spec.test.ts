import { check } from "./check.ts";

async function* walkTs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkTs(p);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield p;
    }
  }
}

Deno.test("DAG gate: modules form an acyclic graph and domain remains pure", async () => {
  const SRC = new URL("../src", import.meta.url).pathname;
  const files: string[] = [];
  for await (const f of walkTs(SRC)) files.push(f);

  const relOf = (p: string) => p.slice(SRC.length + 1);
  const exists = new Set(files.map((f) => relOf(f)));

  const importRe = /^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm;
  const edges = new Map<string, string[]>();
  for (const f of files) {
    const text = await Deno.readTextFile(f);
    const deps: string[] = [];
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      const base = relOf(f).split("/").slice(0, -1).join("/");
      const parts = (base ? base + "/" : "") + spec;
      const norm = parts.split("/").reduce<string[]>((acc, seg) => {
        if (seg === "." || seg === "") return acc;
        if (seg === "..") acc.pop();
        else acc.push(seg);
        return acc;
      }, []).join("/");
      for (const cand of [`${norm}.ts`, `${norm}/index.ts`]) {
        if (exists.has(cand)) {
          deps.push(cand);
          break;
        }
      }
    }
    edges.set(relOf(f), deps);
  }

  // Cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[] = [];
  const visit = (start: string, trail: string[]): void => {
    const stack: Array<{ node: string; iter: number }> = [{ node: start, iter: 0 }];
    const localTrail = [...trail];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (color.get(top.node) === BLACK) {
        stack.pop();
        localTrail.pop();
        continue;
      }
      if (color.get(top.node) !== GRAY) {
        color.set(top.node, GRAY);
        localTrail.push(top.node);
      }
      const deps = edges.get(top.node) ?? [];
      if (top.iter < deps.length) {
        const next = deps[top.iter];
        top.iter++;
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          cycles.push([...localTrail, next].join(" -> "));
        } else if (c === WHITE) {
          stack.push({ node: next, iter: 0 });
        }
      } else {
        color.set(top.node, BLACK);
        stack.pop();
        localTrail.pop();
      }
    }
  };

  for (const f of edges.keys()) {
    if ((color.get(f) ?? WHITE) === WHITE) visit(f, []);
  }

  check(cycles.length === 0, `DAG cycles found: ${cycles.join("; ")}`);

  // Domain purity
  const domainViolations: string[] = [];
  for (const [from, deps] of edges) {
    if (!from.startsWith("domain/")) continue;
    for (const d of deps) {
      if (!d.startsWith("domain/")) {
        domainViolations.push(`${from} imports ${d}`);
      }
    }
  }
  check(domainViolations.length === 0, `Domain purity violations: ${domainViolations.join("; ")}`);
});

Deno.test("Spec-map gate: code references all HIGH_LEVEL sections accurately", async () => {
  const PKG = new URL("..", import.meta.url).pathname;
  const SPEC = `${PKG}/../../../HIGH_LEVEL.md`;
  const SRC = `${PKG}/src`;

  const specText = await Deno.readTextFile(SPEC);
  const sections = new Set<string>();
  for (const line of specText.split("\n")) {
    const m = line.match(/^#{1,2}\s+([a-z].*?)\s*$/);
    if (m) sections.add(m[1]);
  }

  const tagRe = /HIGH_LEVEL:\s*#([a-z][a-z0-9 ()-]*)/gm;
  const PENDING: Record<string, string> = {
    "tools (main agent)": "S3",
    "tools (other agents)": "S3",
    "commands": "S3",
    "skill": "S3",
    "configurations": "S2-S3",
    "interfaces": "S2-S3",
    "review and validation communication": "S2",
    "review request": "S2",
    "review result": "S2",
    "stale results": "S2",
    "rebuttal": "S2",
    "reviewer independence": "S2",
    "validator communication": "S2",
    "no direct mutation": "S2",
    "quest creation": "S1",
    "storage": "S1",
    "independent review contexts": "S2",
    "review independence": "S2",
  };
  const hits = new Map<string, string[]>();
  for await (const path of walkTs(SRC)) {
    const text = await Deno.readTextFile(path);
    tagRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
      const name = m[1].trim();
      if (!hits.has(name)) hits.set(name, []);
      hits.get(name)!.push(path.slice(SRC.length + 1));
    }
  }

  const EXEMPT = new Set(["intro", "dependencies"]);
  const missing: string[] = [];
  for (const s of sections) {
    if (hits.has(s) || EXEMPT.has(s) || PENDING[s]) continue;
    missing.push(s);
  }
  check(missing.length === 0, `Missing HIGH_LEVEL section tags: ${missing.join(", ")}`);

  const unknown: string[] = [];
  for (const t of hits.keys()) {
    if (!sections.has(t)) unknown.push(t);
  }
  check(unknown.length === 0, `Unknown HIGH_LEVEL section tags: ${unknown.join(", ")}`);
});
