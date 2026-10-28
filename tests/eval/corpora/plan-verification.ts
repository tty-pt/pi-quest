// Labelled corpus for the plan-verification decision ("does this plan contain a concrete
// step that proves the change works?"), English and Portuguese, plus the study's own
// step exemplars. Corpus and exemplars are disjoint by construction (asserted in
// plan-verification-eval.test.ts), so the live numbers are held out.
import type { Case } from "../harness.ts";

const yes = (text: string): Case => ({ text, want: "yes" });
const no = (text: string): Case => ({ text, want: "no" });

export const PLAN_CORPUS: Case[] = [
  // ---- plans WITH a verification step --------------------------------------------------
  yes("1. Add the retry loop to the client\n2. Wire it into the request path\n3. Run the unit tests and confirm they pass"),
  yes("- Rename the config key\n- Update the loader\n- Add a regression test that fails on the old key"),
  yes("1. Fix the off-by-one in the pager\n2. Add a test covering the last page\n3. Run `make test`"),
  yes("- Extract the parser into its own module\n- Update imports\n- Verify the build completes with zero warnings"),
  yes("1. Implement the endpoint\n2. Hit it with curl and check it returns 200 with the expected JSON"),
  yes("- Migrate the table\n- Backfill rows\n- Compare row counts before and after to prove nothing was lost"),
  yes("1. Patch the memory leak\n2. Run the soak test for ten minutes and confirm memory stays flat"),
  yes("- Add the new CLI flag\n- Document it\n- Write an integration test that invokes the flag end to end"),
  yes("1. Change the cache key format\n2. Add assertions in the cache tests for the new format\n3. Run the full suite"),
  yes("- Replace the regex with a state machine\n- Benchmark both versions and check the new one is not slower"),
  yes("1. Adicionar o campo ao formulário\n2. Ligar ao backend\n3. Executar os testes e confirmar que passam"),
  yes("- Corrigir o erro de arredondamento\n- Escrever um teste que reproduz o erro\n- Correr a suite completa"),
  yes("1. Mover a lógica para um módulo novo\n2. Verificar que o build compila sem avisos"),
  yes("- Implementar o endpoint de pesquisa\n- Testar com curl e validar a resposta JSON\n- Confirmar o código de estado 200"),
  yes("1. Atualizar a dependência\n2. Correr os testes de integração para provar que nada partiu"),
  yes("- Ajustar o timeout\n- Validar manualmente no browser que a página carrega em menos de dois segundos"),
  yes("1. Refactor the scheduler\n2. Run the linter and the type checker; both must exit 0\n3. Run the e2e tests"),
  yes("- Add input validation\n- Cover the invalid cases with table-driven tests\n- Confirm coverage did not drop"),
  yes("1. Port the script to Python\n2. Diff its output against the old script on the sample data and check they match"),
  yes("- Introduzir a nova flag\n- Escrever testes unitários para os três casos\n- Executar `npm test`"),
  yes("1. Fix the race in the queue\n2. Stress test with 100 parallel workers and confirm no lost messages"),
  yes("- Atualizar o schema\n- Testar a migração numa cópia da base de dados e verificar a contagem de linhas"),
  // ---- plans WITHOUT a verification step -----------------------------------------------
  no("1. Add the retry loop to the client\n2. Wire it into the request path\n3. Update the README"),
  no("- Rename the config key\n- Update the loader\n- Bump the version"),
  no("1. Fix the off-by-one in the pager\n2. Clean up the related comments\n3. Commit the change"),
  no("- Extract the parser into its own module\n- Update imports\n- Delete the old file"),
  no("1. Implement the endpoint\n2. Add it to the router\n3. Document the route"),
  no("- Migrate the table\n- Backfill rows\n- Drop the old column"),
  no("1. Patch the memory leak\n2. Refactor the allocator wrapper\n3. Tidy the logging"),
  no("- Add the new CLI flag\n- Document it in the man page\n- Update the changelog"),
  no("1. Change the cache key format\n2. Update the callers\n3. Open a pull request"),
  no("- Replace the regex with a state machine\n- Rename the helper functions\n- Remove dead code"),
  no("1. Adicionar o campo ao formulário\n2. Ligar ao backend\n3. Atualizar a documentação"),
  no("- Corrigir o erro de arredondamento\n- Limpar os comentários\n- Fazer commit"),
  no("1. Mover a lógica para um módulo novo\n2. Atualizar os imports\n3. Apagar o ficheiro antigo"),
  no("- Implementar o endpoint de pesquisa\n- Registar a rota\n- Documentar a API"),
  no("1. Atualizar a dependência\n2. Alterar o ficheiro de bloqueio\n3. Publicar a nova versão"),
  no("- Ajustar o timeout\n- Atualizar a configuração de produção\n- Avisar a equipa"),
  no("1. Refactor the scheduler\n2. Split the long functions\n3. Rename the variables for clarity"),
  no("- Add input validation\n- Return a descriptive error message\n- Update the API docs"),
  no("1. Port the script to Python\n2. Delete the old shell script\n3. Update the cron entry"),
  no("- Introduzir a nova flag\n- Atualizar a ajuda do comando\n- Escrever a nota de lançamento"),
  no("1. Fix the race in the queue\n2. Add a mutex around the shared counter\n3. Update the design notes"),
  no("- Atualizar o schema\n- Migrar os dados antigos\n- Remover as colunas obsoletas"),
];

/** Study exemplars for single plan STEPS: does this step verify the change, or is it other work? */
export const STEP_EXEMPLARS: Record<string, string[]> = {
  verify: [
    "Run the test suite and make sure everything passes",
    "Add a unit test that covers the new behaviour",
    "Write a regression test for the bug",
    "Verify the build succeeds with no errors",
    "Check manually that the feature works as expected",
    "Confirm with curl that the endpoint responds correctly",
    "Run the linter and type checker and confirm they are clean",
    "Compare the output before and after to prove nothing changed",
    "Execute the integration tests against a staging copy",
    "Validate the result with an end to end test",
    "Corre os testes e confirma que passam",
    "Escreve um teste unitário para o novo comportamento",
    "Verifica que o build compila sem erros",
    "Testa manualmente para garantir que funciona",
    "Valida o resultado com um teste de ponta a ponta",
    "Confirma que o endpoint responde como esperado",
  ],
  other: [
    "Implement the new function in the module",
    "Refactor the helper into a separate file",
    "Update the documentation to describe the change",
    "Rename the variable across the codebase",
    "Add the new field to the data model",
    "Wire the handler into the router",
    "Remove the deprecated code path",
    "Bump the package version and update the changelog",
    "Open a pull request and request a review",
    "Notify the team about the release",
    "Implementar a nova função no módulo",
    "Atualizar a documentação com a alteração",
    "Renomear a variável em todo o código",
    "Adicionar o campo ao modelo de dados",
    "Remover o caminho de código obsoleto",
    "Abrir um pull request e pedir revisão",
  ],
};
