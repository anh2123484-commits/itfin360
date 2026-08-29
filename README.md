# itfin360

Gestión financiera 360º de un departamento IT

## Entorno de desarrollo local

```bash
pnpm install
cp .env.example .env
pnpm db:up      # Postgres 16 (:5432) + Redis 7 (:6379) + MinIO (:9000 API, :9001 consola)
pnpm db:down    # para los servicios
pnpm db:reset   # borra los volúmenes y vuelve a levantarlos desde cero
```

Detalle de servicios, puertos, credenciales y variables de entorno en
[`README-itfin360.md`](README-itfin360.md#entorno-de-desarrollo-local).
Documentación funcional en [`docs/`](docs) y reglas para agentes en [`AGENTS.md`](AGENTS.md).
