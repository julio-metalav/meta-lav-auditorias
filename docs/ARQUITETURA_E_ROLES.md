Você está dando continuidade ao projeto "Meta Lav Auditorias".



REGRAS DE TRABALHO (OBRIGATÓRIAS):

0\) você é minha engenheira de software.

1\) Zero enrolação. Sempre 1 passo por vez.

2\) Quando editar arquivo, entregue o ARQUIVO INTEIRO, pronto pra colar.

3\) Nunca alterar lógica ou papel sem confirmar antes.

5\) Quando eu tiver que fazer algo, explique como leigo, passo a passo. 

6\) Sempre partimos do Vercel com os lançamentos dos códigos no disco local, não o git: você pede o trecho exato do log e resolve sem chute. 7) Objetivo: build verde no Vercel,

8\) Sempre respeitar o MAPA OFICIAL abaixo. Se violar, PARE e AVISE.

9\) Prioridade absoluta: não quebrar nada que já funcionava.

1-) Sempre partir do estado ATUAL do repositório.



MAPA OFICIAL DE PAPÉIS (CONGELADO):

\- Auditor:

&nbsp; • Faz leituras de campo (água/energia/gás), tira fotos das leitura e mais fotos da proveta (de preferencia 2 fotos  - detergente e amanciante + fotos das bombonas de químicos (detergente e amanciate) +  foto do conector bala conectado , observações e conclui em campo

&nbsp; • NÃO lança ciclos

\- Interno:

&nbsp; • Pode fazer TUDO que o auditor faz, ou seja, se o interno estiver em campo e abrir uma auditoria, faz o que o auditor faz

&nbsp; • Pode listar/criar auditorias, atribuir, lançar ciclos e fechar

&nbsp; • NÃO acessa relatórios gerenciais sensíveis (DRE etc.)

\- Gestor:

&nbsp; • Pode tudo



ROTAS OFICIAIS:

\- Lista/criação: /auditorias

\- Auditor campo: /auditor/auditoria/\[id]

\- Interno conferência/ciclos: /interno/auditoria/\[id]

\- Rota genérica: /auditoria/\[id] → redirect por role



STATUS ATUAL DO PROJETO:

\- Login + roles funcionando

\- Lista de auditorias funcionando

\- Interno cria auditorias

\- Redirect por role funcionando

\- Tela do Interno para lançar ciclos EXISTE

\- Próximo foco: estabilidade, persistência e depois relatórios



IMPORTANTE:

Nunca invente fluxo novo sem pedir confirmação.

Se algo parecer inconsistente, pergunte antes de alterar.



Sempre Continuar do último ponto.



BRIEFING – META-LAV auditorias 

Plataforma de Auditorias Mensais + Relatorios Gerenciais + Manutencao Preventiva

Versao: 1.0 | Data: 08/01/2026



1\. Objetivo

Desenvolver um sistema interno (nao publico) para controlar auditorias mensais dos condominios onde a Meta-Lav opera lavanderias compartilhadas, centralizando dados, evidencias (fotos/PDFs), calculos e gerando relatorios gerenciais para tomada de decisao.

O sistema deve:

•	Padronizar auditorias de campo e reduzir falhas de registro.

•	Centralizar dados, fotos e documentos (medidores, quimicos, conector, comprovantes).

•	Permitir conferencia e fechamento pelo escritorio.

•	Gerar relatorios operacionais, financeiros e gerenciais (DRE, KPIs).

•	Automatizar o envio de relatorio mensal ao condominio (com anexos).

•	Controlar manutencao preventiva por ciclos (limpezas).

2\. Perfis de acesso (roles)

2.1 Gestor

•	Acesso total a todas as funcoes.

•	Dashboard gerencial consolidado (DRE, EBITDA, margem, ranking, etc.).

•	Executa todas as rotinas de interno e auditor, quando necessario.

2.2 Interno (escritorio)

•	Cadastra/edita condominios (dados completos).

•	Cadastra auditores (login e senha) e gerencia acessos.

•	Atribui condominios aos auditores e libera auditorias mensais.

•	Define tarifas e parametros financeiros (m3 agua, kWh energia, m3 gas, valores de ciclo, cashback).

•	Confere auditorias, insere ciclos por maquina, fecha auditoria e envia relatorios ao condominio.

•	Registra e controla manutencoes/limpezas por lavadora.

2.3 Auditor de campo

•	Acessa somente os condominios atribuídos.

•	Somente lancamentos de campo + anexos (sem poderes de editar parametros financeiros).

•	Nao fecha auditoria e nao altera auditoria fechada.

3\. Rotina mensal (fluxo)

3.1 Abertura das auditorias (interno)

•	No inicio do mes, o interno libera as auditorias do periodo e atribui os condominios a cada auditor.

•	O auditor passa a ver sua lista de condominios (ordem alfabetica).

3.2 Auditoria de campo (auditor)

Na tela do auditor:

•	Lista de condominios atribuídos (ordem alfabetica).

•	Atalho 'Abrir no Google Maps' com o endereco do condominio.

Para cada condominio/mes, o auditor deve registrar (valor + foto):

•	Agua: leitura/consumo + foto do medidor.

•	Energia: leitura/consumo + foto do medidor.

•	Gas: leitura/consumo + foto do medidor (somente onde houver).

Evidencias adicionais (fotos):

•	Dosagem de quimicos: foto da proveta de medicao de detergente e amaciante (duas fotos).

•	Dosagem de quimicos: foto das bombonas (detergente e amaciante).

•	Cabo / conector bala: foto do cabo conectado.

3.3 Conferencia e fechamento (interno)

•	Interno cadastra condominios, cadastral auditors (faz tudo menos acessar relatorios gerenciais sensiveis – DRE etc)

•	Interno visualiza dados e fotos da auditoria de campo.

•	Interno insere o volume de ciclos vendidos por maquina (lavadora e secadora, individualmente).

•	Sistema calcula faturamento por maquina e total do condominio.

•	Sistema calcula cashback (percentual configuravel por condominio).

•	Interno anexa PDF do comprovante de pagamento do cashback ao condominio.

•	Interno fecha a auditoria (bloqueia edicao pelo auditor).

3.4 Relatorio e envio ao condominio

Ao fechar a auditoria, o sistema deve gerar o relatorio mensal (PDF) e permitir envio por e-mail ao condominio se possivel de forma automatica

Conteudo minimo do relatorio:

•	Faturamento total das maquinas por modelo, sendo dois tipos (10 e 15 k), desde que quando do cadastro do condominio seja informado (lavagem e secagem separados).

•	Total do condominio (despesas de agua, energia e gas onde houver) e cashback calculado conforme cadastro no condominioi.

Anexos obrigatorios no envio:

•	Foto do medidor de agua.

•	Foto do medidor de energia.

•	Foto do medidor de gas (se houver).

•	PDF do comprovante de pagamento do cashback.

Requisito de operacao:

•	Interno revisa/valida o relatorio e entao clica em 'Enviar'.

•	Registrar log do envio (data/hora, destinatarios).

4\. Cadastro completo do condominio (interno/gestor)

Deve existir no dashboard um botao/link para cadastrar e manter dados do condominio, incluindo:

4.1 Identificacao e localizacao

•	Nome do condominio.

•	Cidade/UF.

•	Endereco completo.

•	Botao 'Abrir no Google Maps'.

4.2 Contatos

•	Sindico: nome, telefone e e-mail.

•	Zelador: nome e telefone.

•	E-mails adicionais da administracao (lista).

4.3 Operacao e maquinas

•	Cadastro individual de maquinas com ID interno (ex.: LAV-01, SEC-01).

•	Tipo (lavadora/secadora) e status (ativa/inativa).

•	Suportar ate 10 conjuntos (ou mais, se escalavel).

4.4 Parametros financeiros

•	Valor do ciclo de lavadora (R$).

•	Valor do ciclo de secadora (R$), se diferente.

•	Cashback % (configuravel; padrao tipico 10%, mas variavel).

4.5 Dados bancarios

•	Banco, agencia, conta, tipo de conta, PIX.

•	Favorecido / CNPJ.

5\. Modulo de manutencao preventiva (obrigatorio)

5.1 Regras por lavadora

•	Limpeza quimica: a cada 500 ciclos de lavagem.

•	Limpeza fisica: a cada 2000 ciclos de lavagem.

Observacao: os ciclos sao acumulados com base nos ciclos informados nas auditorias mensais (por lavadora).

5.2 Contadores e alertas

•	Manter contadores por lavadora (dois contadores independentes: quimica e fisica).

•	Status por lavadora: OK / Atencao (ex.: acima de 80%) / Vencida.

•	Listas e alertas no dashboard do interno e do gestor.

5.3 Registro das limpezas

•	Registrar tipo (quimica/fisica), data, responsavel, observacoes.

•	Anexo opcional (foto/comprovante).

•	Ao registrar: resetar apenas o contador correspondente e manter historico.

5.4 Relatorios de manutencao

•	Lista de lavadoras com limpeza vencida.

•	Historico de limpezas por maquina e por condominio.



6\. Relatorios e indicadores (gestor)

O sistema deve consolidar informacoes e permitir filtros por periodo, cidade e condominio.

6.1 Relatorios operacionais

•	Auditorias realizadas, pendentes e atrasadas.

•	Consumo de agua, energia e gas (com historico).

•	Falhas/ocorrencias por maquina (se houver campo).

•	Status de manutencao (limpezas quimicas e mecanicas) por condominio e por maquina.

6.2 Relatorios financeiros

•	Faturamento por maquina e por condominio.

•	Faturamento total mensal.

•	Cashback (valor e percentual).

•	Receita liquida (pos cashback).

•	Custo variavel estimado (agua/energia/gas, produtos quimicos - só da lavadora) com base em tarifas cadastradas.

6.3 Relatorios gerenciais (DRE/KPIs)

KPIs minimos:

•	Receita bruta, cashback, receita liquida.

•	Custos variaveis (agua, energia, gas) e margem de contribuicao.

•	Custos fixos e despesas variaveis (lançados/parametrizados).

•	EBITDA e percentual de lucro.

•	Ranking de melhores e piores condominios.

•	Receita por maquina e (quando aplicavel) por ciclo.

Exportacao:

•	Excel (obrigatorio).

•	PDF (obrigatorio).

7\. Interface (UX/UI)

•	Interface simples e amigavel.

•	Tela do auditor: fluxo linear (seleciona condominio -> insere valores -> sobe fotos a partir do cellular e nao de arquivos.).

•	Cores e identidade visual da Meta-Lav.

8\. Requisitos tecnicos e nao-escopo

8.1 Requisitos tecnicos

•	Controle de acesso por perfil.

•	Upload e armazenamento de fotos e PDFs.

•	Logs basicos (quem lançou/alterou/fechou/enviou).

•	Estabilidade e facilidade de manutencao.

•	Integracao com e-mail (envio com anexos).



8\. Criterios de aceite

O projeto sera considerado entregue quando:

•	Auditor consegue lancar auditoria com todos os anexos obrigatorios.

•	Interno consegue conferir, inserir ciclos por maquina, anexar PDF, fechar e enviar relatorio.

•	Relatorios gerenciais (KPIs/DRE) funcionam com filtros e exportacao.

•	Modulo de manutencao funciona (contadores, alertas, registro, historico).

•	Controle de acesso por perfil funciona corretamente.



