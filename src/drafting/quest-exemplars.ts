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
    "Start an implementation quest for this",
    "Implement the recommended changes",
    "Let's do this now",
    "Inicie a quest de implementação",
    "Implemente as mudanças propostas",
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
    "Let's brainstorm a little bit about this",
    "What do you think of this approach?",
    "Can you explain how this module works?",
    "Could we discuss the architecture before doing anything?",
    "What are our options for handling this issue?",
    "Can you inspect the file and tell me your thoughts?",
    "Olá, como estás?",
    "Qual é a capital de França?",
    "Explica-me o que é um apontador",
    "Muito obrigado",
    "Tive um dia longo no trabalho",
    "Lembras-te da nossa conversa anterior?",
    "Vamos conversar sobre as opções de arquitetura",
    "O que você acha desta ideia?",
    "Me explica como funciona esse componente",
    "Podemos pensar juntos sobre isso antes de implementar?",
  ],
};
