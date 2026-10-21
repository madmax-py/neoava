# NeoAVA

Front-end pessoal para o AVA da UniEvangélica (Moodle), usando a API oficial de Web Services
(o mesmo token do app móvel do Moodle). É **somente leitura**, com uma exceção: fazer
questionários (iniciar, salvar e enviar tentativas), como o app oficial faz.

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

## 3. App web local

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

Para mexer no visual sem token: `http://127.0.0.1:5173/?demo` usa dados fictícios
(só existe em `npm run dev`; não entra no build e não acessa a rede).

O navegador chama o Moodle direto (o servidor responde com `Access-Control-Allow-Origin: *`).

- O servidor escuta só em `127.0.0.1`: outros computadores da rede não alcançam o app.
  Por isso o token **nunca** é injetado na página: cada pessoa entra com a própria matrícula e
  o token fica só no `localStorage` do navegador dela. O `MOODLE_TOKEN` do `.env` é usado só
  pelos scripts de terminal. `.env` e `.cache/` são bloqueados pelo servidor.
- Para abrir no celular (mesma rede Wi-Fi): `npm run dev:rede` e acesse `http://<IP-do-PC>:5173`
  (o Vite mostra o endereço em "Network"). A página vai sem HTTPS: use só em rede de confiança
  e desligue (Ctrl+C) quando terminar. O `npm run dev` continua restrito a este computador.
- Respostas ficam em cache no `localStorage` (15–60 min por tipo); "Atualizar" força nova busca.
- Links de arquivos levam `?token=` na URL (exigência do Moodle); eles abrem com `rel=noreferrer`.

## Regras do projeto

- `.env`, `.cache/` e `dist/` estão no `.gitignore`. Nunca commitar credenciais.
- O cliente (`src/moodle/client.ts`) só aceita funções da lista `READ_ONLY_FUNCTIONS` e bloqueia
  nomes com padrão de escrita (`*_view_*`, `save_*`, `submit_*`, `add_*`…).
- A única escrita permitida é fazer questionário: as funções de `WRITE_FUNCTIONS`
  (`mod_quiz_start_attempt`, `mod_quiz_save_attempt`, `mod_quiz_process_attempt`,
  `mod_quiz_view_attempt`), e só com `allowWrite`. Qualquer outra escrita continua bloqueada.
  Iniciar e enviar pedem confirmação na interface.
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
src/question-html.ts  limpeza do HTML das questões e inventário dos campos
src/views/             uma tela por arquivo
src/demo.ts            dados fictícios do modo ?demo (só em dev)
src/demo-quiz.ts       questionários do modo ?demo, com estado (iniciar/salvar/enviar)
src/main.ts            inicialização e roteamento
scripts/               CLI (site-info, resumo)
```
