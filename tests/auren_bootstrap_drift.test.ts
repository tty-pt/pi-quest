import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
