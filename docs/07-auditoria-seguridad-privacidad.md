# 07 · Auditoría de seguridad y privacidad por diseño

Revisión del código tal y como está en `main` el 12 de septiembre de 2026, commit
`8ce0d91`. El encargo: decir qué impide meter datos reales de clientes y qué no.

Se ha leído el código, no la documentación. Donde un comentario promete algo, se
ha comprobado si el código lo cumple; en tres sitios no lo cumple, y están
señalados. Lo que se ha medido, se dice que se ha medido y con qué resultado.

## Veredicto

**Hoy no se pueden meter datos reales de clientes.** No por la arquitectura, que
es mejor de lo normal a esta altura, sino por diez cosas concretas que se listan
abajo y que van desde dos formas de tumbar el servidor con un fichero de 60 KB
hasta la ausencia total de la capa de ciclo de vida del dato personal.

La separación importa, porque cambia qué hay que hacer. El aislamiento entre
clientes, el control de acceso y el tratamiento de credenciales están bien
construidos y bien razonados: no hay que rehacerlos. Lo que falta es casi todo lo
que rodea a eso, y falta entero, no a medias.

Dos de los tres agujeros más graves los introduje yo hoy, en la importación de
ficheros. Están los primeros de la lista.

### Qué queda cerrado con la PR que trae este informe

Los puntos 1, 2 y 5, más las longitudes que la importación no validaba. Es el
primer paso del orden que hay al final del documento: lo que se arregla con una
PR pequeña y quita un riesgo grande. Cada punto lleva anotado su estado.

El veredicto no cambia: siguen bloqueando los otros siete, y el que más pesa es
la cadena de la invitación.

---

## Lo que bloquea meter datos reales

### 1 · Un fichero de 60 KB deja el servidor colgado durante días

**Estado: cerrado en esta misma PR.** El lector de XML ya no usa expresiones
regulares perezosas: recorre la cadena una vez con `indexOf`, así que el coste
es lineal pase lo que pase con las etiquetas. Hay un test que sube 800 KB de
`<si>` sin cerrar y comprueba que termina.

`apps/web/src/lib/xlsx.ts:75,77,108,229,233`

Los regex que leen el XML de un `.xlsx` son cuadráticos cuando la etiqueta no se
cierra. Con N aperturas `<si>` y ningún cierre, `matchAll` reintenta desde cada
posición y recorre el resto de la cadena cada vez.

Medido en este entorno, con el regex exacto de la línea 75:

| Entrada | Tiempo |
| ------- | ------ |
| 20 KB   | 31 ms |
| 40 KB   | 123 ms |
| 80 KB   | 490 ms |
| 160 KB  | 1.979 ms |

Duplicar el tamaño cuadruplica el tiempo. Extrapolando, 1 MB son unos 80
segundos y 60 MB son días.

El ataque: un ZIP con una sola entrada `xl/sharedStrings.xml` cuyo contenido es
`<si>` repetido hasta 60 MB. Comprimido ocupa 57 KB, medido también aquí (ratio
1028:1). Pasa el tope de tamaño, pasa el tope de descompresión, y entra en
`textosCompartidos`, que se ejecuta antes incluso de comprobar que el libro
tenga una hoja. A partir de ahí el bucle de eventos de Node se queda girando. No
hay timeout, ni worker, ni `AbortSignal`. Quien pueda dar de alta una factura
puede hacerlo, y en un despliegue serverless bastan unas pocas peticiones.

### 2 · El tope de descompresión se comprueba contra un número que escribe el atacante

**Estado: cerrado en esta misma PR.** El tope ya no se comprueba contra lo que
declara el fichero, sino contando los bytes según salen del descompresor, y es
un presupuesto único de 32 MB para todo el ZIP en vez de uno por entrada. Dos
tests lo ejercitan, uno con el tamaño declarado a cero.

`apps/web/src/lib/zip.ts:57-80`

La comprobación previa usa `tamano`, que es el campo «tamaño sin comprimir» del
directorio central del ZIP, es decir, un valor que pone quien fabrica el fichero
y que no se contrasta contra nada. Poniéndolo a cero, la comprobación siempre
pasa. Después, la línea 74 descomprime el flujo entero a memoria con
`new Response(...).arrayBuffer()`, que no tiene tope, y sólo entonces, en la
línea 76, se mira el tamaño real. Para cuando se mira, la memoria ya está
reservada.

Con el ratio medido, un fichero de 1 MB expande a 1 GB. En una función con 1 GB
de memoria eso es un fallo inmediato. Además se descomprimen todas las entradas
aunque un `.xlsx` no las necesite, y el tope es por entrada y no acumulado: con
512 entradas permitidas, el presupuesto teórico es de 32 GB por petición.

Los dos topes que existen (`MAXIMO_ENTRADAS`, `MAXIMO_DESCOMPRIMIDO`) no tienen
ni un solo test. Son límites escritos y nunca ejercitados.

### 3 · Un enlace de invitación filtrado da acceso a la organización

`apps/web/src/lib/rutas-publicas.ts:21`, `apps/web/src/app/api/auth/register/route.ts:8`,
`apps/web/src/lib/auth/register.ts:39`, `apps/web/src/lib/auth/index.ts:44-57`,
`apps/web/src/lib/invitations.ts:102`

La cadena, verificada paso a paso:

1. `/api/auth/register` es público, porque `/api/auth` está en la lista de rutas
   públicas y la comparación es por prefijo de segmento.
2. Crea el usuario sin verificar que quien registra controle esa dirección.
   `emailVerified` queda a nulo.
3. El proveedor de credenciales no mira `emailVerified` en ningún momento.
4. `acceptInvitation` autoriza comparando el correo de la sesión con el de la
   invitación.

Resultado: quien tenga el enlace de invitación dirigido a una dirección que
todavía no tiene cuenta, se registra con esa dirección y su propia contraseña,
entra, y acepta la invitación. Queda dentro del tenant con el rol que fijó quien
invitó, que puede ser propietario.

Y el enlace se filtra con facilidad, porque el token viaja en la ruta de la URL
(`apps/web/src/app/api/invitations/route.ts:17`), acaba en los logs de acceso del
proveedor, en el historial del navegador y en la cabecera `Referer`; se vuelve a
emitir en el query string cuando la aceptación falla
(`apps/web/src/app/invitaciones/[tenantId]/[token]/page.tsx:23`); dura siete
días; no hay forma de revocarlo; y hoy se le entrega al propietario para que lo
reparta él por el canal que quiera.

### 4 · El login no tiene límite de intentos y los fallos no se registran

`apps/web/src/lib/auth/index.ts:44-57`, y la ausencia de cualquier limitador en
todo el repositorio.

No hay throttling en ningún punto. Tres consecuencias distintas del mismo hueco:

Fuerza bruta sobre contraseñas, sin bloqueo de cuenta ni de origen. El único
freno es el coste de scrypt.

Agotamiento de memoria: cada intento reserva unos 32 MB por los parámetros de
scrypt (`password.ts:22`). Unas decenas de peticiones concurrentes con
contraseñas cualesquiera tumban el proceso sin necesidad de acertar ninguna.
`/api/auth/register` es peor, porque calcula el hash antes de mirar si el usuario
existe (`register.ts:28`).

Bombardeo de correo: el formulario de enlace mágico dispara un envío por
petición contra cualquier dirección. Es un relay para spamear a terceros con el
remitente del producto.

Y encima es invisible: `authorize` devuelve nulo en silencio en los cuatro
caminos de fallo. Sin IP, sin contador, sin evento. Un ataque de credenciales
contra esta aplicación es a la vez ilimitado e indetectable.

### 5 · No hay ninguna cabecera de seguridad

**Estado: cerrado en esta misma PR, con una excepción anotada.** Las cabeceras
están en `apps/web/src/lib/cabeceras.ts`, con test, y se aplican a todas las
rutas desde `next.config.ts`. La excepción es `script-src 'unsafe-inline'`:
quitarlo obliga a firmar con `nonce` los scripts que Next inyecta para hidratar,
y eso hay que probarlo contra el despliegue de verdad porque un fallo deja la
aplicación en blanco sin ningún error en el servidor. Va aparte.

`apps/web/next.config.ts:3-10`, `vercel.json:1-7`, `apps/web/src/middleware.ts:18-28`

Comprobados los tres únicos sitios donde podrían estar. Faltan todas: no hay
Content-Security-Policy, ni Strict-Transport-Security, ni X-Frame-Options ni
`frame-ancestors`, ni X-Content-Type-Options, ni Referrer-Policy, ni
Permissions-Policy.

Sin `frame-ancestors` la aplicación se puede meter en un iframe, y la cookie de
sesión es `SameSite=Lax`, que sí viaja en una navegación por GET dentro de un
marco. Sin Referrer-Policy, el token de invitación del punto 3 se filtra por
`Referer` a cualquier recurso externo que cargue esa página.

Es la tarea F8-05, que está en el backlog sin hacer y la propia guía de
despliegue lo reconoce.

### 6 · La capa de ciclo de vida del dato personal no existe

No hay política de retención. Ningún modelo del esquema declara periodo ni ruta
de borrado, lo que incumple la regla dura 15 de `AGENTS.md` en el cien por cien
de las tablas.

No hay forma de borrar un tenant. Las cascadas del esquema están bien puestas,
así que un borrado funcionaría, pero no existe ningún endpoint, ni acción, ni
función que lo haga: hoy dar de baja a un cliente es entrar a mano en el editor
SQL con el rol de migraciones.

No hay exportación de datos de un interesado. No hay anonimización. No hay
`deletedAt` en ninguna tabla pese a que la documentación lo declara como
convención.

No se purgan los tokens de verificación caducados ni las invitaciones no
aceptadas, y ambas tablas guardan direcciones de correo. Acumulan
indefinidamente.

En términos prácticos: si entra un cliente real y pide sus datos o su baja, hoy
no hay con qué atenderle.

### 7 · El registro de auditoría se puede borrar, y el esquema afirma que no

`packages/db/prisma/schema.prisma:226` frente a `packages/db/src/roles.ts:172,187`

El comentario del esquema dice «append-only para el rol de aplicación en F0-07».
F0-07 no está hecha, y el script de roles concede `SELECT, INSERT, UPDATE,
DELETE` sobre todas las tablas sin ninguna excepción para `audit_log`, tanto en
el grant explícito como en los privilegios por defecto.

Quien pueda ejecutar código en la aplicación puede reescribir o borrar el rastro
de su propio tenant. Un registro de auditoría alterable no sirve como prueba, y
es el único control que respalda el acceso a datos de retribución.

Es el hallazgo que más me preocupa de los que no son míos, porque el comentario
afirma una garantía que no existe, y alguien va a confiar en ella.

### 8 · La credencial que salta el aislamiento vive en el entorno de ejecución

`vercel.json:5` y `docs/06-despliegue.md:144`

El comando de build ejecuta las migraciones, lo que obliga a declarar
`MIGRATION_DATABASE_URL` en el proyecto de Vercel. Las variables de Vercel están
disponibles también en tiempo de ejecución, no sólo durante el build. Es decir:
el proceso que sirve las peticiones tiene en su entorno la cadena de conexión del
rol con `BYPASSRLS`, que salta todas las políticas RLS.

Toda la arquitectura de aislamiento del producto se apoya en que ese rol no sea
alcanzable desde la aplicación, y ahí lo es. Una dependencia maliciosa que lea
`process.env` obtiene acceso a los datos de todos los clientes.

Añadido: los despliegues de vista previa usan las mismas variables, así que cada
rama lee y escribe contra la base de producción.

### 9 · El cómputo probablemente sale de la Unión Europea, y nadie lo ha comprobado

`vercel.json:1-7`, `docs/06-despliegue.md:122-160`

La base de datos está en Fráncfort por decisión consciente y escrita. El cómputo
no tiene región declarada en ninguna parte: `vercel.json` no fija `regions`, y
las funciones de Vercel salen por defecto en Washington salvo que se diga otra
cosa.

Los datos reposan en la UE; se procesan probablemente fuera. Eso no es
necesariamente ilegal, pero es una transferencia internacional que nadie ha
documentado ni evaluado, y contradice la única frase que hay escrita sobre el
asunto.

### 10 · No hay registro de encargados, ni contratos, ni aviso de privacidad

Tres proveedores tratan datos personales: Supabase (todo), Vercel (todo lo que
pasa por una petición, incluidos los tokens de invitación en los logs de acceso)
y Resend (la dirección de correo y el enlace de acceso). Resend aparece
únicamente como ejemplo de cadena SMTP en la guía de despliegue. No hay ningún
documento que los recoja como encargados.

Tampoco hay aviso de privacidad en la aplicación. El registro pide correo, nombre
y contraseña sin una sola palabra sobre qué se hace con ellos. Y la invitación
recoge el correo de una persona que todavía no es usuaria, no ha interactuado con
el sistema y a la que nadie informa de nada.

Lo que sí está limpio: sólo hay dos cookies, las dos estrictamente necesarias, y
cero analítica. No hace falta banner de cookies porque no hay nada que
consentir. Eso está bien resuelto.

---

## Importante, antes de dar acceso a terceros

Estas no bloquean una prueba con datos propios, pero sí bloquean vender el
producto.

**El control de segregación de funciones existe, está probado y no se puede
activar.** `apps/web/src/lib/invoice-transition.ts:66-76` no pasa
`requireSegregationOfDuties` a `requestTransition`, y no hay ninguna variable ni
ajuste de tenant que lo encienda. La misma persona puede dar de alta una factura
y aprobarla. El comentario del motor dice que se activa por tenant; hoy esa frase
es falsa. Y todo el andamiaje para encenderlo (`createdById`, su índice,
`Tenant.settings`) ya está construido y sin usar.

**Un CONTRIBUTOR lee todas las facturas del tenant y sus agregados.** Todos los
caminos de lectura usan `requireAnyPermission(['invoices:read',
'invoices:create'])`, lo que convierte `invoices:read` en un permiso decorativo:
no restringe nada que `invoices:create` no abra ya. El PRD dice que un
CONTRIBUTOR no ve ningún agregado económico, y ve el total del departamento.

**Un VIEWER llega a número de factura, descripción de línea e importe** a través
de `/gastos`, en la tabla de compras pendientes de capitalizar
(`apps/web/src/app/gastos/page.tsx:252-294`). El PRD le niega el detalle de
factura. Esto es mío, de esta mañana: la pantalla se protegió con
`dashboards:showback` sin mirar qué implica ese permiso en la matriz.

**El test de permisos replica el error en vez de detectarlo.**
`permissions.test.ts:91` codifica la misma concesión que contradice al PRD,
porque el test es una copia de la implementación y no una traducción
independiente del documento. Un test de matriz que se escribe mirando el código
no protege de nada.

**La importación no valida con Zod.** `importacion-alta.ts:108-129` construye el
objeto de alta a mano y se salta los esquemas que sí aplica la API: sin límite de
500 caracteres en la descripción, sin 100 en el número de factura, sin 200 en el
nombre del proveedor, sin máximo de líneas. Y las columnas son `text` sin
longitud. Un CSV con una celda de 3 MB inserta un proveedor con un nombre de 3
MB. Contradice la regla dura 7 del propio `AGENTS.md`. También es mío.

**El servidor se puede enumerar.** El registro devuelve 409 cuando el correo
existe y 201 cuando lo crea, lo que confirma qué direcciones están dadas de alta
(`register.ts:31-37`). Y el login tarda unos 100 ms si hay contraseña y unos
pocos si no (`auth/index.ts:50-51`), lo que filtra el mismo dato por otra vía que
no se arregla cambiando un código de estado. Las dos cosas alimentan directamente
el punto 3.

**`withTenant` entrega un cliente que también alcanza las tablas sin RLS.**
`tenant-context.ts:16` devuelve el cliente de transacción completo, que incluye
`tx.user`. Esa tabla no tiene RLS a propósito, y el rol de aplicación tiene
`SELECT` sobre ella. Un `tx.user.findMany()` dentro de `withTenant` devuelve el
correo, el nombre y el hash de contraseña de todos los usuarios de todos los
clientes. Hoy no se explota, porque ninguna consulta hace `include` hacia `user`,
pero la regla que el proyecto vende no cubre esas dos tablas y nada lo señala.

**El gate de RLS de CI es más débil de lo que parece.**
`packages/db/src/rls-check.ts:27,28,30`: no comprueba `FORCE`, sólo `ENABLE`; no
mira el predicado de la política, sólo que exista una con ese nombre, así que una
tabla nueva con `USING (true)` pasa el gate; y la exención es un comentario de
texto libre que cualquiera puede escribir. Los tests de aislamiento tampoco lo
tapan, porque llevan la lista de tablas escrita a mano.

**No hay ningún control de seguridad en CI.** Ni Dependabot, ni CodeQL, ni
escaneo de secretos, ni `pnpm audit`. Es la tarea F0-09, de fase cero, pendiente
mientras el producto ya está desplegado. Y las acciones están fijadas por etiqueta
móvil (`@v4`), no por SHA, lo que ya ha sido vector de ataque real en otros
proyectos.

**No hay observabilidad.** Todo el registro del sistema son cinco `console` con
una cadena de texto. Sin nivel, sin JSON, sin identificador de petición, sin
traza. Ante un error 500 en producción no hay stack, ni ruta, ni tenant. No se
sabría que hay un incidente ni se podría investigar después.

**Las copias de seguridad son una línea en la sección de pendientes.** No hay
objetivo de punto de recuperación, ni de tiempo, ni procedimiento, ni prueba de
restauración, ni retención declarada. Y el plan gratuito de Supabase pausa el
proyecto a los siete días sin tráfico.

**La capa de autenticación es una beta.** `next-auth 5.0.0-beta.32`, la única
versión pre-release del repositorio, sosteniendo la autenticación de un producto
multi-cliente con datos retributivos previstos.

**Los scripts de instalación de dependencias no están restringidos.** pnpm 9
ejecuta los `postinstall` por defecto y no hay `ignore-scripts`. Combinado con el
punto 8, un paquete comprometido se ejecuta en un entorno que tiene la credencial
que salta el aislamiento.

---

## Mejoras

`audit_log.ip` está declarada y nunca se escribe: o se usa con base legal
declarada, o se quita, porque una columna de dato personal vacía invita a
rellenarla sin pensarlo.

`vendor.tax_id` y `legal_name` son datos personales cuando el proveedor es un
autónomo, y nada en el código lo reconoce.

`invoice.extraction` es un JSON sin esquema donde el día de mañana el OCR
volcará el contenido de un PDF sin filtro.

El `AUTH_SECRET` de ejemplo del repositorio tiene 51 caracteres y por tanto pasa
la validación de longitud mínima. Un despliegue que arrastre ese fichero arranca
sin quejarse, con un secreto de firma que conoce cualquiera.

La validación de variables de entorno es perezosa, no al arranque, pese a lo que
dice su propio comentario, y sólo cubre cuatro de las quince variables. El fallo
de configuración más grave posible, poner la cadena privilegiada como
`DATABASE_URL`, no lo detecta nada.

Las cadenas de conexión documentadas no exigen `sslmode=require`.

El `docker-compose` publica Postgres, Redis y MinIO en todas las interfaces, no
sólo en localhost, y Redis va sin contraseña. En una red de coworking o de
cliente eso es alcanzable desde la LAN.

No hay `error.tsx`, así que una denegación de permiso en una página sale como
error genérico de servidor, indistinguible de una caída.

`escribirCsv` no neutraliza los valores que empiezan por `=`, `+`, `-` o `@`. Hoy
no es explotable porque la única exportación es la plantilla, cuyo contenido es
constante; el día que se exporte el listado de facturas, un proveedor llamado
`=cmd|...` se ejecuta en el Excel de quien lo abra. Cuesta una línea arreglarlo
ahora y es un incidente arreglarlo después.

`GET /api/invoices/[id]` devuelve `createdById`, que ninguna pantalla usa.

---

## Lo que está bien

Hay que decirlo, y no es cortesía: es lo que explica que la lista de arriba sea
larga pero no profunda. Lo de abajo está verificado leyendo el código.

**El aislamiento entre clientes es real y está bien construido.** Las ocho tablas
con datos de cliente tienen RLS con `FORCE` y política simétrica, comprobadas una
a una en las migraciones. Ninguna política es permisiva de más: no hay ni un
`USING (true)`, ninguna carece de `WITH CHECK`. El rol de aplicación no tiene
`BYPASSRLS` y eso se verifica leyendo `pg_roles`, no declarándolo. `withTenant`
valida el UUID antes de abrir la transacción y fija la variable con alcance
local, de modo que una conexión devuelta al pool no arrastra el tenant anterior.
No hay ni un solo acceso de Prisma fuera de `withTenant` en toda la aplicación, y
tampoco un solo `$queryRawUnsafe`.

**El test de aislamiento prueba de verdad, no el camino feliz.** Levanta Postgres
real, crea los dos roles con el mismo SQL de producción y se conecta con el rol
sin privilegios. Para cada modelo comprueba que no se ve la fila del otro tenant
ni pidiéndola por id, que no se puede actualizar ni borrar, que fuera de contexto
se ven cero filas, y que escribir con el tenant del otro falla. Tiene un test de
control que confirma que el rol de migraciones sí ve ambos, sin el cual todo lo
demás pasaría igual con una base vacía.

**El tenant activo nunca viene del cliente.** La cookie es una preferencia que se
contrasta contra las pertenencias reales en cada petición; manipularla no sirve
de nada. El rol tampoco viaja en el token de sesión, así que revocar una
pertenencia surte efecto en la petición siguiente.

**Las credenciales están bien tratadas.** scrypt con parámetros correctos, sal
aleatoria por hash, comparación en tiempo constante de verdad, validación del
parámetro de coste al leer un hash almacenado para que uno manipulado no pueda
degradarlo. Los tokens de invitación son de 256 bits y en la base sólo queda su
SHA-256. Los enlaces mágicos caducan en quince minutos, no en las veinticuatro
horas por defecto, y son de un solo uso incluso ante dos consumos simultáneos.

**Ninguna escritura está protegida sólo escondiendo un botón.** Cada acción de
servidor repite la comprobación que la pantalla ya hizo, y la importación vuelve
a leer y validar el fichero original sin fiarse del resumen que le manda el
navegador. Ese último punto es el sitio donde la mayoría de las implementaciones
se fían del cliente.

**Se devuelve 404 y no 403 para recursos de otro cliente**, de forma consistente
y con el razonamiento escrito en cada sitio. Un 403 confirmaría que el
identificador existe en algún lado.

**La higiene de errores está por encima de la media.** Los errores de validación
salen como ruta y código, nunca con el valor rechazado. Los inesperados se
registran sólo por el nombre de la clase. El logger de la librería de
autenticación está sustituido a propósito para que un fallo de envío no imprima
el correo del usuario.

**La minimización es real, no declarativa.** No hay tablas de sesión ni de
proveedor de identidad, con el motivo escrito. La invitación se borra al
aceptarse en vez de quedarse marcada. La auditoría de una edición guarda sólo los
campos tocados y su valor anterior, no el registro entero.

**La supresión estadística de datos retributivos está implementada en el motor,
no en la interfaz**, con el razonamiento de por qué: una media de dos personas
revela el sueldo del otro. Y el control de acceso a retribución existe y está
auditado antes de que exista el dato, que es el orden correcto.

**La superficie de dependencias es mínima**: trece de producción, lockfile
comiteado, instalación congelada en CI y en el despliegue, sin `overrides` ni
resoluciones fuera del registro. Y `next` está por encima del parche de
CVE-2025-29927, que importa especialmente aquí porque toda la puerta de
autorización es el middleware.

**El aislamiento es un error de lint, no una convención.** Importar el cliente
Prisma crudo falla el lint con un mensaje que explica por qué. TypeScript está en
modo estricto de verdad, con `noUncheckedIndexedAccess` y
`exactOptionalPropertyTypes`.

**La documentación de despliegue es honesta**: enumera lo que falta en vez de
esconderlo, incluida esta misma tarea.

---

## Orden en el que arreglarlo

Por riesgo y por coste, no por comodidad.

Primero, lo que se arregla con una PR pequeña y quita un riesgo grande: los dos
problemas de la importación (1 y 2), que son de código de hoy y que sé
exactamente cómo cerrar; las longitudes que la importación no valida; y las
cabeceras de seguridad, que son un bloque en `next.config.ts`.

Segundo, la cadena de la invitación (3), que es el hallazgo con peor consecuencia:
verificar el correo antes de dejar entrar, sacar el token de la URL, y poder
revocar una invitación.

Tercero, el límite de intentos y el registro de eventos de autenticación (4).
Van juntos porque el uno sin el otro deja el ataque invisible o ilimitado.

Cuarto, `audit_log` append-only (7) y sacar la credencial de migraciones del
entorno de ejecución (8). Los dos tocan roles de base de datos y migraciones, así
que conviene hacerlos a la vez y revisarlos con calma.

Quinto, la capa de dato personal (6, 9 y 10): retención declarada por modelo,
borrado de tenant, exportación, región de cómputo, registro de encargados y aviso
de privacidad. Es la más larga y la que menos código lleva.

En paralelo, y sin depender de nada: los gates de CI (Dependabot, CodeQL, escaneo
de secretos), porque cuanto antes estén, menos deuda se acumula por debajo.

Lo de permisos (segregación de funciones, CONTRIBUTOR, VIEWER) va después, no
porque importe menos, sino porque exige decidir contigo qué debe ver cada rol, y
esa conversación conviene tenerla con la matriz del PRD delante.
