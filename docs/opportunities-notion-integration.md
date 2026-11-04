# Integración con Notion: diseño validado y esquema final

Rama `feature/opportunities-listings-prototype`. Sustituye a la versión anterior de este documento y a la sección 4 de `opportunities-listings-v2.md`. Los procedimientos operativos están en [listings-runbook.md](listings-runbook.md) y el piloto en [pilot-rutherford-grove.md](pilot-rutherford-grove.md).

## 1. Decisiones aplicadas

- **Proyectos independientes.** Todo el desarrollo está en este repositorio. No se modificó ni se depende de `app.sdahomechoices.com.au`; solo se comunicarían a través de Notion y APIs.
- **Sin automatización de publicación.** No hay commits de bots a `main`, ni ejecuciones programadas, ni webhooks de Notion, ni Deploy Hooks. El workflow de GitHub es solo manual, solo abre un PR y nunca despliega.
- **Tres pasos separados:** sincronización (genera una propuesta en una rama), aprobación (una persona revisa y fusiona el PR) y despliegue (el despliegue normal de `main`).
- **El build no usa Notion.** El sitio compila solo con ficheros commiteados. Un build ajeno a los listings no depende de que Notion funcione, y una sincronización fallida no puede publicar ni despublicar nada.

## 2. Validación contra la documentación oficial de Notion

Leí la referencia actual (query a data source, retrieve a data source, valores de propiedades de página, límites). **No pude consultar el Notion real**, y las respuestas simuladas de las pruebas demuestran la lógica de mapeo, no la compatibilidad en producción. Lo que sigue verificado en la documentación y lo que no:

| Tema | Documentación | Qué hace el adaptador |
|---|---|---|
| Versión | Los ejemplos actuales usan `2026-03-11`. La única versión permitida en la especificación de *retrieve* es esa | Versión fijada en `NOTION_VERSION = '2026-03-11'`. Se puede cambiar solo con `NOTION_API_VERSION` tras repetir el esquema y el preflight. La app interna usa `2025-09-03`; no he comprobado si sigue aceptada |
| Consulta | `POST /v1/data_sources/{id}/query` | Es lo que usa. Solo lee |
| Esquema | `GET /v1/data_sources/{id}` devuelve `properties` con `id`, `name`, `type` y, en select, `options` | `listings:schema` compara tipos y opciones. Admite que el mapa venga indexado por nombre o por id (la documentación no lo aclara) |
| Data source vs base | Un id incorrecto da 404 | Solo acepta UUID. Convierte `collection://<uuid>` a UUID y **nunca** envía el URI a la API. Rechaza con un mensaje claro el id de la **base** (`2e2909c1-bb60-81b5-...`) |
| Paginación | `has_more` y `next_cursor` | Se sigue hasta el final, con tope de 200 páginas |
| Resultado incompleto | Una consulta devuelve como máximo 10.000 resultados y lo indica en `request_status: incomplete` | **Es un error**, no una truncación silenciosa: una fila ausente podría ser una retirada |
| `filter_properties` | Acepta nombres o ids | La propuesta pide solo las propiedades que necesita (no Features, Listing Agent, Deals ni Sharepoint Link) |
| Límites | Unas 3 consultas por segundo a data sources; 429 con `Retry-After`; 529 se trata igual | Espaciado de 350 ms entre peticiones, reintentos para 429, 529, 500, 502, 503 y 504 con `Retry-After` o espera exponencial con jitter, tope de reintentos. No reintenta 400, 401, 403, 404 ni `public_api_request_blocked` |
| Errores | Códigos 400, 401, 403, 404, 406, 429, 503... | `NotionApiError` lleva solo estado y código. **Nunca** incluye token, cabeceras ni cuerpo (probado) |
| Valores vacíos | `rich_text: []`, `number: null`, `select: null`, `date: null`, `people: []`, `url: null`, `checkbox: false` | Probado con un registro vacío: nada falla y el estado por defecto es Not Published |
| Persona | El valor puede ser parcial: **siempre `id`, no siempre `name`** | La autorización se hace por **id de usuario**, nunca por nombre |
| Fecha | `start`, `end`, `time_zone` | Lee `start` |
| Relación | Hasta 25 referencias en la página y `has_more` | No se depende de ella (solo se detecta su presencia) |
| Papelera | La versión `2026-03-11` renombra `archived` a `in_trash` | Se leen ambos; una página archivada o en la papelera se trata como retirada |
| `text` del conector | Es `rich_text` en la API | Mapeado así |

**Sigue sin verificarse** (requiere credenciales): que los tipos reales coincidan con los que dio el conector, que `Web Approved By` devuelva el id con las capacidades concedidas, y la versión `2026-03-11` frente a `2025-09-03` en tu espacio de trabajo. Se cierra con `npm run listings:schema` y `npm run listings:preflight`.

## 3. Esquema final y migración (para aprobación)

Tipos confirmados de los campos existentes (no se modifican): Name `title`; Address, Description y Listing Agent `rich_text`; Price y Yield `number`; Design Category y State/ Territory `select`; Features `multi_select`; Deals `relation`; Sharepoint Link `url`; Listing Date y Listing End Date `date`.

**Solo se añaden propiedades. No se renombra ni se borra nada y no se escribe en ningún registro.** El manifiesto exacto, generado del código y vigilado por una prueba, está en [notion-schema-manifest.md](notion-schema-manifest.md).

| # | Propiedad | Tipo | Opciones o formato | Por defecto | Uso |
|---|---|---|---|---|---|
| 1 | Web Listing Status | Select | Not Published, Draft, In Review, Approved, Published, Under Offer, Sold, Withdrawn | Not Published | Esencial. Vacío o desconocido equivale a Not Published |
| 2 | Web Public Address | Texto | `Street Name, Suburb VIC 3217`, sin número de casa ni de unidad | vacío | Esencial |
| 3 | Web Description | Texto | Párrafos separados por una línea en blanco | vacío | Esencial. La Description del CRM no se usa nunca |
| 4 | Web Pricing Mode | Select | Asking Price, Price Guide, Expressions of Interest, Contact Agent | vacío | Esencial |
| 5 | Web Approved By | Persona | Una persona | vacío | Esencial, **y además debe estar en la lista de aprobadores** |
| 6 | Web Display Price | Número | AUD | vacío | Solo con Asking Price o Price Guide |
| 7 | Web Title | Texto | Máx. 90 caracteres | vacío | Opcional. Por defecto "SDA property, <suburb>" |
| 8 | Web Featured | Casilla | | desmarcada | Opcional |
| 9 | Web Photo Folder | URL | Carpeta SharePoint `Approved for Website` | vacío | Opcional. El sitio no la lee |

**Se derivan, no se crean:** el slug (de la dirección pública, congelado al publicar), la hora de aprobación (la fija la propuesta) y la ubicación del manifest (`<LISTINGS_MEDIA_BASE_URL>/<id público>/manifest.json`).

**Lista de migración**
1. Aprobar esta tabla.
2. Crear las 9 propiedades con esos tipos y opciones exactos (`npm run listings:schema` imprime lo que falta y avisa de cualquier tipo equivocado).
3. No tocar ningún registro existente. Todos quedan en Not Published por defecto.
4. Crear la integración de solo lectura y compartirle la base (runbook, sección 1).
5. Ejecutar `listings:schema`: debe terminar sin pendientes.
6. Rellenar `src/data/listings/approvers.json` con el id de usuario de Notion de cada aprobador.

**Observaciones del esquema real**
- **Design Category** tiene las opciones HPS, IL, R, FA y Basic. `R` se publica como Robust. **`Basic` es una categoría SDA reconocida** (existente o heredada), no una certificación de obra nueva: no se describe nunca como tal y un listing Basic no se puede proponer hasta validar su clasificación (`compliance.json`).
- **State/ Territory** tiene los ocho códigos y todos se reconocen.
- **Web Display Price como número** admite una sola cifra. Con Price Guide solo puede mostrarse una cifra, no un rango. Si hace falta un rango, añadir un segundo campo `Web Display Price Max`. **Decisión pendiente.**

## 4. Aprobación y trazabilidad

Una persona editable en Notion no demuestra autorización por sí sola. La publicación exige **cuatro cosas**:

1. **Persona nombrada** en `Web Approved By`, con **id de usuario verificable** (debe ser un campo de persona).
2. Ese id está en `src/data/listings/approvers.json`. **Por defecto la lista está vacía, así que nadie puede aprobar** hasta que se rellene.
3. La propuesta pasa todas las validaciones. Si falla cualquiera, **no se genera ningún snapshot** para esa fila.
4. Un PR con el snapshot, revisado y fusionado. `CODEOWNERS` exige un propietario en `approved/`, `withdrawn/` y `approvers.json`. **Para que sea vinculante hay que activar "Require review from Code Owners" en la protección de rama de `main`.**

Cada snapshot guarda: id del listing, versión, aprobador (nombre e id), hora de aprobación, hora de la primera publicación, `sourceEditedAt` (última edición de la fila en Notion), estado comercial, hash del contenido público y el contenido. Se verifica la integridad en cada build. **Modificar `approvers.json` también pasa por PR**, así que no puede ampliarse la lista en silencio.

## 5. Dos clases de cambio

- **Contenido público** (título, texto, dirección, precio, categoría, fotos): nueva versión, hash nuevo, PR de revisión.
- **Estado comercial** (Available, Under offer, Sold), destacado y fecha de fin: mismo hash, sin nueva versión. Se aplican también por PR.

Mientras hay un borrador pendiente, sigue publicada la última versión aprobada.

## 6. Qué queda inerte

- El workflow `listings-sync.yml` es solo `workflow_dispatch`, exige escribir `PROPOSE`, empuja únicamente a una rama `listing/...` y abre un PR. No tiene `schedule`, `repository_dispatch`, `push`, Deploy Hook ni `curl`. Una prueba lo comprueba.
- Es el único workflow del repositorio.
- No hay ninguna llamada a Notion en el build ni en el cargador de datos (probado).
