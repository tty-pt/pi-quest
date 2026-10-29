// HIGH_LEVEL: #drafting — shipped exemplars for fine-grained quest kind classification
// (axil-auren `POST /v1/classify`). Detects whether a quest is a bugfix, feature,
// refactor, documentation, analysis, or standard task.
import type { QuestKind } from "../domain/quest.ts";

export const QUEST_KINDS: ReadonlySet<string> = new Set<QuestKind>([
  "standard",
  "analysis",
  "bugfix",
  "feature",
  "refactor",
  "docs",
]);

export const KIND_EXEMPLARS: Record<string, string[]> = {
  bugfix: [
    "Fix the crash when parsing malformed JSON payloads",
    "Resolve null pointer dereference on server startup",
    "Fix race condition in worker connection pool",
    "Repair broken regex in date parsing logic",
    "Fix flaky test timeout in integration suite",
    "Corrigir o segmentation fault ao abrir o socket",
    "Consertar o vazamento de memória no loop de eventos",
    "Resolver o bug de concorrência na fila de tarefas",
  ],
  feature: [
    "Implement WebSocket real-time subscription endpoint",
    "Add dark mode theme support to the dashboard UI",
    "Build OAuth2 Google and GitHub login providers",
    "Add PDF export capability for invoice generation",
    "Create new REST API route for candidate profile retrieval",
    "Implementar suporte a múltiplos idiomas no cabeçalho",
    "Adicionar nova tela de listagem de usuários com paginação",
    "Criar funcionalidade de upload de arquivos anexos",
  ],
  refactor: [
    "Refactor database adapter to use connection pooling",
    "Restructure module boundaries to eliminate circular dependencies",
    "Clean up duplicate utility functions across packages",
    "Extract HTTP routing logic into a separate service class",
    "Decouple state management from React view components",
    "Refatorar a camada de acesso a dados para isolar consultas SQL",
    "Reorganizar a estrutura de pastas e módulos do backend",
  ],
  docs: [
    "Update README with installation and quickstart guide",
    "Document configuration environment variables in docs/CONFIG.md",
    "Write API usage examples and curl commands in documentation",
    "Update CHANGELOG.md for the v1.2.0 release",
    "Document architectural decisions and conventions in docs",
    "Atualizar a documentação da API com os novos endpoints",
    "Escrever o guia de instalação passo a passo no README",
  ],
  analysis: [
    "Investigate performance bottlenecks in database queries",
    "Audit security vulnerabilities and attack surfaces in auth module",
    "Analyze feasibility of migrating from Webpack to Vite",
    "Compare benchmark metrics between SQLite and PostgreSQL",
    "Conduct architectural review of proposed event-driven microservices",
    "Investigar a causa da lentidão no processamento de imagens",
    "Analisar a viabilidade técnica de suporte a WebAssembly",
  ],
  standard: [
    "General engineering task across multiple areas",
    "Miscellaneous development work",
    "Update package versions and run tests",
    "Tarefa genérica de desenvolvimento de software",
  ],
};
