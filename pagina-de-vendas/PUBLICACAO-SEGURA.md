# Procedimento seguro de publicação — projeto `lumeo-vendas`

Este documento descreve o fluxo a seguir nas próximas atualizações das páginas de
vendas (HQs e Livros), para validar um deploy antes dele chegar ao domínio
público (`lumeo-vendas.vercel.app`).

Este arquivo é só documentação. Ele não dispara nenhum deploy, commit ou push por
conta própria.

## Visão geral

Hoje (até esta auditoria) cada publicação ia direto para produção com
`vercel --prod`, sem etapa de validação isolada. O fluxo abaixo usa um
deployment de **produção isolado** (não um Preview comum) como etapa de
validação, para eliminar o risco de `vercel promote` provocar uma recompilação
com variáveis de produção diferentes do que foi validado — se o deployment
testado já foi compilado como produção desde o início, promovê-lo depois é só
trocar o alias do domínio, sem rebuild.

```
vercel --prod --skip-domain   →  compila com as variáveis de PRODUÇÃO, gera
                                  uma URL própria, mas NÃO move o domínio
                                  público pra ela
      │
      ▼
  validar esse deployment      →  rotas, estilos, imagens, checkouts,
                                   mobile e desktop
      │
      ▼
  autorização humana           →  só segue com "sim" explícito
      │
      ▼
vercel promote <url>           →  troca o alias do domínio público pra esse
                                   mesmo deployment, sem recompilar
      │
      ▼
  conferir domínio público     →  reexecutar a mesma checklist já no ar
```

## 1) Preparar o deployment de produção sem tocar no domínio público

```bash
cd pagina-de-vendas
vercel --prod --skip-domain
```

`--skip-domain` desativa a promoção automática (o aliasing) do domínio público
para esse novo deployment. Mesmo usando `--prod` — ou seja, compilado com as
mesmas configurações/variáveis que um deployment de produção normal usaria —
o `lumeo-vendas.vercel.app` continua apontando pra versão anterior enquanto
esse deployment isolado é validado numa URL própria (tipo
`https://lumeo-vendas-<hash>-delima-dev.vercel.app`).

Isso resolve o problema de um `vercel promote` em cima de um Preview comum
(`vercel deploy` sem `--prod`): nesse caso a Vercel pode recompilar o projeto
com as variáveis de produção no momento da promoção, e o que foi validado no
Preview deixa de ser garantidamente idêntico ao que vai pro ar. Compilando já
como produção desde o passo 1, a promoção no passo 5 não recompila nada.

**Atenção**: URLs de deployment individual (diferente do domínio de produção)
exigem autenticação da conta Vercel para acesso externo — confirmado nesta
auditoria (retornam redirecionamento de login para quem não está logado). Duas
formas de lidar com isso na validação:
- abrir o deployment em um navegador já logado na conta Vercel do projeto; ou
- configurar, nas configurações do projeto na Vercel, um "Protection Bypass for
  Automation" (recurso padrão da Vercel), se quiser rodar os testes abaixo de
  forma automatizada/sem login manual.

## 2) Rotas a testar nesse deployment

Testar exatamente estas 5 rotas (as mesmas do domínio público):

| Rota | Conteúdo esperado |
|---|---|
| `/` | página de Livros |
| `/livros` | página de Livros |
| `/hqs` | página de HQs |
| `/privacidade` | política de privacidade |
| `/termos` | termos de uso |

## 3) O que validar em cada rota

- **CSS realmente aplicado** (não só "carregou") — ex.: inspecionar se o header
  está `position: sticky` via DevTools/computed style, não apenas checar
  status 200 do arquivo `.css`.
- **Imagens** — nenhuma quebrada, nenhum ícone/logo faltando.
- **JavaScript** — sem erro no console, CTAs e carrosséis respondendo.
- **Console do navegador** — zero erro, zero warning de recurso bloqueado.
- **Responsividade** — conferir em pelo menos 360/390/412px (mobile) e
  1440px (desktop), sem rolagem horizontal indevida.
- **Links reais da Hotmart** — clicar nos CTAs de compra e confirmar que levam
  à URL de checkout correta, com os parâmetros (`off=`, `checkoutMode`, UTMs)
  preservados — sem concluir nenhuma compra.

Essa é a mesma checklist usada na auditoria de estabilidade mais recente; pode
ser repetida manualmente ou via script (Playwright) apontando para a URL do
deployment isolado em vez do domínio de produção.

## 4) Autorização antes de promover

Só seguir para a promoção depois de autorização explícita. Nenhuma promoção
automática.

## 5) Promover o deployment validado

```bash
vercel promote <url-do-deployment-de-produção-isolado>
```

Como esse deployment já foi compilado com `--prod` no passo 1, essa promoção
só troca o alias do domínio público para ele — sem recompilar nada. Isso
garante que o artefato validado nos passos 2–3 é byte a byte o mesmo que vai
para o ar, eliminando qualquer diferença entre "o que foi testado" e "o que
foi publicado".

## 6) Conferir produção depois da promoção

Repetir a mesma checklist do passo 3, agora em `https://lumeo-vendas.vercel.app`
(domínio público), para confirmar que a promoção refletiu corretamente.

## 7) Rollback

Se algo passar despercebido na validação e for identificado depois da
promoção, reverter imediatamente para a versão anterior:

```bash
vercel rollback
```

Esse comando restaura rapidamente o deployment anterior no domínio público.
Alternativamente, `vercel promote <url-do-deployment-anterior>` aponta o
domínio de volta para qualquer deployment específico já existente — útil se
for necessário voltar a uma versão mais antiga que a imediatamente anterior
(a Vercel mantém o histórico de deployments, listável com `vercel ls
lumeo-vendas`).

## 8) Cuidado com nomes de arquivo de imagem/vídeo

`/assets/*` tem `Cache-Control: max-age=604800` (7 dias) no navegador do
visitante. Trocar o **conteúdo** de uma imagem/vídeo mantendo o **mesmo nome
de arquivo** pode deixar visitantes recorrentes vendo a versão antiga por até
7 dias.

Regra prática para as próximas atualizações de asset:
- Se o conteúdo visual muda, o nome do arquivo muda junto (ex.:
  `lumeo-logo.webp` → `lumeo-logo-v2.webp`, ou um sufixo de data/hash), e as
  referências no HTML são atualizadas para o novo nome.
- Reaproveitar o mesmo nome de arquivo só quando o conteúdo for idêntico
  (otimização de peso sem mudança visual, por exemplo).
