# API - Diego Lechona

API REST para la aplicación de gestión de calidad e inocuidad. Usa Node.js, Express, Sequelize y PostgreSQL en Neon.

## Requisitos

- Node.js 20 o superior
- Una base de datos PostgreSQL accesible (por ejemplo, Neon)

## Configuración local

1. Instala las dependencias:

   ```powershell
   npm install
   ```

2. Copia `.env.example` como `.env` y configura `DATABASE_URL`. Define también un `JWT_SECRET` aleatorio de al menos 32 bytes y `CORS_ORIGIN` con el origen del frontend.
3. Si la base está vacía y aún no existen las cuentas iniciales, aprovisiónalas una sola vez:

   ```powershell
   npm run create-users
   ```

   El comando muestra las contraseñas generadas solo al crear las cuentas. Guárdalas de forma segura.
4. Inicia el servidor en desarrollo:

   ```powershell
   npm run dev
   ```

La API escucha en `http://localhost:3000` por defecto. Para producción usa `npm start`; la plataforma debe proporcionar `DATABASE_URL`, `JWT_SECRET` y `CORS_ORIGIN`. El pool PostgreSQL usa por defecto un máximo de cinco conexiones por instancia; `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_ACQUIRE_MS` y `DB_POOL_IDLE_MS` permiten ajustarlo dentro de límites validados. Considera todas las instancias del backend al fijar el total de conexiones permitido por el proveedor. No publiques el archivo `.env`.

Para medir una publicación sin exponer sentencias SQL ni parámetros, activa opcionalmente `LOG_HTTP_TIMING=true` y/o `LOG_DB_TIMING=true` en la plataforma. Los logs HTTP omiten la query string; las respuestas incluyen `Server-Timing` para solicitudes normales. Estas métricas describen solo el tiempo observado por la API/Sequelize, no el tiempo total percibido por el navegador.

Ejecuta las pruebas unitarias de reglas/validadores con `npm test` desde `server/`; no requieren conexión a la base de datos.

## Consultas paginadas

Los listados de recursos siguen siendo compatibles con clientes antiguos. Para paginar un recurso, envía `page` y `limit`; el límite máximo por respuesta es 100. Por ejemplo:

```text
GET /api/modules/agua/records?month=2026-10&format=ID_FORMATO&page=1&limit=10
```

La respuesta paginada contiene `items`, `total`, `page`, `pageSize` y `pages`. La interfaz usa esta ruta para consultar solo la página visible de registros. Los registros nuevos deben pertenecer al mes de trabajo seleccionado.

## Autenticación

`GET /api/health` y `POST /api/auth/login` son públicos. Los demás endpoints requieren un JWT en el encabezado `Authorization: Bearer <token>`. Los tokens vencen en 8 horas.

Roles disponibles:

- `super`: administra todas las cuentas y puede asignar cualquier rol.
- `user_admin`: crea y desactiva usuarios normales.
- `user`: accede a los módulos de calidad.

## Endpoints principales

Todos usan el prefijo `/api`:

- `GET /health`: verifica la conexión a PostgreSQL.
- `POST /auth/login`, `GET /auth/me`: autenticación y cuenta actual.
- `GET`, `POST /auth/users`; `PATCH /auth/users/:id/status`: gestión de cuentas según el rol.
- `GET /bootstrap`: metadatos, maestros y formatos para iniciar la interfaz.
- `GET /modules`, `/modules/:moduleId?month=AAAA-MM`: programas y sus recursos; al abrir un programa, la interfaz solicita solo los registros del mes seleccionado.
- `/modules/:moduleId/{documents,formats,records,schedules,actions}`: operaciones de recursos de cada programa. Los listados de documentos no incluyen los adjuntos; `GET /modules/:moduleId/documents/:id` obtiene un archivo individual.
- `GET`, `POST`, `DELETE /masters/:category`: datos maestros.
- `GET /reports`, `/trace`, `/backup`: informes, trazabilidad y descarga opcional de copia JSON. No hay endpoints para subir o restaurar backups.

Al arrancar, Sequelize sincroniza los modelos y carga los formatos iniciales si faltan.
