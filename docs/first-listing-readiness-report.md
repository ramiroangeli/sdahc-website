# Informe de preparación: primer listing real

Rama `feature/opportunities-listings-prototype`. Piloto: Rutherford Grove, Armstrong Creek. **Nada está publicado, desplegado ni modificado en Notion.** `npm run check:readiness -- --github` reproduce las comprobaciones de la sección 7.

## 0. Antes de nada: este repositorio es público

`ramiroangeli/sdahc-website` es **público**. Hallazgos:
- Tres commits locales de esta rama (`675cd0e`, `441946e` y `0e7aa8e`, y por tanto los merges posteriores) contenían los **números reales de casa y unidad** de las tres propiedades de prueba, en fixtures, pruebas y documentos. La rama **no se ha subido** y `origin/main` no los contiene.
- **Corregido en el árbol de trabajo:** se sustituyeron por números sintéticos y una prueba impide que vuelvan a aparecer en cualquier fichero versionado.
- **Pendiente de tu decisión:** el historial de esos commits sigue conteniéndolos. **No subas esta rama tal cual.** Dos salidas: (A, recomendada, no reescribe nada) crear una rama nueva desde `origin/main` con el árbol final sin historial y subir esa; (B) reescribir el historial local, que me pediste no hacer sin autorización.
- Un repositorio público también expone los snapshots aprobados, los ids de aprobadores, los motivos de retirada y la documentación. Los motivos de retirada ya se validan (corto, sin correos, teléfonos ni importes).

## 1. Esquema de Notion: nueve campos

Manifiesto exacto, generado desde el código y comprobado por una prueba para que no se desvíe: [notion-schema-manifest.md](notion-schema-manifest.md) y [.json](notion-schema-manifest.json).

| # | Propiedad | Tipo | Opciones | Requerida |
|---|---|---|---|---|
| 1 | Web Listing Status | Select | Not Published, Draft, In Review, Approved, Published, Under Offer, Sold, Withdrawn | Siempre |
| 2 | Web Public Address | Texto | `Street Name, Suburb STATE 1234` | Siempre |
| 3 | Web Description | Texto | | Siempre |
| 4 | Web Pricing Mode | Select | Asking Price, Price Guide, Expressions of Interest, Contact Agent | Siempre |
| 5 | Web Approved By | Persona | | Siempre |
| 6 | Web Display Price | Número | AUD | Con Asking Price o Price Guide |
| 7 | Web Title | Texto | | No |
| 8 | Web Featured | Casilla | | No |
| 9 | Web Photo Folder | URL | | No |

**Frente a la propuesta de doce campos:** el slug, la hora de aprobación y la ubicación del manifest de fotos se **derivan**; Web Display Price pasa a número; Web Approved By queda como persona **más** una lista de aprobadores autorizados; Web Photo Folder pasa a opcional. Resultado: cinco obligatorios, uno condicional y tres opcionales. La explicación campo a campo está en el manifiesto.

## 2. Conexión real de solo lectura

- **Versión de API:** `2026-03-11`, fijada. **Usa el UUID del data source** (`2e2909c1-bb60-8177-bf4f-000b40ef0d48`) y no el de la base: el código lo rechaza si se configura el de la base. `collection://` se convierte a UUID y nunca se envía a la API.
- **Permisos mínimos:** integración interna con **solo "Read content"** (sin Insert ni Update) y conectada únicamente a la base Properties. Opcional: "Read user information without email", que solo añade el nombre del aprobador; la autorización funciona con el id.
- **Pasos exactos:** [listings-runbook.md](listings-runbook.md), sección 1.
- **Tokens:** viven en `.env.listings` (git-ignored). El build y el cargador de datos nunca los leen; ningún error ni log los imprime; el escáner del build busca `NOTION_TOKEN`, `api.notion.com` y patrones de token en el cliente y el servidor; ninguna variable de Notion tiene prefijo público. Todo está cubierto por pruebas.
- **Ejecución contra Notion real:** **no hay credenciales en este entorno**, así que no pude ejecutar `listings:schema` ni `listings:preflight`. Con `.env.listings` creado, son dos comandos.

## 3. Separación de datos comerciales

La **Description del CRM, Features, Listing Agent, Price, Yield y Sharepoint Link no se publican nunca**: el preflight los marca como protegidos y solo se leen para detectar fugas. El texto público sale únicamente de `Web Description`. El precio anunciado solo sale de `Web Display Price`, escrito y aprobado a mano. La dirección pública es `Rutherford Grove, Armstrong Creek VIC 3217`, sin número de casa ni de unidad.

Design Category y Build Type son los únicos valores derivados del CRM; entran al snapshot y se ven en el diff del PR. Si se dejan vacíos, no se muestran.

## 4. Categoría SDA "Basic"

Corregido: **`Basic` ya no se trata como dato inválido.** Es una categoría de diseño SDA reconocida (existente o heredada). Reglas:
- Un listing con Basic **no se puede proponer** hasta que su clasificación se valide para ese listing concreto (`compliance.json`, por PR).
- **Nunca se describe como obra nueva ni como vivienda nueva certificada:** se bloquean "new build", "newly built", "purpose-built", "brand new" y "new dwelling" en título, descripción y Build Type. Un Build Type "New build" con Basic se rechaza por incoherente.
- `R` se publica como Robust.

## 5. Bloqueos comerciales y de cumplimiento

Revisión completa y preguntas para el asesor: [victorian-pricing-compliance.md](victorian-pricing-compliance.md).

- **Victoria, reglas en vigor desde el 1 de octubre de 2026.** No asumo que las ventas SDA queden excluidas. Las páginas oficiales **no abordan** EOI, "Contact Agent" ni los anuncios sin precio, así que su tratamiento está sin resolver.
- **Conflicto de privacidad central:** la PPS describe la propiedad y la exención de privacidad cubre solo violencia familiar o personal. Hay que saber si la PPS exige la dirección completa. Eso choca con nuestra regla de no publicar el número de casa.
- **Compuerta por defecto cerrada:** `compliance.json` impide proponer cualquier listing victoriano, por modo de precio, hasta que una persona lo registre tras asesoramiento. No se implementó ninguna carga de documentos de cumplimiento.
- **Precio vendido y retención** (7 días, 18 meses), **EOI con fecha fija** (precio de reserva) y quién es "el agente": preguntas abiertas.
- **Otros estados:** no revisados.

## 6. Qué falta del piloto (Rutherford Grove)

Detalle en [pilot-rutherford-grove.md](pilot-rutherford-grove.md). No pude leer la página, así que lo siguiente es lo que se sabe que falta:
- Las 9 propiedades `Web *` no existen.
- `Web Description`, `Web Pricing Mode` y `Web Approved By`.
- Aprobador autorizado (`approvers.json` está vacío).
- Fotografías reales aprobadas, con alt y revisión de privacidad, y su almacenamiento público.
- Clasificación de Design Category (y validación si es Basic).
- Despeje de cumplimiento en Victoria para el modo de precio elegido.
- Valores reales de Price, Yield y Design Category (a leer con el preflight, que no imprime importes).

## 7. Comprobaciones de producción

| Comprobación | Resultado hoy |
|---|---|
| CODEOWNERS vinculante | **No.** `main` no tiene protección de rama ni rulesets, hay un único colaborador y el fichero CODEOWNERS está solo en esta rama. Además, con un único colaborador el autor no puede aprobar su propio PR, así que una regla de código propietario bloquearía todos los merges o se saltaría como administrador. Hace falta un segundo revisor y aplicar [github-ruleset-main.json](github-ruleset-main.json) (preparado, **no aplicado**). Está configurado con 0 aprobaciones generales: solo exige propietario cuando cambian los ficheros de listings |
| Ruta de entrega de consultas | **Existe, sin verificar en Vercel.** Usa el mismo remitente y dominio Resend que los formularios ya en producción. Necesita `LISTINGS_ENQUIRY_MODE=email` y `RESEND_API_KEY` en Vercel (Production y Preview). Sin ello el endpoint responde 503 y nunca simula éxito. No llega todavía a Notion |
| Retirada de emergencia sin Notion | **Verificada**: se ejecuta con el entorno vacío de credenciales y sin red (prueba automática) y `check:withdrawal` confirma que el build no contiene ruta, catálogo, enlaces, sitemap ni ficheros. Procedimiento en el runbook, sección 6 |
| Imágenes aprobadas sin exponer SharePoint | **Diseño y guardas listos, sin activar.** EXIF y GPS se eliminan, nombres por hash, revisión de privacidad por foto, origen público obligatorio y bloqueo de cualquier enlace de SharePoint. Falta el almacén público y su dominio en `img-src`; `check:readiness` lo avisa cuando se define `LISTINGS_MEDIA_BASE_URL` |
| Ningún listing se publica automáticamente | **Verificado**: no hay snapshots, el único workflow es manual y solo abre un PR, y el build no usa Notion. Pruebas automáticas |

## 8. Secuencia mínima para publicar la primera propiedad

1. **Decidir cómo subir la rama** sin los números del historial (sección 0).
2. Responder las preguntas de cumplimiento de Victoria y registrar el resultado en `compliance.json` (por PR).
3. Aprobar y crear las 9 propiedades de Notion.
4. Crear la integración de solo lectura y ejecutar `listings:schema` y `listings:preflight`.
5. Añadir un segundo revisor al repositorio y aplicar la regla de `main`; activar CODEOWNERS en `main`.
6. Añadir el id del aprobador a `approvers.json` (por PR).
7. Rellenar los campos Web de la fila; decidir modo de precio y la clasificación de Design Category.
8. Fotos reales: seleccionar, procesar, revisar, subir, y añadir el dominio a `img-src`.
9. Configurar `LISTINGS_ENQUIRY_MODE=email` en Vercel y probar una consulta en una vista previa.
10. Proponer en una rama, revisar la vista previa y fusionar el PR.
11. Tras desplegar, confirmar en producción y probar el procedimiento de retirada una vez en una vista previa.

## 9. Correcciones de código de esta ronda

Categoría Basic y sus reglas; compuerta de cumplimiento de Victoria por modo de precio; filas nuevas del preflight (Description del CRM, Listing Agent, cumplimiento, clasificación Basic); manifiesto del esquema generado del código; comprobador de preparación (`check:readiness`); motivo de retirada validado para un repositorio público y retirada ejecutable en un directorio temporal para probarla; escáner del build que busca tokens y el host de Notion; saneamiento de las direcciones reales; ruleset de GitHub preparado. 324 pruebas, cero fallos.
