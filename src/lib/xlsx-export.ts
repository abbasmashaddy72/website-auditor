/** Small single-sheet XLSX writer for reports. ZIP/XML only; no new runtime dependencies.
 * Strings use inlineStr, NEVER Excel formulas, so imported audit text cannot execute.
 */
import { zipEntries } from './zip';

export type WorkbookCell = string | number | boolean | Date | null | undefined;
const sanitize = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const xml = (value: string) =>
  sanitize(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const column = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const tableCell = (value: WorkbookCell, address: string, header: boolean): string => {
  const style = header ? ' s="1"' : '';
  if (typeof value === 'number' && Number.isFinite(value))
    return `<c r="${address}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${address}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  // Excel cells have a 32,767 UTF-16-code-unit limit. Keep exports readable and
  // make any truncation explicit; JSON remains the full-fidelity alternative.
  const note = ' [truncated: use JSON export for full value]';
  const string = raw.length > 32767 ? raw.slice(0, 32767 - note.length) + note : raw;
  // Inline strings cannot be executed as formula cells even when prefixed with =, +, @, or -.
  return `<c r="${address}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(string)}</t></is></c>`;
};
const tableRow = (cells: WorkbookCell[], index: number, header: boolean) =>
  `<row r="${index}">${cells.map((v, i) => tableCell(v, column(i) + index, header)).join('')}</row>`;
export function buildXlsx(headers: string[], rows: WorkbookCell[][], title = 'Audit'): Buffer {
  if (!headers.length || headers.length > 100 || rows.length > 10000)
    throw Error('Excel export requires 1–100 columns and at most 10,000 rows');
  if (rows.some((row) => row.length > headers.length)) throw Error('Excel row exceeds defined columns');
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i < 4 ? 30 : 21}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${tableRow(headers, 1, true)}${rows.map((row, i) => tableRow(row, i + 2, false)).join('')}</sheetData>` +
    '</worksheet>';
  const safeTitle =
    sanitize(title)
      .replace(/[\\/*?:\[\]]/g, '')
      .slice(0, 31) || 'Audit';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const docRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parts = [
    {
      name: '[Content_Types].xml',
      value:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      value:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${docRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      value:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="${main}" xmlns:r="${docRel}">` +
        `<sheets><sheet name="${xml(safeTitle)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      value:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${docRel}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${docRel}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      value:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>` +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
    },
    { name: 'xl/worksheets/sheet1.xml', value: sheet },
  ];
  return zipEntries(parts.map((part) => ({ name: part.name, bytes: Buffer.from(part.value, 'utf8') })));
}
