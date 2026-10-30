import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldAutoDownload, describeProgress, describeModelStatus, type CatalogModel } from "../src/auren-bootstrap.ts";

function fakeModel(over: Partial<CatalogModel> & { id: string; file: string }): CatalogModel {
  return {
    url: "http://127.0.0.1:1/x",
    bytes: 0,
    sha256: "0".repeat(64),
    tier: "small",
    capabilities: ["embed"],
    config: { n_ctx: 2048 },
    ...over,
  };
}

Deno.test("auren-bootstrap: vendored copy in pi-quest is byte-identical to pi-mm", () => {
  const questCopy = join(new URL(".", import.meta.url).pathname, "..", "src", "auren-bootstrap.ts");
  const mmCopy = join(new URL(".", import.meta.url).pathname, "..", "..", "pi-mm", "src", "auren-bootstrap.ts");

  if (!existsSync(mmCopy)) {
    // Sibling extension not installed; pass gracefully
    return;
  }

  const qBytes = readFileSync(questCopy);
  const mBytes = readFileSync(mmCopy);
  if (!qBytes.equals(mBytes)) {
    throw new Error(
      "Drift detected between pi-quest/src/auren-bootstrap.ts and pi-mm/src/auren-bootstrap.ts! Keep them byte-identical.",
    );
  }
});

Deno.test("auren-bootstrap: shouldAutoDownload rejects inference models without embed capability", () => {
  const chatSmall = fakeModel({ id: "qwen", file: "qwen.gguf", tier: "small", capabilities: ["chat", "judge"] });
  const chatLarge = fakeModel({ id: "olmoe", file: "olmoe.gguf", tier: "large", capabilities: ["chat", "judge"] });
  const embedSmall = fakeModel({ id: "bge-base", file: "bge-base.gguf", tier: "small", capabilities: ["embed"] });

  if (shouldAutoDownload(chatSmall, "auto", undefined) !== false) throw new Error("chatSmall must return false");
  if (shouldAutoDownload(chatLarge, "auto", true) !== false) throw new Error("chatLarge must return false");
  if (shouldAutoDownload(embedSmall, "auto", undefined) !== true) throw new Error("embedSmall must return true");
});

Deno.test("auren-bootstrap: describeModelStatus formats download and active model status", () => {
  const idle = { phase: "idle" as const, running: false, started: false, downloads: [], failures: [], pendingConsent: [], configPath: null, notices: [] };
  if (describeModelStatus(idle) !== "🔌 off") throw new Error("idle should return 🔌 off");

  const dl = { phase: "downloading" as const, running: false, started: false, downloads: [{ id: "bge-base", done: 42, total: 100 }], failures: [], pendingConsent: [], configPath: null, notices: [] };
  if (describeProgress(dl) !== "⬇ bge-base (42%)") throw new Error("describeProgress failed");
  if (describeModelStatus(dl) !== "⬇ bge-base (42%)") throw new Error("describeModelStatus download failed");

  const running = { phase: "ready" as const, running: true, started: false, activeModel: "bge-base", downloads: [], failures: [], pendingConsent: [], configPath: null, notices: [] };
  if (describeModelStatus(running) !== "⚡ bge-base") throw new Error("describeModelStatus running failed");
});
