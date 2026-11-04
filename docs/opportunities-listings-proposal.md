# Listings en /opportunities/: arquitectura y propuesta (Fase 3)

Estado: prototipo local en la rama `feature/opportunities-listings-prototype`. Nada desplegado, ningún registro de Notion tocado, ninguna propiedad publicada.

Límite de esta auditoría: el conector de Notion no estaba autorizado en esta sesión, así que no pude leer la base real. El mapeo de Deals y Contacts sale de los scripts de sync de `62_sdahc_Internal_App/sync` (nombres de propiedades confirmados ahí). El esquema de **Properties** y de Groups/Investors no lo he visto: hay que verificarlo antes de implementar.

## 1. Arquitectura encontrada

| Área | Hallazgo |
|---|---|
| Framework | Astro 7 con salida estática; las rutas con `prerender = false` corren como funciones serverless |
| Hosting | Vercel (`@astrojs/vercel`), deploy por git push, `trailingSlash: always`, sitemap automático |
| Estilos | Tokens en `src/styles/tokens.css`, estilos globales en `global.css`, estilos de componente en `<style>` con scope de Astro. Sin Tailwind |
| Datos | Sin base de datos ni CMS. `src/data/opportunities.json` solo guarda cifras de cabecera (100+, estados, categorías) |
| Formularios | Tres endpoints (`contact`, `opportunities`, `report`): validan, aplican honeypot y comprobación de origen, y envían correo con Resend. No escriben en Notion |
| Seguridad | CSP estricta en `vercel.json`: los scripts en línea se permiten por hash sha256, `img-src 'self' data:`, `connect-src 'self'` |
| /opportunities/ actual | Hero, banda de estados, "Why off-market", "How access works", formulario Buyer/Vendor. Todo el contenido es genérico; no hay listings individuales |
| Ecosistema | `62_sdahc_Internal_App` ya sincroniza Notion (Deals, Contacts, Tasks, Groups) a un Supabase interno cada noche. Ese Supabase contiene datos financieros confidenciales |

**Conservar**: hero, banda de estados, why-off-market, how-access-works, formulario general (sigue siendo la vía para quien no mira una propiedad concreta), el patrón de endpoint (origen, honeypot, límites).
**Añadir**: catálogo, página de detalle, galería, ficha de estado, formulario por propiedad, capa de datos con compuerta de publicación, pipeline de fotos, adaptador de Notion.

## 2. Alternativas

**A. Notion como fuente, snapshot público generado en el build.**
Un script lee una base "Listings" de Notion, valida, descarga/optimiza fotos y escribe un JSON público. Astro genera páginas estáticas. Sin base de datos nueva. Latencia de publicación: un rebuild (1 a 2 minutos) disparado por un Deploy Hook.

**B. Notion + Supabase.**
Añade una base de datos, otra capa de sync y otra superficie de ataque. Ventaja real: lectura dinámica sin rebuild. Para 3 a 50 listings no compensa. Si se eligiera, tendría que ser un proyecto Supabase **separado** del interno, porque `raw.deals` guarda precios, comisiones y fees.

**C. CMS nativo.**
No existe. Crear uno duplicaría el CRM y obligaría al equipo a mantener dos sitios de edición.

**Recomendación: A.** Es la única que no añade dependencias de datos, mantiene la regla de la casa ("sin base de datos") y hace que lo publicado sea un fichero revisable y auditable. Su coste es el rebuild; se mitiga con un Deploy Hook y un rebuild nocturno de seguridad.

## 3. Modelo de datos

Las bases `Properties` y `Deals` **no se modifican**. Se añaden dos bases nuevas:

- **Listings**: la capa de publicación. Es la única base que el sitio lee.
- **Enquiries**: consultas entrantes, enlazadas a Contact y Listing.

### Listings (nueva)

| Propiedad Notion | Tipo | Público | Notas |
|---|---|---|---|
| Name | title | No | Nombre interno |
| Public title | text | Sí | Máx. 90 caracteres |
| Slug | text | Sí | Solo suburb y estado, nunca calle |
| Type | select (Property, Portfolio) | Sí | |
| Property | relation a Properties | No | Solo trazabilidad |
| Deal | relation a Deals | No | Solo trazabilidad; ningún campo del Deal se lee |
| Summary | text | Sí | 20 a 220 caracteres |
| Description | rich text | Sí | Párrafos de texto plano |
| Suburb, State, Region | text, select, text | Sí | |
| Street address | text | No | Confidencial por defecto |
| Release street publicly | checkbox | Controla | Por defecto apagado |
| Commercial status | select (Available, EOI open, Under offer, Sold) | Sí | Lo fija una persona; **no** se deriva del Stage del Deal |
| Price display | select (By EOI, On request) | Sí | No existe campo numérico de precio |
| SDA design category | multi-select (HPS, IL, Robust, FA) | Sí | |
| Bedrooms, Resident places | number | Sí | Opcionales |
| Building type, Enrolment status | text | Sí | Opcionales |
| Portfolio property count, states | number, multi-select | Sí | Solo para portfolios |
| Photos (approved) | relation o URLs a la carpeta aprobada | Sí | Ver sección 6 |
| Publication status | select (Draft, In review, Approved, Published, Withdrawn) | No | Independiente del pipeline comercial |
| Approved by, Approved at | person, date | No | Obligatorios para publicar |
| Approved hash | text | No | Lo escribe el sync de aprobación; liga la aprobación al contenido exacto |
| Publish from, Withdrawn at, Withdrawn reason | date, date, text | No | |
| SharePoint folder | url | No | Nunca sale de Notion |
| Internal notes | text | No | |

Tipos en código: `src/data/listings/schema.ts`. `ListingSource` es el registro completo; `PublicListing` es el único tipo que ven páginas y componentes.

### Enquiries (nueva)

Name, Email (normalizado a minúsculas), Phone, Message, Listing (relation), Contact (relation), Received at, Dedup key (texto, `hash(email|listing|día)`), Consent (checkbox), Status (New, Triaged, Converted, Spam). Convertir a Deal es una acción humana.

### Mapeo con Contacts (existente)

Campos confirmados en el sync: Name, Email, Phone Number, Relationship Status, Contact Type, Source, State, Business Origin, Non-active, relaciones Deals, Group y Tasks. Un Contact nuevo se crea solo con Name, Email, Phone Number y Source. Para Source hay que usar una opción **ya existente** o precrear "Website: Opportunities", porque la API crea opciones nuevas en silencio.

## 4. Publicación con aprobación humana

```
Draft -> In review -> Approved -> Published -> Withdrawn
```

1. Un editor completa la ficha y pasa a **In review**.
2. Un aprobador nombrado (propuesta: Steve) revisa **solo los campos públicos** y pone **Approved by/at**. Un botón de Notion pasa a Published y fija el hash.
3. Una automatización de Notion llama al Deploy Hook de Vercel.
4. El build lee Notion, aplica la compuerta y genera páginas solo para lo publicable.
5. **Retirada**: Status = Withdrawn (o fecha de retirada) y Deploy Hook. La URL desaparece en el siguiente build (1 a 2 minutos) y sale del sitemap. Nunca hay borrado de datos.
6. **Edición posterior**: una automatización de Notion devuelve el registro a In review al editar un campo público, y además el hash ya no coincide, así que el listing se despublica solo hasta la siguiente aprobación.

Compuerta implementada y probada en `isPublishable()` (`src/data/listings/index.ts`). Falla cerrada: estado distinto de Published, falta de aprobador, retirada, fecha futura o hash que no coincide significan que el listing no existe en el sitio.

## 5. Separación público / confidencial

- El sitio solo lee la base Listings, con una integración de Notion de **solo lectura** limitada a esa base. No tiene acceso a Deals, Contacts ni a la base interna.
- `toPublicListing()` copia campo a campo (allowlist) y valida con un esquema `strict`: un campo nuevo en el origen no puede filtrarse.
- `assertNoLeak()` rompe el build si el registro público contiene enlaces de SharePoint o Notion, importes en dólares, o la calle cuando no está liberada.
- La calle va **oculta por defecto**: en viviendas SDA vive gente. URLs y títulos usan suburb y estado. Ver decisión 1.
- Ningún documento de SharePoint (IM, contratos, valoraciones) se enlaza ni se copia. La documentación sigue yendo por NDA.
- Los fixtures solo existen en `astro dev` o con `LISTINGS_FIXTURES=1`. Un build de producción normal no publica nada de ellos (verificado: `/opportunities/` queda sin catálogo y el sitemap solo lista la ruta base).

## 6. Fotografías

Originales en SharePoint, solo lo aprobado llega a la web:

```
SharePoint/Listings/<id>/00_Originals   privado, nunca se toca
SharePoint/Listings/<id>/01_Approved    el editor copia aquí solo lo aprobado
```

1. Un script de build usa Microsoft Graph con una app registrada y permiso **Sites.Selected** (lectura, un solo sitio), solo sobre `01_Approved`.
2. `sharp` (ya instalado) corrige orientación, **elimina EXIF y GPS**, genera 3 anchos en AVIF/WebP con JPEG de respaldo, con nombre por hash del contenido.
3. Sube a **Vercel Blob (público)** y registra rutas y dimensiones en el snapshot.
4. El texto alternativo es un campo obligatorio por foto en Notion; sin alt el build falla.
5. Lista de control de aprobación: sin residentes identificables, sin número de casa ni correo visible, sin matrículas.

Las URL de ficheros alojados por Notion caducan a la hora, por lo que **nunca** se enlazan directamente.
Alternativa más simple para pocas fotos: commitear a `public/images/listings/`. Crece rápido el repositorio, así que se recomienda Blob. Requiere añadir el dominio de Blob a `img-src` en la CSP.

## 7. Flujo de consultas

`/api/listing-enquiry/` (implementado en modo dry-run y email; Notion pendiente):

1. Origen permitido, honeypot, límites de longitud, consentimiento y `listing_id` contra la lista de listings **publicados** (un listing retirado devuelve 404).
2. **Correo por Resend primero** y siempre: nunca se pierde un lead aunque Notion falle.
3. Notion (fase posterior, integración separada con escritura solo en Enquiries y Contacts):
   - Buscar Contact por Email normalizado. Si existe, **no se sobrescribe nada**; se enlaza. Si no existe, se crea con campos mínimos.
   - Comprobar la clave de deduplicación y crear la fila de Enquiry enlazada a Contact y Listing.
   - **No se crea ningún Deal.** Si el Listing ya tiene un Deal relacionado, el Enquiry hereda ese vínculo; convertir a un Deal nuevo es manual.
4. Si el paso Notion falla, se marca para reintento y el correo ya salió.

Sin modo configurado, el endpoint devuelve 503 fuera de `astro dev`, para no tragar enquiries en silencio.

## 8. Cambios por archivo

Nuevos:
- `src/data/listings/schema.ts`, `fixtures.ts`, `index.ts`: modelo, fixtures y cargador con compuerta
- `src/components/ListingCard.astro`, `ListingStatusBadge.astro`, `ListingsCatalogue.astro`, `ListingGallery.astro`, `ListingEnquiryForm.astro`
- `src/pages/opportunities/[slug].astro`: ruta de detalle (ruta nueva, solicitada)
- `src/pages/api/listing-enquiry.ts`, `src/lib/enquiry-http.ts`
- `scripts/test-listings-gate.mjs`, este documento

Modificados:
- `src/pages/opportunities.astro`: importa y coloca `<ListingsCatalogue />` justo bajo el hero (banda oscura sobre hero oscuro, así el degradado de entrada de la banda de estados sigue encajando; no se tocó ningún estilo existente)
- `vercel.json`: 3 hashes sha256 añadidos a `script-src` (catálogo, galería, formulario)

Fase posterior (no hecha): `scripts/sync-listings.mjs` (Notion a snapshot), `scripts/publish-photos.mjs`, Deploy Hook, variables de entorno.

## 9. Dependencias, costes, limitaciones

- Nueva dependencia: `@notionhq/client` (solo build). `sharp` y `astro/zod` ya existen.
- Costes: Vercel Blob (céntimos por mes a este volumen), Notion y Vercel ya pagados, Microsoft Graph sin coste.
- Credenciales nuevas: dos integraciones de Notion (lectura de Listings en build; escritura en Enquiries y Contacts en runtime), app de Entra para Graph, token Blob. Todo en variables de entorno de Vercel.
- Limitaciones: la publicación depende de un rebuild; los inline scripts exigen recalcular hashes CSP cada vez que cambian (conviene automatizarlo, ver pruebas); el filtrado es en cliente, adecuado hasta unas decenas de listings.

## 10. Pruebas antes de desplegar

Hechas (prototipo):
- 18 pruebas de compuerta, allowlist y leak guard: `node scripts/test-listings-gate.mjs`
- Build de producción sin fixtures: sin catálogo ni páginas de listing; con fixtures: 3 páginas y ninguna calle en `dist/`
- Hashes CSP de todos los scripts en línea presentes
- Verificación visual en navegador: catálogo, filtros, galería, estados, envío dry-run, una columna a 390 px sin desbordamiento

Pendientes:
- Con datos reales de Notion: Contact existente (mismo email en mayúsculas), Contact nuevo, doble envío, listing retirado entre carga y envío
- Revisión visual en una vista previa de Vercel con navegador real en móvil y lector de pantalla (VoiceOver)
- Contraste automatizado (axe o Lighthouse) y navegación solo con teclado
- Rendimiento con 30 listings y fotos reales (LCP, CLS)
- Comprobación de que el token de build no puede leer Deals ni Contacts
- Script de comprobación de hashes CSP en CI

## 11. Decisiones abiertas

1. **Calle pública o no.** Recomiendo suburb y estado. El control por listing ya existe.
2. **Mostrar "Sold"** en el catálogo (credibilidad) o retirar al vender.
3. **Fotos**: Vercel Blob (recomendado) o repositorio.
4. **Aprobador** único o lista.
5. **Disparo del rebuild**: automatización de Notion (requiere plan con webhooks) o botón manual más rebuild nocturno.
6. **Autorizar el conector de Notion** para que verifique el esquema real de Properties antes de implementar el sync.
7. Las fotos de referencia genéricas que usan los fixtures 1 y 2 son estáticas del sitio y una muestra Sydney; solo sirven para probar la galería.
