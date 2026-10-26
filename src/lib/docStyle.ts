// ============================================================
// Estilo premium de documentos — FUENTE ÚNICA DE VERDAD
// ------------------------------------------------------------
// Regla permanente de Yadir: TODO documento que genera el sistema
// (informes PDF, boletines por correo, PowerPoint, IPV devuelto y
// Excel exportados) comparte este acabado: diseño limpio estilo
// One UI 9, verde profundo del sistema como base, acentos
// luminosos sutiles (esmeralda, turquesa y un hilo dorado),
// tipografía clara y bordes redondeados generosos.
//
// Los valores replican los tokens del tema de la app
// (client/src/theme.css: --deep, --accent, --turquoise, --gold,
// --text, --dim, --border, --bg) para que un documento impreso o
// enviado se reconozca al instante como parte del mismo sistema.
// El servidor (server/src/actions.ts) no puede importar este
// módulo: allí la misma paleta vive como constantes DOC_* con
// estos mismos valores exactos. Si un día cambia un color, se
// cambia en los dos sitios a la vez.
// ============================================================

export const DOC_STYLE = {
  /** Verde profundo: encabezados, títulos y cifras clave. */
  deep: "#0B3D2E",
  deep2: "#0E5240",
  /** Esmeralda luminosa: acento principal, barras y datos vivos. */
  emerald: "#16A34A",
  accent: "#0E9F6E",
  /** Turquesa luminoso del logo: segundo acento, hilo de luz. */
  turquoise: "#0EA5BD",
  turquoiseBright: "#22B8CF",
  /** Dorado sobrio: hilo fino de cierre y datos destacados. */
  gold: "#C9A227",
  goldSoft: "#F5D67B",
  /** Tinta y textos secundarios sobre papel. */
  ink: "#14231C",
  text: "#122019",
  dim: "#57705F",
  /** Superficies de papel y tarjetas. */
  bg: "#F2F7F4",
  card: "#FFFFFF",
  cardAlt: "#E9F2EC",
  border: "#DDE8E1",
  /** Tonos claros legibles SOBRE el verde profundo. */
  onDeep: "#FFFFFF",
  onDeepSoft: "#BFE3CE",
  onDeepDim: "#8FC7A5",
  /** Avisos (mismos criterios que la app). */
  danger: "#B3261E",
  warnBg: "#FFF4D6",
  warnText: "#7A5B00",
  /** Nombre oficial del sistema en todos los documentos. */
  systemName: "Queen SDA - Sistema de Automatización de Datos V2.0",
  business: "La Reina Restaurante - Bar",
  /** Tipografía de documentos: sans clara estilo One UI; la serif
   *  queda solo para el nombre del restaurante en el menú. */
  fontSans: "Calibri, 'Segoe UI', Arial, sans-serif",
  fontDisplay: "Georgia, 'Times New Roman', serif",
} as const;

/** Franja luminosa premium bajo un encabezado: esmeralda gruesa,
 *  turquesa fina y un hilo dorado. En PDF se dibuja con rects; en
 *  HTML/Excel se usan los mismos tres colores en ese orden. */
export const DOC_ACCENT_STRIP = [
  { color: DOC_STYLE.emerald, height: 3 },
  { color: DOC_STYLE.turquoise, height: 1.6 },
  { color: DOC_STYLE.gold, height: 1 },
] as const;

/** Fondo aurora de los documentos (pedido del dueño, 2026-10-23): la
 *  MISMA receta que pinta la app (theme.css, --ambient-bg, en claro)
 *  llevada a todo lo que el sistema genera — boletines por correo,
 *  PDF exportados y presentaciones — para que un documento se
 *  reconozca como parte del mismo sistema también por su fondo:
 *  manchas suaves de turquesa y esmeralda con toques azules y
 *  violetas sobre el papel #F2F7F4.
 *  - `css`: valor de background-image para documentos HTML/correo
 *    (sintaxis rgba con comas, la más compatible con clientes de
 *    correo); el color de respaldo sigue siendo DOC_STYLE.bg.
 *  - `cssDark`: la versión profunda para el modo oscuro del correo.
 *  - `blobs`: las mismas manchas para el PDF, donde no hay CSS: cada
 *    mancha se dibuja como un degradado radial que nace en su color
 *    ya fundido sobre el papel (`color`, calculado con su alfa de la
 *    receta CSS) y se apaga hasta el papel. cx/cyTop van en fracción
 *    del ancho/alto de página (cyTop desde arriba, puede salir de la
 *    hoja) y r en fracción del ancho. El servidor lleva la misma
 *    tabla como DOC_AURORA_S: si cambia aquí, cambia allí. */
export const DOC_AURORA = {
  paper: "#F2F7F4",
  css: "radial-gradient(58rem 34rem at 88% -10%, rgba(14,165,189,0.17), rgba(14,165,189,0) 62%), radial-gradient(46rem 30rem at -12% 4%, rgba(14,159,110,0.16), rgba(14,159,110,0) 60%), radial-gradient(48rem 30rem at 54% -12%, rgba(59,130,246,0.10), rgba(59,130,246,0) 60%), radial-gradient(52rem 36rem at 110% 58%, rgba(14,159,110,0.10), rgba(14,159,110,0) 64%), radial-gradient(44rem 32rem at -10% 98%, rgba(14,165,189,0.13), rgba(14,165,189,0) 62%), radial-gradient(44rem 32rem at 106% 106%, rgba(139,92,246,0.11), rgba(139,92,246,0) 62%), linear-gradient(168deg, #EDF7F0 0%, #F2F7F4 44%, #E8F3F5 100%)",
  cssDark: "radial-gradient(58rem 34rem at 88% -10%, rgba(45,212,238,0.08), rgba(45,212,238,0) 62%), radial-gradient(46rem 30rem at -12% 4%, rgba(34,197,94,0.09), rgba(34,197,94,0) 60%), radial-gradient(48rem 30rem at 54% -12%, rgba(96,165,250,0.055), rgba(96,165,250,0) 60%), radial-gradient(52rem 36rem at 110% 58%, rgba(34,197,94,0.05), rgba(34,197,94,0) 64%), radial-gradient(44rem 32rem at -10% 98%, rgba(45,212,238,0.06), rgba(45,212,238,0) 62%), radial-gradient(44rem 32rem at 106% 106%, rgba(167,139,250,0.06), rgba(167,139,250,0) 62%), linear-gradient(168deg, #0C1813 0%, #0A1411 46%, #0A1518 100%)",
  blobs: [
    { cx: 0.88, cyTop: -0.1, r: 0.98, color: "#CBE9EB" },
    { cx: -0.12, cyTop: 0.04, r: 0.78, color: "#CDE9DF" },
    { cx: 0.54, cyTop: -0.12, r: 0.82, color: "#D9E5F3" },
    { cx: 1.1, cyTop: 0.58, r: 0.88, color: "#DBEEE7" },
    { cx: -0.1, cyTop: 0.98, r: 0.75, color: "#D4ECEC" },
    { cx: 1.06, cyTop: 1.06, r: 0.75, color: "#E7E6F4" },
  ],
} as const;
