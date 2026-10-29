import { check } from "../check.ts";
import { runSemanticLints as run } from "../../src/validation/semantic-lint.ts";
import { SITE_LINT_RULES } from "../lint-rules.ts";

const runSemanticLints = (diff: string) => run(diff, SITE_LINT_RULES);

Deno.test("semantic lint rejects #ifdef in isomorphic UX", () => {
  const diff = `
diff --git a/mods/song/ux/song.c b/mods/song/ux/song.c
--- a/mods/song/ux/song.c
+++ b/mods/song/ux/song.c
@@ -10,2 +10,4 @@
+#ifdef __wasm__
+  do_something();
+#endif
`;
  const violations = runSemanticLints(diff);
  check(violations.length > 0, "detected UX #ifdef");
  check(violations[0].ruleId === "no-ux-compile-branch", "correct ruleId");
  check(violations[0].file === "mods/song/ux/song.c", "correct file");
});

Deno.test("semantic lint allows header guard in isomorphic UX and site_ui aggregator", () => {
  const diff = `
diff --git a/mods/song/ux/song.c b/mods/song/ux/song.c
--- a/mods/song/ux/song.c
+++ b/mods/song/ux/song.c
@@ -1,2 +1,3 @@
+#ifndef SONG_UX_C
+#define SONG_UX_C
diff --git a/mods/site_ui/ux/site_ui.c b/mods/site_ui/ux/site_ui.c
--- a/mods/site_ui/ux/site_ui.c
+++ b/mods/site_ui/ux/site_ui.c
@@ -5,2 +5,4 @@
+#ifndef __wasm__
+  aggregator_init();
+#endif
`;
  const violations = runSemanticLints(diff);
  check(violations.length === 0, "sanctioned guards and site_ui aggregator allowed");
});

Deno.test("semantic lint rejects cross-module #include '*.c'", () => {
  const diff = `
diff --git a/mods/song/song.c b/mods/song/song.c
--- a/mods/song/song.c
+++ b/mods/song/song.c
@@ -10,2 +10,3 @@
+#include "../other/file.c"
`;
  const violations = runSemanticLints(diff);
  check(violations.length === 1, "rejected cross-module c include");
  check(violations[0].ruleId === "no-cross-module-c-include", "ruleId matches");
});

Deno.test("semantic lint allows sanctioned c inclusions in site_ui.c and list.c", () => {
  const diff = `
diff --git a/mods/site_ui/ux/site_ui.c b/mods/site_ui/ux/site_ui.c
--- a/mods/site_ui/ux/site_ui.c
+++ b/mods/site_ui/ux/site_ui.c
@@ -1,2 +1,3 @@
+#include "list.c"
diff --git a/mods/common/list.c b/mods/common/list.c
--- a/mods/common/list.c
+++ b/mods/common/list.c
@@ -1,2 +1,3 @@
+#include "sub.c"
`;
  const violations = runSemanticLints(diff);
  check(violations.length === 0, "sanctioned aggregators allowed");
});

Deno.test("semantic lint rejects git conflict markers", () => {
  const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -20,2 +20,4 @@
+<<<<<<< HEAD
+  foo();
+=======
+  bar();
+>>>>>>> branch
`;
  const violations = runSemanticLints(diff);
  check(violations.length >= 2, "detected conflict markers");
  check(violations.some((v) => v.ruleId === "no-conflict-markers"), "ruleId matches");
});

Deno.test("semantic lint rejects forbidden engine symbols in isomorphic UX", () => {
  const diff = `
diff --git a/mods/song/ux/song.c b/mods/song/ux/song.c
--- a/mods/song/ux/song.c
+++ b/mods/song/ux/song.c
@@ -10,2 +10,3 @@
+  corm_put_record(ref);
`;
  const violations = runSemanticLints(diff);
  check(violations.length === 1, "forbidden engine symbol rejected");
  check(violations[0].ruleId === "no-ux-engine-symbols", "ruleId matches");
});

Deno.test("semantic lint ships no repo-specific rules: only conflict markers without config", () => {
  const diff = `
diff --git a/mods/song/ux/song.c b/mods/song/ux/song.c
--- a/mods/song/ux/song.c
+++ b/mods/song/ux/song.c
@@ -10,2 +10,4 @@
+#ifdef __wasm__
+#include "../other/file.c"
`;
  check(run(diff).length === 0, "no built-in site rules");
  const conflict = `
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,3 @@
+<<<<<<< HEAD
`;
  const v = run(conflict);
  check(v.length === 1 && v[0].ruleId === "no-conflict-markers", "conflict markers always rejected");
});
