# NeoAVA

Front-end pessoal para o AVA da UniEvangélica (Moodle), usando a API oficial de Web Services
(o mesmo token do app móvel do Moodle). É **somente leitura**, com duas exceções: fazer
questionários e enviar tarefas (arquivos e texto online), como o app oficial faz.

> As notas exibidas são as do AVA e podem não ser as notas oficiais do sistema acadêmico.

## 1. Obter o token

O jeito mais simples é entrar com matrícula e senha:

- **No app web:** a tela inicial tem um formulário de login.
- **No terminal:** `npm run login` pede a senha sem mostrá-la e grava só o token no `.env`.

Nos dois casos a senha vai direto para `login/token.php` do AVA (mesmo fluxo do app oficial
do Moodle), não é gravada em lugar nenhum, e o `privatetoken` é descartado.

Alternativa manual:

```bash
read -s -p "Senha: " SENHA; echo
curl -s -X POST https://avagrad.unievangelica.edu.br/login/token.php \
  -d "username=MATRICULA" --data-urlencode "password=$SENHA" -d "service=moodle_mobile_app"
unset SENHA
```

```bash
npm install
npm run login          # ou: cp .env.example .env e preencha MOODLE_TOKEN
```

## 2. Linha de comando

```bash
npm run site-info      # lista as funções liberadas para o token → docs/funcoes_disponiveis.json
npm run resumo         # VA1/VA2/VA3 e projeção por disciplina + próximos prazos
npm run resumo -- --refresh   # ignora o cache
```

## 3. App web

```bash
npm run dev            # http://127.0.0.1:5173 (só nesta máquina)
```

Telas (barra lateral no computador, barra inferior no celular):

- **Painel**: aproveitamento do ciclo, pontos acumulados (rosca), desempenho por disciplina,
  entregas dos próximos 14 dias e mapa de calor de 5 semanas, últimas notas lançadas,
  distribuição das notas, conclusão por disciplina e histórico de médias (quando o AVA informa).
- **Disciplinas**: cartões do ciclo atual + disciplinas anteriores.
- **Disciplina**: aproveitamento, pontos por VA, desempenho por atividade, notas, status de envio e
  feedback das tarefas, tentativas e notas dos questionários, conteúdo com o que já foi concluído.
- **Tarefa** (clique no nome da tarefa na página da disciplina): prazo, envio atrasado/data de corte,
  nota, enunciado e anexos, o seu envio e a avaliação do professor (comentário e arquivos).
  - **Adicionar/Editar envio**: escolher ou arrastar arquivos e/ou escrever o texto online. Os limites
    da tarefa (quantidade, tamanho, tipos, limite de palavras) são conferidos antes de enviar.
  - **Salvar rascunho** grava no AVA sem entregar; **Enviar para avaliação** pede confirmação (e a
    declaração de autoria, quando exigida). Tarefas sem rascunho entregam ao salvar, com confirmação.
  - **Remover envio** (com confirmação) e **Iniciar tarefa** para tarefas com tempo limite.
  - Como o Moodle grava: upload para a área de rascunho (`webservice/upload.php`) e
    `mod_assign_save_submission` com o itemid dessa área, que **substitui** os arquivos do envio.
    Por isso, ao editar, os arquivos mantidos são baixados e enviados de novo junto com os novos.
  - Ao mudar um texto já enviado, a formatação anterior (negrito, listas…) vira texto simples.
- **Prazos**, **Histórico** e **Perfil** (seus dados no AVA, somente leitura).
- **Questionário** (clique no nome de um quiz na página da disciplina): nota, tentativas, prazo, tempo
  limite, regras de acesso (senha, rede, Safe Exam Browser…), tipos de questão e o botão
  **Iniciar tentativa** / **Continuar tentativa**.
- **Tentativa**: responder o questionário pelo NeoAVA, como no app oficial do Moodle.
  - **Iniciar** pede confirmação (avisa que conta no limite e que o tempo começa a correr) e a senha,
    se o quiz tiver uma. A senha fica só na memória da aba.
  - As respostas são **salvas automaticamente** no AVA ~2 s depois de cada alteração, ao trocar de
    página, ao clicar em "Salvar agora" e ao sair da tela. Clicar no texto da alternativa marca a opção.
  - **Revisar e enviar** mostra a situação de cada questão; **Enviar tudo e terminar** pede
    confirmação (avisa quantas estão sem resposta) e manda para correção. Não tem volta.
  - Se o tempo acabar com a página aberta, a tentativa é enviada automaticamente, como o AVA faz.
  - Navegação sequencial é respeitada (não dá para voltar páginas, como no AVA).
  - Questões de arrastar/ordenar (`ddwtos`, `ddimageortext`, `ddmarker`, `ordering`) dependem do
    JavaScript do AVA: aparecem desativadas, com aviso para responder lá.
  - Quizzes com Safe Exam Browser ou restrição de rede não podem ser iniciados por aqui.
  - Tentativas finalizadas mostram a **revisão** (nota, certo/errado, feedback), conforme as opções
    do professor. Tentativas com tempo esgotado só são lidas após um clique.
  - O HTML das questões vem do Moodle e é reconstruído com uma lista fechada de tags e atributos
    (`src/question-html.ts`): scripts, estilos, eventos, botões e links `javascript:` são descartados.
  - O Moodle ignora em silêncio respostas com `sequencecheck` desatualizado; depois de cada gravação
    o app relê a página e atualiza esse campo.

**Modelo de notas (UniEvangélica):** 3 ciclos por semestre (VA1, VA2, VA3 — ou "FASE 1/2/3" nas
on-line), cada um com até 100 pontos. As notas das atividades somam direto no ciclo; a média final
é a média simples dos 3 ciclos. O app mostra, por disciplina:

- **garantido** = soma do que você já tem ÷ 3;
- **máximo possível** = garantido + tudo que ainda pode ser ganho (100 − obtido − perdido em cada ciclo);
- **projeção** = mantendo o aproveitamento atual no que falta;
- quantos pontos faltam para a **média mínima** (padrão 60, editável no topo do painel).

O ciclo em andamento é estimado pelas datas da disciplina (início→fim dividido em 3). O quadro de
notas do AVA esconde o valor máximo dos itens; o app recupera esse valor pela configuração das
tarefas e questionários (`grade`) — ele só é necessário para saber o que foi *perdido* ou está *em
aberto*. Disciplinas sem VA1–VA3 no AVA aparecem como "fora do modelo".

Em **Prazos** há um botão que gera o link `.ics` do calendário do AVA para assinar no Google Agenda
ou no celular. O link é pessoal (equivale a uma senha de leitura do calendário), nunca vai para o
cache e deixa de funcionar se você trocar a senha do AVA.

Demonstração: o botão "Ver demonstração" no login (ou `?demo` na URL) abre uma conta fictícia
com dados de exemplo, para apresentar o sistema ou mexer no visual sem token. Não acessa o AVA;
os dados ficam em `src/demo*.ts`, num arquivo à parte que só é baixado ao abrir a demonstração.
"Sair da demonstração" volta ao login sem apagar o token real salvo no navegador.

O navegador chama o Moodle direto (o servidor responde com `Access-Control-Allow-Origin: *`).
Não existe back-end: o mesmo app roda local (`npm run dev`) ou publicado (seção 4).

- O servidor de desenvolvimento (`npm run dev`) escuta só em `127.0.0.1`: outros computadores
  da rede não alcançam o app.
  Por isso o token **nunca** é injetado na página: cada pessoa entra com a própria matrícula e
  o token fica só no `localStorage` do navegador dela. O `MOODLE_TOKEN` do `.env` é usado só
  pelos scripts de terminal. `.env` e `.cache/` são bloqueados pelo servidor.
- Para abrir no celular (mesma rede Wi-Fi): `npm run dev:rede` e acesse `http://<IP-do-PC>:5173`
  (o Vite mostra o endereço em "Network"). A página vai sem HTTPS: use só em rede de confiança
  e desligue (Ctrl+C) quando terminar. O `npm run dev` continua restrito a este computador.
- No login, **Lembrar neste computador** vem marcado. Desmarcado (para computador compartilhado),
  token e cache ficam no `sessionStorage` e somem ao fechar a aba; nada fica no `localStorage`.
- Logo depois do login, o app pré-carrega os dados de todas as telas enquanto o botão mostra o
  progresso (no máximo 12 s; o resto continua por trás). Status de envio e tentativas só são
  pré-carregados para atividades com prazo nos últimos 14 ou nos próximos 21 dias; as demais são
  buscadas ao abrir a página delas.
- Respostas ficam em cache no `localStorage` (com cópia em memória). Dentro da validade (5–60 min
  por tipo) trocar de página não faz nenhuma chamada ao AVA. Vencido, o dado guardado aparece na
  hora e a versão nova é buscada em segundo plano; se mudou, a tela se redesenha sozinha, mantendo a
  rolagem (nunca durante uma edição ou com diálogo aberto). "Atualizar dados" força nova busca.
- O cache se limpa sozinho (entradas vencidas há mais de 7 dias) e, se o `localStorage` encher,
  apaga as entradas mais antigas em vez de parar de gravar. O carregamento só aparece se a tela
  demorar mais de 150 ms, e o botão Voltar devolve a rolagem de onde você estava.
- Links de arquivos levam `?token=` na URL (exigência do Moodle); eles abrem com `rel=noreferrer`.

## 4. Publicado (Vercel)

O `vercel.json` publica o `dist/` como site estático. O que muda em relação ao uso local:

- O endereço é público, mas o app continua sem servidor próprio: cada pessoa entra com a própria
  matrícula, a senha vai direto para o AVA e o token fica só no navegador dela.
- Como o token fica no `localStorage` de um domínio público, a proteção contra script injetado é o
  que importa: o `Content-Security-Policy` só aceita scripts do próprio site (mais o script de tema
  do `index.html`, pelo hash) e só deixa a página conversar com o AVA (`connect-src`). Se mudar o
  script inline do `index.html`, atualize o hash no `vercel.json`.
- Também vão `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (os links de arquivo levam
  `?token=`), HSTS e `nosniff`.
- **Instalar como app (PWA):** no celular, "Adicionar à tela inicial"; no computador, o ícone de
  instalar na barra de endereço. O service worker (`public/sw.js`, só em produção) guarda apenas os
  arquivos do app para abrir sem rede; nunca guarda nada vindo do AVA. Com o cache de dados ainda
  válido, as telas abrem sem internet.

## 5. Testes

```bash
npm test               # roda uma vez (o build também roda antes de gerar o dist)
npm run test:watch     # fica rodando enquanto você edita
```

Cobrem as contas de notas (`src/grades.ts`), o filtro de HTML das questões (scripts, eventos,
links `javascript:`, imagens e token) e a trava de somente leitura do cliente.

## Regras do projeto

- `.env`, `.cache/` e `dist/` estão no `.gitignore`. Nunca commitar credenciais.
- O cliente (`src/moodle/client.ts`) só aceita funções da lista `READ_ONLY_FUNCTIONS` e bloqueia
  nomes com padrão de escrita (`*_view_*`, `save_*`, `submit_*`, `add_*`…).
- A única escrita permitida é fazer questionário e enviar tarefa: as funções de `WRITE_FUNCTIONS`
  (`mod_quiz_start_attempt`, `mod_quiz_save_attempt`, `mod_quiz_process_attempt`,
  `mod_quiz_view_attempt`, `core_files_get_unused_draft_itemid`, `mod_assign_start_submission`,
  `mod_assign_save_submission`, `mod_assign_submit_for_grading`, `mod_assign_remove_submission`)
  e o upload para a área de rascunho, sempre com `allowWrite`. Qualquer outra escrita continua
  bloqueada. Os passos sem volta (iniciar, enviar, remover) pedem confirmação na interface.
- No máximo 2 requisições simultâneas; requisições iguais em andamento são reaproveitadas.
- Uso individual: cada pessoa usa o próprio token, guardado localmente. Nada é centralizado.

## Estrutura

```
src/moodle/client.ts   cliente: call(wsfunction, params), arrays aninhados, erros, cache, limite
src/moodle/api.ts      wrappers tipados das funções de consulta
src/format.ts          datas em America/Sao_Paulo
src/grades.ts          ciclo atual, valores máximos, pontos acumulados, quebra por VA
src/ui.ts              componentes visuais e gráficos (HTML/CSS/SVG, sem bibliotecas)
src/state.ts           estado compartilhado (cliente, usuário, navegação)
src/data.ts            busca/agregação de dados usada por várias telas
src/layout.ts          barra lateral, carregamento, avatar
src/browser-cache.ts   cache e token no navegador (localStorage ou, sem "Lembrar", sessionStorage)
src/prefetch.ts        pré-carregamento logo depois do login
src/question-html.ts  limpeza do HTML das questões e inventário dos campos
src/views/             uma tela por arquivo (questionário: quiz.ts, quiz-attempt.ts, quiz-shared.ts)
src/demo.ts            dados fictícios do modo ?demo (botão "Ver demonstração" no login)
src/demo-quiz.ts       questionários do modo ?demo, com estado (iniciar/salvar/enviar)
src/demo-assign.ts     tarefas do modo ?demo, com estado (upload/salvar/enviar/remover)
src/main.ts            inicialização e roteamento (tabela de rotas)
src/**/*.test.ts       testes (Vitest)
public/sw.js           service worker do PWA (só arquivos do app)
scripts/               CLI (site-info, resumo)
```
