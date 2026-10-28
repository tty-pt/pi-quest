// HIGH_LEVEL: #drafting — shipped exemplars for quest-vs-conversation detection.
// Embedding nearest-exemplar search over these (plus the operator's `questExemplars`)
// decides whether a free-form message opens a quest. Held-out evaluation:
// tests/eval/quest-intent-eval.test.ts. Keep corpus messages out of this table.
export type QuestIntentKind = "quest" | "conversation";

export const QUEST_INTENT_KINDS: ReadonlySet<string> = new Set<QuestIntentKind>(["quest", "conversation"]);

export const QUEST_EXEMPLARS: Record<string, string[]> = {
  quest: [
    "Fix the bug in the login handler",
    "Add a new feature to export reports",
    "Refactor the database layer",
    "Implement the missing API endpoint",
    "Write tests for the authentication module",
    "Update the dependencies and make the build pass",
    "Please change the button colour on the dashboard",
    "Investigate why the build is failing and fix it",
    "Remove the unused code from the project",
    "Optimise the slow query in the report page",
    "Corrige o erro no tratamento do login",
    "Adiciona uma nova funcionalidade para exportar relatórios",
    "Refaz a camada de base de dados",
    "Implementa o endpoint que falta na API",
    "Escreve testes para o módulo de autenticação",
    "Atualiza as dependências e faz o build passar",
  ],
  conversation: [
    "Hi there, how are you?",
    "What is the capital of France?",
    "Explain what a pointer is",
    "Thank you very much",
    "I had a long day at work",
    "Do you remember our earlier conversation?",
    "What do you think about functional programming?",
    "Good evening",
    "Tell me a joke",
    "How does garbage collection work in general?",
    "Olá, como estás?",
    "Qual é a capital de França?",
    "Explica-me o que é um apontador",
    "Muito obrigado",
    "Tive um dia longo no trabalho",
    "Lembras-te da nossa conversa anterior?",
  ],
};
