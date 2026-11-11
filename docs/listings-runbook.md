# Runbook de listings: configuración, publicación y retirada

Para el primer piloto. Todo es manual y revisable. Nada de esto está activado: el repositorio no publica ni despliega nada por sí solo.

> **El repositorio es público.** Todo lo que se commitea (snapshots, ids de aprobadores, motivos de retirada, documentación e historial) lo puede leer cualquiera. Nunca escribas una dirección interna con número de casa o unidad, un precio interno, ni datos de residentes. Revisa un diff antes de empujarlo. Estado de las reglas de GitHub, revisores y visibilidad: `npm run check:readiness -- --github`.

## 0. Cómo encaja todo

```
Notion (solo lectura)  ->  propuesta en una rama  ->  PR revisado y fusionado  ->  despliegue de main
   sincronización             (snapshot en git)            aprobación                 publicación
```
El sitio compila solo con los ficheros de `src/data/listings/approved/` y `withdrawn/`. **Nunca consulta Notion**, ni en el build ni en ejecución.

## 1. Configuración de Notion de solo lectura (local)

1. En Notion: Configuración, Conexiones, **Desarrollar o gestionar integraciones**, crear una integración **interna** nueva llamada `SDAHC Website (read only)`. No reutilices la integración de la app interna: tiene acceso a Deals y datos financieros.
2. Capacidades: marca **solo "Read content"**. Deja desmarcados Insert y Update. Si quieres ver el nombre del aprobador, marca también "Read user information without email"; sin ella solo llega el id y la autorización sigue funcionando.
3. En la base **Properties**, menú de los tres puntos, **Connections**, añade esa integración. Es la única base que debe compartirse.
4. Copia el token. **No lo pegues en el chat, en un commit, en un issue ni en un log.**
5. En la raíz del repo crea `.env.listings` (ya está en `.gitignore`):
   ```
   NOTION_TOKEN=<token>
   NOTION_PROPERTIES_DATA_SOURCE_ID=2e2909c1-bb60-8177-bf4f-000b40ef0d48
   LISTINGS_MEDIA_BASE_URL=<origen público de las fotos, cuando exista>
   ```
   Usa el UUID del data source. **No** el id de la base (`2e2909c1-bb60-81b5-...`), y no hace falta `collection://` (se acepta y se convierte).
6. Los comandos `npm run listings:*` cargan ese fichero con `node --env-file-if-exists`. Ningún comando imprime el token ni lo incluye en un error (hay una prueba).
7. Comprueba la configuración sin imprimir ningún secreto: `npm run listings:doctor` (local) y `npm run listings:doctor -- --online` (pregunta a Notion si acepta el token y si la integración puede leer el data source). Luego `npm run listings:schema`.

Para revisar **un solo registro sin credenciales**, exporta la página de Notion a JSON y ejecuta `node scripts/listings-sync.mjs --preflight <pageId> --from-file pagina.json`.

## 2. Comprobar el esquema y la fila

- `npm run listings:schema`: compara el data source real con lo esperado, lista las propiedades Web que faltan (con tipo y opciones exactos), avisa de cualquier tipo equivocado y de las opciones de Design Category que no se publican como categoría. **No cambia nada en Notion.**
- `npm run listings:preflight -- <pageId>`: informe de una fila: campos disponibles, campos públicos que faltan, fotos aprobadas, aprobador autorizado, modo de precio, validación de privacidad y **preparación final**. No imprime valores financieros.

## 3. Flujo de publicación manual

1. Completa en Notion los campos Web de la fila y pasa a **In Review**, luego **Approved** (el aprobador queda nombrado en `Web Approved By`).
2. Prepara y sube las fotos (sección 4).
3. Crea una rama de revisión desde `main`:
   ```
   git fetch origin
   git switch -c listing/<nombre> origin/main
   ```
4. Pasa la fila a **Published** en Notion y ejecuta, en este orden:
   ```
   npm run listings:preflight -- <pageId>      # no debe quedar nada en MISSING
   npm run listings:propose                    # simulacro: muestra lo que propondría
   npm run listings:propose -- --write         # escribe src/data/listings/approved/<slug>.json
   ```
   `--write` **se niega a ejecutarse en `main`**. Si cualquier validación falla, esa fila no genera ningún fichero.
5. Revisa el diff del snapshot: título, texto, dirección pública (sin número), modo de precio, fotos.
6. `git add src/data/listings/approved && git commit && git push -u origin listing/<nombre>`, y abre un PR hacia `main`.
7. **El revisor** (código propietario) mira la vista previa de Vercel (con `LISTINGS_MEDIA_BASE_URL` definida también en Preview) y el diff. Aprobar y fusionar el PR **es la aprobación de publicación**. Después se despliega `main`.
8. Si el PR no se fusiona, no ocurre nada. Si Notion falla o la sincronización falla, no se propone nada.

El workflow manual `Propose listing snapshot` se retiró: las listings se publican desde el Listings Manager (flujo normal) y, solo para casos excepcionales, con estos pasos locales. El comando `npm run listings:withdraw` y el resto de la CLI siguen disponibles.

## 4. Fotografías (SharePoint a almacenamiento público)

SharePoint se mantiene como biblioteca original. Flujo manual:

1. Alguien copia a `Marketing / Approved for Website` solo las fotos elegidas (los originales no se tocan).
2. Se descargan a una carpeta local: `npm run listings:photos -- --in <carpeta> --out <salida> --id <id público>` (el id lo imprime `listings:preflight`; la salida queda en `<salida>/<id público>/`, que es exactamente el prefijo de subida) (orientación corregida, **EXIF y GPS eliminados**, 480/960/1600 px WebP, nombres por hash, máscara de color).
3. En `manifest.json`: escribir el **alt** de cada foto y poner `privacyReviewed: true` tras revisar cada encuadre (números en fachada, buzones, carteles, matrículas, personas, objetos personales).
4. Comprobar la carpeta antes de subirla: `npm run listings:photos:verify -- <salida>/<id público>`. Rechaza una carpeta sin alt, sin revisión de privacidad, con metadatos, con nombres que no sean el hash o con imágenes que no estén en el manifest.
5. Subir la carpeta **a mano** a Vercel Blob (almacenamiento público) bajo `<id público>/`, de forma que el manifest quede en `<LISTINGS_MEDIA_BASE_URL>/<id público>/manifest.json`. Sube con una caducidad de caché conservadora (ver sección 6).
6. Añadir el dominio de Blob a `img-src` en la CSP de `vercel.json` (mediante PR).

**Vercel Blob sigue siendo la opción preferida**, pero no he podido verificar la configuración de tu cuenta: la conexión a Vercel solo ve que existen dos proyectos separados (`sdahc-website` y `sdahc-intelligence-app`) y rechaza el acceso a los detalles del equipo. Antes de subir nada hay que confirmar si ya existe un almacén Blob en `sdahc-website` y su dominio público. No activé ni creé almacenamiento.

### Prueba real de entrega de consultas

`npm run listings:test-delivery` muestra, sin enviar nada, el remitente, el destinatario y el asunto que se usarían y si hay clave. `npm run listings:test-delivery -- --send` envía **un** correo de prueba, claramente rotulado, por el mismo camino que el endpoint (mismo sumidero, mismo remitente Resend y mismo buzón). Solo acepta destinatarios `@sdahomechoices.com.au`. Es un paso explícito porque envía un correo real. El endpoint solo acepta consultas de un listing publicado, así que la prueba a través del endpoint se repite en el primer Preview con el snapshot propuesto y `LISTINGS_ENQUIRY_MODE=email` definido para Preview.

## 5. Cambio de estado comercial

Under Offer, Sold, destacado o fecha de fin no cambian el contenido público, pero **también pasan por PR**: repite los pasos 3 a 7. La propuesta detecta que solo cambió el estado y reescribe el snapshot sin subir de versión.

## 6. Retirada de emergencia (sin Notion)

**Un build fallido no retira nada.** Si un despliegue falla, Vercel mantiene vivo el despliegue anterior, con el listing dentro. Por eso la retirada no depende de Notion ni de que nada se sincronice, y hay que verificar que el despliegue nuevo **terminó bien**.

**Procedimiento**
1. En una rama desde `main`:
   ```
   npm run listings:withdraw -- <slug|id>
   ```
   **Camino normal: el Listings Manager** (Publisher, dirección escrita y motivo privado); este comando es solo la salida de emergencia. Escribe `src/data/listings/withdrawn/<id>.json` con palabras constantes (`withdrawnBy: "SDA Home Choices"`, `reason: "withdrawn"`): el repositorio es público, así que **nunca** lleva un motivo ni un nombre (si se pasan `--reason` o `--by` no se guardan; anota el motivo en privado). **Esa retirada anula cualquier estado de Notion** (aunque diga Published) hasta que alguien ejecute `--reinstate`, también por PR.
2. Comprueba localmente, tras compilar:
   ```
   npm run build
   npm run check:withdrawal -- <slug> --dist .vercel/output/static
   ```
   (`--dist .vercel/output/static` comprueba lo que ve un visitante; el bundle de funciones del servidor sigue conteniendo los datos del listing, que ya eran públicos en el repositorio, y por eso no se analiza.) Falla si el build aún contiene la ruta, la entrada del catálogo o del hero, cualquier enlace interno, la referencia en el sitemap, el canonical, el JSON-LD o cualquier fichero con su nombre. Con la ficha publicada devuelve error y tras la retirada pasa (verificado con una ficha de prueba).
3. PR con ese único fichero, revisión rápida de un propietario, fusión y despliegue.
4. **Confirma en producción** que el despliegue nuevo está Ready:
   - `curl -sI https://sdahomechoices.com.au/opportunities/<slug>/` debe dar 404.
   - `curl -s https://sdahomechoices.com.au/sitemap-0.xml | grep <slug>` no debe devolver nada.
   - La página `/opportunities/` ya no enlaza a la ficha.
5. Si el PR o el despliegue no pueden esperar: en el panel de Vercel, **Instant Rollback** al último despliegue anterior a la publicación (sin depender de ningún build). Confirma antes la disponibilidad en tu plan y cuándo se reactivan los despliegues automáticos tras el rollback. Si tu plan permite reglas de ruta a nivel de proyecto, una redirección de `/opportunities/<slug>/` también actúa sin build. **No he podido verificar ninguna de las dos en tu cuenta.**

**Qué queda fuera del sitio y hay que tratar aparte**
| Elemento | Qué hacer |
|---|---|
| Páginas ya desplegadas | Un despliegue nuevo las sustituye. Hay que verificar que terminó correctamente |
| Caché de Vercel | La caché es por despliegue, por lo que el despliegue nuevo no sirve la página anterior. Verifícalo con `curl` |
| Fotos en Vercel Blob | Las URL públicas siguen vivas hasta borrarlas. **Borra el prefijo `<id público>/`** del almacén. Si la caché se subió con una vida larga, una copia puede seguir sirviéndose hasta que caduque, así que sube con una caducidad corta |
| Buscadores | La ficha devolverá 404. Para acelerarlo, usa la herramienta de eliminación de URL de Search Console |
| Copias de terceros | Un tercero puede haber guardado la página o las fotos. No se puede revocar |
| Formularios | Una ficha retirada rechaza consultas nuevas (404) |

## 7. Qué pasa si algo falla

| Fallo | Efecto |
|---|---|
| Notion no responde o la sincronización falla | No se genera propuesta. **El sitio no cambia** |
| La validación de una fila falla | Esa fila no genera snapshot. Las demás siguen su curso |
| El aprobador no está en la lista | No se propone |
| Se cierra el PR sin fusionar | No ocurre nada |
| El build de producción falla | Sigue el despliegue anterior. **No cuenta como retirada.** Usa la sección 6 |
| Cae Notion con el sitio publicado | No afecta: el sitio no lo usa |
| Faltan fotos o su revisión de privacidad | No se propone |

## 8. Quién hace qué

| Rol | Hace | No puede |
|---|---|---|
| Equipo | Rellena los campos Web, prepara fotos, lanza la propuesta | Publicar sin PR aprobado |
| Aprobador listado | Se nombra en `Web Approved By` | Ampliar la lista de aprobadores sin PR |
| Propietario de código | Revisa y fusiona el PR | |
| Cualquiera con acceso | Prepara una retirada | Saltarse la revisión del PR |
