// ═══════════════════════════════════════════════════════════
//  Google Apps Script — 道路檢測資料庫
//
//  SN  → 單一工作表 "SN_Data"
//  IRI → 依路線_方向_車道 細分，例如 "IRI_國道1號_南下_外側車道"
//
//  POST body: CSV 文字 (header row + data rows)
//  POST ?type=sn|iri
// ═══════════════════════════════════════════════════════════

const SS_ID = PropertiesService.getScriptProperties().getProperty('SS_ID');

const SN_SHEET = 'SN_Data';

const SN_HEADERS  = ['date', 'route', 'direction', 'lane', 'mileage', 'sn'];
const IRI_HEADERS = ['date', 'time', 'route', 'direction', 'lane', 'mileage', 'avgIri', 'avgPrqi'];

// ─── Entry Points ────────────────────────────────────────

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const type = (e.parameter.type || '').toLowerCase();

    if (type !== 'sn' && type !== 'iri') {
      return jsonResponse({ success: false, error: 'type=sn or type=iri required' });
    }

    // ── 解析 CSV body ────────────────────────────────────
    const csv   = e.postData.contents || '';
    const lines = csv.split('\n').filter(function(l) { return l.trim().length > 0; });
    if (lines.length < 2) {
      return jsonResponse({ success: false, error: 'Empty CSV body' });
    }

    const headers = parseCsvLine(lines[0]);
    const records = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = parseCsvLine(lines[i]);
      var obj  = {};
      headers.forEach(function(h, idx) { obj[h] = vals[idx] !== undefined ? vals[idx] : ''; });
      records.push(obj);
    }

    if (records.length === 0) {
      return jsonResponse({ success: false, error: 'No records parsed' });
    }

    if (type === 'sn') {
      // SN：統一寫入 SN_Data
      appendRows(SN_SHEET, SN_HEADERS, records);

    } else {
      // IRI：依 route + direction + lane 分組，各寫一個工作表
      var groups = {};
      records.forEach(function(r) {
        var key = iriSheetName(r.route, r.direction, r.lane);
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      Object.keys(groups).forEach(function(sheetName) {
        appendRows(sheetName, IRI_HEADERS, groups[sheetName]);
      });
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
      return jsonResponse({ success: true, data: readSheet(SN_SHEET, SN_HEADERS) });

    } else if (type === 'iri') {
      // 掃描所有 IRI_ 開頭的工作表，合併回傳
      const ss     = SpreadsheetApp.openById(SS_ID);
      const sheets = ss.getSheets().filter(function(s) {
        return s.getName().indexOf('IRI_') === 0;
      });

      var allData = [];
      sheets.forEach(function(sheet) {
        allData = allData.concat(readSheetObj(sheet, IRI_HEADERS));
      });

      return jsonResponse({ success: true, data: allData });

    } else if (type === 'iri_sheets') {
      // 回傳 IRI 有哪些工作表（方便前端列清單）
      const ss     = SpreadsheetApp.openById(SS_ID);
      const names  = ss.getSheets()
        .map(function(s) { return s.getName(); })
        .filter(function(n) { return n.indexOf('IRI_') === 0; });
      return jsonResponse({ success: true, sheets: names });
    }

    return jsonResponse({ success: false, error: 'type=sn|iri|iri_sheets required' });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

// ─── IRI 工作表命名規則 ──────────────────────────────────
// 格式：IRI_<route>_<direction>_<lane>
// 例如：IRI_國道1號_南下_外側車道

function iriSheetName(route, direction, lane) {
  // 去除不能用在 Sheet 名稱的字元（/ \ ? * [ ]），最長 100 字
  var safe = function(s) {
    return String(s || '未知').replace(/[\/\\?*\[\]]/g, '').trim();
  };
  return ('IRI_' + safe(route) + '_' + safe(direction) + '_' + safe(lane)).slice(0, 100);
}

// ─── CSV Parser (RFC 4180) ───────────────────────────────

function parseCsvLine(line) {
  var result = [];
  var cur    = '';
  var inQ    = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"')      { inQ = true; }
      else if (ch === ',') { result.push(cur.trim()); cur = ''; }
      else                 { cur += ch; }
    }
  }
  result.push(cur.trim());
  return result;
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
  const rows  = records.map(function(r) {
    return headers.map(function(h) { return r[h] !== undefined ? r[h] : ''; });
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
}

function readSheet(sheetName, headers) {
  const ss    = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  return readSheetObj(sheet, headers);
}

function readSheetObj(sheet, headers) {
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  // 跳過第一列 header
  return vals.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
