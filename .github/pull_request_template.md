## Qué hace esta PR

Closes #

<!-- Una o dos frases. Qué cambia y por qué. -->

## Criterios de aceptación de la issue

<!-- Copia aquí los criterios de la issue y marca cada uno. No los des por hechos. -->

- [ ]
- [ ]

## Decisiones tomadas

<!-- OBLIGATORIO. Todo lo que has asumido porque no estaba resuelto en docs/.
     Si no has asumido nada, escribe "ninguna". Esta es la sección que más se lee. -->

## Comprobaciones

- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` en verde en local
- [ ] Importes en céntimos enteros, campos con sufijo `Cents`, sin `float`
- [ ] Toda tabla nueva lleva `tenantId` y su política RLS, y el test de aislamiento se ha ampliado
- [ ] Ninguna consulta Prisma fuera de `withTenant`
- [ ] Sin `any` ni `@ts-ignore` sin justificar
- [ ] Si toca retribución: cifrado, permiso `canViewCompensation` y entrada en `AuditLog`
- [ ] Sin secretos ni datos reales de cliente en el diff
- [ ] Tests nuevos que cubren los criterios de aceptación

## Fuera de alcance detectado

<!-- Cosas que has visto y NO has tocado. Enlaza las issues que hayas abierto. -->
