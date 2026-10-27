import { assertEquals } from "../check.ts";
import { fakePi, fakeCtx } from "../fake-pi.ts";
import { installRouter } from "../../src/router/virtual-model.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { getRouterStatusLines } from "../../src/surface/commands/router.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE } from "../../src/domain/quest.ts";
import type { VirtualModelDefinition } from "../../src/router/types.ts";

Deno.test("installRouter — registers virtual model quest/auto on pi instance", () => {
  const pi = fakePi();
  installRouter(pi);

  assertEquals(pi.virtualModels.length, 1);
  const registered = pi.virtualModels[0] as VirtualModelDefinition;
  assertEquals(registered.provider, "quest");
  assertEquals(registered.id, "auto");
  assertEquals(registered.name, "Quest Auto Router");
  assertEquals(registered.thinkingLevels?.includes("high"), true);
});

Deno.test("installRouter — safely no-ops if registerVirtualModel is not available", () => {
  const pi = fakePi();
  // @ts-ignore simulate older pi without registerVirtualModel
  delete pi.registerVirtualModel;

  installRouter(pi);
  // Should not throw
});

Deno.test("commands — registers quest-router command", () => {
  const pi = fakePi();
  installCommands(pi);

  const found = pi.commands.find((c) => c.name === "quest-router");
  assertEquals(found !== undefined, true);
});

Deno.test("getRouterStatusLines — formats status lines with cell and matrix info", async () => {
  const ctx = fakeCtx("/tmp");
  replaceState({ ...IDLE_STATE, phase: "drafting", difficulty: "complex" });

  const lines = await getRouterStatusLines(ctx);
  const text = lines.join("\n");

  assertEquals(text.includes("=== Pi-Quest Virtual Model Router ==="), true);
  assertEquals(text.includes("Virtual Model : quest/auto"), true);
  assertEquals(text.includes("Phase='drafting', Difficulty='complex'"), true);
  assertEquals(text.includes("Activation    : Use '/model quest/auto'"), true);
});
