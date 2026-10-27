import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

Deno.test("versions: vendored copy in pi-quest is byte-identical to pi-mm", () => {
  const questCopy = join(new URL(".", import.meta.url).pathname, "..", "src", "versions.ts");
  const mmCopy = join(new URL(".", import.meta.url).pathname, "..", "..", "pi-mm", "src", "versions.ts");

  if (!existsSync(mmCopy)) {
    // Sibling extension not installed; pass gracefully
    return;
  }

  const qBytes = readFileSync(questCopy);
  const mBytes = readFileSync(mmCopy);
  if (!qBytes.equals(mBytes)) {
    throw new Error(
      "Drift detected between pi-quest/src/versions.ts and pi-mm/src/versions.ts! Keep them byte-identical.",
    );
  }
});
