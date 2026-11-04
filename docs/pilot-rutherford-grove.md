# Piloto: Rutherford Grove, Armstrong Creek

Primer listing real. **No está publicado y no puede publicarse sin aprobación explícita.** Sin fotos, precios ni yields inventados.

| Dato | Valor |
|---|---|
| Dirección interna (completa, nunca pública) | Solo en Notion. **No se escribe aquí**: este repositorio es público |
| Dirección pública (texto exacto de `Web Public Address`) | `Rutherford Grove, Armstrong Creek VIC 3217` |
| Página de Notion | `402909c1-bb60-817e-b2d8-d9def6dde218` |
| Id público (calculado, no secreto) | `lst_454f05d21f`. Supone que Notion devuelve el id de la página con ese formato; el preflight lo confirma |
| Slug que se derivará | `rutherford-grove-armstrong-creek-vic` (solo letras y guiones) |
| Ubicación derivada de las fotos | `<LISTINGS_MEDIA_BASE_URL>/lst_454f05d21f/manifest.json` |

## Límite de esta evaluación

**No he leído esta página de Notion**, así que no puedo decir qué valores tiene ya. Lo siguiente se apoya en el esquema confirmado por el equipo y en lo que sé del piloto. Para sustituir "a verificar" por datos reales, tras configurar el acceso de solo lectura (runbook, sección 1):

```
npm run listings:preflight -- 402909c1-bb60-817e-b2d8-d9def6dde218
```
Imprime qué hay y qué falta, **sin mostrar precio ni yield**. Sin credenciales sirve `--from-file pagina.json` con un export de la página. Ya lo ejecuté sobre un export mínimo con solo la dirección: sugiere exactamente `Rutherford Grove, Armstrong Creek VIC 3217` y deja el resto pendiente.

## Preflight del piloto (estado actual)

| Elemento | Estado | Detalle |
|---|---|---|
| Campos existentes disponibles | A verificar | Address, Price, Yield, Description, Design Category, State/ Territory, Features, Sharepoint Link, Listing Agent y fechas existen en el esquema. Falta leer sus valores en esta fila |
| Campos públicos obligatorios | **Faltan** | Las 9 propiedades `Web *` aún no existen. Web Public Address, Web Description, Web Pricing Mode y Web Approved By deben rellenarse |
| Fotografías aprobadas | **Faltan** | Ninguna. No se usará ningún placeholder ni imagen de otra propiedad |
| Aprobación de publicación | **Falta** | Web Listing Status no existe aún (equivale a Not Published) y `approvers.json` está vacío, así que nadie puede aprobar todavía |
| Modo de precio | **Falta decidir** | Elegir uno de los cuatro. Ver "Precio" |
| Cumplimiento de Victoria | **Sin despejar** | `compliance.json` impide proponer cualquier listing victoriano hasta registrar el asesoramiento. Ver [victorian-pricing-compliance.md](victorian-pricing-compliance.md) |
| Validación de privacidad | Lista | La dirección pública sin número está definida y la sugerencia automática coincide. Se valida otra vez en cada propuesta y en cada build |
| **Preparación final** | **NO PREPARADO** | Resolver los puntos "Faltan" y repetir el preflight |

## 1. Información que puede estar lista (a verificar en la fila)

| Campo existente | Uso público | Condición |
|---|---|---|
| Address | Solo origen de la sugerencia de dirección pública. Nunca se publica | Ya la tenemos |
| State/ Territory | Se comprueba que coincida con la dirección pública (VIC) | Debe decir VIC |
| Design Category | Categoría SDA en la ficha y en el hero | Opciones del CRM: HPS, IL, R, FA, Basic. `R` se publica como Robust. **`Basic` es una categoría SDA reconocida** (existente o heredada): no se describe como obra nueva y hay que validar su clasificación antes de proponerla. El aprobador confirma el valor |
| Listing End Date | Retira la ficha en esa fecha | Opcional |

## 2. Campos públicos que faltan

`Web Public Address` (ya definido), `Web Description` (texto público breve, escrito por una persona), `Web Pricing Mode`, `Web Approved By` (persona autorizada), `Web Listing Status`, y opcionalmente `Web Title` (por defecto "SDA property, Armstrong Creek").

## 3. Datos financieros y de ocupación que requieren aprobación

| Dato | Tratamiento |
|---|---|
| Price | No se publica nunca automáticamente. Un precio público solo entra por `Web Display Price`, escrito y aprobado a mano, y solo con Asking Price o Price Guide |
| Yield | No se publica. Haría falta un campo público específico y una aprobación expresa. Hoy no existe |
| Features | No se publica (puede contener detalle de inquilinos u ocupación) |
| Ocupación, inquilinos, ingresos | Nunca públicos. Se entregan bajo NDA |
| Sharepoint Link | Interno. Puede contener IMs y documentos de tenencia. No se usa como galería |

**Precio.** Expressions of Interest o Contact Agent no publican ninguna cifra. Asking Price o Price Guide publican una cifra en AUD escrita en `Web Display Price`. **Las reglas victorianas de precio en vigor desde el 1 de octubre de 2026 no están clasificadas para ventas SDA, y las páginas oficiales no tratan EOI ni "Contact Agent": ningún modo está despejado.** Con el campo numérico, un Price Guide es una sola cifra, no un rango.

## 4. Fotografías de marketing necesarias

Fotos reales. Sin placeholders ni imágenes de otra propiedad.
- Fachada o frente, **sin número de casa, buzón ni números de la vecindad visibles**
- Sala de estar, cocina y comedor
- Dormitorios
- Baño accesible
- Patio o área exterior
- Rasgos de accesibilidad (rampa, puertas anchas, circulación) cuando corresponda

En todas: **sin personas identificables, sin objetos personales de residentes, sin documentos, sin matrículas.** Si la vivienda está ocupada, confirmar el consentimiento del residente y del proveedor antes de usar cada foto.

## 5. SharePoint y flujo de imágenes

```
<Cliente> / Properties / <unidad>-<número> Rutherford Grove / Marketing /
    Original Photos /          material en bruto, privado, nunca sale de aquí
    Approved for Website /     solo las fotos elegidas y revisadas
```
La carpeta puede llevar la dirección completa (es un nombre interno). Su enlace se guarda en `Web Photo Folder` (opcional). **No** se usa el `Sharepoint Link` existente.

SharePoint, procesado, almacenamiento público y manifest: **`npm run listings:photos`** (EXIF y GPS eliminados, 3 tamaños, nombres por hash), revisión de privacidad y alt por foto en `manifest.json`, subida a Vercel Blob bajo `lst_454f05d21f/`, y dominio en `img-src`. Detalle en el runbook, sección 4. No se activó almacenamiento ni se subió ningún fichero.

## 6. Aprobaciones y cumplimiento pendientes

Esto es lo que hay que **confirmar**; no afirmo que se exija ni que falte:
- Un aprobador autorizado: su id de usuario de Notion añadido a `approvers.json` (mediante PR).
- Autorización para comercializar la propiedad y mostrar su calle, suburb y fotos.
- Consentimiento de residentes y proveedor para las fotografías, si está ocupada.
- Reglas de publicidad y de precio en Victoria (sección 3).
- Revisión de privacidad de cada foto.
- Revisión del PR por un propietario de código.

## 7. Bloqueos antes de la primera publicación

1. Aprobar y crear el esquema de Notion (9 propiedades).
2. Crear la integración de solo lectura y ejecutar `listings:schema` hasta que no quede nada pendiente.
3. Rellenar `approvers.json` con el id de usuario del aprobador.
4. Decidir el modo de precio y el tratamiento de Design Category si es `Basic`.
5. Fotos reales aprobadas, revisadas y subidas, y dominio de Blob en la CSP.
6. Activar "Require review from Code Owners" en `main`.
7. Verificar en Vercel el almacén Blob y las variables de entorno de `sdahc-website` (no pude comprobarlo).
8. Aprobar el PR en una vista previa y solo entonces fusionar.
