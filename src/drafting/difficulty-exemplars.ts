// HIGH_LEVEL: #drafting — shipped exemplars for quest difficulty (trivial / standard / complex).
// Embedding nearest-exemplar search over these (plus the operator's `difficultyExemplars`)
// classifies a quest request. Held-out evaluation: tests/eval/difficulty-eval.test.ts
// (corpora A, B, C). Keep corpus requests out of this table.
export const DIFFICULTY_KINDS: ReadonlySet<string> = new Set(["trivial", "minor", "standard", "major", "complex"]);

export const DIFFICULTY_EXEMPLARS: Record<string, string[]> = {
  trivial: [
    "Fix a typo in the documentation",
    "Bump the package version number",
    "Add a short comment above the function",
    "Rename one variable in a single file",
    "Change a constant value in the config",
    "Delete an unused import",
    "Update the year in the license header",
    "Corrige uma gralha na documentação",
    "Atualiza o número de versão do pacote",
    "Muda o valor de uma constante na configuração",
  ],
  minor: [
    "Small bugfix in a single function with existing tests",
    "Adjust margin and padding on the modal component",
    "Add a missing error check to the file parser",
    "Update an existing test case to cover a new edge case",
    "Fix off-by-one index calculation in array helper",
    "Pequena correção de bug numa função com testes existentes",
    "Ajusta o espaçamento do componente modal",
    "Adiciona verificação de erro em falta no parser",
  ],
  standard: [
    "Add a new button to the page and wire it to the backend",
    "Fix the bug where the server crashes on empty input",
    "Implement a new API endpoint with tests",
    "Write tests for the module and fix what they find",
    "Add form validation with error messages",
    "Refactor one module to remove duplicated code",
    "Adiciona um botão novo à página e liga-o ao backend",
    "Corrige o erro que faz o servidor cair com dados vazios",
    "Implementa um endpoint novo na API com testes",
    "Acrescenta validação ao formulário com mensagens de erro",
  ],
  major: [
    "Refactor multi-module data flow across backend services",
    "Implement cross-module caching layer and invalidate on writes",
    "Add new schema tables and integrate API endpoints",
    "Upgrade HTTP request pipeline with streaming JSON parser",
    "Refatora o fluxo de dados entre vários módulos",
    "Implementa camada de cache inter-módulos",
    "Adiciona novas tabelas de schema e integra endpoints",
  ],
  complex: [
    "Redesign the architecture of the whole system",
    "Migrate the database to a different engine with no downtime",
    "Rewrite the core module in another language keeping the interface",
    "Replace the communication protocol across every service",
    "Split the application into independent services",
    "Overhaul the authentication system for all tenants",
    "Redesenha a arquitetura de todo o sistema",
    "Migra a base de dados para outro motor sem tempo de paragem",
    "Reescreve o módulo central noutra linguagem mantendo a interface",
    "Divide a aplicação em serviços independentes",
  ],
};
