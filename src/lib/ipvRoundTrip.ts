export type IpvAddition = {
  section: "RH" | "Coctelería" | "Pizzería" | "Entradas y mesas" | "Almacén" | "Gastos" | "Cuentas pagadas";
  category: string;
  concept: string;
  quantity: number | null;
  amount: number | null;
  detail: string;
};

export type IpvProductBarcode = {
  productKey: string;
  name: string;
  dept: string;
  um: string;
  barcode: string;
};

export type IpvNameCorrection = { fromName: string; toName: string; dept: string };

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
import { DOC_STYLE } from "./docStyle";
const SYSTEM_NAME = DOC_STYLE.systemName;

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function unzipAll(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un XLSX válido.");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("El XLSX tiene una estructura ZIP no compatible.");
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) { files.set(name, new Uint8Array()); continue; }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + size > bytes.length) throw new Error("El XLSX quedó truncado dentro de una de sus entradas.");
    const compressed = bytes.subarray(start, start + size);
    let content: Uint8Array;
    if (method === 0) content = compressed.slice();
    else if (method === 8) {
      const stream = new Blob([compressed as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`El XLSX usa compresión no compatible (${method}).`);
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) throw new Error(`El XLSX tiene una entrada dañada (${name}).`);
    files.set(name, content);
  }
  return files;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zipAll(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const compressed = name.endsWith("/") ? data : await deflate(data);
    const method = name.endsWith("/") ? 0 : 8;
    const crc = crc32(data);
    const local = join([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, compressed]);
    locals.push(local);
    centrals.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    offset += local.length;
  }
  const central = join(centrals);
  return join([...locals, central, u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
}

const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
function xml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function colLetters(col: number): string {
  let value = col;
  let result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
function colNumber(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let out = 0;
  for (const letter of letters) out = out * 26 + letter.charCodeAt(0) - 64;
  return out;
}
function xmlDoc(source: string): XMLDocument {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Una sección del IPV no contiene XML válido.");
  return doc;
}
function directChildren(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === tagName);
}
function firstDirect(parent: Element, tagName: string): Element | null { return directChildren(parent, tagName)[0] ?? null; }
function rowElements(doc: XMLDocument): Element[] {
  const sheetData = doc.getElementsByTagNameNS(MAIN_NS, "sheetData")[0];
  return sheetData ? directChildren(sheetData, "row") : [];
}
function cellsOf(row: Element): Element[] { return directChildren(row, "c"); }
function findCell(row: Element, col: number): Element | undefined { return cellsOf(row).find((item) => colNumber(item.getAttribute("r") ?? "") === col); }
function readCell(cell: Element | undefined, shared: string[]): string {
  if (!cell) return "";
  if (cell.getAttribute("t") === "inlineStr") return Array.from(cell.getElementsByTagNameNS(MAIN_NS, "t")).map((t) => t.textContent ?? "").join("").trim();
  const raw = firstDirect(cell, "v")?.textContent ?? "";
  if (cell.getAttribute("t") === "s") return shared[Number(raw)]?.trim() ?? "";
  return raw.trim();
}
function numberCell(row: Element, col: number, shared: string[]): number {
  const value = Number(readCell(findCell(row, col), shared).replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}
function rowHas(row: Element, shared: string[], needle: string): boolean {
  const key = norm(needle);
  return cellsOf(row).some((cell) => norm(readCell(cell, shared)).includes(key));
}
function makeCell(doc: XMLDocument, row: Element, col: number): Element {
  const ref = `${colLetters(col)}${row.getAttribute("r") ?? "1"}`;
  const existing = findCell(row, col);
  if (existing) return existing;
  const next = cellsOf(row).find((cell) => colNumber(cell.getAttribute("r") ?? "") > col);
  const created = doc.createElementNS(MAIN_NS, "c");
  created.setAttribute("r", ref);
  row.insertBefore(created, next ?? null);
  return created;
}
function setCell(doc: XMLDocument, row: Element, col: number, value: string | number, formula?: string, styleFrom?: Element): void {
  const cell = makeCell(doc, row, col);
  const style = cell.getAttribute("s") || styleFrom?.getAttribute("s") || "";
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  if (style) cell.setAttribute("s", style);
  if (formula) {
    cell.removeAttribute("t");
    const f = doc.createElementNS(MAIN_NS, "f");
    f.textContent = formula;
    const v = doc.createElementNS(MAIN_NS, "v");
    v.textContent = String(typeof value === "number" && Number.isFinite(value) ? value : 0);
    cell.append(f, v);
  } else if (typeof value === "number") {
    cell.setAttribute("t", "n");
    const v = doc.createElementNS(MAIN_NS, "v");
    v.textContent = String(Number.isFinite(value) ? value : 0);
    cell.appendChild(v);
  } else {
    cell.setAttribute("t", "inlineStr");
    const is = doc.createElementNS(MAIN_NS, "is");
    const t = doc.createElementNS(MAIN_NS, "t");
    t.textContent = value;
    is.appendChild(t);
    cell.appendChild(is);
  }
}
function setFormulaCell(doc: XMLDocument, row: Element, col: number, formula: string, cached: number): void {
  setCell(doc, row, col, cached, formula, findCell(row, col));
}
function updateDimension(doc: XMLDocument): void {
  const rows = rowElements(doc);
  const maxRow = Math.max(1, ...rows.map((row) => Number(row.getAttribute("r") ?? 1)));
  const maxCol = Math.max(1, ...rows.flatMap((row) => cellsOf(row).map((cell) => colNumber(cell.getAttribute("r") ?? "A1"))));
  const dimension = doc.getElementsByTagNameNS(MAIN_NS, "dimension")[0];
  if (dimension) dimension.setAttribute("ref", `A1:${colLetters(maxCol)}${maxRow}`);
}
function cloneBlankRow(template: Element, newRowNumber: number): Element {
  const clone = template.cloneNode(true) as Element;
  const oldRowNumber = Number(template.getAttribute("r") ?? newRowNumber);
  clone.setAttribute("r", String(newRowNumber));
  for (const cell of cellsOf(clone)) {
    const oldRef = cell.getAttribute("r") ?? `A${oldRowNumber}`;
    cell.setAttribute("r", `${colLetters(colNumber(oldRef))}${newRowNumber}`);
    const formula = firstDirect(cell, "f");
    if (formula?.textContent) formula.textContent = formula.textContent.replace(new RegExp(`(?<=[A-Z])${oldRowNumber}(?!\\d)`, "g"), String(newRowNumber));
    if (!formula) while (cell.firstChild) cell.removeChild(cell.firstChild);
    else {
      const value = firstDirect(cell, "v");
      if (value) value.textContent = "";
    }
  }
  return clone;
}
function shiftRangeRows(value: string, fromRow: number): string {
  return value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (all, col: string, rawRow: string) => {
    const row = Number(rawRow);
    return row >= fromRow ? `${col}${row + 1}` : all;
  });
}
function insertRowBefore(doc: XMLDocument, beforeRow: number, template: Element): Element {
  const rows = rowElements(doc).sort((a, b) => Number(b.getAttribute("r") ?? 0) - Number(a.getAttribute("r") ?? 0));
  for (const row of rows) {
    const current = Number(row.getAttribute("r") ?? 0);
    if (current < beforeRow) continue;
    row.setAttribute("r", String(current + 1));
    for (const cell of cellsOf(row)) {
      const ref = cell.getAttribute("r") ?? "A1";
      cell.setAttribute("r", `${colLetters(colNumber(ref))}${current + 1}`);
      const formula = firstDirect(cell, "f");
      if (formula?.textContent) formula.textContent = shiftRangeRows(formula.textContent, beforeRow);
    }
  }
  for (const tag of ["mergeCell", "autoFilter", "conditionalFormatting", "dataValidation"]) {
    for (const node of Array.from(doc.getElementsByTagNameNS(MAIN_NS, tag))) {
      for (const attr of ["ref", "sqref"]) {
        const value = node.getAttribute(attr);
        if (value) node.setAttribute(attr, shiftRangeRows(value, beforeRow));
      }
    }
  }
  const sheetData = doc.getElementsByTagNameNS(MAIN_NS, "sheetData")[0];
  if (!sheetData) throw new Error("La hoja no contiene una tabla de filas compatible.");
  const before = rowElements(doc).find((row) => Number(row.getAttribute("r") ?? 0) === beforeRow + 1);
  const created = cloneBlankRow(template, beforeRow);
  sheetData.insertBefore(created, before ?? null);
  updateDimension(doc);
  return created;
}
function getOrCreateDataRow(doc: XMLDocument, shared: string[], headerRow: number, totalRow: number, descriptionCol: number): { row: Element; totalRow: number } {
  const rows = rowElements(doc);
  const blank = rows.find((row) => {
    const r = Number(row.getAttribute("r") ?? 0);
    return r > headerRow && r < totalRow && !readCell(findCell(row, descriptionCol), shared);
  });
  if (blank) return { row: blank, totalRow };
  const template = rows.find((row) => Number(row.getAttribute("r") ?? 0) === totalRow - 1)
    ?? rows.find((row) => Number(row.getAttribute("r") ?? 0) === headerRow + 1);
  if (!template) throw new Error("No pude ampliar una tabla del IPV porque no encontré una fila modelo.");
  return { row: insertRowBefore(doc, totalRow, template), totalRow: totalRow + 1 };
}
function rowAt(doc: XMLDocument, rowNumberValue: number): Element | undefined { return rowElements(doc).find((row) => Number(row.getAttribute("r") ?? 0) === rowNumberValue); }
function sumColumn(doc: XMLDocument, shared: string[], col: number, start: number, end: number): number {
  let total = 0;
  for (const row of rowElements(doc)) {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r >= start && r <= end) total += numberCell(row, col, shared);
  }
  return total;
}

/** Reubica una fila completa sin tocar sus valores. Las referencias y las
 * fórmulas que apuntan a la propia fila se ajustan a la nueva posición. */
function moveRowTo(row: Element, newRowNumber: number): void {
  const oldRowNumber = Number(row.getAttribute("r") ?? newRowNumber);
  row.setAttribute("r", String(newRowNumber));
  for (const cell of cellsOf(row)) {
    const oldRef = cell.getAttribute("r") ?? `A${oldRowNumber}`;
    cell.setAttribute("r", `${colLetters(colNumber(oldRef))}${newRowNumber}`);
    const formula = firstDirect(cell, "f");
    if (formula?.textContent && oldRowNumber !== newRowNumber) {
      formula.textContent = formula.textContent.replace(
        new RegExp(`(\\$?[A-Z]{1,3}\\$?)${oldRowNumber}(?!\\d)`, "g"),
        (_all, column: string) => `${column}${newRowNumber}`,
      );
    }
  }
}

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let winner: string | undefined;
  let winnerCount = 0;
  for (const [value, count] of counts) {
    if (count > winnerCount) { winner = value; winnerCount = count; }
  }
  return winner;
}

/** Detecta desvíos de formato en las filas de una tabla y restablece, por
 * columna, el estilo dominante de la propia plantilla. Así un texto que fue
 * centrado o alineado a la derecha por accidente vuelve a la ubicación visual
 * prevista sin reescribir el contenido. Después ordena alfabéticamente las
 * filas completas por su campo principal; los huecos permanecen al final. */
function normalizeTableLayout(
  sheet: SheetPart,
  shared: string[],
  headerRow: number,
  totalRow: number,
  labelCol: number,
  numberCol?: number,
): void {
  const rows = rowElements(sheet.doc)
    .filter((row) => {
      const r = Number(row.getAttribute("r") ?? 0);
      return r > headerRow && r < totalRow;
    })
    .sort((a, b) => Number(a.getAttribute("r") ?? 0) - Number(b.getAttribute("r") ?? 0));
  if (rows.length < 1) return;

  const maxCol = Math.max(1, ...rows.flatMap((row) => cellsOf(row).map((cell) => colNumber(cell.getAttribute("r") ?? "A1"))));
  const canonicalStyles = new Map<number, string>();
  for (let col = 1; col <= maxCol; col += 1) {
    const styles = rows.flatMap((row) => {
      const cell = findCell(row, col);
      return cell ? [cell.getAttribute("s") ?? ""] : [];
    });
    const style = mostFrequent(styles);
    if (style !== undefined) canonicalStyles.set(col, style);
  }
  const canonicalRowStyle = mostFrequent(rows.map((row) => row.getAttribute("s") ?? ""));

  const originalPosition = new Map(rows.map((row, index) => [row, index]));
  const ordered = [...rows].sort((a, b) => {
    const aLabel = readCell(findCell(a, labelCol), shared).trim();
    const bLabel = readCell(findCell(b, labelCol), shared).trim();
    if (!aLabel && !bLabel) return (originalPosition.get(a) ?? 0) - (originalPosition.get(b) ?? 0);
    if (!aLabel) return 1;
    if (!bLabel) return -1;
    const compared = aLabel.localeCompare(bLabel, "es", { sensitivity: "base", numeric: true, ignorePunctuation: true });
    return compared || (originalPosition.get(a) ?? 0) - (originalPosition.get(b) ?? 0);
  });
  const targetRows = rows.map((row) => Number(row.getAttribute("r") ?? 0));
  const sheetData = sheet.doc.getElementsByTagNameNS(MAIN_NS, "sheetData")[0];
  const total = rowAt(sheet.doc, totalRow);
  if (!sheetData) return;

  ordered.forEach((row, index) => {
    const targetRow = targetRows[index];
    if (targetRow === undefined) return;
    moveRowTo(row, targetRow);
    if (canonicalRowStyle !== undefined) canonicalRowStyle ? row.setAttribute("s", canonicalRowStyle) : row.removeAttribute("s");
    for (const cell of cellsOf(row)) {
      const style = canonicalStyles.get(colNumber(cell.getAttribute("r") ?? "A1"));
      if (style === undefined) continue;
      style ? cell.setAttribute("s", style) : cell.removeAttribute("s");
    }
    if (numberCol && readCell(findCell(row, labelCol), shared).trim()) {
      const preceding = ordered.slice(0, index).filter((item) => readCell(findCell(item, labelCol), shared).trim()).length;
      setCell(sheet.doc, row, numberCol, preceding + 1, undefined, findCell(row, numberCol));
    }
    sheetData.insertBefore(row, total ?? null);
  });
  updateDimension(sheet.doc);
}

type SheetPart = { name: string; key: string; doc: XMLDocument };
function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target.replace(/^\.\//, "")}`.split("/");
  const out: string[] = [];
  for (const part of parts) part === ".." ? out.pop() : part !== "." && out.push(part);
  return out.join("/");
}
function loadShared(files: Map<string, Uint8Array>): string[] {
  const source = files.get("xl/sharedStrings.xml");
  if (!source) return [];
  const doc = xmlDoc(dec.decode(source));
  return Array.from(doc.getElementsByTagNameNS(MAIN_NS, "si")).map((si) => Array.from(si.getElementsByTagNameNS(MAIN_NS, "t")).map((t) => t.textContent ?? "").join(""));
}
function loadSheets(files: Map<string, Uint8Array>, workbook: XMLDocument, rels: XMLDocument): SheetPart[] {
  const targets = new Map(Array.from(rels.documentElement.children).filter((el) => el.localName === "Relationship").map((el) => [el.getAttribute("Id") ?? "", el.getAttribute("Target") ?? ""]));
  return Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet")).flatMap((sheet) => {
    const rid = sheet.getAttributeNS(REL_NS, "id") ?? sheet.getAttribute("r:id") ?? "";
    const target = targets.get(rid);
    if (!target) return [];
    const key = resolveTarget(target);
    const bytes = files.get(key);
    return bytes ? [{ name: sheet.getAttribute("name") ?? "", key, doc: xmlDoc(dec.decode(bytes)) }] : [];
  });
}
function findSheet(sheets: SheetPart[], ...names: string[]): SheetPart | undefined {
  const keys = names.map(norm);
  return sheets.find((sheet) => keys.includes(norm(sheet.name))) ?? sheets.find((sheet) => keys.some((key) => norm(sheet.name).includes(key)));
}
function findRowNumber(sheet: SheetPart, shared: string[], needle: string, min = 1): number {
  return Number(rowElements(sheet.doc).find((row) => Number(row.getAttribute("r") ?? 0) >= min && rowHas(row, shared, needle))?.getAttribute("r") ?? -1);
}
function hasExactLine(sheet: SheetPart, shared: string[], start: number, end: number, descriptionCol: number, concept: string, amountCol: number, amount: number | null): boolean {
  const conceptKey = norm(concept);
  return rowElements(sheet.doc).some((row) => {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r < start || r > end || norm(readCell(findCell(row, descriptionCol), shared)) !== conceptKey) return false;
    return amount == null || Math.abs(numberCell(row, amountCol, shared) - amount) < 0.01;
  });
}

function addDepartmentSale(sheet: SheetPart, shared: string[], item: IpvAddition): void {
  const headerRow = findRowNumber(sheet, shared, "Precio de venta", 1);
  let totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) throw new Error(`No encontré la tabla de ventas original en «${sheet.name}».`);
  const amount = item.amount ?? 0;
  if (hasExactLine(sheet, shared, headerRow + 1, totalRow - 1, 3, item.concept, 14, amount)) return;
  const slot = getOrCreateDataRow(sheet.doc, shared, headerRow, totalRow, 3);
  totalRow = slot.totalRow;
  const row = slot.row;
  const r = Number(row.getAttribute("r") ?? 0);
  const no = Math.max(0, ...rowElements(sheet.doc).filter((x) => {
    const n = Number(x.getAttribute("r") ?? 0);
    return n > headerRow && n < totalRow;
  }).map((x) => numberCell(x, 1, shared))) + 1;
  setCell(sheet.doc, row, 1, no, undefined, findCell(row, 1));
  setCell(sheet.doc, row, 3, item.concept, undefined, findCell(row, 3));
  setCell(sheet.doc, row, 4, "U", undefined, findCell(row, 4));
  setCell(sheet.doc, row, 5, 1, undefined, findCell(row, 5));
  setCell(sheet.doc, row, 6, 0, undefined, findCell(row, 6));
  setFormulaCell(sheet.doc, row, 7, `E${r}+F${r}`, 1);
  setCell(sheet.doc, row, 8, 0, undefined, findCell(row, 8));
  setCell(sheet.doc, row, 9, 0, undefined, findCell(row, 9));
  setFormulaCell(sheet.doc, row, 10, `G${r}-H${r}-I${r}`, 1);
  setFormulaCell(sheet.doc, row, 11, `J${r}-L${r}`, 1);
  setCell(sheet.doc, row, 12, 0, undefined, findCell(row, 12));
  setCell(sheet.doc, row, 13, amount, undefined, findCell(row, 13));
  setFormulaCell(sheet.doc, row, 14, `K${r}*M${r}`, amount);
  setCell(sheet.doc, row, 15, 0, undefined, findCell(row, 15));
  setFormulaCell(sheet.doc, row, 16, `K${r}*O${r}`, 0);
  setFormulaCell(sheet.doc, row, 17, `N${r}-P${r}`, amount);
  const total = rowAt(sheet.doc, totalRow);
  if (total) {
    for (const col of [14, 16, 17]) setFormulaCell(sheet.doc, total, col, `SUM(${colLetters(col)}${headerRow + 1}:${colLetters(col)}${totalRow - 1})`, sumColumn(sheet.doc, shared, col, headerRow + 1, totalRow - 1));
  }
}

function expenseSheetName(detail: string): string {
  const key = norm(detail);
  // Los gastos de bebidas alcohólicas y no alcohólicas comparten una sola
  // tabla: la de «Bebidas alcohólicas». El departamento exacto queda en la
  // columna Destino/Observación para que SDA pueda reconstruirlo al importar.
  if (key.includes("bebidas no") || key.includes("bebidas") || key.includes("barra")) return "Bebidas alcohólicas";
  if (key.includes("pizza")) return "Pizzas";
  if (key.includes("cantina") || key.includes("coctel")) return "Cantina";
  return "Elaboración";
}
function addExpense(sheet: SheetPart, shared: string[], item: IpvAddition): void {
  const titleRow = findRowNumber(sheet, shared, "GASTOS", 1) > 0
    ? findRowNumber(sheet, shared, "GASTOS", 1)
    : findRowNumber(sheet, shared, "ENTRADA DE PRODUCTOS", 1);
  const headerRow = findRowNumber(sheet, shared, "Precio de compra", Math.max(1, titleRow));
  let totalRow = findRowNumber(sheet, shared, "Total gastos", Math.max(1, headerRow + 1));
  if (totalRow < 0) totalRow = findRowNumber(sheet, shared, "Total entradas", Math.max(1, headerRow + 1));
  if (titleRow < 0 || headerRow < 0 || totalRow < 0) throw new Error(`No encontré la tabla «GASTOS» original en «${sheet.name}».`);
  const title = rowAt(sheet.doc, titleRow);
  if (title) setCell(sheet.doc, title, 1, "GASTOS (detalle del día)", undefined, findCell(title, 1));
  const originalTotal = rowAt(sheet.doc, totalRow);
  if (originalTotal) setCell(sheet.doc, originalTotal, 2, "Total gastos", undefined, findCell(originalTotal, 2));
  const amount = item.amount ?? 0;
  if (hasExactLine(sheet, shared, headerRow + 1, totalRow - 1, 2, item.concept, 6, amount)) return;
  const slot = getOrCreateDataRow(sheet.doc, shared, headerRow, totalRow, 2);
  totalRow = slot.totalRow;
  const row = slot.row;
  const r = Number(row.getAttribute("r") ?? 0);
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const no = Math.max(0, ...rowElements(sheet.doc).filter((x) => {
    const n = Number(x.getAttribute("r") ?? 0);
    return n > headerRow && n < totalRow;
  }).map((x) => numberCell(x, 1, shared))) + 1;
  setCell(sheet.doc, row, 1, no, undefined, findCell(row, 1));
  setCell(sheet.doc, row, 2, item.concept, undefined, findCell(row, 2));
  setCell(sheet.doc, row, 3, "U", undefined, findCell(row, 3));
  setCell(sheet.doc, row, 4, quantity, undefined, findCell(row, 4));
  setCell(sheet.doc, row, 5, amount / quantity, undefined, findCell(row, 5));
  setFormulaCell(sheet.doc, row, 6, `D${r}*E${r}`, amount);
  setCell(sheet.doc, row, 7, item.category, undefined, findCell(row, 7));
  setCell(sheet.doc, row, 8, item.detail, undefined, findCell(row, 8));
  const total = rowAt(sheet.doc, totalRow);
  if (total) setFormulaCell(sheet.doc, total, 6, `SUM(F${headerRow + 1}:F${totalRow - 1})`, sumColumn(sheet.doc, shared, 6, headerRow + 1, totalRow - 1));
}

function addEntryTablesSale(sheet: SheetPart, shared: string[], item: IpvAddition): void {
  const headerRow = findRowNumber(sheet, shared, "Descripción", 1);
  let totalRow = findRowNumber(sheet, shared, "TOTAL VENTAS", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) throw new Error("No encontré la tabla original de «Entrada y mesas».");
  const amount = item.amount ?? 0;
  if (hasExactLine(sheet, shared, headerRow + 1, totalRow - 1, 3, item.concept, 6, amount)) return;
  const slot = getOrCreateDataRow(sheet.doc, shared, headerRow, totalRow, 3);
  totalRow = slot.totalRow;
  const row = slot.row;
  const r = Number(row.getAttribute("r") ?? 0);
  const no = Math.max(0, ...rowElements(sheet.doc).filter((x) => {
    const n = Number(x.getAttribute("r") ?? 0);
    return n > headerRow && n < totalRow;
  }).map((x) => numberCell(x, 1, shared))) + 1;
  setCell(sheet.doc, row, 1, no, undefined, findCell(row, 1));
  setCell(sheet.doc, row, 3, item.concept, undefined, findCell(row, 3));
  setCell(sheet.doc, row, 4, 1, undefined, findCell(row, 4));
  setCell(sheet.doc, row, 5, amount, undefined, findCell(row, 5));
  setFormulaCell(sheet.doc, row, 6, `D${r}*E${r}`, amount);
  const total = rowAt(sheet.doc, totalRow);
  if (total) setFormulaCell(sheet.doc, total, 6, `SUM(F${headerRow + 1}:F${totalRow - 1})`, sumColumn(sheet.doc, shared, 6, headerRow + 1, totalRow - 1));
}

function addWarehouse(sheet: SheetPart, shared: string[], item: IpvAddition): void {
  const headerRow = findRowNumber(sheet, shared, "Saldo inicial", 1);
  let totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) throw new Error("No encontré la tabla original de «Almacén».");
  const quantity = item.quantity ?? 0;
  if (hasExactLine(sheet, shared, headerRow + 1, totalRow - 1, 2, item.concept, 9, quantity)) return;
  const slot = getOrCreateDataRow(sheet.doc, shared, headerRow, totalRow, 2);
  totalRow = slot.totalRow;
  const row = slot.row;
  const r = Number(row.getAttribute("r") ?? 0);
  const no = Math.max(0, ...rowElements(sheet.doc).filter((x) => {
    const n = Number(x.getAttribute("r") ?? 0);
    return n > headerRow && n < totalRow;
  }).map((x) => numberCell(x, 1, shared))) + 1;
  setCell(sheet.doc, row, 1, no, undefined, findCell(row, 1));
  setCell(sheet.doc, row, 2, item.concept, undefined, findCell(row, 2));
  setCell(sheet.doc, row, 3, "U", undefined, findCell(row, 3));
  setCell(sheet.doc, row, 4, Math.max(0, quantity), undefined, findCell(row, 4));
  setCell(sheet.doc, row, 5, 0, undefined, findCell(row, 5));
  setFormulaCell(sheet.doc, row, 6, `D${r}+E${r}`, Math.max(0, quantity));
  setCell(sheet.doc, row, 7, 0, undefined, findCell(row, 7));
  setCell(sheet.doc, row, 8, Math.max(0, -quantity), undefined, findCell(row, 8));
  setFormulaCell(sheet.doc, row, 9, `F${r}-G${r}-H${r}`, quantity);
  setCell(sheet.doc, row, 10, 0, undefined, findCell(row, 10));
  setFormulaCell(sheet.doc, row, 11, `I${r}*J${r}`, 0);
  setCell(sheet.doc, row, 12, item.detail, undefined, findCell(row, 12));
  const total = rowAt(sheet.doc, totalRow);
  if (total) {
    setFormulaCell(sheet.doc, total, 9, `SUM(I${headerRow + 1}:I${totalRow - 1})`, sumColumn(sheet.doc, shared, 9, headerRow + 1, totalRow - 1));
    setFormulaCell(sheet.doc, total, 11, `SUM(K${headerRow + 1}:K${totalRow - 1})`, sumColumn(sheet.doc, shared, 11, headerRow + 1, totalRow - 1));
  }
}

function addRh(sheet: SheetPart, shared: string[], item: IpvAddition): void {
  const headerRow = findRowNumber(sheet, shared, "Nombre y apellidos", 1);
  let totalRow = findRowNumber(sheet, shared, "TOTAL A PAGAR", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) throw new Error("No encontré la tabla original de RH.");
  if (rowElements(sheet.doc).some((row) => norm(readCell(findCell(row, 2), shared)) === norm(item.concept))) return;
  const slot = getOrCreateDataRow(sheet.doc, shared, headerRow + 1, totalRow, 2);
  totalRow = slot.totalRow;
  const row = slot.row;
  const no = Math.max(0, ...rowElements(sheet.doc).filter((x) => {
    const n = Number(x.getAttribute("r") ?? 0);
    return n > headerRow && n < totalRow;
  }).map((x) => numberCell(x, 1, shared))) + 1;
  const details = item.detail.split("·").map((part) => part.trim());
  setCell(sheet.doc, row, 1, no, undefined, findCell(row, 1));
  setCell(sheet.doc, row, 2, item.concept, undefined, findCell(row, 2));
  setCell(sheet.doc, row, 3, item.category, undefined, findCell(row, 3));
  setCell(sheet.doc, row, 4, details.find((part) => norm(part).startsWith("ci:"))?.replace(/^CI:\s*/i, "") ?? "", undefined, findCell(row, 4));
  setCell(sheet.doc, row, 5, details.find((part) => norm(part).startsWith("cuenta:"))?.replace(/^Cuenta:\s*/i, "") ?? "", undefined, findCell(row, 5));
  setCell(sheet.doc, row, 6, details.find((part) => norm(part).startsWith("movil:"))?.replace(/^Móvil:\s*/i, "") ?? "", undefined, findCell(row, 6));
}

/** Revisa las tablas que SDA puede completar. La búsqueda por encabezados
 * soporta que el usuario haya movido filas dentro de la plantilla: se toma la
 * estructura real del libro, se corrige el estilo por columna y se ordenan las
 * filas completas sin cambiar ningún valor de negocio. */
function applyOfficialProductNames(sheets: SheetPart[], shared: string[], corrections: IpvNameCorrection[]): void {
  const sectionMatches = (sheetName: string, dept: string) => {
    const sheet = norm(sheetName);
    const department = norm(dept);
    if (sheet.includes(department) || department.includes(sheet)) return true;
    if ((sheet.includes("cantina") || sheet.includes("coctel")) && (department.includes("cantina") || department.includes("coctel"))) return true;
    if ((sheet.includes("pizza") || sheet.includes("pizzeria")) && (department.includes("pizza") || department.includes("pizzeria"))) return true;
    return false;
  };
  for (const correction of corrections) {
    // Mayúsculas y acentos también son una corrección válida: se localiza la
    // fila de forma tolerante, pero se escribe exactamente el nombre elegido.
    if (!correction.fromName.trim() || !correction.toName.trim() || correction.fromName.trim() === correction.toName.trim()) continue;
    for (const sheet of sheets) {
      if (!sectionMatches(sheet.name, correction.dept)) continue;
      for (const row of rowElements(sheet.doc)) {
        for (const cell of cellsOf(row)) {
          if (norm(readCell(cell, shared)) !== norm(correction.fromName)) continue;
          setCell(sheet.doc, row, colNumber(cell.getAttribute("r") ?? ""), correction.toName, undefined, cell);
        }
      }
    }
  }
}

function normalizeWritableTables(sheets: SheetPart[], shared: string[]): void {
  for (const sheet of sheets) {
    const name = norm(sheet.name);
    if (name === norm("RH")) {
      const header = findRowNumber(sheet, shared, "Nombre y apellidos", 1);
      const total = findRowNumber(sheet, shared, "TOTAL A PAGAR", Math.max(1, header + 1));
      if (header > 0 && total > header) normalizeTableLayout(sheet, shared, header, total, 2, 1);
      continue;
    }
    if (name.includes(norm("Almacén"))) {
      const header = findRowNumber(sheet, shared, "Saldo inicial", 1);
      const total = findRowNumber(sheet, shared, "TOTAL", Math.max(1, header + 1));
      if (header > 0 && total > header) normalizeTableLayout(sheet, shared, header, total, 2, 1);
      continue;
    }
    if (name.includes(norm("Entrada y mesas"))) {
      const header = findRowNumber(sheet, shared, "Descripción", 1);
      const total = findRowNumber(sheet, shared, "TOTAL VENTAS", Math.max(1, header + 1));
      if (header > 0 && total > header) normalizeTableLayout(sheet, shared, header, total, 3, 1);
      continue;
    }
    if (name.includes(norm("Cantina")) || name.includes(norm("Coctelería")) || name.includes(norm("Pizzas")) || name.includes(norm("Pizzería"))) {
      const header = findRowNumber(sheet, shared, "Precio de venta", 1);
      const total = findRowNumber(sheet, shared, "TOTAL", Math.max(1, header + 1));
      if (header > 0 && total > header) normalizeTableLayout(sheet, shared, header, total, 3, 1);
    }

    const gastosTitle = findRowNumber(sheet, shared, "GASTOS", 1);
    const legacyTitle = findRowNumber(sheet, shared, "ENTRADA DE PRODUCTOS", 1);
    const title = gastosTitle > 0 ? gastosTitle : legacyTitle;
    const expenseHeader = findRowNumber(sheet, shared, "Precio de compra", Math.max(1, title));
    const gastosTotal = findRowNumber(sheet, shared, "Total gastos", Math.max(1, expenseHeader + 1));
    const legacyTotal = findRowNumber(sheet, shared, "Total entradas", Math.max(1, expenseHeader + 1));
    const expenseTotal = gastosTotal > 0 ? gastosTotal : legacyTotal;
    if (title > 0 && expenseHeader > 0 && expenseTotal > expenseHeader) {
      const titleEl = rowAt(sheet.doc, title);
      const totalEl = rowAt(sheet.doc, expenseTotal);
      if (titleEl) setCell(sheet.doc, titleEl, 1, "GASTOS (detalle del día)", undefined, findCell(titleEl, 1));
      if (totalEl) setCell(sheet.doc, totalEl, 2, "Total gastos", undefined, findCell(totalEl, 2));
      normalizeTableLayout(sheet, shared, expenseHeader, expenseTotal, 2, 1);
    }
  }
}

function addPaidSheet(files: Map<string, Uint8Array>, workbook: XMLDocument, rels: XMLDocument, types: XMLDocument, sheets: SheetPart[], shared: string[], date: string, additions: IpvAddition[]): void {
  const orderedAdditions = [...additions].sort((a, b) => a.category.localeCompare(b.category, "es", { sensitivity: "base", numeric: true, ignorePunctuation: true }));
  const existing = findSheet(sheets, "Cuentas pagadas");
  if (existing) {
    const rows = rowElements(existing.doc);
    const existingKeys = new Set(rows.slice(1).map((row) => `${readCell(findCell(row, 1), shared)}::${norm(readCell(findCell(row, 2), shared))}::${numberCell(row, 3, shared)}::${norm(readCell(findCell(row, 4), shared))}`));
    for (const item of orderedAdditions) {
      const key = `${date}::${norm(item.category)}::${item.amount ?? 0}::${norm(item.detail)}`;
      if (existingKeys.has(key)) continue;
      const rowNumberValue = Math.max(1, ...rows.map((row) => Number(row.getAttribute("r") ?? 1))) + 1;
      const row = existing.doc.createElementNS(MAIN_NS, "row"); row.setAttribute("r", String(rowNumberValue));
      existing.doc.getElementsByTagNameNS(MAIN_NS, "sheetData")[0]?.appendChild(row);
      setCell(existing.doc, row, 1, date); setCell(existing.doc, row, 2, item.category); setCell(existing.doc, row, 3, item.amount ?? 0); setCell(existing.doc, row, 4, item.detail);
      rows.push(row);
    }
    const lastRow = Math.max(1, ...rowElements(existing.doc).map((row) => Number(row.getAttribute("r") ?? 1)));
    normalizeTableLayout(existing, shared, 1, lastRow + 1, 2);
    updateDimension(existing.doc);
    return;
  }
  const worksheetNumbers = [...files.keys()].flatMap((name) => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)?.[1] ? [Number(/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)?.[1])] : []);
  const sheetIds = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet")).map((sheet) => Number(sheet.getAttribute("sheetId") ?? 0));
  const relIds = Array.from(rels.documentElement.children).map((rel) => Number(/^rId(\d+)$/.exec(rel.getAttribute("Id") ?? "")?.[1] ?? 0));
  const sheetNumber = Math.max(0, ...worksheetNumbers) + 1;
  const sheetId = Math.max(0, ...sheetIds) + 1;
  const relId = Math.max(0, ...relIds) + 1;
  const key = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheet = workbook.createElementNS(MAIN_NS, "sheet");
  sheet.setAttribute("name", "Cuentas pagadas"); sheet.setAttribute("sheetId", String(sheetId)); sheet.setAttributeNS(REL_NS, "r:id", `rId${relId}`);
  workbook.getElementsByTagNameNS(MAIN_NS, "sheets")[0]?.appendChild(sheet);
  const relationship = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship");
  relationship.setAttribute("Id", `rId${relId}`); relationship.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"); relationship.setAttribute("Target", `worksheets/sheet${sheetNumber}.xml`);
  rels.documentElement.appendChild(relationship);
  const override = types.createElementNS(types.documentElement.namespaceURI, "Override");
  override.setAttribute("PartName", `/${key}`); override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  types.documentElement.appendChild(override);
  const headers = ["Fecha", "Cliente", "Importe", "Forma de pago"];
  const body = [headers.map((header, index) => `<c r="${colLetters(index + 1)}1" t="inlineStr"><is><t>${xml(header)}</t></is></c>`).join(""), ...orderedAdditions.map((item, index) => {
    const r = index + 2;
    return `<c r="A${r}" t="inlineStr"><is><t>${xml(date)}</t></is></c><c r="B${r}" t="inlineStr"><is><t>${xml(item.category)}</t></is></c><c r="C${r}" t="n"><v>${item.amount ?? 0}</v></c><c r="D${r}" t="inlineStr"><is><t>${xml(item.detail)}</t></is></c>`;
  })];
  const rows = body.map((cells, index) => `<row r="${index + 1}">${cells}</row>`).join("");
  files.set(key, enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NS}"><dimension ref="A1:D${Math.max(1, additions.length + 1)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="20" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:D${Math.max(1, additions.length + 1)}"/></worksheet>`));
}

function productBarcodeSheetXml(products: IpvProductBarcode[]): string {
  const ordered = [...products].sort((a, b) =>
    a.dept.localeCompare(b.dept, "es", { sensitivity: "base", numeric: true, ignorePunctuation: true })
    || a.name.localeCompare(b.name, "es", { sensitivity: "base", numeric: true, ignorePunctuation: true }),
  );
  const headers = ["Producto", "Departamento", "UM", "Código de barras"];
  const headerCells = headers.map((header, index) => `<c r="${colLetters(index + 1)}1" t="inlineStr"><is><t>${xml(header)}</t></is></c>`).join("");
  const dataRows = ordered.map((product, index) => {
    const row = index + 2;
    const values = [product.name, product.dept, product.um, product.barcode];
    return `<row r="${row}">${values.map((value, col) => `<c r="${colLetters(col + 1)}${row}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`;
  }).join("");
  const lastRow = Math.max(1, ordered.length + 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NS}"><dimension ref="A1:D${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="36" customWidth="1"/><col min="2" max="2" width="25" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="4" width="24" customWidth="1"/></cols><sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData><autoFilter ref="A1:D${lastRow}"/></worksheet>`;
}

/** Mantiene una hoja maestra con todos los productos del sistema. El código
 * se escribe como texto para conservar ceros iniciales y no alterar EAN/UPC.
 * Como esta hoja la crea SDA, puede regenerarse completa en cada IPV sin
 * tocar las tablas originales capturadas por el usuario. */
function addProductBarcodesSheet(files: Map<string, Uint8Array>, workbook: XMLDocument, rels: XMLDocument, types: XMLDocument, sheets: SheetPart[], products: IpvProductBarcode[]): void {
  const source = productBarcodeSheetXml(products);
  const existing = findSheet(sheets, "Códigos de barras", "Codigos de barras");
  if (existing) {
    existing.doc = xmlDoc(source);
    return;
  }

  const worksheetNumbers = [...files.keys()].flatMap((name) => {
    const match = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name);
    return match?.[1] ? [Number(match[1])] : [];
  });
  const sheetIds = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet")).map((sheet) => Number(sheet.getAttribute("sheetId") ?? 0));
  const relIds = Array.from(rels.documentElement.children).map((rel) => Number(/^rId(\d+)$/.exec(rel.getAttribute("Id") ?? "")?.[1] ?? 0));
  const sheetNumber = Math.max(0, ...worksheetNumbers) + 1;
  const sheetId = Math.max(0, ...sheetIds) + 1;
  const relId = Math.max(0, ...relIds) + 1;
  const key = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheet = workbook.createElementNS(MAIN_NS, "sheet");
  sheet.setAttribute("name", "Códigos de barras");
  sheet.setAttribute("sheetId", String(sheetId));
  sheet.setAttributeNS(REL_NS, "r:id", `rId${relId}`);
  workbook.getElementsByTagNameNS(MAIN_NS, "sheets")[0]?.appendChild(sheet);
  const relationship = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship");
  relationship.setAttribute("Id", `rId${relId}`);
  relationship.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet");
  relationship.setAttribute("Target", `worksheets/sheet${sheetNumber}.xml`);
  rels.documentElement.appendChild(relationship);
  const override = types.createElementNS(types.documentElement.namespaceURI, "Override");
  override.setAttribute("PartName", `/${key}`);
  override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  types.documentElement.appendChild(override);
  const doc = xmlDoc(source);
  sheets.push({ name: "Códigos de barras", key, doc });
  files.set(key, enc.encode(source));
}

function templateFingerprintSheetXml(date: string, fingerprint: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NS}"><dimension ref="A1:B3"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Huella SDA</t></is></c><c r="B1" t="inlineStr"><is><t>${xml(fingerprint)}</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Fecha de origen</t></is></c><c r="B2" t="inlineStr"><is><t>${xml(date)}</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Sistema</t></is></c><c r="B3" t="inlineStr"><is><t>${xml(SYSTEM_NAME)}</t></is></c></row></sheetData></worksheet>`;
}

/** Inserta una huella verificable en una hoja veryHidden. No modifica ninguna
 * cifra del IPV y Excel conserva la marca al usar el archivo como plantilla. */
function addTemplateFingerprintSheet(files: Map<string, Uint8Array>, workbook: XMLDocument, rels: XMLDocument, types: XMLDocument, sheets: SheetPart[], date: string, fingerprint: string): void {
  const source = templateFingerprintSheetXml(date, fingerprint);
  const workbookSheets = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet"));
  const existingNode = workbookSheets.find((item) => norm(item.getAttribute("name") ?? "") === norm("_SDA_META"));
  const existing = findSheet(sheets, "_SDA_META");
  if (existing && existingNode) {
    existing.doc = xmlDoc(source);
    existingNode.setAttribute("state", "veryHidden");
    return;
  }
  const worksheetNumbers = [...files.keys()].flatMap((name) => {
    const match = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name);
    return match?.[1] ? [Number(match[1])] : [];
  });
  const sheetIds = workbookSheets.map((sheet) => Number(sheet.getAttribute("sheetId") ?? 0));
  const relIds = Array.from(rels.documentElement.children).map((rel) => Number(/^rId(\d+)$/.exec(rel.getAttribute("Id") ?? "")?.[1] ?? 0));
  const sheetNumber = Math.max(0, ...worksheetNumbers) + 1;
  const sheetId = Math.max(0, ...sheetIds) + 1;
  const relId = Math.max(0, ...relIds) + 1;
  const key = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheet = workbook.createElementNS(MAIN_NS, "sheet");
  sheet.setAttribute("name", "_SDA_META");
  sheet.setAttribute("sheetId", String(sheetId));
  sheet.setAttribute("state", "veryHidden");
  sheet.setAttributeNS(REL_NS, "r:id", `rId${relId}`);
  workbook.getElementsByTagNameNS(MAIN_NS, "sheets")[0]?.appendChild(sheet);
  const relationship = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship");
  relationship.setAttribute("Id", `rId${relId}`);
  relationship.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet");
  relationship.setAttribute("Target", `worksheets/sheet${sheetNumber}.xml`);
  rels.documentElement.appendChild(relationship);
  const override = types.createElementNS(types.documentElement.namespaceURI, "Override");
  override.setAttribute("PartName", `/${key}`);
  override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  types.documentElement.appendChild(override);
  const doc = xmlDoc(source);
  sheets.push({ name: "_SDA_META", key, doc });
  files.set(key, enc.encode(source));
}

function applySystemPrintHeader(sheet: SheetPart): void {
  const root = sheet.doc.documentElement;
  let headerFooter = firstDirect(root, "headerFooter");
  if (!headerFooter) {
    headerFooter = sheet.doc.createElementNS(MAIN_NS, "headerFooter");
    const insertBefore = Array.from(root.children).find((child) => [
      "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors",
      "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "picture",
      "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
    ].includes(child.localName));
    root.insertBefore(headerFooter, insertBefore ?? null);
  }
  let oddHeader = firstDirect(headerFooter, "oddHeader");
  if (!oddHeader) {
    oddHeader = sheet.doc.createElementNS(MAIN_NS, "oddHeader");
    headerFooter.appendChild(oddHeader);
  }
  // Encabezado y pie de impresión premium (regla de documentos del
  // sistema): nombre en verde profundo negrita centrado y, al pie,
  // negocio a la izquierda y paginación a la derecha. Solo afecta a
  // la impresión: no toca ni una celda, cifra ni fórmula del IPV.
  oddHeader.textContent = `&C&"Calibri,Bold"&14&K0B3D2E ${SYSTEM_NAME}`;
  let oddFooter = firstDirect(headerFooter, "oddFooter");
  if (!oddFooter) {
    oddFooter = sheet.doc.createElementNS(MAIN_NS, "oddFooter");
    headerFooter.appendChild(oddFooter);
  }
  oddFooter.textContent = `&L&"Calibri"&9&K57705F ${DOC_STYLE.business} &C&"Calibri"&9&K57705F IPV cuadrado por Queen SDA &R&"Calibri"&9&K57705F Página &P de &N`;
  headerFooter.setAttribute("differentOddEven", "0");
  headerFooter.setAttribute("differentFirst", "0");
}

function removeLegacySheet(files: Map<string, Uint8Array>, workbook: XMLDocument, rels: XMLDocument, types: XMLDocument): void {
  const sheet = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet")).find((item) => norm(item.getAttribute("name") ?? "") === norm("Actualizaciones SDA"));
  if (!sheet) return;
  const rid = sheet.getAttributeNS(REL_NS, "id") ?? sheet.getAttribute("r:id") ?? "";
  const relationship = Array.from(rels.documentElement.children).find((item) => item.getAttribute("Id") === rid);
  const target = relationship?.getAttribute("Target") ?? "";
  const key = target ? resolveTarget(target) : "";
  sheet.remove(); relationship?.remove();
  if (key) {
    files.delete(key);
    Array.from(types.documentElement.children).find((item) => item.getAttribute("PartName") === `/${key}`)?.remove();
  }
}

export type FreshIpvPrice = {
  productKey: string;
  dept: string;
  names: string[];
  um: string;
  salePrice: number | null;
  costPrice: number | null;
};

function setNumberKeepingFormula(doc: XMLDocument, row: Element, col: number, value: number): void {
  const cell = makeCell(doc, row, col);
  const formula = firstDirect(cell, "f")?.textContent ?? "";
  if (formula) setCell(doc, row, col, value, formula, cell);
  else setCell(doc, row, col, value, undefined, cell);
}

function clearCellKeepingFormula(doc: XMLDocument, row: Element, col: number): void {
  const cell = findCell(row, col);
  if (!cell) return;
  const formula = firstDirect(cell, "f")?.textContent ?? "";
  if (formula) setCell(doc, row, col, 0, formula, cell);
  else setCell(doc, row, col, "", undefined, cell);
}

function excelSerial(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
}

function freshPriceFor(prices: FreshIpvPrice[], sheetName: string, productName: string, um: string): FreshIpvPrice | undefined {
  const sheetKey = norm(sheetName).replace("cocteleria", "cantina");
  const productKey = norm(productName);
  const umKey = norm(um);
  return prices.find((price) => {
    const deptKey = norm(price.dept).replace("cocteleria", "cantina");
    if (deptKey !== sheetKey && !deptKey.includes(sheetKey) && !sheetKey.includes(deptKey)) return false;
    if (umKey && norm(price.um) && norm(price.um) !== umKey) return false;
    return price.names.some((name) => norm(name) === productKey);
  });
}

function resetDepartmentForFreshDay(sheet: SheetPart, shared: string[], prices: FreshIpvPrice[]): void {
  const headerRow = findRowNumber(sheet, shared, "Precio de venta", 1);
  const totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) return;
  const cols = { no: 1, name: 3, um: 4, initial: 5, entry: 6, available: 7, loss: 8, transfer: 9, forSale: 10, sold: 11, final: 12, salePrice: 13, saleAmount: 14, costPrice: 15, costAmount: 16, profit: 17 };
  for (let r = 1; r <= headerRow; r += 1) {
    const row = rowAt(sheet.doc, r);
    if (!row) continue;
    for (const cell of cellsOf(row)) {
      const label = norm(readCell(cell, shared));
      const col = colNumber(cell.getAttribute("r") ?? "");
      if (label.includes("saldo inicial")) cols.initial = col;
      else if (label === "disponible") cols.available = col;
      else if (label.includes("a la venta")) cols.forSale = col;
      else if (label.includes("saldo final")) cols.final = col;
      else if (label.includes("traslado")) cols.transfer = col;
      else if (label.includes("baja")) cols.loss = col;
      else if (label.includes("entrada")) cols.entry = col;
      else if (label.includes("precio") && label.includes("venta")) cols.salePrice = col;
      else if (label.includes("precio") && (label.includes("costo") || label.includes("compra"))) cols.costPrice = col;
      else if (label === "venta") cols.sold = col;
      else if (label === "um" || label.includes("unidad")) cols.um = col;
    }
  }
  for (const row of rowElements(sheet.doc)) {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r <= headerRow || r >= totalRow) continue;
    const name = readCell(findCell(row, cols.name), shared).trim();
    const no = readCell(findCell(row, cols.no), shared).trim();
    if (!name || !no) continue;
    const rawFinal = readCell(findCell(row, cols.final), shared);
    const final = rawFinal !== ""
      ? numberCell(row, cols.final, shared)
      : numberCell(row, cols.available, shared) - numberCell(row, cols.loss, shared) - numberCell(row, cols.transfer, shared) - numberCell(row, cols.sold, shared);
    const initial = Number.isFinite(final) ? final : 0;
    setCell(sheet.doc, row, cols.initial, initial, undefined, findCell(row, cols.initial));
    setCell(sheet.doc, row, cols.entry, 0, undefined, findCell(row, cols.entry));
    setNumberKeepingFormula(sheet.doc, row, cols.available, initial);
    setCell(sheet.doc, row, cols.loss, 0, undefined, findCell(row, cols.loss));
    setCell(sheet.doc, row, cols.transfer, 0, undefined, findCell(row, cols.transfer));
    setNumberKeepingFormula(sheet.doc, row, cols.forSale, initial);
    setCell(sheet.doc, row, cols.sold, 0, undefined, findCell(row, cols.sold));
    setNumberKeepingFormula(sheet.doc, row, cols.final, initial);
    const price = freshPriceFor(prices, sheet.name, name, readCell(findCell(row, cols.um), shared));
    if (price?.salePrice != null) setCell(sheet.doc, row, cols.salePrice, price.salePrice, undefined, findCell(row, cols.salePrice));
    if (price?.costPrice != null) setCell(sheet.doc, row, cols.costPrice, price.costPrice, undefined, findCell(row, cols.costPrice));
    setNumberKeepingFormula(sheet.doc, row, cols.saleAmount, 0);
    setNumberKeepingFormula(sheet.doc, row, cols.costAmount, 0);
    setNumberKeepingFormula(sheet.doc, row, cols.profit, 0);
  }

  // Los gastos/entradas detallados pertenecen al día anterior. Se conservan
  // la tabla, sus estilos y fórmulas, pero se dejan sus filas disponibles.
  const detailTitle = Math.max(findRowNumber(sheet, shared, "GASTOS", totalRow + 1), findRowNumber(sheet, shared, "ENTRADA DE PRODUCTOS", totalRow + 1));
  const detailHeader = findRowNumber(sheet, shared, "Descripción", Math.max(totalRow + 1, detailTitle));
  const detailTotal = detailHeader > 0 ? findRowNumber(sheet, shared, "Total", detailHeader + 1) : -1;
  if (detailHeader > 0 && detailTotal > detailHeader) {
    for (const row of rowElements(sheet.doc)) {
      const r = Number(row.getAttribute("r") ?? 0);
      if (r <= detailHeader || r >= detailTotal) continue;
      for (let col = 1; col <= 8; col += 1) clearCellKeepingFormula(sheet.doc, row, col);
    }
    const total = rowAt(sheet.doc, detailTotal);
    if (total) for (let col = 4; col <= 8; col += 1) setNumberKeepingFormula(sheet.doc, total, col, 0);
  }
}

function resetWarehouseForFreshDay(sheet: SheetPart, shared: string[], prices: FreshIpvPrice[]): void {
  const headerRow = findRowNumber(sheet, shared, "Saldo inicial", 1);
  const totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) return;
  for (const row of rowElements(sheet.doc)) {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r <= headerRow || r >= totalRow) continue;
    const name = readCell(findCell(row, 2), shared).trim();
    if (!name) continue;
    const final = numberCell(row, 9, shared);
    setCell(sheet.doc, row, 4, final, undefined, findCell(row, 4));
    setCell(sheet.doc, row, 5, 0, undefined, findCell(row, 5));
    setNumberKeepingFormula(sheet.doc, row, 6, final);
    setCell(sheet.doc, row, 7, 0, undefined, findCell(row, 7));
    setCell(sheet.doc, row, 8, 0, undefined, findCell(row, 8));
    setNumberKeepingFormula(sheet.doc, row, 9, final);
    const price = freshPriceFor(prices, "Almacén", name, readCell(findCell(row, 3), shared));
    if (price?.costPrice != null) setCell(sheet.doc, row, 10, price.costPrice, undefined, findCell(row, 10));
    setNumberKeepingFormula(sheet.doc, row, 11, final * numberCell(row, 10, shared));
    clearCellKeepingFormula(sheet.doc, row, 12);
  }
}

function resetSimpleDailyTable(sheet: SheetPart, shared: string[]): void {
  const headerRow = findRowNumber(sheet, shared, "Descripción", 1);
  const totalRow = findRowNumber(sheet, shared, "TOTAL VENTAS", Math.max(1, headerRow + 1));
  if (headerRow < 0 || totalRow < 0) return;
  for (const row of rowElements(sheet.doc)) {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r <= headerRow || r >= totalRow) continue;
    for (let col = 1; col <= 8; col += 1) clearCellKeepingFormula(sheet.doc, row, col);
  }
  const total = rowAt(sheet.doc, totalRow);
  if (total) for (let col = 4; col <= 8; col += 1) setNumberKeepingFormula(sheet.doc, total, col, 0);
}

function resetAccountsBlock(sheet: SheetPart, shared: string[], phrase: string): void {
  const title = findRowNumber(sheet, shared, phrase, 1);
  if (title < 0) return;
  const total = rowElements(sheet.doc).find((row) => {
    const r = Number(row.getAttribute("r") ?? 0);
    return r > title && rowHas(row, shared, `Total ${phrase}`);
  });
  const totalRow = Number(total?.getAttribute("r") ?? -1);
  if (totalRow <= title) return;
  for (const row of rowElements(sheet.doc)) {
    const r = Number(row.getAttribute("r") ?? 0);
    if (r <= title || r >= totalRow) continue;
    const text = norm(cellsOf(row).map((cell) => readCell(cell, shared)).join(" "));
    if (text.includes("cliente") || text.includes("nombre") || text.includes("saldo") || text.includes("observ")) continue;
    for (let col = 1; col <= 4; col += 1) clearCellKeepingFormula(sheet.doc, row, col);
  }
  for (let col = 2; col <= 4; col += 1) setNumberKeepingFormula(sheet.doc, total!, col, 0);
}

function resetBreakdownForFreshDay(sheet: SheetPart, shared: string[]): void {
  resetAccountsBlock(sheet, shared, "Cuentas por cobrar");
  resetAccountsBlock(sheet, shared, "Cuentas por pagar");

  const cashHeader = findRowNumber(sheet, shared, "Billetes", 1);
  if (cashHeader > 0) {
    const header = rowAt(sheet.doc, cashHeader);
    let quantityCol = 2;
    let subtotalCol = 3;
    if (header) for (const cell of cellsOf(header)) {
      const label = norm(readCell(cell, shared));
      const col = colNumber(cell.getAttribute("r") ?? "");
      if (label.includes("cantidad") || label.includes("billete")) quantityCol = col;
      else if (label.includes("total") || label.includes("subtotal")) subtotalCol = col;
    }
    for (const row of rowElements(sheet.doc)) {
      const r = Number(row.getAttribute("r") ?? 0);
      if (r <= cashHeader || r > cashHeader + 30) continue;
      const first = norm(readCell(findCell(row, Math.max(1, quantityCol - 1)), shared));
      if (first.startsWith("total")) { setNumberKeepingFormula(sheet.doc, row, subtotalCol, 0); break; }
      if (numberCell(row, Math.max(1, quantityCol - 1), shared) <= 0) continue;
      setCell(sheet.doc, row, quantityCol, 0, undefined, findCell(row, quantityCol));
      setNumberKeepingFormula(sheet.doc, row, subtotalCol, 0);
    }
  }

  let currencyTitle = findRowNumber(sheet, shared, "DIVISAS", 1);
  if (currencyTitle < 0) currencyTitle = findRowNumber(sheet, shared, "MLC", 1);
  if (currencyTitle > 0) {
    const headerRow = rowElements(sheet.doc).find((row) => {
      const r = Number(row.getAttribute("r") ?? 0);
      return r > currencyTitle && r <= currencyTitle + 4 && rowHas(row, shared, "Cantidad");
    });
    if (headerRow) {
      const headerNumber = Number(headerRow.getAttribute("r") ?? 0);
      let quantityCol = 3;
      let conversionCol = 4;
      for (const cell of cellsOf(headerRow)) {
        const label = norm(readCell(cell, shared));
        const col = colNumber(cell.getAttribute("r") ?? "");
        if (label.includes("cantidad") || label.includes("billete")) quantityCol = col;
        else if (label.includes("conversion") || label.includes("equivalente") || label.includes("total")) conversionCol = col;
      }
      for (const row of rowElements(sheet.doc)) {
        const r = Number(row.getAttribute("r") ?? 0);
        if (r <= headerNumber || r > headerNumber + 16) continue;
        if (norm(cellsOf(row).map((cell) => readCell(cell, shared)).join(" ")).includes("total")) { setNumberKeepingFormula(sheet.doc, row, conversionCol, 0); break; }
        setCell(sheet.doc, row, quantityCol, 0, undefined, findCell(row, quantityCol));
        setNumberKeepingFormula(sheet.doc, row, conversionCol, 0);
      }
    }
  }

  for (const row of rowElements(sheet.doc)) {
    const labels = cellsOf(row).map((cell) => norm(readCell(cell, shared)));
    const daily = labels.some((label) => label.includes("transferencias recibidas") || label.includes("total zelle"));
    const calculated = labels.some((label) => label.includes("total efectivo") || label.includes("total divisas") || label.includes("total cuentas") || label.includes("total de fondos") || label.includes("ventas del dia") || label === "cuadre");
    if (!daily && !calculated) continue;
    const labelCol = Math.max(0, ...cellsOf(row).filter((cell) => {
      const label = norm(readCell(cell, shared));
      return daily
        ? label.includes("transferencias recibidas") || label.includes("total zelle")
        : label.includes("total efectivo") || label.includes("total divisas") || label.includes("total cuentas") || label.includes("total de fondos") || label.includes("ventas del dia") || label === "cuadre";
    }).map((cell) => colNumber(cell.getAttribute("r") ?? "")));
    for (const cell of cellsOf(row)) {
      const col = colNumber(cell.getAttribute("r") ?? "");
      if (col <= labelCol) continue;
      if (daily) setCell(sheet.doc, row, col, 0, undefined, cell);
      else setNumberKeepingFormula(sheet.doc, row, col, 0);
    }
  }
}

/** Prepara un IPV completamente nuevo para `targetDate`. No lo guarda como
 * versión, no lo mezcla con la conciliación de ida y vuelta y no modifica el
 * archivo fuente. Solo descarga una copia: cierres → aperturas, movimientos
 * diarios a cero, arqueo y cuentas vacíos y precios vigentes del catálogo. */
export async function buildFreshIpvForDay(file: File, targetDate: string, prices: FreshIpvPrice[]): Promise<Blob> {
  const files = await unzipAll(await file.arrayBuffer());
  const workbookKey = "xl/workbook.xml";
  const relsKey = "xl/_rels/workbook.xml.rels";
  const workbook = xmlDoc(dec.decode(files.get(workbookKey) ?? new Uint8Array()));
  const rels = xmlDoc(dec.decode(files.get(relsKey) ?? new Uint8Array()));
  const shared = loadShared(files);
  const sheets = loadSheets(files, workbook, rels);
  const parameters = findSheet(sheets, "Parámetros", "Parametros");
  if (!parameters) throw new Error("El último IPV no tiene la hoja «Parámetros» necesaria para preparar el día.");
  const dateRow = rowAt(parameters.doc, 3);
  if (!dateRow) throw new Error("No encontré la fecha del IPV en Parámetros.");
  setCell(parameters.doc, dateRow, 2, excelSerial(targetDate), undefined, findCell(dateRow, 2));

  for (const sheet of sheets) {
    const sheetName = norm(sheet.name);
    if (["bebidas alcoholicas", "bebidas no alcoholicas", "elaboracion", "cantina", "cocteleria", "pizzas", "pizzeria"].includes(sheetName)) resetDepartmentForFreshDay(sheet, shared, prices);
    else if (sheetName.includes("almacen")) resetWarehouseForFreshDay(sheet, shared, prices);
    else if (sheetName.includes("entrada y mesas")) resetSimpleDailyTable(sheet, shared);
    else if (sheetName.includes("desglose")) resetBreakdownForFreshDay(sheet, shared);
    else if (sheetName.includes("cuentas pagad")) {
      const sheetData = sheet.doc.getElementsByTagNameNS(MAIN_NS, "sheetData")[0];
      if (sheetData) for (const row of rowElements(sheet.doc)) if (Number(row.getAttribute("r") ?? 0) > 1) row.remove();
      updateDimension(sheet.doc);
    }
  }

  let calcPr = workbook.getElementsByTagNameNS(MAIN_NS, "calcPr")[0];
  if (!calcPr) { calcPr = workbook.createElementNS(MAIN_NS, "calcPr"); workbook.documentElement.appendChild(calcPr); }
  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  for (const sheet of sheets) files.set(sheet.key, enc.encode(new XMLSerializer().serializeToString(sheet.doc)));
  files.set(workbookKey, enc.encode(new XMLSerializer().serializeToString(workbook)));
  const output = await zipAll(files);

  const reopened = await unzipAll(output.slice().buffer as ArrayBuffer);
  if (!reopened.has("[Content_Types].xml") || !reopened.has("_rels/.rels") || !reopened.has(workbookKey) || !reopened.has(relsKey)) throw new Error("El IPV fresco no superó la prueba de apertura de Excel.");
  const reopenedWorkbook = xmlDoc(dec.decode(reopened.get(workbookKey) ?? new Uint8Array()));
  const reopenedRels = xmlDoc(dec.decode(reopened.get(relsKey) ?? new Uint8Array()));
  const reopenedSheets = loadSheets(reopened, reopenedWorkbook, reopenedRels);
  const reopenedParams = findSheet(reopenedSheets, "Parámetros", "Parametros");
  const reopenedShared = loadShared(reopened);
  const reopenedDateRow = reopenedParams ? rowAt(reopenedParams.doc, 3) : undefined;
  if (!reopenedDateRow || Math.round(numberCell(reopenedDateRow, 2, reopenedShared)) !== excelSerial(targetDate)) throw new Error("La fecha del IPV fresco no quedó aplicada correctamente.");
  return new Blob([output as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Integra cada dato en su tabla original. Mantiene intactas las cifras
 * capturadas; los nombres de productos son la única excepción y pueden
 * actualizarse mediante una corrección aprendida por código de barras.
 * Usa filas vacías y, cuando una tabla se llena, la amplía conservando el
 * formato y extendiendo sus fórmulas de total. */
export async function buildUpdatedIpv(file: File, date: string, additions: IpvAddition[], productBarcodes: IpvProductBarcode[], nameCorrections: IpvNameCorrection[] = [], templateFingerprint = ""): Promise<Blob> {
  const files = await unzipAll(await file.arrayBuffer());
  const workbookKey = "xl/workbook.xml";
  const relsKey = "xl/_rels/workbook.xml.rels";
  const typesKey = "[Content_Types].xml";
  const workbook = xmlDoc(dec.decode(files.get(workbookKey) ?? new Uint8Array()));
  const rels = xmlDoc(dec.decode(files.get(relsKey) ?? new Uint8Array()));
  const types = xmlDoc(dec.decode(files.get(typesKey) ?? new Uint8Array()));
  const shared = loadShared(files);
  removeLegacySheet(files, workbook, rels, types);
  const sheets = loadSheets(files, workbook, rels);

  for (const item of additions) {
    if (item.section === "Cuentas pagadas") continue;
    if (item.section === "Coctelería") {
      const sheet = findSheet(sheets, "Cantina", "Coctelería");
      if (!sheet) throw new Error("No encontré la sección original de Coctelería/Cantina.");
      addDepartmentSale(sheet, shared, item);
    } else if (item.section === "Pizzería") {
      const sheet = findSheet(sheets, "Pizzas", "Pizzería");
      if (!sheet) throw new Error("No encontré la sección original de Pizzería.");
      addDepartmentSale(sheet, shared, item);
    } else if (item.section === "Entradas y mesas") {
      const sheet = findSheet(sheets, "Entrada y mesas");
      if (!sheet) throw new Error("No encontré la sección original de Entrada y mesas.");
      addEntryTablesSale(sheet, shared, item);
    } else if (item.section === "Almacén") {
      const sheet = findSheet(sheets, "Almacén", "Almacen");
      if (!sheet) throw new Error("No encontré la sección original de Almacén.");
      addWarehouse(sheet, shared, item);
    } else if (item.section === "Gastos") {
      const sheet = findSheet(sheets, expenseSheetName(item.detail));
      if (!sheet) throw new Error(`No encontré la tabla de Gastos que corresponde a «${item.detail}».`);
      addExpense(sheet, shared, item);
    } else if (item.section === "RH") {
      const sheet = findSheet(sheets, "RH");
      if (!sheet) throw new Error("No encontré la sección original de RH.");
      addRh(sheet, shared, item);
    }
  }

  // Las correcciones de nombre aprendidas por código —tanto las encontradas
  // en internet como las escritas manualmente— son la única excepción al
  // valor original: cambia solo el nombre exacto, nunca cantidades ni importes.
  applyOfficialProductNames(sheets, shared, nameCorrections);

  // Antes de cerrar el libro, SDA verifica las posiciones visuales de cada
  // columna y el orden alfabético. La fila se mueve completa: no se cambian
  // nombres, cantidades, importes ni demás valores ya capturados.
  normalizeWritableTables(sheets, shared);

  const paid = additions.filter((item) => item.section === "Cuentas pagadas");
  addPaidSheet(files, workbook, rels, types, sheets, shared, date, paid);
  addProductBarcodesSheet(files, workbook, rels, types, sheets, productBarcodes);
  if (!templateFingerprint.startsWith("SDA2-")) throw new Error("No se pudo generar la huella única del IPV.");
  addTemplateFingerprintSheet(files, workbook, rels, types, sheets, date, templateFingerprint);

  // El nombre vigente del sistema forma parte del encabezado de impresión de
  // cada hoja generada, sin mover filas ni alterar cifras o fórmulas del IPV.
  for (const sheet of sheets) applySystemPrintHeader(sheet);

  // Excel recalcula las fórmulas ampliadas al abrir; los valores en celdas
  // nuevas y los totales también llevan caché numérica para que SDA pueda
  // reimportar el archivo inmediatamente, incluso antes de abrirlo en Excel.
  let calcPr = workbook.getElementsByTagNameNS(MAIN_NS, "calcPr")[0];
  if (!calcPr) { calcPr = workbook.createElementNS(MAIN_NS, "calcPr"); workbook.documentElement.appendChild(calcPr); }
  calcPr.setAttribute("calcMode", "auto"); calcPr.setAttribute("fullCalcOnLoad", "1"); calcPr.setAttribute("forceFullCalc", "1");

  for (const sheet of sheets) files.set(sheet.key, enc.encode(new XMLSerializer().serializeToString(sheet.doc)));
  files.set(workbookKey, enc.encode(new XMLSerializer().serializeToString(workbook)));
  files.set(relsKey, enc.encode(new XMLSerializer().serializeToString(rels)));
  files.set(typesKey, enc.encode(new XMLSerializer().serializeToString(types)));
  const output = await zipAll(files);

  const reopened = await unzipAll(output.slice().buffer as ArrayBuffer);
  const reopenedWorkbook = dec.decode(reopened.get(workbookKey) ?? new Uint8Array());
  if (!reopened.has("[Content_Types].xml") || !reopened.has("_rels/.rels") || !reopened.has(workbookKey) || !reopened.has(relsKey)) throw new Error("El IPV actualizado no superó la prueba de apertura de Excel.");
  if (reopenedWorkbook.includes("Actualizaciones SDA")) throw new Error("La hoja genérica antigua no pudo retirarse del IPV.");
  if (!reopenedWorkbook.includes("Cuentas pagadas")) throw new Error("La sección «Cuentas pagadas» no quedó integrada en el IPV.");
  if (!reopenedWorkbook.includes("Códigos de barras")) throw new Error("La hoja de códigos de barras no quedó integrada en el IPV.");
  if (!reopenedWorkbook.includes("_SDA_META") || !reopenedWorkbook.includes("veryHidden")) throw new Error("La huella técnica no quedó protegida dentro del IPV.");
  const reopenedSheets = [...reopened.entries()].filter(([key]) => key.startsWith("xl/worksheets/") && key.endsWith(".xml"));
  if (!reopenedSheets.length || reopenedSheets.some(([, bytes]) => !dec.decode(bytes).includes(SYSTEM_NAME))) throw new Error("El encabezado de Queen SDA no quedó aplicado en todas las hojas del IPV.");
  const barcodeSheet = reopenedSheets.find(([, bytes]) => dec.decode(bytes).includes("Código de barras"));
  if (!barcodeSheet) throw new Error("No se pudo comprobar el catálogo de códigos de barras dentro del IPV.");
  const barcodeXml = dec.decode(barcodeSheet[1]);
  for (const product of productBarcodes) {
    if (!barcodeXml.includes(xml(product.name)) || (product.barcode && !barcodeXml.includes(xml(product.barcode)))) throw new Error(`No se pudo comprobar el código de «${product.name}» dentro del IPV.`);
  }
  for (const item of additions) {
    if (item.section === "Cuentas pagadas") continue;
    const marker = xml(item.concept);
    if (![...reopened.entries()].some(([key, bytes]) => key.startsWith("xl/worksheets/") && dec.decode(bytes).includes(marker))) throw new Error(`No se pudo comprobar «${item.concept}» en su sección del IPV.`);
  }
  return new Blob([output as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}


export type IpvLabCorrections = {
  products: { dept: string; name: string; precioVenta: number | null; importeVenta: number; ganancia: number }[];
  desglose: { ventas: number; totalCuentas: number; totalFondos: number; cuadre: number } | null;
};

/** IPV corregido del Laboratorio: aplica sobre una copia del libro los
 * ajustes que el laboratorio calculó para cuadrarlo a 0 — el importe de
 * venta de cada producto con diferencia (y su precio de venta cuando
 * manda el importe), la ganancia y los totales de su hoja, y las
 * cifras del Desglose (ventas del día, total de cuentas por cobrar,
 * total de fondos y CUADRE en 0). Es la ÚNICA vía que reescribe cifras
 * de un IPV y vive aislada en el laboratorio: el archivo original no
 * se toca y el resultado es un Excel nuevo que el usuario descarga y
 * decide si importa por la vía normal. Las celdas llevan la fórmula
 * de la plantilla con el valor corregido en caché, para que SDA pueda
 * reimportarlo sin abrirlo antes en Excel. */
export async function buildCorrectedIpv(file: File, corrections: IpvLabCorrections): Promise<Blob> {
  const files = await unzipAll(await file.arrayBuffer());
  const workbookKey = "xl/workbook.xml";
  const relsKey = "xl/_rels/workbook.xml.rels";
  const typesKey = "[Content_Types].xml";
  const workbook = xmlDoc(dec.decode(files.get(workbookKey) ?? new Uint8Array()));
  const rels = xmlDoc(dec.decode(files.get(relsKey) ?? new Uint8Array()));
  const types = xmlDoc(dec.decode(files.get(typesKey) ?? new Uint8Array()));
  const shared = loadShared(files);
  const sheets = loadSheets(files, workbook, rels);

  const touched = new Set<SheetPart>();
  for (const product of corrections.products) {
    const sheet = product.dept === "Cantina" ? findSheet(sheets, "Cantina", "Coctelería") : findSheet(sheets, product.dept);
    if (!sheet) continue;
    const headerRow = findRowNumber(sheet, shared, "Precio de venta", 1);
    const totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
    const row = rowElements(sheet.doc).find((candidate) => {
      const r = Number(candidate.getAttribute("r") ?? 0);
      if (headerRow > 0 && r <= headerRow) return false;
      if (totalRow > 0 && r >= totalRow) return false;
      if (!readCell(findCell(candidate, 1), shared)) return false;
      return norm(readCell(findCell(candidate, 3), shared)) === norm(product.name);
    });
    if (!row) continue;
    const r = Number(row.getAttribute("r") ?? 0);
    if (product.precioVenta != null) setCell(sheet.doc, row, 13, product.precioVenta, undefined, findCell(row, 13));
    setFormulaCell(sheet.doc, row, 14, `K${r}*M${r}`, product.importeVenta);
    setFormulaCell(sheet.doc, row, 17, `N${r}-P${r}`, product.ganancia);
    touched.add(sheet);
  }
  for (const sheet of touched) {
    const headerRow = findRowNumber(sheet, shared, "Precio de venta", 1);
    const totalRow = findRowNumber(sheet, shared, "TOTAL", Math.max(1, headerRow + 1));
    const total = totalRow > 0 ? rowAt(sheet.doc, totalRow) : undefined;
    if (!total || headerRow < 0 || totalRow < 0) continue;
    for (const col of [14, 16, 17]) setFormulaCell(sheet.doc, total, col, `SUM(${colLetters(col)}${headerRow + 1}:${colLetters(col)}${totalRow - 1})`, sumColumn(sheet.doc, shared, col, headerRow + 1, totalRow - 1));
  }

  if (corrections.desglose) {
    const sheet = findSheet(sheets, "Desglose");
    if (sheet) {
      // Misma lectura que hace el importador: la etiqueta en una celda
      // y el importe en la primera celda numérica a su derecha (o en la
      // columna indicada cuando la plantilla la fija, como las cuentas).
      const setLabelValue = (needle: string, value: number, col?: number) => {
        const rowNumber = findRowNumber(sheet, shared, needle, 1);
        if (rowNumber < 0) return;
        const row = rowAt(sheet.doc, rowNumber);
        if (!row) return;
        if (col != null) { setCell(sheet.doc, row, col, value, undefined, findCell(row, col)); return; }
        const cells = cellsOf(row);
        const labelCell = cells.find((cell) => norm(readCell(cell, shared)).includes(norm(needle)));
        const labelCol = labelCell ? colNumber(labelCell.getAttribute("r") ?? "") : 1;
        const numeric = cells.find((cell) => colNumber(cell.getAttribute("r") ?? "") > labelCol && readCell(cell, shared) !== "" && Number.isFinite(Number(readCell(cell, shared).replace(",", "."))));
        const targetCol = numeric ? colNumber(numeric.getAttribute("r") ?? "") : labelCol + 1;
        setCell(sheet.doc, row, targetCol, value, undefined, numeric ?? labelCell);
      };
      setLabelValue("Ventas del día", corrections.desglose.ventas);
      setLabelValue("Total cuentas por cobrar", corrections.desglose.totalCuentas, 2);
      setLabelValue("Total de fondos", corrections.desglose.totalFondos);
      setLabelValue("CUADRE", corrections.desglose.cuadre);
    }
  }

  let calcPr = workbook.getElementsByTagNameNS(MAIN_NS, "calcPr")[0];
  if (!calcPr) { calcPr = workbook.createElementNS(MAIN_NS, "calcPr"); workbook.documentElement.appendChild(calcPr); }
  calcPr.setAttribute("calcMode", "auto"); calcPr.setAttribute("fullCalcOnLoad", "1"); calcPr.setAttribute("forceFullCalc", "1");

  for (const sheet of sheets) files.set(sheet.key, enc.encode(new XMLSerializer().serializeToString(sheet.doc)));
  files.set(workbookKey, enc.encode(new XMLSerializer().serializeToString(workbook)));
  files.set(relsKey, enc.encode(new XMLSerializer().serializeToString(rels)));
  files.set(typesKey, enc.encode(new XMLSerializer().serializeToString(types)));
  const output = await zipAll(files);

  const reopened = await unzipAll(output.slice().buffer as ArrayBuffer);
  if (!reopened.has("[Content_Types].xml") || !reopened.has(workbookKey) || !reopened.has(relsKey)) throw new Error("El IPV corregido no superó la prueba de apertura de Excel.");
  return new Blob([output as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export type CostSheetExport = {
  productName: string;
  dept: string;
  date: string;
  currency: string;
  servings: number;
  unitsPerServing: number;
  wastePct: number;
  laborWorkerName: string;
  laborMinutes: number;
  laborCost: number;
  cookingHours: number;
  charcoalUsePct: number;
  cookingCostPerHour: number;
  cookingCost?: number;
  overheadPct?: number;
  overheadCost?: number;
  salePrice: number;
  targetMarginPct: number;
  variationBufferPct: number;
  /** Costo de los ingredientes SIN la merma aplicada (tal como lo
   *  muestra la ficha en pantalla, que distingue ambos importes). */
  ingredientsRawCost: number;
  /** Costo de los ingredientes CON la merma ya aplicada. */
  ingredientsCost: number;
  /** Subida de costos que la ficha aguanta antes de perder (%). */
  tolerancePct: number;
  totalRecipeCost: number;
  costPerServing: number;
  costPerUnit: number;
  profitPerServing: number;
  marginPct: number;
  suggestedPrice: number;
  scenarios: { rise: number; costPerServing: number; profit: number; marginPct: number }[];
  ingredients: { ingredient: string; amountUsed: number; unit: string; purchasePrice: number; purchasedAmount: number; cost: number; note: string }[];
};

/** Libro XLSX autocontenido para una ficha de costo. Se genera en el cliente
 * con los datos que el usuario ya revisó; el mismo blob se entrega en
 * «Archivo listo» y se adjunta al correo configurado. */
function costSheetWorksheetXml(sheet: CostSheetExport): string {
  const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
  const s = (ref: string, value: string, style = 0) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  const n = (ref: string, value: number, style = 0) => `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  const rows: string[] = [];
  rows.push(row(1, s("A1", "FICHA DE COSTO", 1)));
  rows.push(row(2, s("A2", sheet.productName, 2)));
  rows.push(row(3, s("A3", "Departamento", 3) + s("B3", sheet.dept) + s("D3", "Fecha", 3) + s("E3", sheet.date)));
  rows.push(row(4, s("A4", "Raciones", 3) + n("B4", sheet.servings, 4) + s("C4", "Unidades por ración (informativo)", 3) + n("D4", sheet.unitsPerServing, 4) + s("E4", "Merma %", 3) + n("F4", sheet.wastePct, 4)));
  rows.push(row(5, s("A5", "Persona que elabora", 3) + s("B5", sheet.laborWorkerName || "Sin mano de obra") + s("D5", "Tiempo (min)", 3) + n("E5", sheet.laborMinutes, 4)));
  rows.push(row(6, s("A6", "Tiempo de cocción (horas)", 3) + n("B6", sheet.cookingHours, 4) + s("C6", `Costo promedio por hora · ${sheet.charcoalUsePct} % carbón / ${100 - sheet.charcoalUsePct} % electricidad`, 3) + n("D6", sheet.cookingCostPerHour, 5) + s("E6", sheet.currency, 3)));
  rows.push(row(7, s("A7", "INGREDIENTES", 1)));
  rows.push(row(8, [s("A8", "Ingrediente", 3), s("B8", "Cantidad usada", 3), s("C8", "Unidad", 3), s("D8", "Precio compra", 3), s("E8", "Rendimiento", 3), s("F8", "Costo", 3), s("G8", "Observaciones", 3)].join("")));
  let r = 9;
  for (const item of sheet.ingredients) {
    rows.push(row(r, s(`A${r}`, item.ingredient) + n(`B${r}`, item.amountUsed, 4) + s(`C${r}`, item.unit) + n(`D${r}`, item.purchasePrice, 5) + n(`E${r}`, item.purchasedAmount, 4) + n(`F${r}`, item.cost, 5) + s(`G${r}`, item.note)));
    r += 1;
  }
  r += 1;
  const metrics: [string, number, string][] = [
    ["Ingredientes (sin merma)", sheet.ingredientsRawCost, sheet.currency], [`Ingredientes con merma (${sheet.wastePct} %)`, sheet.ingredientsCost, sheet.currency], ["Mano de obra", sheet.laborCost, sheet.currency],
    ...(sheet.cookingCost != null ? [["Cocción (repartida entre las raciones)", sheet.cookingCost, sheet.currency] as [string, number, string]] : []),
    ...(sheet.overheadCost != null ? [[`Gastos generales y fijos · global (${sheet.overheadPct ?? 0} %)`, sheet.overheadCost, sheet.currency] as [string, number, string]] : []),
    ["Costo total de la receta", sheet.totalRecipeCost, sheet.currency],
    ["Costo por ración (precio mínimo para no perder)", sheet.costPerServing, sheet.currency], ["Costo por unidad (informativo)", sheet.costPerUnit, sheet.currency], ["Precio de venta", sheet.salePrice, sheet.currency],
    ["Ganancia por ración", sheet.profitPerServing, sheet.currency], ["Margen", sheet.marginPct, "%"], ["Subida de costos que aguanta", sheet.tolerancePct, "%"], ["Margen meta · global", sheet.targetMarginPct, "%"],
    ["Colchón por variación · global", sheet.variationBufferPct, "%"], ["Precio sugerido", sheet.suggestedPrice, sheet.currency],
  ];
  rows.push(row(r, s(`A${r}`, "RESUMEN", 1))); r += 1;
  for (const [label, value, unit] of metrics) { rows.push(row(r, s(`A${r}`, label, 3) + n(`B${r}`, value, unit === "%" ? 4 : 5) + s(`C${r}`, unit))); r += 1; }
  // Los mismos 3 escenarios de la ficha en pantalla: costo actual y qué
  // pasa si los costos suben 10 % o 20 %.
  let scenarioTitleRow = 0;
  if (sheet.scenarios.length > 0) {
    r += 1;
    scenarioTitleRow = r;
    rows.push(row(r, s(`A${r}`, "¿Y SI SUBEN LOS PRECIOS?", 1))); r += 1;
    rows.push(row(r, s(`A${r}`, "Subida de costos", 3) + s(`B${r}`, "Costo por ración", 3) + s(`D${r}`, "Ganancia por ración", 3) + s(`E${r}`, "Margen", 3))); r += 1;
    for (const scenario of sheet.scenarios) {
      rows.push(row(r, s(`A${r}`, `+${scenario.rise} %`, 3) + n(`B${r}`, scenario.costPerServing, 5) + s(`C${r}`, sheet.currency) + n(`D${r}`, scenario.profit, 5) + n(`E${r}`, scenario.marginPct, 4) + s(`F${r}`, "%")));
      r += 1;
    }
  }
  rows.push(row(r + 1, s(`A${r + 1}`, `Cálculo aproximado. Revisa cantidades, rendimientos y precios antes de tomar una decisión. · ${DOC_STYLE.systemName} · ${DOC_STYLE.business}`, 6)));
  const merges = ["A1:G1", "A2:G2", "A7:G7", ...(scenarioTitleRow > 0 ? [`A${scenarioTitleRow}:G${scenarioTitleRow}`] : [])];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NS}"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="17" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="6" width="18" customWidth="1"/><col min="7" max="7" width="42" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells></worksheet>`;
  return sheetXml;
}

// Estilos premium de las fichas de costo (misma paleta que el resto de
// documentos, ./docStyle): cabecera verde profundo con letra blanca,
// títulos en verde profundo, bordes del tema y cifras en formato claro.
const COST_SHEET_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN_NS}"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF0B3D2E"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0B3D2E"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3D2E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F2EC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFDDE8E1"/></left><right style="thin"><color rgb="FFDDE8E1"/></right><top style="thin"><color rgb="FFDDE8E1"/></top><bottom style="thin"><color rgb="FFDDE8E1"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="4" fontId="3" fillId="3" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Empaqueta una o varias hojas de ficha en un libro XLSX válido: la
 * misma estructura y estilos para la exportación individual y para el
 * «Descargar todo» con una hoja por producto. */
async function buildCostSheetsWorkbook(worksheets: { name: string; xml: string }[]): Promise<Blob> {
  const files = new Map<string, Uint8Array>();
  const sheetOverrides = worksheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  files.set("[Content_Types].xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`));
  files.set("_rels/.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  const sheetTags = worksheets.map((ws, i) => `<sheet name="${xml(ws.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  files.set("xl/workbook.xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheetTags}</sheets><calcPr calcMode="auto"/></workbook>`));
  const relTags = worksheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${worksheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  files.set("xl/_rels/workbook.xml.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags}</Relationships>`));
  files.set("xl/styles.xml", enc.encode(COST_SHEET_STYLES_XML));
  worksheets.forEach((ws, i) => files.set(`xl/worksheets/sheet${i + 1}.xml`, enc.encode(ws.xml)));
  const output = await zipAll(files);
  const reopened = await unzipAll(output.slice().buffer as ArrayBuffer);
  if (!reopened.has("xl/workbook.xml") || !reopened.has("xl/worksheets/sheet1.xml")) throw new Error("La ficha no superó la comprobación de apertura de Excel.");
  return new Blob([output as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Libro XLSX de UNA ficha de costo (la exportación individual de siempre). */
export async function buildCostSheetXlsx(sheet: CostSheetExport): Promise<Blob> {
  return buildCostSheetsWorkbook([{ name: "Ficha de costo", xml: costSheetWorksheetXml(sheet) }]);
}

/** Libro XLSX con TODAS las fichas llenas: una hoja por producto, con el
 * mismo contenido que exporta cada ficha por separado. El nombre de cada
 * hoja es el del producto (Excel limita a 31 caracteres y prohíbe algunos
 * signos; los duplicados se numeran). */
export async function buildAllCostSheetsXlsx(sheets: CostSheetExport[]): Promise<Blob> {
  const used = new Set<string>();
  const worksheets = sheets.map((sheet) => {
    const base = (sheet.productName.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Ficha").slice(0, 31);
    let name = base;
    let suffix = 2;
    while (used.has(name.toLocaleLowerCase("es"))) {
      const tag = ` (${suffix})`;
      name = `${base.slice(0, 31 - tag.length)}${tag}`;
      suffix += 1;
    }
    used.add(name.toLocaleLowerCase("es"));
    return { name, xml: costSheetWorksheetXml(sheet) };
  });
  return buildCostSheetsWorkbook(worksheets);
}
