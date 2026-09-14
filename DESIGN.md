---
name: School Air
description: Painel de instrumento para monitorar a qualidade do ar de salas de aula, com temas escuro e claro
colors:
  fundo-noturno: "#0e1116"
  superficie: "#151a21"
  painel: "#1b222c"
  linha-divisoria: "#2a3442"
  cinza-inativo: "#4a586c"
  leitura-primaria: "#e2e6ec"
  leitura-secundaria: "#94a1b3"
  azul-instrumento: "#6b9df8"
  verde-seguro: "#6ec07a"
  ambar-atencao: "#e8a33d"
  vermelho-critico: "#e05c5c"
typography:
  display:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
  valor-instrumento:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
  headline:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "rgba(107,157,248,0.15)"
    textColor: "{colors.azul-instrumento}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  chip-status:
    backgroundColor: "rgba(110,192,122,0.12)"
    textColor: "{colors.verde-seguro}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  card-sensor:
    backgroundColor: "{colors.painel}"
    rounded: "{rounded.lg}"
    padding: "20px 24px"
  input-field:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.leitura-primaria}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item:
    backgroundColor: "rgba(107,157,248,0.12)"
    textColor: "{colors.azul-instrumento}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
---

# Design System: School Air

## 1. Overview

**Creative North Star: "O Instrumento de Bancada"**

O School Air é um instrumento de medição, não um site. A navegação vive num trilho lateral expansível (56 ↔ 220px), como o painel de comandos de um equipamento; o conteúdo responde à pergunta "alguma sala está ruim agora?" no primeiro olhar. Os números — sempre com unidade e limiar — são o protagonista, compostos em IBM Plex Mono sobre superfícies em degraus tonais com cantos discretos (4–10px, nem pílula nem quina seca).

O sistema opera em **dois turnos**: tema escuro (padrão, tokens acima) e tema claro, alternados por botão no topo, persistidos e respeitando a preferência do sistema na primeira visita. Todos os papéis de cor são tokens CSS (`--color-*`); nenhum componente referencia cor absoluta, exceto os gráficos (limitação do canvas — tons médios fixos legíveis nos dois temas).

Rejeita explicitamente (do PRODUCT.md): painel de NOC/cripto, site institucional genérico, planilha crua, visual gamificado — e qualquer slogan na interface.

**Key Characteristics:**
- Trilho lateral expansível; barra superior mínima (status + tema)
- Números em IBM Plex Mono; interface em IBM Plex Sans
- Cor sempre significa estado; tudo em tokens com par claro/escuro
- Profundidade por borda 1px + degrau tonal; sombra real só no login

## 2. Colors

Paleta em tokens com dois temas. O escuro é o canônico (frontmatter); o claro redefine os mesmos papéis: fundo `#eef1f5`, superfície `#f8fafc`, painel `#ffffff`, borda `#d7dde6`, texto `#1c2430`, sub `#5a6675`, accent `#3565c4`, verde `#22803a`, âmbar `#8f6206`, vermelho `#b93a3a` — todos ≥4.5:1 sobre seus fundos.

### Primary
- **Azul Instrumento** (#6b9df8 escuro / #3565c4 claro): ação, seleção, foco. Nunca decoração.

### Secondary
- **Verde Seguro** (#6ec07a / #22803a), **Âmbar Atenção** (#e8a33d / #8f6206), **Vermelho Crítico** (#e05c5c / #b93a3a): o vocabulário semântico do IAQ.

### Neutral
- **Fundo Noturno** (#0e1116) → **Superfície** (#151a21) → **Painel** (#1b222c): os três degraus tonais; **Linha Divisória** (#2a3442) em 1px; **Leitura Primária/Secundária** (#e2e6ec / #94a1b3).

### Named Rules
**A Regra da Cor é Estado.** Verde, âmbar e vermelho pertencem ao IAQ e a mais nada.
**A Regra do Fundo Tintado.** Botões coloridos: rgba da própria cor a 12–20% + texto na cor cheia; nunca fundo sólido saturado.
**A Regra dos Dois Turnos.** Todo papel de cor existe em par escuro/claro via token; cor absoluta em componente é proibida (exceção documentada: séries dos gráficos).

## 3. Typography

**Display Font:** IBM Plex Sans
**Body Font:** IBM Plex Sans
**Label/Mono Font:** IBM Plex Mono (valores, hora, tabelas)

**Character:** par técnico da mesma família — a Sans humanista-técnica para a interface, a Mono para tudo que é medido. A hierarquia vem de peso e tamanho.

### Hierarchy
- **Display** (700, 36px, Sans): o veredito do hero, e nada mais.
- **Valor de instrumento** (700, 20–48px, **Mono**): leituras numéricas; CO₂ dominante em 48px.
- **Headline** (700, 24px): títulos de aba.
- **Title** (500, 14px): nomes de cartões, salas e seções.
- **Body** (400, 14px): texto corrente; tabelas em Mono 13px.
- **Label** (400, 12px, tracking 0.05em, CAIXA ALTA): rótulos de métricas, sempre com ícone inline de 14–16px — único uso de uppercase.

### Named Rules
**A Regra da Unidade.** Nenhum número sem unidade e, onde couber, sem limiar de referência.
**A Regra do Mono.** Se é medido, é Mono. Se é interface, é Sans.

## 4. Elevation

Sistema plano: profundidade por borda 1px (#2a3442) + degrau tonal (fundo → superfície → painel). Sombras foram removidas dos cartões; hover de cartão clicável usa leve sombra + translateY(-1px) como resposta de estado, e o overlay de login mantém a única sombra estrutural (`0 8px 24px rgba(0,0,0,0.35)`).

### Named Rules
**A Regra da Camada Tonal.** Contêiner sobreposto é um degrau tonal mais claro; sombra sozinha não cria hierarquia.

## 5. Components

### Navegação (trilho lateral)
- Fixo à esquerda, 220px aberto / 56px recolhido (rótulos `.side-label` somem); toggle no topo; usuário + Sair no rodapé do trilho; estado persistido.
- Item: 6px de raio, ícone 16px + rótulo; ativo em azul tintado 12%; hover em `color-mix` do texto a 7%.

### Buttons
- **Shape:** 6px; mini-botões de tabela 4px, agrupados em flex `gap-1.5`.
- **Primary/Sucesso/Perigo:** padrão tintado (12–20% + texto na cor cheia), peso 500.

### Chips
- 4px de raio, tintado 12%, 11px/500 — semânticos (Ótimo/Atenção/Crítico) e informativos.

### Cards / Containers
- 8–10px de raio, painel sobre fundo, borda 1px, padding 20–24px, sem sombra em repouso.
- **Régua de leituras**: superfície única com divisórias verticais para métricas secundárias — proibido regredir para grade de cartões idênticos.

### Inputs / Fields
- Superfície + borda 1px, raio 6px; foco com contorno no azul instrumento.

### Hero de Status (assinatura)
Responde a pergunta nº 1: lavado tonal do estado (gradiente 90° do tint para transparente — **não** faixa lateral), ícone em bloco tintado, veredito em Display, motivo com valor e limiar, hora em Mono.

## 6. Do's and Don'ts

### Do:
- **Do** usar tokens `--color-*` para toda cor de componente (funcionam nos dois temas).
- **Do** compor todo valor medido em IBM Plex Mono com unidade e limiar.
- **Do** manter o trilho lateral como única navegação primária.
- **Do** respeitar `prefers-reduced-motion` (menu e temas incluídos).

### Don't:
- **Don't** parecer "painel de NOC/criptomoedas", "site institucional genérico", "planilha crua" ou "visual gamificado/infantil" (PRODUCT.md, textual).
- **Don't** escrever slogan na interface.
- **Don't** usar cor absoluta em componente novo, faixa lateral colorida, gradient text ou glassmorphism.
- **Don't** voltar a grade de cartões idênticos para métricas — a régua existe para isso.
- **Don't** usar verde/âmbar/vermelho fora do estado do ar.
