// Labelled corpus for quest difficulty (trivial / standard / complex), English and
// Portuguese, plus the study's own exemplars. Definitions follow DIFFICULTY_QUESTION:
//   trivial  = small isolated patch: typo, doc fix, version bump, comment, one-file change
//   standard = normal feature, ordinary bugfix, multi-file change
//   complex  = architectural overhaul, major refactor, redesign, protocol/data migration, high blast radius
// The state-changing error is predicting "trivial" for anything that is not trivial: it
// drops plan review. Corpus and exemplars are disjoint by construction (asserted in
// difficulty-eval.test.ts).
import type { Case } from "../harness.ts";

const t = (text: string): Case => ({ text, want: "trivial" });
const s = (text: string): Case => ({ text, want: "standard" });
const c = (text: string): Case => ({ text, want: "complex" });

export const DIFFICULTY_CORPUS: Case[] = [
  // ---- trivial ----------------------------------------------------------------------------
  t("Fix the typo in the README heading"),
  t("Bump the version to 2.3.1 in package.json"),
  t("Add a comment explaining the retry constant"),
  t("Rename the variable `tmp` to `buffer` in the parser"),
  t("Change the default port from 8080 to 8081 in the config file"),
  t("Update the copyright year in the footer"),
  t("Remove the unused import at the top of utils.py"),
  t("Correct the spelling of 'recieve' in the error message"),
  t("Corrige o erro de ortografia no título do README"),
  t("Atualiza a versão para 2.3.1 no package.json"),
  t("Acrescenta um comentário a explicar a constante de tentativas"),
  t("Muda a porta por omissão de 8080 para 8081 no ficheiro de configuração"),
  t("Apaga o import que não é usado no topo do utils.py"),
  t("Please make the log line say 'started' instead of 'start'"),
  t("Troca o texto do botão de 'Enviar' para 'Submeter'"),
  // ---- standard ---------------------------------------------------------------------------
  s("Add a dark mode toggle to the settings page"),
  s("Fix the crash when the config file is empty"),
  s("Implement pagination for the search results endpoint"),
  s("Write unit tests for the date parser and fix the bugs they reveal"),
  s("Make the CLI print colours only when stdout is a terminal"),
  s("Add input validation to the registration form and show inline errors"),
  s("Replace the polling loop in the sync worker with a websocket subscription"),
  s("Add a CSV export button to the reports page, including the backend endpoint"),
  s("Adiciona um interruptor de modo escuro à página de definições"),
  s("Corrige o erro que faz o servidor cair quando o ficheiro de configuração está vazio"),
  s("Implementa paginação no endpoint de resultados de pesquisa"),
  s("Escreve testes para o parser de datas e corrige os erros que revelarem"),
  s("Acrescenta validação ao formulário de registo e mostra os erros junto aos campos"),
  s("Cria um endpoint para exportar relatórios em CSV e o botão correspondente"),
  s("The upload handler leaks file descriptors on error, fix it and add a regression test"),
  // ---- complex ----------------------------------------------------------------------------
  c("Redesign the storage layer so we can move from SQLite to Postgres without downtime"),
  c("Migrate the whole codebase from callbacks to async/await and update every module that depends on it"),
  c("Replace our home-grown RPC protocol with gRPC across all services and keep old clients working"),
  c("Split the monolith into separate services with their own databases"),
  c("Rewrite the authentication system to support SSO, MFA and per-tenant policies"),
  c("Overhaul the build system and the CI pipeline for every repository in the organisation"),
  c("Introduce an event-sourcing architecture for the order domain and migrate the existing data"),
  c("Port the engine from C to Rust while keeping the public API and the on-disk format stable"),
  c("Redesenha a camada de armazenamento para passarmos de SQLite para Postgres sem tempo de paragem"),
  c("Migra todo o código de callbacks para async/await e atualiza todos os módulos que dependem disso"),
  c("Substitui o nosso protocolo RPC próprio por gRPC em todos os serviços mantendo os clientes antigos a funcionar"),
  c("Divide o monólito em serviços separados, cada um com a sua base de dados"),
  c("Reescreve o sistema de autenticação para suportar SSO, MFA e políticas por cliente"),
  c("Introduz uma arquitetura de event sourcing no domínio das encomendas e migra os dados existentes"),
  c("Change the wire format of the replication protocol and roll it out to the whole fleet"),
];

/**
 * Corpus B: written AFTER corpus A's result and the pre-registered margin, BEFORE any run
 * against it. New topics throughout, including grand-sounding trivial requests and
 * small-sounding complex ones.
 */
export const DIFFICULTY_CORPUS_B: Case[] = [
  // ---- trivial ----------------------------------------------------------------------------
  t("Fix the misspelled word 'adress' in the contact page"),
  t("Increase the request timeout from 10 to 15 seconds in settings.ini"),
  t("Please document the --dry-run flag in a one-line comment"),
  t("Delete the commented-out block at the bottom of main.go"),
  t("Change the greeting text on the home page to 'Welcome back'"),
  t("Set the log level default to warn in the config template"),
  t("Update the support email address in the footer"),
  t("Fix the indentation of the second paragraph in CONTRIBUTING.md"),
  t("Corrige a palavra 'endereco' na página de contacto"),
  t("Aumenta o tempo limite dos pedidos de 10 para 15 segundos no settings.ini"),
  t("Apaga o bloco comentado no fim do main.go"),
  t("Muda o texto de boas-vindas da página inicial para 'Bem-vindo de volta'"),
  t("Atualiza o email de suporte no rodapé"),
  t("Renomeia a função helper2 para formatDate neste ficheiro"),
  t("Troca o ícone do botão de ajuda por um ponto de interrogação"),
  // ---- standard ---------------------------------------------------------------------------
  s("Add rate limiting to the login endpoint and cover it with tests"),
  s("The invoice PDF shows the wrong total when a discount is applied, fix that"),
  s("Add a search box to the product list that filters as you type"),
  s("Cache the results of the currency conversion call for five minutes"),
  s("Support uploading multiple files at once in the attachments form"),
  s("Send an email to the user when their export finishes, with a download link"),
  s("Add sorting by date and by name to the customers table"),
  s("Make the notification settings persist per user across sessions"),
  s("Adiciona limitação de pedidos ao endpoint de login e cobre-a com testes"),
  s("O PDF da fatura mostra o total errado quando há desconto, corrige isso"),
  s("Acrescenta uma caixa de pesquisa à lista de produtos que filtra enquanto se escreve"),
  s("Guarda em cache o resultado da conversão de moeda durante cinco minutos"),
  s("Permite enviar vários ficheiros de uma só vez no formulário de anexos"),
  s("Envia um email ao utilizador quando a exportação terminar, com uma ligação para descarregar"),
  s("Torna as definições de notificações persistentes por utilizador entre sessões"),
  // ---- complex ----------------------------------------------------------------------------
  c("Move the entire platform from a single data centre to an active-active multi-region deployment"),
  c("Replace the in-house job scheduler with a distributed workflow engine across all teams' pipelines"),
  c("Rebuild the permissions model from role-based to attribute-based and migrate every existing policy"),
  c("Convert the ledger from mutable balances to an append-only double-entry design with a full historical backfill"),
  c("Redesign the public API as v2 and run it alongside v1 until every client has moved"),
  c("Re-platform the mobile and web clients onto a shared codebase and retire the old ones"),
  c("Change the primary key type of every table to UUIDs and update all foreign keys and the services that use them"),
  c("Swap the message broker for a different technology without dropping a single message"),
  c("Muda toda a plataforma de um único centro de dados para uma implantação ativa-ativa em várias regiões"),
  c("Substitui o agendador de tarefas interno por um motor de workflows distribuído em todos os pipelines das equipas"),
  c("Reconstrói o modelo de permissões de baseado em papéis para baseado em atributos e migra todas as políticas existentes"),
  c("Converte o livro-razão de saldos mutáveis para um desenho de dupla entrada só de acrescento, com preenchimento histórico completo"),
  c("Redesenha a API pública como v2 e mantém-na a correr ao lado da v1 até todos os clientes migrarem"),
  c("Troca o tipo da chave primária de todas as tabelas para UUID e atualiza as chaves estrangeiras e os serviços que as usam"),
  c("Substitui o broker de mensagens por outra tecnologia sem perder uma única mensagem"),
];

/**
 * Corpus C: written AFTER corpus B falsified margin 0.02 and margin 0.075 was
 * pre-registered, BEFORE any run against it. A and B are development data from here on.
 */
export const DIFFICULTY_CORPUS_C: Case[] = [
  // ---- trivial ----------------------------------------------------------------------------
  t("Correct the capitalisation of 'github' to 'GitHub' in the about page"),
  t("Bump the minimum Node version to 20 in the engines field"),
  t("Add a missing semicolon on line 42 of app.js"),
  t("Reword the error message to say 'File not found' instead of 'No file'"),
  t("Switch the primary button colour to the brand blue in the stylesheet"),
  t("Remove the leftover console.log in the checkout handler"),
  t("Update the link to the docs in the sidebar"),
  t("Change the page title to 'Dashboard' in the HTML template"),
  t("Corrige a maiúscula de 'github' para 'GitHub' na página sobre"),
  t("Sobe a versão mínima do Node para 20 no campo engines"),
  t("Acrescenta o ponto e vírgula em falta na linha 42 do app.js"),
  t("Muda a cor do botão principal para o azul da marca na folha de estilos"),
  t("Remove o console.log que ficou no handler do checkout"),
  t("Atualiza a ligação para a documentação na barra lateral"),
  t("Altera o título da página para 'Painel' no template HTML"),
  // ---- standard ---------------------------------------------------------------------------
  s("Add a password reset flow with an emailed token and tests"),
  s("The calendar shows events one day late for users west of UTC, fix it"),
  s("Add a dark theme variant to the chart components"),
  s("Implement soft delete for projects, with a trash view and restore button"),
  s("Add a health check endpoint that reports database and cache status"),
  s("Paginate the audit log page and add a date range filter"),
  s("Validate uploaded images by size and type and show a clear error"),
  s("Add keyboard shortcuts for the main actions in the editor"),
  s("Adiciona um fluxo de recuperação de palavra-passe com token por email e testes"),
  s("O calendário mostra os eventos com um dia de atraso para utilizadores a oeste de UTC, corrige"),
  s("Implementa eliminação suave de projetos, com uma vista de reciclagem e botão de restaurar"),
  s("Adiciona um endpoint de verificação de saúde que reporta o estado da base de dados e da cache"),
  s("Pagina o registo de auditoria e acrescenta um filtro por intervalo de datas"),
  s("Valida as imagens carregadas por tamanho e tipo e mostra um erro claro"),
  s("Acrescenta atalhos de teclado para as ações principais do editor"),
  // ---- complex ----------------------------------------------------------------------------
  c("Re-architect the data pipeline from nightly batch jobs to real-time streaming across all consumers"),
  c("Migrate our identity provider to a new vendor and move every user, session and integration over without logging anyone out"),
  c("Replace the ORM with a hand-written data access layer across the whole backend"),
  c("Introduce multi-tenancy into a single-tenant application, including data isolation and billing"),
  c("Split the shared database into per-service databases and rewrite all cross-service queries"),
  c("Rebuild the search stack on a new engine and reindex all historical content with zero downtime"),
  c("Convert the whole frontend from server-rendered pages to a single-page application"),
  c("Redesign the plugin system so third-party extensions run sandboxed, and port the existing plugins"),
  c("Re-arquiteta o pipeline de dados de jobs noturnos em lote para streaming em tempo real em todos os consumidores"),
  c("Migra o nosso fornecedor de identidade para outro e passa todos os utilizadores, sessões e integrações sem desligar ninguém"),
  c("Substitui o ORM por uma camada de acesso a dados escrita à mão em todo o backend"),
  c("Introduz multi-tenancy numa aplicação de um só cliente, incluindo isolamento de dados e faturação"),
  c("Divide a base de dados partilhada em bases por serviço e reescreve todas as consultas entre serviços"),
  c("Reconstrói a pesquisa sobre um motor novo e reindexa todo o conteúdo histórico sem tempo de paragem"),
  c("Converte todo o frontend de páginas renderizadas no servidor para uma aplicação de página única"),
];

/** The shipped exemplars (single source of truth); the corpus tests assert disjointness from them. */
export { DIFFICULTY_EXEMPLARS } from "../../../src/drafting/difficulty-exemplars.ts";
