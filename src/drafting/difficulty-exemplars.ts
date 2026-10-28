// HIGH_LEVEL: #drafting — shipped exemplars for quest difficulty (trivial / standard / complex).
// Embedding nearest-exemplar search over these (plus the operator's `difficultyExemplars`)
// classifies a quest request. Held-out evaluation: tests/eval/difficulty-eval.test.ts
// (corpora A, B, C). Keep corpus requests out of this table.
export const DIFFICULTY_KINDS: ReadonlySet<string> = new Set(["trivial", "standard", "complex"]);

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
