import { check } from "../check.ts";
import { extractRecentConversationContext } from "../../src/durability/transcript.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { ensureDraftFile } from "../../src/files.ts";
import { applyUpdate } from "../../src/surface/tools/update-state.ts";
import { IDLE_STATE } from "../../src/domain/quest.ts";
import { getState, replaceState } from "../../src/app/store.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import type { Pi, PiCtx, TranscriptEntry } from "../../src/hooks/events.ts";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";

Deno.test("conversation_context: extractRecentConversationContext safely handles missing or empty sessions", () => {
  const emptyCtx = fakeCtx("/tmp");
  check(extractRecentConversationContext(emptyCtx) === "", "empty entries return empty string");

  const nullCtx = {} as unknown as PiCtx;
  check(extractRecentConversationContext(nullCtx) === "", "null sessionManager returns empty string");
});

Deno.test("conversation_context: extractRecentConversationContext extracts user and assistant turns, filtering noise", () => {
  const entries: TranscriptEntry[] = [
    { data: { role: "user", content: "Can we build a FLAC player for NeverDark?" } },
    { data: { role: "assistant", content: "Yes, we can write an isomorphic C decoder in mods/nd/ux." } },
    { data: { type: "tool_use", name: "bash", input: { command: "ls" } } },
    { data: { type: "tool_result", content: [{ type: "text", text: "file.c" }] } },
    { data: { role: "user", content: "Great! Let's make sure it handles 24-bit 48kHz audio." } },
    { data: { role: "assistant", content: "Understood, 24-bit 48kHz will be supported." } },
  ];

  const ctx = {
    ...fakeCtx("/tmp"),
    sessionManager: {
      getEntries: () => entries,
    },
  };

  const context = extractRecentConversationContext(ctx, 4);
  check(context.includes("[user] Can we build a FLAC player"), "includes initial user inquiry");
  check(context.includes("[assistant] Yes, we can write an isomorphic C decoder"), "includes assistant response");
  check(!context.includes("tool_use"), "filters out tool calls");
  check(!context.includes("tool_result"), "filters out tool results");
  check(context.includes("[user] Great! Let's make sure it handles 24-bit 48kHz audio"), "includes recent user turn");
});

Deno.test("conversation_context: renderDraftTemplate renders context under ## Context / Background Discussion", () => {
  const withoutContext = renderDraftTemplate("MyQuest", "Implement audio decoding");
  check(!withoutContext.includes("## Context / Background Discussion"), "omits context section when absent");

  const withContext = renderDraftTemplate("MyQuest", "Implement audio decoding", "[user] Initial idea\n[assistant] Technical plan");
  check(withContext.includes("## Original request"), "has original request");
  check(withContext.includes("Implement audio decoding"), "has objective");
  check(withContext.includes("## Context / Background Discussion"), "has context section");
  check(withContext.includes("[user] Initial idea"), "contains dialogue snippet");
  check(withContext.includes("## Amendments"), "amendments header follows context");
});

Deno.test("conversation_context: ensureDraftFile creates draft file with preceding context", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "quest_context_ensure_test" });
  try {
    const ctx = fakeCtx(tmpDir);
    const qid = "ctx123";
    const context = "[user] Need FLAC player\n[assistant] Will design architecture";

    await ensureDraftFile(ctx, qid, "AudioQuest", "Build player", context);

    const fullPath = join(tmpDir, draftPath(qid as any));
    const content = await readFile(fullPath, "utf8");
    check(content.includes("## Original request"), "has original request");
    check(content.includes("## Context / Background Discussion"), "has context section");
    check(content.includes("Need FLAC player"), "has extracted user dialogue");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

Deno.test("conversation_context: applyUpdate threads conversation context into newly created quest file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "quest_update_context_test" });
  try {
    const entries: TranscriptEntry[] = [
      { data: { role: "user", content: "We decided to deprecate MP3." } },
      { data: { role: "assistant", content: "Understood, MP3 decoder removed in v0.2.0." } },
    ];

    const ctx = {
      ...fakeCtx(tmpDir),
      sessionManager: {
        getEntries: () => entries,
      },
    };
    const pi = fakePi();
    replaceState(IDLE_STATE);

    const res = await applyUpdate(pi as unknown as Pi, ctx, {
      objective: "Remove MP3 remnants",
      draftName: "cleanup-mp3",
    });

    check(!res.error, "quest created without error");
    const state = getState();
    check(state.qid !== null, "quest qid is active");

    const fullPath = join(tmpDir, draftPath(state.qid!));
    const content = await readFile(fullPath, "utf8");
    check(content.includes("## Original request"), "has original request");
    check(content.includes("## Context / Background Discussion"), "has context section");
    check(content.includes("We decided to deprecate MP3"), "has prior conversation turn");
    check(content.includes("Understood, MP3 decoder removed"), "has assistant dialogue");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    replaceState(IDLE_STATE);
  }
});
