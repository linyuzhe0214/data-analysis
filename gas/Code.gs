// ═══════════════════════════════════════════════════════════
//  Google Apps Script — 道路檢測資料庫
//  Sheet: "SN_Data" | "IRI_Data"
//
//  SN  Schema : date | route | direction | lane | mileage | sn
//  IRI Schema : date | time | route | direction | lane | mileage | avgIri | avgPrqi
// ═══════════════════════════════════════════════════════════

// SS_ID 存在 GAS Script Properties，不寫死在程式碼裡
// 設定方式：GAS 編輯器 → 專案設定 → 指令碼屬性 → 新增 SS_ID
const SS_ID = PropertiesService.getScriptProperties().getProperty('SS_ID');

const SN_SHEET  = 'SN_Data';
const IRI_SHEET = 'IRI_Data';

const SN_HEADERS  = ['date', 'route', 'direction', 'lane', 'mileage', 'sn'];
const IRI_HEADERS = ['date', 'time', 'route', 'direction', 'lane', 'mileage', 'avgIri', 'avgPrqi'];

// ─── CORS + Entry Point ──────────────────────────────────

function doOptions() {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { type, records } = payload; // type: 'sn' | 'iri'

    if (!type || !Array.isArray(records) || records.length === 0) {
      return jsonResponse({ success: false, error: 'Invalid payload' });
    }

    if (type === 'sn') {
      appendRows(SN_SHEET, SN_HEADERS, records);
    } else if (type === 'iri') {
      appendRows(IRI_SHEET, IRI_HEADERS, records);
    } else {
      return jsonResponse({ success: false, error: `Unknown type: ${type}` });
    }

    return jsonResponse({ success: true, inserted: records.length });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    const type = (e.parameter.type || '').toLowerCase();
    if (type === 'sn') {
      const data = readSheet(SN_SHEET, SN_HEADERS);
      return jsonResponse({ success: true, data });
    } else if (type === 'iri') {
      const data = readSheet(IRI_SHEET, IRI_HEADERS);
      return jsonResponse({ success: true, data });
    }
    return jsonResponse({ success: false, error: 'type=sn or type=iri required' });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

// ─── Sheet Helpers ───────────────────────────────────────

function getOrCreateSheet(sheetName, headers) {
  const ss    = SpreadsheetApp.openById(SS_ID);
  let   sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4a86e8')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendRows(sheetName, headers, records) {
  const sheet = getOrCreateSheet(sheetName, headers);
  const rows  = records.map(r => headers.map(h => r[h] ?? ''));
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
      .setValues(rows);
  }
}

function readSheet(sheetName, headers) {
  const ss    = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const [, ...dataRows] = sheet.getDataRange().getValues(); // skip header
  return dataRows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
