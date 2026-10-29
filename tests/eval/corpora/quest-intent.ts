// Labelled corpus for the quest-vs-conversation decision ("is this message an instruction
// to start a software task, or conversation?"), English and Portuguese, plus the study's
// own exemplars. Disjoint by construction (asserted in quest-intent-eval.test.ts).
// The state-changing label is "quest": a false quest opens a quest and steers the agent.
import type { Case } from "../harness.ts";

const quest = (text: string): Case => ({ text, want: "quest" });
const chat = (text: string): Case => ({ text, want: "conversation" });

export const QUEST_CORPUS: Case[] = [
  // ---- quests ---------------------------------------------------------------------------
  quest("Fix the crash when the config file is empty"),
  quest("Add a dark mode toggle to the settings page"),
  quest("Refactor the payment module so it no longer depends on the global state"),
  quest("Implement pagination for the search results endpoint"),
  quest("Please upgrade the build to the latest compiler and fix whatever breaks"),
  quest("Write unit tests for the date parser"),
  quest("The login form loses the password on error, please fix it"),
  quest("Migrate the user table to the new schema and update all the queries"),
  quest("Audit the codebase for unchecked malloc calls"),
  quest("Make the CLI print colours only when stdout is a terminal"),
  quest("Remove the deprecated v1 endpoints and clean up the router"),
  quest("Speed up the startup time, it takes four seconds right now"),
  quest("Corrige o erro que faz o servidor cair quando o ficheiro está vazio"),
  quest("Adiciona um botão para exportar os dados em CSV"),
  quest("Refaz o módulo de pagamentos para não depender do estado global"),
  quest("Implementa a paginação nos resultados de pesquisa"),
  quest("Escreve testes unitários para o parser de datas"),
  quest("O formulário de login perde a palavra-passe quando há erro, resolve isso"),
  quest("Atualiza as dependências e corrige o que partir"),
  quest("Podes investigar porque é que o build está tão lento e acelerá-lo?"),
  quest("We need to support IPv6 in the listener, can you take care of it"),
  quest("Rename the Widget class to Panel everywhere and update the docs"),
  quest("Preciso que adiciones validação aos campos do registo"),
  quest("Could you build a script that backs up the database every night"),
  // ---- conversation -----------------------------------------------------------------------
  chat("Hello, how are you today?"),
  chat("What does a mutex do?"),
  chat("Can you explain how the parser works?"),
  chat("Thanks, that was really helpful"),
  chat("I was thinking about the architecture yesterday and it still feels a bit off"),
  chat("Do you remember what we decided about the cache last week?"),
  chat("What is the difference between a process and a thread?"),
  chat("Good morning!"),
  chat("Why is the sky blue?"),
  chat("I read an interesting article about memory allocators"),
  chat("Which editor do you prefer?"),
  chat("How long have you been running in this session?"),
  chat("Olá, tudo bem?"),
  chat("O que faz um mutex?"),
  chat("Podes explicar-me como funciona o parser?"),
  chat("Obrigado, ajudou bastante"),
  chat("Ontem estive a pensar na arquitetura e continua a não me convencer"),
  chat("Lembras-te do que decidimos sobre a cache na semana passada?"),
  chat("Qual é a diferença entre um processo e uma thread?"),
  chat("Bom dia!"),
  chat("Li um artigo interessante sobre alocadores de memória"),
  chat("What time is it in Lisbon?"),
  chat("That bug we fixed last month was nasty"),
  chat("Is it a good idea to use Rust for this kind of thing, in general?"),
];

/**
 * Corpus B: written AFTER corpus A's result and BEFORE running anything against it, to
 * validate the pre-registered hypothesis (margin 0.10) on messages nobody tuned for.
 */
export const QUEST_CORPUS_B: Case[] = [
  quest("Make the importer skip rows with a missing id instead of crashing"),
  quest("Could you add retry logic to the upload client?"),
  quest("The tests in the scheduler module are flaky, find out why and fix them"),
  quest("Convert the build scripts from make to cmake"),
  quest("Add a --verbose flag to the CLI and log every request when it is on"),
  quest("Our API returns 500 when the name contains an apostrophe, please sort that out"),
  quest("Replace the hand-rolled JSON parser with a library"),
  quest("Go through the error handling in the network layer and make it consistent"),
  quest("Set up a CI job that runs the linter on every pull request"),
  quest("Delete the legacy migration scripts and update the docs accordingly"),
  quest("Document the public functions in the header file"),
  quest("Make the dashboard load faster on mobile"),
  quest("Preciso que o importador ignore as linhas sem id em vez de falhar"),
  quest("Adiciona lógica de repetição ao cliente de upload"),
  quest("Os testes do módulo de agendamento são instáveis, descobre porquê e resolve"),
  quest("Converte os scripts de build de make para cmake"),
  quest("Acrescenta uma flag --verbose ao CLI que regista todos os pedidos"),
  quest("A nossa API devolve 500 quando o nome tem uma plica, trata disso"),
  quest("Substitui o parser de JSON feito à mão por uma biblioteca"),
  quest("Cria um job de CI que corre o linter em cada pull request"),
  quest("Apaga os scripts de migração antigos e atualiza a documentação"),
  quest("Documenta as funções públicas do ficheiro de cabeçalho"),
  quest("Torna o painel mais rápido a carregar no telemóvel"),
  quest("I would like the logger to rotate files once they pass 10 MB, can you do that?"),
  chat("Hey, long time no see!"),
  chat("What is the difference between a stack and a heap?"),
  chat("Walk me through how the scheduler decides which task runs next"),
  chat("Great, thanks for the explanation"),
  chat("The deploy last night went smoothly, nobody noticed a thing"),
  chat("Do you recall which library we picked for logging?"),
  chat("Is it true that Lisp has no syntax?"),
  chat("Good afternoon everyone"),
  chat("That race condition we chased all week was brutal"),
  chat("I have been reading about consensus algorithms lately"),
  chat("Do you prefer tabs or spaces?"),
  chat("How many tokens can you handle at once?"),
  chat("Boa tarde, como correu o fim de semana?"),
  chat("Qual é a diferença entre uma pilha e um heap?"),
  chat("Explica-me como é que o agendador escolhe a próxima tarefa"),
  chat("Ótimo, obrigado pela explicação"),
  chat("O deploy de ontem à noite correu bem, ninguém deu por nada"),
  chat("Sabes qual foi a biblioteca de logs que escolhemos?"),
  chat("É verdade que o Lisp não tem sintaxe?"),
  chat("A condição de corrida que perseguimos a semana toda foi terrível"),
  chat("Tenho andado a ler sobre algoritmos de consenso"),
  chat("Preferes tabs ou espaços?"),
  chat("What day of the week is it?"),
  chat("Honestly, I am not sure Kubernetes is worth it for a team our size"),
];

/** The shipped exemplars (single source of truth); the corpus tests assert disjointness from them. */
export { QUEST_EXEMPLARS } from "../../../src/drafting/quest-exemplars.ts";
