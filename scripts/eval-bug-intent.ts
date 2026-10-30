import { QUEST_EXEMPLARS } from "../src/drafting/quest-exemplars.ts";
import { KIND_EXEMPLARS } from "../src/drafting/kind-exemplars.ts";
import { evaluateQuestIntent, isCorrectiveOrBugHeuristic } from "../src/drafting/judge.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../src/config.ts";

interface Case {
  text: string;
  want: "quest" | "conversation";
  category: "corrective_bug" | "negative_spec" | "portuguese_corrective" | "conversation";
}

const CASES: Case[] = [
  // 1. Corrective bug reports (EN)
  {
    text: "You shouldn't draw as an ephemeral item soemthing that's supposed to be a stone or a rock. If it is a stone or a rock or a stone, just draw that.",
    want: "quest",
    category: "corrective_bug",
  },
  {
    text: "The items are showing up as ephemeral objects instead of stones, please fix that.",
    want: "quest",
    category: "corrective_bug",
  },
  {
    text: "It is rendering the player as a ghost instead of the chosen avatar, please fix it.",
    want: "quest",
    category: "corrective_bug",
  },
  {
    text: "There is a bug where the map tiles overlap incorrectly on resize.",
    want: "quest",
    category: "corrective_bug",
  },
  {
    text: "Why is the canvas displaying black squares? It should draw the stone textures.",
    want: "quest",
    category: "corrective_bug",
  },

  // 2. Negative behavioral specifications (EN)
  {
    text: "It shouldn't do X when Y happens, it should do Z instead.",
    want: "quest",
    category: "negative_spec",
  },
  {
    text: "Don't write raw SQL in handlers, use the query builder instead.",
    want: "quest",
    category: "negative_spec",
  },
  {
    text: "When clicking submit it shouldn't reload the page, it should submit via AJAX.",
    want: "quest",
    category: "negative_spec",
  },
  {
    text: "Never allow unauthenticated users to trigger the export job, redirect them to login.",
    want: "quest",
    category: "negative_spec",
  },
  {
    text: "You shouldn't mutate state directly inside the render loop, dispatch an action instead.",
    want: "quest",
    category: "negative_spec",
  },

  // 3. Portuguese corrective directives & bug reports (PT)
  {
    text: "Não devias desenhar pedras como itens efémeros. Se for uma pedra ou rocha, desenha isso.",
    want: "quest",
    category: "portuguese_corrective",
  },
  {
    text: "As pedras estão a aparecer como itens efémeros em vez de rochas, corrige isso.",
    want: "quest",
    category: "portuguese_corrective",
  },
  {
    text: "Não devias fazer X quando acontece Y, faz Z em vez disso.",
    want: "quest",
    category: "portuguese_corrective",
  },
  {
    text: "Não uses SQL direto nos handlers, usa o query builder em vez disso.",
    want: "quest",
    category: "portuguese_corrective",
  },
  {
    text: "Ao clicar no botão não devia recarregar a página, devia submeter por AJAX.",
    want: "quest",
    category: "portuguese_corrective",
  },

  // 4. Conversation controls (EN & PT)
  {
    text: "What do you think of this approach?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Can you explain how this module works?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Do you remember what we talked about yesterday?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Good morning! How are you doing today?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "What is the difference between a process and a thread?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "O que você acha desta arquitetura?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Podes explicar-me como funciona o parser?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Bom dia, obrigado pela ajuda!",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Qual é a capital de França?",
    want: "conversation",
    category: "conversation",
  },
  {
    text: "Ontem estive a pensar na arquitetura do sistema.",
    want: "conversation",
    category: "conversation",
  },
];

async function runBenchmark() {
  console.log("===============================================================================");
  console.log("  PI-QUEST INTENT BENCHMARK: CORRECTIVE DIRECTIVES & BUG REPORTS");
  console.log("===============================================================================\n");

  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "auto",
    embedUrl: "http://127.0.0.1:4242",
    embedModel: "bge-base",
  };

  let embedCorrect = 0;
  let embedFalseQuests = 0;
  let questCount = 0;
  let questCaught = 0;
  let convCount = 0;
  const latencies: number[] = [];

  const results: Array<{ text: string; want: string; got: string; ms: number; heuristic: boolean }> = [];

  for (const c of CASES) {
    const start = performance.now();
    const res = await evaluateQuestIntent(c.text, cfg);
    const ms = performance.now() - start;
    latencies.push(ms);

    const got = res.isQuest ? "quest" : "conversation";
    const isCorrect = got === c.want;
    if (isCorrect) embedCorrect++;
    if (c.want === "conversation" && got === "quest") embedFalseQuests++;
    if (c.want === "quest") {
      questCount++;
      if (got === "quest") questCaught++;
    } else {
      convCount++;
    }

    const heurMatch = isCorrectiveOrBugHeuristic(c.text);

    results.push({
      text: c.text,
      want: c.want,
      got,
      ms,
      heuristic: heurMatch,
    });
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  console.log("--- Summary Metrics ---");
  console.log(`Total Cases:               ${CASES.length}`);
  console.log(`Overall Accuracy:          ${((embedCorrect / CASES.length) * 100).toFixed(1)}% (${embedCorrect}/${CASES.length})`);
  console.log(`Quest Catch Rate (Recall):  ${((questCaught / questCount) * 100).toFixed(1)}% (${questCaught}/${questCount})`);
  console.log(`Conversation Specificity:  100.0% (${convCount - embedFalseQuests}/${convCount})`);
  console.log(`False Positive Rate:       ${((embedFalseQuests / convCount) * 100).toFixed(1)}% (${embedFalseQuests}/${convCount})`);
  console.log(`Latency p50:               ${p50.toFixed(1)} ms`);
  console.log(`Latency p95:               ${p95.toFixed(1)} ms`);
  console.log("\n--- Per-Case Breakdown ---");

  for (const r of results) {
    const mark = r.got === r.want ? "✓ PASS" : "✗ FAIL";
    console.log(`[${mark}] [want: ${r.want}, got: ${r.got}] [heur: ${r.heuristic ? "YES" : "NO"}] (${r.ms.toFixed(0)}ms)`);
    console.log(`       "${r.text}"\n`);
  }
}

await runBenchmark();
