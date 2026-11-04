# /opportunities/ v2: hero, catálogo y sistema de listings

> **Partes sustituidas.** El esquema de Notion, la sincronización durante el build (`prebuild`, fichero de estado), el workflow que hacía commit a `main` y la lista de pasos de publicación quedaron reemplazados: ver [opportunities-notion-integration.md](opportunities-notion-integration.md) y [listings-runbook.md](listings-runbook.md). El sitio ya no consulta Notion en ningún build.

Rama: `feature/opportunities-listings-prototype`. Sin desplegar, `main` sin tocar (sigue en 5312eed), ningún registro de Notion leído ni modificado. Complementa `opportunities-listings-proposal.md`; donde difieren, manda este documento.

## 1. Qué se construyó

**Hero nuevo** ([OpportunitiesHero.astro](../src/components/OpportunitiesHero.astro), [HeroCardFan.astro](../src/components/HeroCardFan.astro))
- Título "SDA Investment Opportunities" y dos caminos de igual peso: *Available properties* (icono de casa, CTA azul, lleva a `#listings`) y *Off-market opportunities* (candado, fondo más oscuro con filo ámbar, texto de confidencialidad y NDA, lleva a `#access`). Nunca muestra información confidencial.
- Abanico de 3 o 5 tarjetas con rotación, profundidad, entrada escalonada y deriva lenta. Hover, foco de teclado o las flechas traen una tarjeta al frente; clic o Enter siempre navega a la ficha. En móvil pasa a carrusel con swipe nativo (scroll-snap), sin hover y sin desbordamiento.
- Cada tarjeta: foto, estado, calle, suburb, estado y código postal, categoría SDA solo si está aprobada, y estado comercial.
- Con menos de 3 listings se completa con tarjetas bloqueadas "Off-market" (decorativas, sin enlace, solo un código de estado de `opportunities.json`). Con 0 listings el hero y la vía off-market se ven igual.

**Catálogo** ([ListingsCatalogue.astro](../src/components/ListingsCatalogue.astro)): "Available SDA Properties" con búsqueda por suburb o calle, estado, categoría SDA, tipo y estado comercial (cada filtro solo aparece si los datos pueden cambiar el resultado), orden, URL compartible y estado vacío profesional que mantiene el camino off-market.

**Imagen con máscara cromática** ([ListingImage.astro](../src/components/ListingImage.astro)): un único componente para hero, catálogo y ficha, es decir, la misma biblioteca de imágenes aprobadas. Tres estados: foto real (`srcset`), placeholder DEMO, o "photography to follow".

**Ficha** ([[slug].astro](../src/pages/opportunities/[slug].astro)): dirección pública, precio según modo, JSON-LD `RealEstateListing`, Open Graph solo con foto real, galería, formulario.

## 2. Reglas permanentes implementadas

| Regla | Cómo se garantiza |
|---|---|
| Nunca número de casa o unidad | `publicAddressSchema` no tiene campo para él. La dirección sale solo de `Web Public Address` ("Calle, Suburb VIC 3217"), parseada de forma estricta: un dígito en la calle la rechaza, no la "limpia". Además una guarda revisa todo el contenido serializado (título, descripción, alt, slug, nombres de fichero) con y sin la dirección interna |
| Slugs y URLs | Solo letras y guiones. Si hay varias propiedades en la misma calle, la siguiente recibe un sufijo de 4 letras estable. El primer slug publicado se congela |
| SEO, OG, JSON-LD, sitemap | Se construyen solo desde `PublicListing`. Sin coordenadas. OG usa la foto real más ancha, nunca un DEMO |
| Fotos | Nombres por hash de contenido, sin EXIF, origen público aprobado, revisión de privacidad humana obligatoria por foto |
| Precios | `Asking Price`, `Price Guide`, `Expressions of Interest`, `Contact Agent`. Solo un importe AUD aprobado a mano (`Web Display Price`) es público. El `Price` del CRM no se lee nunca hacia contenido público |
| Fixtures | Solo en `astro dev` o con `LISTINGS_FIXTURES=1`. Un deploy con `VERCEL_ENV=production` se niega a compilar con fixtures. Un build normal no incluye ni su código |
| Aprobación humana | Un listing solo existe en el sitio si hay snapshot aprobado con aprobador, fecha y hash íntegro |

## 3. Versionado

Tres capas separadas: **interna** (CRM), **borrador público** (campos `Web *`), **última versión aprobada** (`src/data/listings/approved/<slug>.json`, versionada en git).
- Editar el CRM o el borrador no cambia lo publicado. Mientras hay un borrador pendiente, sigue la última versión aprobada.
- **Retirada** (`Withdrawn`, `Not Published`, fecha fin vencida o página archivada) oculta en el siguiente build. Se lee en vivo de Notion en cada build (`prebuild`); si hay credenciales y la lectura falla, el build falla (no se puede perder una retirada).
- El hash cubre solo contenido público. El estado comercial (`Published`, `Under Offer`, `Sold`) es una decisión humana en vivo y queda fuera del hash: marcar "Under Offer" no exige re-aprobar.
- Promoción: `npm run listings:promote` (simulación) y `-- --write`. Exige estado vivo, aprobador, fecha, dirección, precio, slug, fotos con alt y revisión de privacidad, y todas las guardas.

## 4. Campos nuevos propuestos en Properties (no creados)

> **Reemplazado.** El esquema propuesto aquí (12 campos) se redujo a 9 propiedades, de las cuales solo 5 son esenciales; el slug, la hora de aprobación y la ubicación del manifest se derivan. Ver [opportunities-notion-integration.md](opportunities-notion-integration.md), sección 3.

Base `2e2909c1-bb60-81b5-8806-ff710a8274ed`, data source `2e2909c1-bb60-8177-bf4f-000b40ef0d48`. No se duplican campos existentes (Name, Address, Price, Yield, Description, Design Category, Build Type, Features, Listing Agent, Listing Date, Listing End Date, Sharepoint Link, Deals, State/ Territory).

| Propiedad | Tipo Notion | Uso |
|---|---|---|
| Web Listing Status | Select: Not Published (por defecto), Draft, In Review, Published, Under Offer, Sold, Withdrawn | Vacío o desconocido equivale a Not Published |
| Web Public Address | Texto | "Calle, Suburb VIC 3217" sin número |
| Web Title | Texto | Máx. 90 caracteres |
| Web Description | Texto | Párrafos separados por línea en blanco. El primero es el resumen |
| Web Pricing Mode | Select: Asking Price, Price Guide, Expressions of Interest, Contact Agent | |
| Web Display Price | Texto | Solo AUD aprobado; obligatorio para Asking Price y Price Guide, prohibido en los otros |
| Web Photo Folder | URL | Carpeta SharePoint `Marketing / Approved for Website`. Solo referencia interna |
| Web Media Manifest | URL | `manifest.json` subido junto a las fotos |
| Web Featured | Checkbox | Orden en el hero |
| Web Slug | Texto | Se congela al publicar |
| Web Approved By | Persona | Obligatorio |
| Web Approved At | Fecha | Obligatorio |

`Design Category` y `Build Type` (existentes) pasan al borrador solo vía allowlist y quedan cubiertos por la aprobación. `Price`, `Yield`, `Features`, `Listing Agent`, `Sharepoint Link` y `Deals` solo se leen hacia `internal`, para detectar fugas.

## 5. Fotografías: procedimiento y almacenamiento

1. Un humano copia solo las fotos aprobadas a `Marketing / Approved for Website` (los originales quedan en `Original Photos`).
2. `npm run listings:photos -- --in <carpeta> --out <salida>`: corrige orientación, **elimina EXIF/GPS**, genera 480/960/1600 px en WebP con nombre por hash, **sin ampliar**, y calcula la máscara de color.
3. Un humano rellena el alt de cada foto y pone `privacyReviewed: true` tras revisar la imagen (números en fachadas, buzones, carteles, matrículas, personas). No se puede automatizar; por defecto es `false` y bloquea la publicación.
4. Subir la carpeta al almacenamiento público y pegar la URL del manifest en `Web Media Manifest`.

**Color dominante:** sí es viable sin dependencia nueva. `sharp` (ya instalado por Astro) da el color dominante; se ajusta al acento de marca más cercano (blue, teal, amber, slate, leídos de `tokens.css`) y se guarda como `accent`. Una foto solo puede teñirse con colores del sitio.

**Vercel Blob vs Supabase Storage:** recomiendo **Vercel Blob (público)**. El sitio ya está en Vercel, no suma proveedor ni credenciales, sirve por CDN y encaja con el flujo manual de subida. Supabase Storage solo tendría sentido si se adoptara Supabase para otra cosa. Requiere añadir el dominio de Blob a `img-src` en la CSP (no hecho: aún no existe el dominio).

## 6. Consultas (lead capture)

Flujo: formulario, `/api/listing-enquiry/`, registro, CRM. Cada enquiry guarda listing ID, nombre, email, teléfono opcional, mensaje, origen, fecha y estado.
- Implementado y probado: validación, honeypot, token de tiempo, límite por IP y por email, rechazo de spam de enlaces, sumidero de email (Resend) y la lógica de vincular con un Contact existente por email en minúsculas. **No existe ningún método que cree un Deal.**
- **No implementado:** cliente real de Notion y destino de Enquiries (falta confirmar el esquema de Contacts y aprobar dónde se guardan). Sin `LISTINGS_ENQUIRY_MODE=email`, el endpoint responde 503 en cualquier despliegue: no simula éxito.
- El límite en memoria es un freno por instancia. El control real debe ser una regla de rate limit del Vercel Firewall sobre `/api/listing-enquiry/`.
- **Supabase para recibir leads:** no lo recomiendo todavía. Añade una base y una superficie nueva para un volumen bajo. Un correo durable más Notion cubre el caso. Si se quisiera una bandeja a prueba de caídas de Notion, bastaría una tabla de solo inserción con RLS y clave de servicio en el servidor, detrás de la misma interfaz `EnquirySink`.

## 7. QA ejecutado

| Prueba | Resultado |
|---|---|
| `npm run test:listings` | 195 pruebas, 0 fallos. Una mutación (guarda de número de calle desactivada) hizo fallar las pruebas esperadas y se restauró |
| Build sin fixtures + `check:privacy -- --expect-none` | Limpio (79 ficheros): sin páginas de listing, sin marcas DEMO, sitemap solo con `/opportunities/`, hero y vía off-market presentes, estado vacío visible |
| Build con fixtures + `check:privacy` | Limpio (82 ficheros, cliente y servidor): ni números de casa ni direcciones internas |
| Hash CSP | Todos los scripts en línea de `/opportunities/`, de las fichas y de otras páginas tienen hash. Se actualizaron 3 hashes en `vercel.json` |
| Visual | Desktop, 768 y 390 px sin desbordamiento horizontal; ambos CTAs visibles en la primera pantalla a 390 px. Capturas en [docs/screenshots/](screenshots/) |
| Teclado | Orden lógico (menú, los dos CTAs, tarjetas, flechas); el foco trae la tarjeta al frente; foco visible |
| Reduced motion | Verificado en el CSS (entrada, deriva, aurora y transiciones se desactivan). **No** emulado en navegador |
| `main` y producción | `main` en 5312eed sin cambios; no se ejecutó ningún deploy |

## 8. Qué funciona del todo y qué depende de terceros

**Completo:** hero, abanico y carrusel, catálogo con filtros, ficha, galería, modelo de datos y versionado, guardas de privacidad, precios configurables, aislamiento de fixtures, adaptador Notion (con respuestas simuladas), scripts de promoción y de fotos, verificador de build, consultas con validación y anti-spam.

**Depende de credenciales o de fotos:**
- Lectura real de Notion: `NOTION_TOKEN` y `NOTION_PROPERTIES_DATA_SOURCE_ID`. **El adaptador está probado solo contra respuestas simuladas con la forma documentada de la API; falta contrastarlo con la base real.**
- Crear los 12 campos `Web *` en Notion (cambio de esquema que debes aprobar).
- Fotos reales aprobadas, su revisión de privacidad y el almacenamiento público (`LISTINGS_MEDIA_BASE_URL` y `img-src`).
- Envío de consultas: `LISTINGS_ENQUIRY_MODE=email` y `RESEND_API_KEY`, y después el cliente de Notion.
- No verificado: Lighthouse y rendimiento con imágenes reales, lector de pantalla, emulación real de `prefers-reduced-motion`, ni la vista previa de Vercel. Con fotos reales hay que medir LCP.

## 9. Archivos

Nuevos: `src/data/listings/{address,pricing,guards,versioning,publish,notion,seo,lib}.ts`, `src/data/listings/approved/`, `src/lib/enquiries.ts`, `src/components/{OpportunitiesHero,HeroCardFan,ListingImage}.astro`, `scripts/{listings-sync,prepare-listing-photos,check-dist-privacy,test-listings}.mjs`, `scripts/lib/bundle-ts.mjs`, `docs/screenshots/`.
Reescritos: `schema.ts`, `fixtures.ts`, `index.ts`, `ListingCard`, `ListingsCatalogue`, `ListingGallery`, `ListingEnquiryForm`, `ListingStatusBadge`, `[slug].astro`, `api/listing-enquiry.ts`.
Modificados: `opportunities.astro` (hero y catálogo nuevos, `id="access"`, hero antiguo y su script retirados), `vercel.json` (hashes), `package.json` (`prebuild`, `test:listings`, `check:privacy`, `listings:promote`, `listings:photos`), `.env.example`, `.gitignore`.
Se retiró el hero antiguo (póster genérico y su script); las tres fotos genéricas de "Why off-market" se conservan.

## 10. Próximas acciones para el primer listing real

1. Aprobar y crear los 12 campos `Web *` en Properties y autorizar el token de lectura.
2. Elegir el listing y rellenar sus campos `Web *` (dirección pública sin número, título, descripción, modo de precio).
3. Seleccionar y preparar las fotos (`listings:photos`), revisarlas, subirlas y pegar la URL del manifest.
4. Con credenciales: `npm run listings:promote` (simulación), revisar el diff y `-- --write`; commit.
5. Preview de Vercel: revisar fichas, hero y `check:privacy`; probar el formulario con `LISTINGS_ENQUIRY_MODE=email`.
6. Regla de rate limit en Vercel Firewall y revisión de accesibilidad con lector de pantalla.
7. Decidir la ruta de las consultas hacia Notion (esquema de Contacts y destino de Enquiries).
