# Victoria: reglas de precio de venta y listings SDA

**No es asesoramiento jurídico.** Resume lo que dicen las páginas oficiales de Consumer Affairs Victoria (CAV) leídas el 2 de noviembre de 2026 y deja por escrito las preguntas que deben resolver el OIEC o el asesor jurídico de Victoria antes de publicar el primer listing victoriano. Los resúmenes están parafraseados; hay que contrastarlos con las fuentes.

## Qué dicen las fuentes oficiales

| Tema | Resumen | Fuente |
|---|---|---|
| Entrada en vigor | Las nuevas reglas de precio de venta de vivienda residencial se aplican desde el 1 de octubre de 2026. La Property Price Statement (PPS) sustituye a la Statement of Information | [Industry Q&As](https://www.consumer.vic.gov.au/licensing-and-registration/estate-agents/new-changes-to-property-sales-and-underquoting-laws/industry-qas-new-changes-to-property-sales-and-underquoting-laws) |
| Alcance | La publicación del precio de venta y la PPS se aplican a todas las ventas de **propiedad residencial gestionadas por agentes inmobiliarios** en Victoria, por subasta o venta privada | misma página |
| Contenido de la PPS | Características clave de la propiedad y de cada venta comparable: tipo de edificio, dormitorios, baños, plazas de aparcamiento, superficie interior y superficie de terreno | misma página |
| Visibilidad de la PPS | Debe mostrarse o enlazarse en la **primera parte visible** del anuncio principal en línea, **inmediatamente junto al precio anunciado**. La cartelería con datos de la propiedad necesita una dirección web o QR a la PPS | misma página |
| Ventas fuera de mercado | No exigen anunciar un precio de reserva, pero el agente **debe preparar la PPS, entregarla en las inspecciones o a petición, y publicar el precio de venta en línea** en los 7 días siguientes a que la venta sea incondicional | misma página |
| Precio de reserva | Se aplica a subastas y ventas de **fecha fija** gestionadas por agentes. Debe publicarse al menos 7 días antes. Un cambio reinicia el plazo. La página dice que una oferta por invitación con fecha y hora fijas **"podría constituir"** una venta de fecha fija, sin cerrarlo | misma página |
| Precio vendido | La PPS actualizada con el precio de venta debe mantenerse en línea **al menos 18 meses** | misma página |
| Exenciones de privacidad | Solo por violencia familiar o personal que afecte al vendedor o comprador. **Una preferencia general de confidencialidad no basta.** Mientras hay una exención concedida o pendiente, publicar el precio es un delito | misma página |
| Publicidad de precios | Un precio único o un rango; el precio anunciado debe ser justo y razonable y reflejar el valor de mercado | [Advertising and representations](https://www.consumer.vic.gov.au/licensing-and-registration/estate-agents/running-your-business/advertising-and-representations) |
| Rango y calificativos | Otras páginas de CAV indican un rango máximo del 10% y que no deben usarse palabras o símbolos que califiquen el precio, con sanciones de 240 unidades de penalización. **No lo leí en la página original, solo en un resumen de búsqueda: hay que confirmarlo** | [Underquoting information](https://www.consumer.vic.gov.au/licensing-and-registration/estate-agents/running-your-business/underquoting-information-for-real-estate-agents) |

**Lo que las páginas no tratan.** Las páginas de CAV que leí **no abordan** los anuncios sin precio, las expresiones de interés (EOI), el "contact agent", ni el "price on application" como categorías propias. La referencia a "junto al precio anunciado" presupone que hay un precio.

## Preguntas sin resolver para el OIEC o el asesor

1. **Clasificación.** ¿La venta de una vivienda SDA (inversión, normalmente con inquilinos inscritos en SDA) es una venta de "propiedad residencial" a efectos de estas reglas? No se debe asumir que queda excluida.
2. **Quién es "el agente".** ¿SDAHC actúa como agente inmobiliario en estas ventas, o lo hace un tercero con la autorización de venta? ¿Cuál es el papel del titular de la licencia victoriana en cada caso? (Sin entrar en acuerdos comerciales, que quedan fuera del sitio.)
3. **Anuncios sin precio.** Si el anuncio no muestra precio (Expressions of Interest o Contact Agent), ¿dónde y cómo debe mostrarse o enlazarse la PPS? ¿Es admisible anunciar sin precio?
4. **EOI con fecha fija.** Si el proceso de EOI tiene fecha y hora de cierre, ¿es una venta de fecha fija con obligación de precio de reserva publicado 7 días antes?
5. **Rango y calificativos.** Si se usa Price Guide o Asking Price: ¿rango permitido y calificativos prohibidos? ¿Cómo se refleja un campo numérico único?
6. **Contenido y privacidad de la PPS.** La PPS describe la propiedad y las comparables. ¿Debe incluir la dirección completa, con número de casa o unidad? Eso **entra en conflicto con nuestra regla de no publicar nunca el número de casa de una propiedad**, que existe para proteger a los residentes. ¿Hay un tratamiento específico para viviendas con residentes vulnerables? La exención de CAV cubre solo violencia familiar o personal.
7. **Dónde se publica.** ¿Se publica la PPS en el anuncio del agente, en nuestro sitio, o en ambos? ¿Un enlace desde nuestra ficha basta?
8. **Precio vendido y retención.** ¿Dónde debe publicarse el precio de venta y cuánto tiempo (7 días y 18 meses)? ¿Cuenta nuestra ficha en estado Sold como ese lugar? ¿Debemos mantenerla 18 meses o retirarla, y cómo se concilia con la privacidad de los residentes?
9. **Fuera de mercado.** Los listings que se comercializan solo bajo NDA ("off-market") siguen obligados a la PPS y a publicar el precio vendido, según la página. ¿Cómo se concilia con la confidencialidad que ofrecemos a los compradores?
10. **Otros estados.** QLD y NT no se han revisado y también son jurisdicciones licenciadas.

## Qué hace el sistema (y qué no)

- **Compuerta por defecto cerrada.** `src/data/listings/compliance.json` registra, **por modo de precio**, si Victoria está despejada. Todos los valores están en `false`: **no se puede proponer ningún listing victoriano** (ni Asking Price, ni Price Guide, ni EOI, ni Contact Agent) hasta que una persona lo registre tras recibir asesoramiento. Cambiar ese fichero exige PR y revisión de un propietario de código. Hay pruebas, y el preflight muestra el bloqueo.
- **No se sube ningún documento de cumplimiento.** No se implementó una carga automática de la PPS ni de otro documento: hay que confirmar antes los requisitos de privacidad (pregunta 6).
- **No se muestra ni se calcula ningún precio vendido.** Un listing en estado Sold muestra solo la etiqueta Sold.
- **No hay clasificación automática** de si una venta está sujeta a estas reglas.
- Las reglas de otros estados no están en el sistema.

## Cómo desbloquear

1. El asesor responde las preguntas 1 a 9 por escrito.
2. Se registra `reviewedBy`, `reviewedAt` y `adviceReference` en `compliance.json`, y se marca solo el modo de precio autorizado, mediante PR.
3. Se repite el preflight del piloto.

## Determinaciones registradas (por listing)

`compliance.json` admite `victoria.determinations`: una entrada por listing y modo de precio, con `basis` (`internal_determination` o `external_advice`), `recordedBy`, `recordedAt`, `reference` y `statement`, todos obligatorios. **Solo autoriza ese listing y ese modo**; no abre ningún otro listing victoriano. Una `internal_determination` es la posición razonada del negocio y **no es asesoramiento jurídico ni una exención**.

- `lst_454f05d21f` (Rutherford Grove, Contact Agent): determinación interna del 2026-11-05. Se comercializa como inversión SDA arrendada, ya anunciada en realcommercial y sin precio. CAV indica que las reglas de underquoting y la PPS se aplican a la venta residencial y no a la comercial; las obligaciones de la Australian Consumer Law siguen vigentes. **La clasificación legal de la propiedad no ha sido confirmada por un abogado ni por el regulador**: es el riesgo residual, aceptado por el negocio.

## Posición permanente (listings con Contact Agent)

`determinations` admite `listingId: "*"`: una sola posición registrada que cubre todos los listings de un modo de precio. Hoy hay una, para **Contact Agent**, registrada como `internal_determination` el 2026-11-09 por el propietario del código al fusionar el PR que la añade.

- **Clase cubierta.** Ventas de viviendas SDA que SDAHC comercializa a inversores como inversión arrendada que genera ingresos, anunciadas sin precio.
- **Base.** La página de CAV sobre underquoting dice que esas reglas y la PPS se aplican a la venta de **propiedad residencial** y no a la **comercial, rural o industrial**, y que la Australian Consumer Law se aplica a todas. La posición de SDAHC es que un inmueble SDA arrendado vendido a un inversor por sus ingresos es una venta comercial; ya existía un registro así para `lst_454f05d21f`.
- **Lo que NO está establecido.** La clasificación legal no está confirmada por un abogado ni por el regulador. La página no trata los anuncios sin precio ni el "contact agent" y no es clara sobre el alcance del precio vendido y del precio de reserva. **Anunciar en un portal comercial, o aprobar comercialmente el marketing, no prueba ninguna exención.** SDAHC acepta el riesgo residual.
- **Lo que el motor exige a cada listing que la use** (`conditions`): solo Contact Agent (nunca se publica precio, rango ni calificativo), el texto público no puede insinuar un precio ("offers over", "guide", "asking", "reserve", "auction", EOI...), y la propiedad debe ser una vivienda SDA (con categoría de diseño). Una condición desconocida falla cerrada.
- **Lo que no se quita.** Las obligaciones de la ACL (nada falso o engañoso) y cualquier requisito que se aplique si una venta resultara ser residencial. Eliminar la entrada por PR bloquea otra vez todo listing que dependa de ella.
- Asking Price, Price Guide y EOI siguen bloqueados en Victoria. Otros estados no cambian.
