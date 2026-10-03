# 08 · Plataforma modular de NovaEra Nexus

Anàlisi funcional de la reestructuració d'ITFin360, de producte de finances IT a plataforma amb
mòduls. Versió 3, octubre de 2026. Incorpora les quinze respostes del primer lliurament i el mòdul de
Diagnòstic, full de ruta i seguiment, que es defineix sencer al document `09`. Validada; el pla de
reestructuració és el document `10` i el backlog el `11`.

Els documents `01` a `07` segueixen vigents per al mòdul de Finances. Aquí es defineix què hi ha per
sobre i al costat.

---

## 0. Què ha canviat

### 0.1 Versió 3

| Tema | Versió 2 | Versió 3 |
|---|---|---|
| Primer mòdul | Finances | Mòdul 0, Diagnòstic, full de ruta i seguiment (doc `09`): és el que obre cada client |
| Valoració | Cinc eixos | Valoració 360 de deu criteris, comuna a iniciatives i projectes, amb votació ponderada per funció i mesura de consens (doc `09` §5) |
| Impacte | Puntuació | Euros: CAPEX, OPEX, payback de caixa i complet, ROI a 36 mesos (doc `09` §6) |
| Seguiment | Informe puntual | Seguiment mensual de benefici realitzat i reavaluació trimestral de maduresa |
| Dimensions | Tecnologia | Nou dimensions, amb ciberseguretat (NIST CSF 2.0), compliment normatiu i IA (Reglament d'IA) |
| Accés | Enllaç màgic o contrasenya | MFA obligatori per a tothom (secció 14.5) |
| Repositori | Públic | Privat (secció 14.6) |

### 0.2 Versió 2

| Tema | Versió 1 | Versió 2 |
|---|---|---|
| Visió entre clients | Agregació iterant client per client | Eliminada. Cada client és un món tancat |
| Rols de direcció | Un rol `FINANCE` reanomenat | Rol de plataforma i funció a l'organigrama separats |
| Bonus | Quantitat fixa | Percentatge del salari brut, ponderat per mida i impacte dels projectes |
| Valoració de projectes | Matriu sense puntuació | Cinc eixos amb puntuació ponderada i pesos per client |
| Aprovació del charter | Direcció | Política d'aprovació per client (direcció o PM), amb esborrany assistit per IA |
| Competències | Model de tercers | Model propi de NovaEra Nexus amb cicle avaluació, formació i reavaluació |
| Documents i reunions | Exportació de Jira i Notion | Jira per a projectes, Google Drive com a entrada, transcripcions de Plaud, Fathom i Teams |
| Retenció de talent | Dos anys | Fins al final de la relació d'assessoria |
| Dades | Joc fictici | Client pilot Cafès Cornellà amb dades reals, amb condicions prèvies |
| IA | Fase final, fora d'abast | Capa transversal dissenyada ara: esdeveniments, disparadors, agents amb baranes, xat |

---

## 1. Punt de partida

El que existeix i funciona: autenticació amb Auth.js, multi-tenant amb Row Level Security a
PostgreSQL, alta per invitació, i finances d'un departament IT (factures, proveïdors, contractes
recurrents, immobilitzat amb amortització, plantilla, imputació d'hores, projectes amb baselines
versionades i quadre EVM). El motor de càlcul viu a `packages/finance-core`, amb setze mòduls purs i
cobertura exigida al 95 %.

El que es construeix: sis mòduls més, un shell que els sosté, una capa d'IA transversal, i un model de
dades on client, departament, persona, projecte, proveïdor, actiu i període fiscal existeixen un sol
cop.

Nom de treball i repositori: ITFin360, sense canvis.

### 1.1 Principi de configuració

Cafès Cornellà és el primer client, no la plantilla. Cap valor seu va escrit al codi. Les 44 setmanes
productives, les 4 hores de reunions del pla director, els llindars de sobrecàrrega, els pesos del
bonus, les bandes d'assoliment, els pesos dels cinc eixos i els trams d'inversió són **paràmetres per
client** amb un valor per defecte que el client pot canviar. Si una regla d'aquest document porta una
xifra, és el valor per defecte, i es pot canviar per client sense tocar codi.

---

## 2. Multi-tenant

### 2.1 Un client, un tenant, un món tancat

Cada client és un tenant amb el seu ecosistema: dades, informes, resultats i anàlisis. Cap pantalla,
cap informe, cap agent i cap consulta barreja dos clients. No hi ha vista global.

NovaEra Nexus opera la plataforma però no és un tenant. Les persones de NovaEra Nexus tenen pertinença
explícita a cada client on treballen, i canvien de client actiu com qualsevol altre usuari amb més d'una
organització. Mentre treballen a Cafès Cornellà, no veuen res d'un altre client, ni tan sols que existeix.

### 2.2 Com s'imposa

- Totes les taules de dades de client porten `tenant_id`, RLS forçada i la política
  `tenant_isolation`. El gate de RLS de CI ho comprova a cada migració.
- El rol de base de dades de l'aplicació és `NOBYPASSRLS`. Cap persona, cap rol i cap agent té bypass.
- Els agents d'IA s'executen dins de `withTenant` com qualsevol consulta d'usuari (secció 13). Un agent no
  pot llegir un client que no sigui el seu perquè la base de dades no l'hi deixa.
- Cap memòria, cap índex vectorial i cap cau es comparteix entre clients. Si es fa servir cerca
  semàntica, l'índex porta `tenant_id` i política RLS com qualsevol altra taula.
- Els fitxers pujats es guarden amb el client al camí (`tenants/<tenantId>/...`) i amb accés per URL
  signada de durada curta.

### 2.3 Una base de dades compartida amb RLS

Es manté una sola base de dades amb RLS. Una base per client multiplica migracions, còpies i cost, i cap
client ho exigeix avui. El model és compatible amb el pas a una base per client si algun contracte ho
demana: totes les taules porten `tenant_id` i l'esquema és idèntic.

Quan la plataforma passi a servidor privat (secció 14.4), aquesta decisió es revisa.

### 2.4 Catàlegs de NovaEra Nexus dins de cada client

El model de competències, les plantilles d'informe, la plantilla de Project Charter i els valors per
defecte dels paràmetres són de NovaEra Nexus i s'usen a tots els clients. No es guarden en una taula global
sense `tenant_id`: una fila compartida que un client pot editar és un acoblament entre clients.

Es **copien** dins del client quan s'activa el mòdul. Cada fila anota d'on ve (`sourceTemplate`,
`sourceVersion`), i així es pot saber quin client va amb quina versió i oferir-li l'actualització. El
client adapta la seva còpia sense tocar la de ningú.

---

## 3. Alta de client

Formulari `/clients/nou`, accessible només a l'equip de NovaEra Nexus (llista d'alta a la variable
`ALTAS_ORGANIZACION`, ja existent des de F0-12).

| Camp | Obligatori | Nota |
|---|---|---|
| Nom comercial | Sí | El que surt a la plataforma i als informes |
| Raó social | Sí | Per als informes formals |
| NIF | No | |
| Moneda base | Sí | `EUR` per defecte |
| Inici de l'exercici fiscal | Sí | Mes. Genera els períodes fiscals |
| Logo | No | SVG o PNG. Es pot pujar després |
| Àrees d'intervenció | Sí | Tecnologia, ciberseguretat, IA per defecte. N'hi pot haver d'altres |
| Mòduls actius | Sí | Finances per defecte. La resta s'activen quan toca |
| Inici de la relació d'assessoria | Sí | |
| Final previst de la relació | No | Condiciona la retenció (secció 15) |
| Consentiment d'IA externa | Sí | Sí o no. Sense consentiment, cap dada surt cap a un model extern |

Què passa en desar, dins d'una sola transacció:

1. Es crea el tenant amb `provision_tenant`, la funció acotada que ja existeix.
2. Es crea la pertinença de qui fa l'alta amb rol `OWNER`.
3. Es generen els períodes fiscals de l'exercici en curs i el següent.
4. Es copien els catàlegs dels mòduls actius.
5. Es crea el departament inicial de cada àrea d'intervenció.
6. Queda a `AuditLog` qui ho ha fet i amb quins mòduls.

Si qualsevol pas falla, no queda res a mitges.

---

## 4. El shell

| Peça | Què fa | Estat |
|---|---|---|
| Autenticació | Auth.js v5, enllaç màgic i contrasenya, JWT | Fet |
| Clients i pertinences | Tenant, Membership, canvi de client actiu, invitacions | Fet |
| Alta de client | Formulari de la secció 3 | Parcial, cal ampliar |
| Rols i funcions | Rol de plataforma i funció a l'organigrama (secció 12) | Fet a mitges |
| Navegació per mòduls | Barra lateral agrupada, mòduls actius per client | Fet a mitges |
| MFA | Segon factor TOTP obligatori, codis de recuperació | Per fer, primera tasca de seguretat |
| Sistema de disseny | Marca NovaEra Nexus, components d'informe, responsive de mòbil a escriptori | Per fer |
| Exportació a PDF | Una pàgina surt en PDF amb la mateixa aparença | Per fer |
| Registre d'auditoria | Canvis, lectures sensibles i accions d'agents | Fet per a canvis |
| Bus d'esdeveniments | Base de disparadors i agents (secció 13) | Per fer |

### 4.1 Mòduls actius per client

`TenantModule` diu quins mòduls té actius cada client i des de quan. La navegació es construeix a partir
d'això i dels permisos, i cada ruta ho torna a comprovar al servidor.

### 4.2 Sistema de disseny

Del manual d'identitat de NovaEra Nexus:

| Token | Color | Paper |
|---|---|---|
| `--beix` | `#F3ECE2` | Principal. Fons base |
| `--gris` | `#2A2A28` | Secundari. Text, capçaleres, fons fosc |
| `--verd` | `#78BFA4` | Accent |

El manual només defineix aquests tres. Els colors d'estat no són de marca, són funcionals, i surten de
l'encàrrec:

| Token | Color | Paper |
|---|---|---|
| `--ok` | `#2E7D5B` | Encapçalaments i estat correcte |
| `--avis` | `#B9770E` | Avisos |
| `--risc` | `#C0392B` | Riscos i no complert |

El tauler de projectes de setembre fa servir `#B4552F` i `#C08A2E`. Queden retirats: els informes nous
surten amb els tokens d'aquesta taula.

Tipografia Silka, amb Poppins de recanvi. Logo horitzontal de NovaEra Nexus a la capçalera esquerra (versió
`nh`, text beix, per a fons fosc; versió `ph`, text gris, per a fons clar), logo del client a la dreta.
Lema al peu: «Connectem estratègia, tecnologia i persones per un creixement sostenible».

Mode fosc des del primer dia, amb `prefers-color-scheme` i commutador manual.

**Silka i el repositori.** El brandbook porta el paquet de fonts web de Silka. Mentre el repositori sigui
públic, les fonts no hi van, perquè seria redistribuir una font de pagament a qualsevol que el cloni. Quan
passi a privat (secció 14.6) es poden afegir si la llicència cobreix l'ús web. Fins llavors, Poppins.

### 4.3 Components d'informe

Els informes de Cafès Cornellà tenen una estructura que es repeteix i que passa a ser part del sistema de
disseny:

- `ReportHeader`: capçalera fosca, logo de NovaEra Nexus a l'esquerra, logo del client a la dreta, data i
  classificació.
- `ObjectiveBlock`: títol, entradeta, i una xifra d'impacte grossa.
- `NumberedSection`: número de dos dígits, guió verd, títol en majúscules.
- `KpiRow`: targetes amb número gran, etiqueta i color d'estat.
- `AlertList`: senyals desplegables en tres nivells (crític, negatiu, positiu) amb el context a dins.
- `PersonCard`: fitxa desplegable amb barres de càrrega i taula de projectes amb etiquetes d'estat.
- `DataTable`: xifres alineades a la dreta, tabulars.
- `ReflectionBlock`: bloc fosc de reflexió.
- `DecisionList`: decisions numerades en cercles vermells.
- `ReportFooter`: lema.

### 4.4 Exportació a PDF

Dues vies. `@media print` sobre el mateix HTML per als documents interns, sense cost d'infraestructura.
Renderitzat al servidor amb Playwright per als informes que van a Direcció, que han de sortir iguals
siguin on siguin impresos. Es construeix la primera i després la segona.

---

## 5. Model de dades comú

### 5.1 Regles

Tota taula de client porta `tenant_id`, RLS forçada i `tenant_isolation`. Imports en cèntims enters,
proporcions en punts bàsics enters (10000 = 100 %), temps en minuts enters. Un pes de bonus del 7,5 % és
`750`.

### 5.2 Entitats comunes

| Entitat | Existeix | Canvis |
|---|---|---|
| `Tenant` | Sí | `legalName`, `commercialName`, `taxId`, `logoKey`, `engagementStart`, `engagementEnd`, `externalAiConsent` |
| `TenantModule` | No | Mòduls actius |
| `Department` | No | Departament o àrea d'intervenció, amb jerarquia |
| `FiscalPeriod` | No | Exercici, trimestres i mesos, oberts o tancats |
| `Employee` | Sí | `departmentId`, `weeklyHours`, `scheduleText`, `remoteDays`, `orgFunction` |
| `Stakeholder` | No | Persona interessada, interna o externa, amb funció i influència |
| `Position` | Sí | `jobDescriptionId` (DLT) |
| `Project` | Sí | Estats `CANDIDATE` i `OPERATING`, `departmentId`, `charterId`, `deadline` |
| `Vendor` | Sí | `commercialName`, `vendorType`, `supportLevel`, contactes |
| `Asset` | Sí | `assignedTo` passa a relació amb `Employee`, `renewalDate` |
| `AuditLog` | Sí | Lectures sensibles i accions d'agents |
| `DomainEvent` | No | Bus d'esdeveniments (secció 13) |

### 5.3 `Department`

Avui `Employee.team` i `Employee.costCenter` són text lliure. Passen a relació, perquè la capacitat, el
pressupost i l'objectiu col·lectiu del bonus necessiten un departament que sigui una fila.

```
Department
  id, tenantId, name, kind (TECH | CYBER | AI | OTHER), costCenter,
  managerId (Employee), parentId (Department)
```

`kind` recull les àrees d'intervenció de NovaEra Nexus. Un client pot tenir departaments d'altres àrees si
l'abast s'amplia.

### 5.4 `FiscalPeriod`

```
FiscalPeriod
  id, tenantId, year, kind (YEAR | QUARTER | MONTH), startDate, endDate,
  status (OPEN | CLOSED), closedAt, closedById
```

Un període tancat no es reescriu. Els canvis posteriors generen ajust datat al període obert. Val per a
tots els mòduls: una avaluació de bonus d'un any tancat no es retoca, es corregeix amb una esmena que
deixa rastre.

---

## 6. Mòdul 1 · Finances

Prioritat 1. Cap funcionalitat nova. Reubicació dins del shell.

`apps/web/src/app/{gastos,facturas,contratos,activos,proveedores}` passa a `apps/web/src/modules/finances/`.
`packages/finance-core` no es toca. La lògica de finances de `lib/` va al mòdul; la comuna (`db.ts`,
`permissions.ts`, `tenant-context.ts`, `formato.ts`, `http.ts`) va al shell.

Cap taula es reanomena, cap columna s'esborra, cap migració destructiva. La regla dura 10 (migracions
compatibles cap enrere) és el que permet reestructurar sense aturar producció.

---

## 7. Mòdul 2 · Portafoli de projectes amb valoració 360

Prioritat 2.

### 7.1 Tres grups, una entitat

Els grups A (candidats), B (en desenvolupament) i C (operatius o finalitzats) són una vista de
`Project.status`:

```
CANDIDATE    → A. Ha arribat, encara no s'ha acceptat
PLANNED      → A. Charter aprovat, encara no comença
ACTIVE       → B
ON_HOLD      → B, aturat
DELIVERED    → C, entregat
OPERATING    → C, en explotació amb cost recurrent
CANCELLED    → fora de tots
```

Un sol projecte recorre els tres grups. Així la valoració de quan era candidat es pot comparar amb
l'impacte real de quan opera.

### 7.2 Valoració de cinc eixos

Substituïda per la Valoració 360 del document `09` §5, que inclou aquests cinc eixos i n'afegeix cinc
més (impacte en les persones, risc i compliment, retorn econòmic, OPEX nou i maduresa de la solució). Un
projecte que ve d'una iniciativa aprovada hereta la nota i l'historial. El text que segueix queda com a
referència del raonament dels pesos.

Cada eix es puntua d'1 a 5. Els dos primers els puntua una persona. Els tres darrers es calculen a partir
de dades, amb trams **relatius al client** perquè 50.000 € no pesa igual en una empresa que en una altra.

| Eix | Què mesura | Com es puntua | Pes per defecte |
|---|---|---|---|
| Impacte estratègic | Alineament amb el pla director i els objectius de l'empresa | Persona, 1 a 5 amb descriptor per nivell | 25 % |
| Impacte de negoci | Ingressos, estalvi, risc evitat o obligació legal | Persona, 1 a 5 amb descriptor per nivell | 30 % |
| Inversió necessària | Cost total respecte al pressupost IT anual del client | Calculat, trams inversos | 20 % |
| Recursos IT interns | Hores previstes respecte a la capacitat anual del departament | Calculat, trams inversos | 15 % |
| Temps de desenvolupament | Mesos fins a entrega | Calculat, trams inversos | 10 % |

Trams per defecte dels eixos calculats (5 és el millor):

| Puntuació | Inversió (% pressupost IT anual) | Recursos IT (% capacitat anual) | Temps |
|---|---|---|---|
| 5 | menys del 2 % | menys del 2 % | menys de 3 mesos |
| 4 | 2 a 5 % | 2 a 5 % | 3 a 6 mesos |
| 3 | 5 a 10 % | 5 a 10 % | 6 a 12 mesos |
| 2 | 10 a 20 % | 10 a 20 % | 12 a 18 mesos |
| 1 | més del 20 % | més del 20 % | més de 18 mesos |

```
puntuació (0..100) = Σ pes_eix × (nota_eix − 1) / 4 × 100
```

Per què aquests pesos. L'impacte de negoci pesa més que l'estratègic perquè és el que Direcció pot
verificar després; l'estratègic és més fàcil de declarar que de demostrar. La inversió pesa més que els
recursos interns perquè els diners es poden aprovar o no, mentre que la capacitat interna és la restricció
que ja està sobrepassada a Cafès Cornellà i té el seu propi mòdul de seguiment. El temps pesa menys perquè
un projecte llarg d'alt impacte no s'ha de penalitzar per llarg.

Els pesos són editables per client i han de sumar 100 % (10000 punts bàsics). Si no sumen, el desat falla,
amb la mateixa regla que ja governa els pesos de les fites.

La puntuació ordena una llista. La matriu segueix: impacte (eixos 1 i 2) contra esforç (eixos 3, 4 i 5),
amb quatre quadrants (fer ara, planificar, revisar, descartar) i llindars per client. La puntuació diu
quin va primer; la matriu diu per què.

```
ProjectAssessment
  id, tenantId, projectId, assessedAt, assessedById,
  strategicScore (1..5), businessScore (1..5),
  investmentCents, itHours, durationMonths,
  investmentScore, itCapacityScore, durationScore,   ← calculats en desar
  totalScoreBp (0..10000), weightsSnapshot (Json), notes
```

Es guarda com a historial. Cada valoració porta data, autor i els pesos amb què es va calcular, perquè una
puntuació de fa sis mesos s'ha de poder llegir amb els pesos que hi havia llavors.

### 7.3 Project Charter

```
ProjectCharter
  id, tenantId, projectId, version, name, scope, objectives,
  ownerId (Employee), sponsorId (Stakeholder), budgetMinCents, budgetMaxCents,
  deadline, successCriteria, risks, dependencies, stakeholders (relació),
  status (DRAFT | SUBMITTED | APPROVED | REJECTED | CHANGES_REQUESTED),
  draftedBy (HUMAN | AGENT), sources (relació a SourceDocument)
CharterApproval
  id, tenantId, charterId, approverId, orgFunction, decision, comment, decidedAt
```

**Regla de transició.** Un projecte no passa de `CANDIDATE` a `PLANNED` o `ACTIVE` sense un charter
`APPROVED`. Es fa amb el patró de màquina d'estats que ja existeix a `invoice-workflow.ts`: transicions
declarades, rebuig al servidor, auditoria de cada pas.

**Qui aprova.** Ho decideix la política d'aprovació del client (secció 12.4). Per defecte: el patrocinador
o el project manager aprova; si el pressupost supera el llindar del client, cal a més la direcció
financera. Una persona no aprova un charter que ha redactat ella.

**Esborrany assistit.** El formulari no comença en blanc. Un agent (secció 13) recull el que hi ha sobre
el projecte (correus i documents de la carpeta d'entrada, actes de reunions, factures i contractes de
proveïdors relacionats, persones esmentades) i proposa un esborrany amb cada camp omplert i la font de cada
dada. La persona revisa, corregeix i envia. L'agent mai envia ni aprova: deixa un `DRAFT` amb
`draftedBy = AGENT` i les fonts enllaçades.

Quan s'aprova es crea `ProjectBaseline` v1 amb el pressupost i les dates del charter.

### 7.4 Projecció OPEX a tres anys

La cua de cost recurrent d'un projecte (els 14.559 €/any d'Azure del Data Lake) **és un contracte**
vinculat al projecte (`Contract.projectId`). La projecció es calcula amb `normalizeRecurring`, que ja
existeix i està provat:

```
projecció(any) = Σ contractes vigents normalitzats a l'any
               + Σ cues dels projectes que entren en explotació
               + Σ cues estimades dels candidats inclosos a l'escenari
```

Un escenari marca quins candidats s'hi inclouen. No escriu a les taules reals.

### 7.5 Històries d'usuari

- Com a assessor, registro un candidat amb quatre dades, l'agent em proposa el charter a partir dels
  documents que ja tenim, i el valoro.
- Com a responsable IT, veig la llista ordenada per puntuació i la matriu, i puc justificar per què un
  projecte no cap aquest any.
- Com a direcció financera, veig la projecció OPEX amb i sense els candidats.
- Com a assessor, el sistema m'impedeix passar un projecte a desenvolupament sense charter aprovat.

### 7.6 Pantalles

`/portafoli`, `/portafoli/matriu`, `/portafoli/opex`, `/portafoli/[id]`, `/portafoli/[id]/charter`.

### 7.7 Dependències

Llegeix de Finances (pressupost IT anual, contractes, factures, actius), de Talent (capacitat del
departament) i de Recopilació (fonts per a l'esborrany del charter). Escriu el que Bonus llegeix.

---

## 8. Mòdul 3 · Talent

Prioritat 3, amb Bonus.

### 8.1 Model de competències de NovaEra Nexus

Model propi de NovaEra Nexus amb deu competències transversals: resolució de problemes, treball en equip,
comunicació efectiva, gestió del temps, lideratge, intel·ligència emocional, delegació, negociació,
pensament crític i gestió de l'estrès. Les competències tècniques (servidors, xarxes, cloud, seguretat
operativa, dades) es defineixen per client i per rol.

Cada competència funciona en cicle:

```
avaluació inicial  →  itinerari formatiu  →  reavaluació  →  diferència mesurada
```

**Avaluació inicial.** Qüestionari d'escala Likert de cinc punts amb ancoratge conductual: les preguntes
descriuen situacions concretes, no opinions generals, i les respostes van de «mai» a «sempre». Tres ítems
per competència per defecte, editable. Cada ítem porta una marca explícita de sentit (`reverse`): en un
ítem formulat en negatiu, «mai» puntua alt; en un formulat en positiu, «sempre» puntua alt. Aquesta marca
és obligatòria i es valida en desar el qüestionari, perquè un ítem amb el sentit girat dona resultats
oposats al que mesura i és l'error més fàcil de cometre en aquest tipus d'instrument.

La puntuació de la competència és la mitjana dels seus ítems, normalitzada a una escala d'1 a 5. Les
respostes poden ser autoavaluació, avaluació del responsable, o totes dues, i es guarden per separat: la
diferència entre com es veu una persona i com la veu el responsable és informació, no soroll.

**Itinerari formatiu.** Per competència: xerrades, bibliografia, tècniques i un cas pràctic, cadascun amb
un qüestionari curt de comprensió. La plataforma guarda l'estructura i el progrés de la persona. El
contingut pot viure a la plataforma o fora (un enllaç), segons el client.

**Reavaluació.** Un test de la competència en acabar l'itinerari. La diferència entre l'avaluació inicial i
la reavaluació és la mesura de l'efecte de la formació, i és el que es pot ensenyar a Direcció com a retorn
de la inversió en formació.

```
Competency
  id, tenantId, code, name, kind (SOFT | TECHNICAL), description,
  sourceTemplate, sourceVersion, position
CompetencyLevel
  id, tenantId, competencyId, level (1..5), name, behaviouralDescriptor
AssessmentItem
  id, tenantId, competencyId, text, reverse (bool), position, active
Assessment
  id, tenantId, employeeId, kind (SELF | MANAGER | REASSESSMENT),
  periodId, startedAt, completedAt, assessorId
AssessmentAnswer
  id, tenantId, assessmentId, itemId, value (1..5)
LearningUnit
  id, tenantId, competencyId, kind (TALK | READING | TECHNIQUE | CASE | OTHER),
  title, url, position
LearningProgress
  id, tenantId, employeeId, learningUnitId, status, quizScoreBp, completedAt
EmployeeCompetency
  id, tenantId, employeeId, competencyId,
  currentLevel, targetLevel, lastAssessmentId, updatedAt
```

### 8.2 Fitxa de persona

```
Employee (amplia)
  departmentId, positionId, weeklyHours, scheduleText, remoteDays, orgFunction
JobDescription (DLT)
  id, tenantId, positionId, version, mission, responsibilities,
  requirements, reportsTo, status, approvedAt
CareerPlan
  id, tenantId, employeeId, title, status, startDate, reviewDate
CareerPhase
  id, tenantId, careerPlanId, position, name, objective,
  companyCommitment, employeeCommitment, status, targetDate
TrainingAction
  id, tenantId, employeeId, name, kind (TECHNICAL | SOFT), priority,
  hours, costCents, quarter, status, provider, competencyId
Evaluation
  id, tenantId, employeeId, periodId, evaluatedAt, evaluatorId,
  kind (QUARTERLY | ANNUAL | SELF), summary, employeeResponse
EvaluationScore
  id, tenantId, evaluationId, competencyId, score (1..5), note
```

`CareerPhase` porta els compromisos de les dues parts. Un pla de carrera on només s'hi compromet la
persona és una llista de deures.

`Evaluation.employeeResponse` és el dret de la persona a respondre a la seva avaluació. Hi és perquè ho
preveu el calendari del sistema de bonus («la persona veu la nota i pot corregir»).

### 8.3 Capacitat del departament

```
CapacityParams (per client, departament i any)
  productiveWeeks          setmanes productives l'any
  meetingHoursPerWeek      hores de reunió per persona i setmana
  interruptionBp           % del temps en interrupcions
  trainingHoursPerYear     hores de formació dins l'horari
  overloadThresholdBp      a partir de quin % es marca sobrecàrrega
  spofThresholdBp          a partir de quin % es marca punt únic de fallada
```

```
contractades setmanals = Σ Employee.weeklyHours actius
productives setmanals  = contractades − reunions − interrupcions
capacitat anual        = productives × setmanes productives − formació
demanda anual          = Σ hores previstes dels projectes actius i nous
                       + hores de compliment pendent
sobrecàrrega           = demanda − capacitat
```

Les hores previstes surten d'una entitat nova:

```
ProjectAssignment
  id, tenantId, projectId, employeeId, role,
  plannedHoursPerWeek | plannedHoursTotal, startDate, endDate
```

Prova d'acceptació: amb els paràmetres de Cafès Cornellà, el càlcul reprodueix les xifres de l'informe de
setembre (146,5 hores contractades, 115 productives, 5.060 de capacitat, 6.420 de demanda, 27 % de
sobrecàrrega). Els paràmetres van a les dades del client, no al codi.

### 8.4 Senyals derivats

Es calculen, no es guarden: punt únic de fallada (una persona concentra més del llindar d'hores d'un
projecte i no hi ha segon assignat), sobrecàrrega individual, persona amb projectes i sense pla, i
competència sense relleu (només una persona arriba al nivell objectiu).

### 8.5 Dades personals

És la part amb més risc de la plataforma.

- Les avaluacions i el pla de carrera d'una persona els veu la persona, el seu responsable, la direcció
  que la política del client indiqui, i l'equip de NovaEra Nexus assignat al client.
- Cada lectura d'una avaluació individual queda a `AuditLog`.
- Els agregats es calculen sobre tres persones o més. Per sota, `SUPPRESSED`.
- La retribució no viu aquí. Va a `CompensationRecord` xifrat (secció 9.2).
- Retenció: fins al final de la relació d'assessoria (secció 15).

### 8.6 Pantalles

`/talent`, `/talent/[id]`, `/talent/capacitat`, `/talent/competencies`, `/talent/avaluacio/[id]`,
`/talent/formacio`.

---

## 9. Mòdul 4 · Bonus per objectius

Prioritat 3.

### 9.1 Model de puntuació

El model per defecte és el de l'informe d'octubre, parametritzat:

```
BonusScheme
  id, tenantId, departmentId, periodId, name, status,
  targetPctBp,          ← % del salari brut que és el bonus objectiu
  teamFactorBp,         ← 2000 = el 20 % depèn de l'objectiu col·lectiu
  approvedBy, approvedAt
BonusBlock           Resultats 6000 · Comportaments 3000 · Aportació de valor 1000
BonusItem            nom, pes, com es mesura, qui avalua, tipus d'escala
BonusBand            <7000 → 0 · 7000-8999 → proporcional · 9000-11000 → 100 % · >11000 → extra 1000 a 2000
EligibilityGate      incident greu per negligència · imputació < 90 % · trimestre < 2/5 en actitud
TeamObjective        objectiu col·lectiu del departament
BonusAssignment      persona ↔ esquema
BonusScore           ítem, estat (NOT_MET | PARTIAL | MET), nota, trimestre, autor, data
```

Pesos de blocs que sumen 10000 i d'ítems que sumen el pes del seu bloc. Si no sumen, el desat falla.

### 9.2 L'import: salari brut, ponderat per mida i impacte

**Base.** El bonus objectiu és un percentatge del **salari brut anual base**, configurable per esquema i per
persona. Brut i no net: el net depèn de la situació fiscal de cada persona (IRPF, situació familiar), que
la plataforma no ha de conèixer ni deduir, i dues persones amb el mateix brut i el mateix rendiment han de
tenir el mateix bonus.

**Correlació amb càrrega, projectes i impacte.** L'ítem «projectes assolits a temps i amb èxit» (40 %) no
compta projectes, compta **pes de projectes**. Cada projecte assignat a una persona pesa:

```
pes del projecte = hores assignades a la persona × puntuació d'impacte del projecte (eixos 1 i 2)
assoliment       = Σ pes dels projectes assolits / Σ pes dels projectes assignats amb definició prèvia
```

Qui ha portat i ha entregat projectes grans i d'alt impacte puntua més que qui n'ha entregat de petits.
La càrrega entra per la mida del projecte, no per les hores fetes: pagar per hores imputades premia
allargar la feina i empitjora el problema de sobrecàrrega que el mateix diagnòstic denuncia.

Un projecte sense charter aprovat (scope, deadline i criteri d'èxit) no compta ni a favor ni en contra, com
diu l'informe. El gate del charter del mòdul 2 és el que ho fa aplicable.

**Confidencialitat.**

- El salari viu a `CompensationRecord`, xifrat per columna i amb auditoria per lectura (F4-02 del backlog).
- El quadre de puntuació (ítems, notes, percentatge, banda) el veuen la persona i el seu responsable.
- L'import en euros només el veuen la persona i la direcció amb permís de retribució. Es calcula al
  servidor en el moment de llegir-lo i cada lectura queda auditada. No es guarda en clar en cap taula.
- Els informes de bonus per a Direcció ensenyen percentatges i bandes. Els imports, només amb permís
  explícit i per persona.
- L'agent d'IA no té accés a `CompensationRecord`. Mai.

### 9.3 Càlcul

```
puntuació   = Σ pes_ítem × factor
              factor: NOT_MET 0 · PARTIAL 0,5 · MET 1 · escala 1-5: (nota − 1) / 4
si falla un gate bloquejant: bonus = 0, i es diu quin
banda       = la que conté la puntuació
bonus base  = salari brut × targetPct × % de la banda
bonus final = bonus base × (1 − teamFactor) + bonus base × teamFactor × assoliment de l'equip
```

### 9.4 Simulador i planificador

El simulador no té dades pròpies: llegeix l'esquema i els marcadors, recalcula en memòria, i desa només
quan es confirma, amb data i autor. Botons de tot assolit, tot parcial i reiniciar.

El planificador de terminis llegeix `Project.deadline` i `ProjectAssignment`. Moure un projecte de
trimestre no canvia la seva data fins que es confirma. Avís si una persona acumula més de dos lliuraments
al mateix trimestre (llindar per client).

### 9.5 Becaris

Mateix quadre amb `payoutKind = SYMBOLIC`. L'avaluació queda a la fitxa de talent com a base de la decisió
de contractació. El marc legal de l'incentiu el decideix el client; la plataforma el registra.

### 9.6 Motor

Capacitat i bonus van a un paquet nou `packages/people-core`, pur, sense base de dades i sense rellotge, amb
gate de cobertura. Separat de `finance-core`, que tracta de diners i ja té setze mòduls.

---

## 10. Mòdul 5 · Proveïdors i actius

Prioritat 4.

```
Vendor (amplia)
  commercialName, vendorType (IT | OT | IOT | PRODUCT), supportLevel (L1 | L2 | L3), slaText
VendorContact
  id, tenantId, vendorId, name, role, email, phone, isPrimary
Asset (amplia)
  assignedToId (Employee), renewalDate, licenseSeats, locationText
```

Contractes i venciments ja viuen a `Contract`. La pantalla nova és la fitxa de proveïdor amb despesa per
any, contractes, actius i venciments junts.

---

## 11. Mòdul 6 · Recopilació de dades i reunions

Prioritat 5.

### 11.1 Canals d'entrada

| Canal | Què hi entra | Com | Quan |
|---|---|---|---|
| Pujada directa | PDF, Excel, CSV | Pantalla de pujada | Ara (CSV i Excel ja fets) |
| Google Drive | Qualsevol fitxer de la carpeta d'entrada del client | API de Drive, carpeta per client | Primera fase |
| Plaud | Transcripció i resum de reunió | Flux actual cap a la carpeta d'entrada | Primera fase |
| Fathom | Transcripció, resum i accions | API o webhook de Fathom | Segona fase |
| Microsoft Teams | Transcripció de reunió | Microsoft Graph, amb consentiment de l'administrador del client | Segona fase |
| Jira | Projectes, tasques, estat | API de Jira, només lectura | Segona fase |
| Notion | Pàgines de documentació | API de Notion, només lectura | Opcional per client |

### 11.2 Google Drive com a porta d'entrada

Cada client té una carpeta d'entrada a Drive. La plataforma la llegeix, classifica cada fitxer pel seu
contingut (factura, exportació, acta, contracte), i el registra com a `SourceDocument`. Res s'importa
directament a les taules de negoci: tot passa per la bandeja de validació.

Accés a Drive amb un compte de servei per client, limitat a la seva carpeta. Mai un accés al Drive sencer
de NovaEra Nexus. Si una credencial es filtra, l'abast del dany és una carpeta d'un client.

Quan la plataforma passi a servidor privat, la carpeta d'entrada es pot substituir per un emmagatzematge
propi sense tocar la resta: la bandeja de validació no sap d'on ve el fitxer.

### 11.3 Reunions

La plataforma rep **text**, no àudio. Plaud, Fathom i Teams ja transcriuen. Rebre àudio voldria dir un
proveïdor de transcripció més, amb el seu contracte de tractament i el consentiment dels assistents.

```
Meeting
  id, tenantId, sourceDocumentId, source (PLAUD | FATHOM | TEAMS | UPLOAD),
  heldAt, title, attendees, summary, transcriptKey, projectId (opcional)
ActionItem
  id, tenantId, meetingId, text, ownerId, dueDate, status, projectId
```

Un agent proposa el resum, les accions i a quin projecte i persones pertany. Una persona ho valida.

### 11.4 Bandeja de validació

```
SourceDocument
  id, tenantId, channel, kind, fileKey, filename, bytes, sha256,
  receivedAt, status (RECEIVED | PROCESSING | PROPOSED | VALIDATED | REJECTED)
Extraction
  id, tenantId, sourceDocumentId, engine, payload (Json),
  fieldConfidence (Json), costCents, createdAt
```

Regla de F7-03 que s'estén a tot: res que vingui d'extracció automàtica arriba a estat definitiu sense
validació humana. Una factura extreta no es comptabilitza sola; un resum de reunió que ningú ha llegit no és
una acta.

El `sha256` evita que el mateix fitxer entri dues vegades per dos canals diferents.

---

## 12. Rols de plataforma i funcions a l'organigrama

### 12.1 Dues coses diferents

La pregunta 4 de la primera versió barrejava dues coses. Les separem:

- **Rol de plataforma**: què pot fer una persona dins de l'eina (llegir finances, aprovar un charter,
  veure avaluacions). Són pocs i estables.
- **Funció a l'organigrama**: qui és aquella persona a l'empresa del client (CEO, direcció financera,
  CIO, CISO...). N'hi ha moltes i canvien d'una empresa a l'altra.

Les aprovacions es dirigeixen per **funció**, no per rol. Així, «un charter de més de 50.000 € l'ha
d'aprovar la direcció financera» és una regla que funciona igual a una empresa amb CFO que a una on la
direcció financera la porta el director general.

### 12.2 Funcions

```
OrgFunction
  CEO · GENERAL_MANAGER · CFO · COO · CIO · CTO · CISO · CDO (dades)
  CPO (producte) · CCO (comercial) · CMO (màrqueting) · HR
  IT_MANAGER · PMO · PROJECT_MANAGER · OTHER
```

Una persona pot tenir més d'una funció (a una pime, el director general sovint és també el financer). La
llista és un catàleg per client: es poden afegir funcions.

```
Stakeholder
  id, tenantId, employeeId (si és intern) | externalName, organisation,
  orgFunctions, departmentId, influence (1..5), interest (1..5), email
```

`Stakeholder` també recull persones de fora (un proveïdor, un consultor) que intervenen en un projecte.

### 12.3 Rols de plataforma

| Rol | Per a qui | Codi actual |
|---|---|---|
| `OWNER` | Equip de NovaEra Nexus assignat al client | Ja existeix |
| `DIRECTION` | Qualsevol membre de direcció del client | Nou |
| `IT_MANAGER` | Responsable IT del client | Ja existeix |
| `FINANCE` | Equip financer del client | Ja existeix |
| `PROJECT_MANAGER` | Qui porta projectes | Ja existeix |
| `CONTRIBUTOR` | Equip que imputa hores i puja documents | Ja existeix |
| `VIEWER` | Lectura | Ja existeix |

`DIRECTION` és un rol nou, no un canvi de nom de `FINANCE`. Els valors existents no es toquen.

### 12.4 Polítiques d'aprovació per client

```
ApprovalPolicy
  id, tenantId, subject (CHARTER | BUDGET_LINE | BONUS_SCHEME | REPORT | VENDOR_CONTRACT),
  conditionKind (ALWAYS | AMOUNT_ABOVE | AREA_IS), conditionValue,
  requiredFunctions, mode (ANY | ALL), position
```

Exemples per defecte:

| Objecte | Condició | Funcions | Mode |
|---|---|---|---|
| Charter | Sempre | Patrocinador o PM | Qualsevol |
| Charter | Pressupost per sobre del llindar | CFO | Totes |
| Charter | Àrea de ciberseguretat | CISO | Totes |
| Esquema de bonus | Sempre | CEO o direcció general, i HR | Totes |
| Informe | Sempre | La funció destinatària | Qualsevol |

Una persona no aprova mai el que ha redactat ella mateixa.

### 12.5 Matriu de permisos

| Permís | OWNER | DIRECTION | IT_MANAGER | FINANCE | PM | CONTRIB. | VIEWER |
|---|---|---|---|---|---|---|---|
| `finance:read` | Sí | Sí | Sí | Sí | No | No | No |
| `invoices:create` | Sí | No | Sí | Sí | No | Sí | No |
| `portfolio:read` | Sí | Sí | Sí | Sí | Propis | Propis | Sí |
| `portfolio:write` | Sí | No | Sí | No | Propis | No | No |
| `portfolio:approve` | Segons política | Segons política | Segons política | Segons política | Segons política | No | No |
| `talent:read` | Sí | Sí | Sí | No | No | Propi | Agregats |
| `talent:write` | Sí | No | Sí | No | No | No | No |
| `talent:read_evaluations` | Sí | Segons política | Equip propi | No | No | Pròpia | No |
| `bonus:read` | Sí | Sí | Equip propi | No | No | Propi | No |
| `bonus:write` | Sí | No | Sí | No | No | No | No |
| `bonus:approve` | Segons política | Segons política | No | No | No | No | No |
| `compensation:read_individual` | No | Per persona | No | Per persona | No | Propi | No |
| `vendors:read` | Sí | Sí | Sí | Sí | No | No | Sí |
| `intake:upload` | Sí | No | Sí | Sí | Sí | Sí | No |
| `intake:validate` | Sí | No | Sí | Sí | No | No | No |
| `reports:generate` | Sí | No | Sí | No | No | No | No |
| `reports:read` | Sí | Sí | Sí | Sí | No | No | Publicats |
| `assistant:use` | Sí | Sí | Sí | Sí | Sí | Sí | No |
| `automation:manage` | Sí | No | No | No | No | No | No |

«Segons política» vol dir que el rol no dona el permís per si sol: el dona la funció que la política
d'aprovació del client exigeix per a aquell objecte. `compensation:read_individual` no el té ningú per
defecte, s'activa per persona i cada lectura queda auditada, com avui.

---

## 13. Capa d'IA: esdeveniments, disparadors, agents i assistent

### 13.1 Principi

La IA proposa; les persones decideixen. Cap agent fa una acció irreversible, envia res a fora del client o
aprova res. Cada acció d'un agent deixa rastre amb el mateix detall que una acció humana.

### 13.2 Bus d'esdeveniments

Cada canvi rellevant escriu un esdeveniment dins de la mateixa transacció que el provoca (patró
*outbox*):

```
DomainEvent
  id, tenantId, type, entity, entityId, payload (Json), occurredAt, actorKind, actorId,
  processedAt
```

Tipus inicials: `invoice.imported`, `document.received`, `meeting.ingested`, `charter.submitted`,
`charter.approved`, `project.status_changed`, `project.deadline_missed`, `assignment.overload`,
`contract.notice_window`, `period.closed`, `evaluation.completed`.

Com que l'esdeveniment s'escriu a la mateixa transacció, no hi ha esdeveniments de canvis que no han passat
ni canvis sense esdeveniment.

### 13.3 Disparadors

```
AutomationRule
  id, tenantId, eventType, condition (Json), action, agentId, enabled,
  requiresApproval (bool), createdById
```

Exemples per defecte, tots desactivats fins que el client els activa:

| Quan | Si | Fes |
|---|---|---|
| `document.received` | És una factura | Extreu i proposa a la bandeja |
| `meeting.ingested` | Sempre | Proposa resum, accions i projecte |
| `contract.notice_window` | Falten 30 dies per al preavís | Avisa el responsable |
| `project.deadline_missed` | Sempre | Avisa el PM i marca el projecte |
| `assignment.overload` | Persona per sobre del llindar | Avisa el responsable IT |
| `candidate.created` | Sempre | Proposa esborrany de charter |

### 13.4 Agents

Un agent és una identitat de servei dins d'un client, amb rol propi i eines limitades:

```
AgentPrincipal
  id, tenantId, name, purpose, allowedTools (llista), role, enabled,
  monthlyCostCapCents, createdById
AgentRun
  id, tenantId, agentId, triggerEventId, startedAt, finishedAt, status,
  inputTokens, outputTokens, costCents, error
AgentProposal
  id, tenantId, agentRunId, kind, targetEntity, payload (Json), sources (Json),
  status (PENDING | ACCEPTED | EDITED | REJECTED), decidedById, decidedAt
```

Agents inicials: extractor de factures, resumidor de reunions, redactor de charters, vigilant de
venciments, vigilant de capacitat.

### 13.5 Baranes

| Barana | Com s'aplica |
|---|---|
| Un client, un agent | L'agent s'executa dins de `withTenant`. RLS li impedeix veure cap altre client |
| Mínim privilegi | Llista tancada d'eines per agent. Cap agent té eines d'escriptura definitiva, només de proposta |
| Sense retribució | Cap agent té accés a `CompensationRecord` ni a cap eina que la llegeixi |
| Persona al circuit | Tot el que escriu un agent és un `AgentProposal` fins que una persona l'accepta |
| Contingut com a dada | El text de documents, correus i actes es passa al model marcat com a dada. Les instruccions que hi apareguin no s'executen (defensa contra injecció) |
| Minimització | Abans d'enviar res a un model extern es treuen dades que l'eina no necessita (DNI, comptes, salaris) |
| Consentiment | Sense `externalAiConsent` del client, cap dada surt cap a un model extern. L'intent queda auditat |
| Proveïdor amb contracte | Només proveïdors de model amb contracte de tractament i sense entrenament amb dades del client |
| Límit de cost | `monthlyCostCapCents` per agent. En arribar-hi, l'agent s'atura i avisa |
| Interruptor | Un `OWNER` pot desactivar tots els agents d'un client d'un sol clic |
| Traçabilitat | Cada `AgentRun` guarda entrada, sortida, eines cridades, cost i qui va acceptar el resultat |

### 13.6 Assistent

Xat dins de la plataforma, per client, amb dos usos:

- **Consultar**: «quina despesa en Azure portem aquest any», «quins projectes depenen només de l'Arnau».
  Respon amb eines de lectura que respecten els permisos de qui pregunta. Si la persona no pot veure una
  dada a la pantalla, l'assistent tampoc la hi pot dir.
- **Demanar**: «prepara'm el charter del projecte de videovigilància», «fes l'informe de despesa del
  trimestre». Genera una petició (`AgentProposal`) que segueix el circuit normal d'aprovació. No executa
  res que la persona no podria fer a mà.

Cada conversa queda guardada al client, amb retenció igual que la resta de dades del client.

### 13.7 Motor

Els esdeveniments i les regles es processen amb un treball periòdic que llegeix `DomainEvent` sense
processar. A Vercel, una tasca programada cada minut. Al servidor privat, un procés dedicat. El codi dels
agents és el mateix en els dos casos.

---

## 14. SecDevOps

### 14.1 Al desenvolupament

Ja actiu: gate de RLS a cada migració, CodeQL, cobertura del motor al 95 %, revisió de format i tipus,
proves d'aïllament entre clients sobre totes les taules.

S'afegeix: escaneig de secrets a cada PR, auditoria de dependències amb llindar (cap vulnerabilitat alta),
GitHub Actions fixades per SHA (pendent des de l'auditoria), model d'amenaces breu per cada mòdul nou abans
d'escriure'n el codi, i proves de les baranes dels agents (un agent no pot llegir un altre client, no pot
llegir retribució, no pot escriure fora de proposta).

### 14.2 A l'operació

Ja actiu: migracions fora del build, regió de Frankfurt, capçaleres de seguretat.

Pendent i necessari abans de dades reals (secció 16): protecció de desplegaments de Vercel (troballa 11 de
l'auditoria), pla de pagament de Supabase (el gratuït es posa en pausa i no té contracte de tractament),
registre d'activitats de tractament (punt 10 de l'auditoria), xifrat de retribució (F4-02) i registre
d'auditoria només d'afegir (punt 7).

### 14.3 Privacitat per disseny

Minimització (cada mòdul guarda el que necessita per al seu càlcul i res més), separació de la retribució,
supressió d'agregats per sota de tres persones, auditoria de lectures sensibles, retenció lligada a la
relació d'assessoria, i cap dada de client al repositori de codi, ni quan sigui privat.

### 14.5 MFA

Segon factor obligatori per a tots els usuaris, sense excepció per rol. Codi TOTP (RFC 6238) amb
qualsevol aplicació d'autenticació, més deu codis de recuperació d'un sol ús guardats amb hash. El secret
TOTP es guarda xifrat amb AES-256-GCM; la clau es deriva amb HKDF de `AUTH_SECRET` o, si existeix, de
`MFA_KEY`. La sessió JWT porta la marca de segon factor superat i el middleware no deixa passar de
`/login/mfa` sense ella. Les accions sensibles (retribució, exportacions, canvi de rols, publicar un
diagnòstic) demanen el codi un altre cop si han passat més de 15 minuts.

Fora de l'aplicació, l'MFA també s'activa als comptes que la sostenen: GitHub, Vercel, Supabase, Google
i Resend. Això ho fa el titular de cada compte.

### 14.6 Repositori privat

El repositori passa a privat. Amb el pla gratuït de GitHub, un repositori privat perd les branques
protegides i l'escaneig de codi amb CodeQL. Per no perdre res:

1. Abans del canvi, el CI substitueix CodeQL per una anàlisi estàtica que funciona igual en privat
   (Semgrep CE) i afegeix escaneig de secrets amb gitleaks a cada PR.
2. Es contracta GitHub Pro al compte personal per recuperar les branques protegides de `main`.
3. Es canvia la visibilitat.

Amb el repositori privat, la regla de no pujar fonts amb llicència es relaxa per a Silka: es pot servir
des del repositori si la llicència permet ús web.

### 14.7 Servidor privat

Quan la plataforma passi a servidor propi, el que canvia és on corre: base de dades, emmagatzematge de
fitxers, treball periòdic dels agents i, si es vol, un model d'IA allotjat dins del mateix perímetre. El
codi, el model de dades i les regles no canvien. Per això cap mòdul pot dependre d'una funció exclusiva de
Vercel o de Supabase que no tingui equivalent obert.

---

## 15. Retenció

La relació d'assessoria amb el client té data de final (`Tenant.engagementEnd`). En arribar-hi:

1. Avís a l'`OWNER` 30 dies abans.
2. Exportació completa del client disponible per lliurar-li.
3. 30 dies de gràcia després del final (decisió ja presa a `docs/03`).
4. Esborrat de totes les dades del client, incloses avaluacions, plans de carrera, converses de l'assistent
   i fitxers.
5. Es conserven només les dades que la llei obliga a guardar més temps (factures, sis anys) i, si el client
   ho vol, en mans seves, no de la plataforma.

Mentre la relació és viva, les dades de talent d'una persona que ja no treballa al client es mantenen, però
deixen de sortir a les pantalles i als càlculs del període en curs.

---

## 16. Client pilot: Cafès Cornellà

### 16.1 Què es carrega

Amb el teu vistiplau explícit (resposta 15):

| Font | Mòdul | Què en surt |
|---|---|---|
| `260915_Costos_IT_2024_2026.xlsx` | Finances | 326.545 € de despesa corrent, cinc llibres, proveïdors, Azure per recurs, immobilitzat (432.006 €), llicències M365 |
| `Pressupost_IT_2027.xlsx` | Finances i Portafoli | Pressupost 2027, supòsits, cartera CAPEX amb 13 projectes |
| `260919_Dashboard_Estat_Projectes` | Portafoli | 40 projectes, 654 tasques, quatre àrees |
| `260920_Informe_Estat_Departament` | Talent | 5 persones, horaris, capacitat, 11 projectes nous 2027 |
| `261003_Sistema_Objectius_Bonus` | Bonus | Model, bandes, gates, objectiu col·lectiu |
| `260526_Informe_Talent` | Talent | Rols, plans formatius, pla de carrera |

### 16.2 Com entra

Les dades reals entren **per la mateixa porta que entraran les de qualsevol client**: la pujada d'Excel i la
bandeja de validació. No es carreguen amb un fitxer de llavors al repositori, per dues raons. Un fitxer amb
salaris i avaluacions de persones identificades no pot anar mai a un repositori de codi, sigui públic o
privat. I si el pilot
entra per una porta especial, no prova la porta que faran servir els clients següents.

El pilot, doncs, és també la prova del canal d'entrada.

### 16.3 Condicions prèvies

La teva pròpia regla (anotada des de l'inici del projecte) és que no hi entren dades reals fins que
l'auditoria de privacitat i seguretat surti bé. Per a Cafès Cornellà això vol dir, en aquest ordre:

1. Protecció de desplegaments de Vercel activada (troballa 11). Sense això, desplegaments antics continuen
   servint codi vell contra la base de producció.
2. Supabase en pla de pagament, amb contracte de tractament signat.
3. Registre d'activitats de tractament amb Cafès Cornellà com a responsable i NovaEra Nexus com a encarregat.
4. F4-02 fet: salaris xifrats per columna i auditats per lectura. Abans d'això, els salaris de la fulla
   `08_Salaris` no es carreguen.
5. Repositori sense cap dada de client (es comprova a CI amb una regla que busca noms i NIF coneguts).

Les dades financeres sense persones (factures, proveïdors, contractes, Azure, immobilitzat) poden entrar en
complir 1, 2 i 3. Les de persones (plantilla, avaluacions, bonus) esperen també el 4.

---

## 17. Regles de càlcul

| Regla | Mòdul | On viu |
|---|---|---|
| Recurrents, amortització, EVM, utilització | Finances, Portafoli | `finance-core` (fet) |
| Avanç per fites, prorrateig per dies | Portafoli, Talent | `apps/web/src/lib` (fet) |
| Valoració de cinc eixos i trams | Portafoli | `portfolio-core/assessment` (nou) |
| Projecció OPEX | Portafoli | `portfolio-core/opex` (nou) |
| Capacitat, sobrecàrrega, punt únic de fallada | Talent | `people-core/capacity` (nou) |
| Puntuació de competències amb ítems invertits | Talent | `people-core/competency` (nou) |
| Bonus: puntuació, gates, bandes, factor d'equip, pes de projecte | Bonus | `people-core/bonus` (nou) |
| Avaluació de polítiques d'aprovació | Shell | `packages/db/src/approval-policy.ts` (nou) |

Tot càlcul va a un paquet pur, sense base de dades i amb la data com a paràmetre.

---

## 18. Dependències entre mòduls

```
Shell (clients, rols, funcions, aprovacions, disseny, PDF, auditoria, esdeveniments, MFA)
 ├─ Diagnòstic     ← Finances, Recopilació; → escriu iniciatives a Portafoli
 ├─ Finances
 ├─ Portafoli      ← Finances, Talent, Recopilació
 ├─ Talent
 ├─ Bonus          ← Portafoli, Talent, retribució xifrada
 ├─ Proveïdors     ← Finances
 ├─ Recopilació    → escriu propostes a Finances, Portafoli, Talent
 ├─ Informes       ← tots
 └─ Capa d'IA      ← esdeveniments de tots; escriu només propostes
```

Cap mòdul importa d'un altre directament. Cada mòdul exposa les seves consultes de lectura a
`modules/<mòdul>/api.ts` i els altres hi passen per allà.

---

## 19. Decisions que queden obertes

Poques, i cap bloqueja el pas 2:

0. **Jira de NovaEra Nexus.** L'únic Jira connectat és el d'un client. El backlog de la plataforma no
   hi pot anar; cal un espai propi de NovaEra Nexus.
1. **Notion o Drive per a documentació.** Ho deixo explicat al missatge: la proposta és Drive com a
   entrada i Notion opcional per client.
2. **Llindar de pressupost per a l'aprovació de la direcció financera.** Proposo un 10 % del pressupost IT
   anual del client, configurable.
3. **Proveïdor de model d'IA.** Cal triar-ne un amb contracte de tractament a la UE i sense entrenament amb
   dades. Es decideix a l'inici del bloc de la capa d'IA, no ara.
