// ═══════════════════════════════════════════════════════════
//  Google Apps Script — 道路檢測資料庫
//
//  SN  → 單一工作表 "SN_Data"
//  IRI → 依路線_方向_車道 細分，例如 "IRI_國道1號_南下_外側車道"
//
//  POST body: CSV 文字 (header row + data rows)
//  POST ?type=sn|iri
// ═══════════════════════════════════════════════════════════

const SS_ID     = PropertiesService.getScriptProperties().getProperty('SS_ID');
const API_SECRET = PropertiesService.getScriptProperties().getProperty('API_SECRET');

// ─── Auth helper ─────────────────────────────────────────
function isAuthorized(e) {
  // 嚴格 Fail-Closed：若 ScriptProperties 未設定 API_SECRET，一律拒絕所有存取
  if (!API_SECRET || API_SECRET.trim().length === 0) {
    console.error('[Auth] API_SECRET is not configured in ScriptProperties. Failing closed.');
    return false;
  }
  return e && e.parameter && e.parameter.key === API_SECRET;
}

const SN_SHEET = 'SN_Data';

const SN_HEADERS  = ['date', 'route', 'direction', 'lane', 'mileage', 'sn'];
const IRI_HEADERS = ['date', 'time', 'route', 'direction', 'lane', 'mileage', 'avgIri', 'avgPrqi'];

const ALLOWED_ROUTES = [
  '國道1號', '國道2號', '國道3號', '國道3甲', '國道4號',
  '國道5號', '國道6號', '國道7號', '國道8號', '國道10號',
  '台61線', '台62線', '台64線', '台65線', '台66線', '台68線', '台72線', '台74線', '台76線', '台78線', '台82線', '台84線', '台86線', '台88線'
];

function sanitizeRoute(route) {
  var s = String(route || '').trim();
  if (ALLOWED_ROUTES.indexOf(s) !== -1) return s;
  var safe = s.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_ ]/g, '').trim().slice(0, 30);
  return safe || '其他路線';
}

// ─── Entry Points ────────────────────────────────────────

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!isAuthorized(e)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

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

    // 防止超大 payload 耗盡 GAS quota（DoS 防護）
    var MAX_RECORDS = 5000;
    if (lines.length - 1 > MAX_RECORDS) {
      return jsonResponse({ success: false, error: 'Too many records (max ' + MAX_RECORDS + ')' });
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
      // SN：依 route (國道別) 分組，各寫一個工作表
      var groups = {};
      records.forEach(function(r) {
        var routeSafe = sanitizeRoute(r.route);
        var key = 'SN_' + routeSafe;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      var groupKeys = Object.keys(groups);
      if (groupKeys.length > 20) {
        return jsonResponse({ success: false, error: 'Too many distinct sheet groups (max 20)' });
      }

      groupKeys.forEach(function(sheetName) {
        appendRows(sheetName, SN_HEADERS, groups[sheetName]);
      });

    } else {
      // IRI：依 route + direction + lane 分組，各寫一個工作表
      var groups = {};
      records.forEach(function(r) {
        var key = iriSheetName(r.route, r.direction, r.lane);
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      var groupKeys = Object.keys(groups);
      if (groupKeys.length > 20) {
        return jsonResponse({ success: false, error: 'Too many distinct sheet groups (max 20)' });
      }

      groupKeys.forEach(function(sheetName) {
        appendRows(sheetName, IRI_HEADERS, groups[sheetName]);
      });
    }

    // 寫入後清除快取與整併工作表，並更新 LAST_UPDATED 時間戳記
    try {
      clearLargeCache('data_sn');
      clearLargeCache('data_iri');
      clearLargeCache('data_all');
      PropertiesService.getScriptProperties().setProperty('LAST_UPDATED', String(Date.now()));
      
      var ss = SpreadsheetApp.openById(SS_ID);
      var cacheSheet = ss.getSheetByName('_CACHE_ALL_');
      if (cacheSheet) {
        ss.deleteSheet(cacheSheet);
      }
    } catch(_) {}

    return jsonResponse({ success: true, inserted: records.length });
  } catch (err) {
    console.error('[doPost]', err);
    return jsonResponse({ success: false, error: 'Internal server error' });
  }
}

function doGet(e) {
  try {
    if (!isAuthorized(e)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    const type = (e.parameter.type || '').toLowerCase();
    const nocache = e.parameter.nocache === '1' || e.parameter.nocache === 'true';

    // ── 輕量 Metadata 檢查（~150ms），前端可用於比對是否需要重新拉取全量資料 ──
    if (type === 'meta') {
      const lastUpdated = PropertiesService.getScriptProperties().getProperty('LAST_UPDATED') || '0';
      return jsonResponse({ success: true, lastUpdated: Number(lastUpdated) });
    }

    if (type === 'all') {
      const lastUpdated = Number(PropertiesService.getScriptProperties().getProperty('LAST_UPDATED') || Date.now());

      if (!nocache) {
        const cached = getLargeCache('data_all');
        if (cached) {
          return jsonResponse({ success: true, ...cached, cached: true, lastUpdated: lastUpdated });
        }
      }

      const ss = SpreadsheetApp.openById(SS_ID);
      
      // 優先檢查是否有整併快取工作表（1 次 API 讀取取代 30+ 次逐表讀取）
      var cacheSheet = ss.getSheetByName('_CACHE_ALL_');
      var snRows = [];
      var iriRows = [];
      var fromCacheSheet = false;

      if (cacheSheet && !nocache) {
        try {
          var cacheData = cacheSheet.getDataRange().getValues();
          if (cacheData.length > 1) {
            for (var i = 1; i < cacheData.length; i++) {
              var row = cacheData[i];
              if (row[0] === 'SN') {
                snRows.push(row.slice(1, SN_HEADERS.length + 1));
              } else if (row[0] === 'IRI') {
                iriRows.push(row.slice(1, IRI_HEADERS.length + 1));
              }
            }
            fromCacheSheet = true;
          }
        } catch (err) {
          console.warn('[CacheSheet] 讀取失敗，回退至全表掃描', err);
        }
      }

      if (!fromCacheSheet) {
        const allSheets = ss.getSheets();
        allSheets.forEach(function(sheet) {
          var name = sheet.getName();
          if (name.indexOf('SN_') === 0) {
            snRows = snRows.concat(readSheetRawRows(sheet));
          } else if (name.indexOf('IRI_') === 0) {
            iriRows = iriRows.concat(readSheetRawRows(sheet));
          }
        });

        // 背景建立/更新 _CACHE_ALL_ 隱藏工作表，供後續秒級讀取
        try {
          if (!cacheSheet) {
            cacheSheet = ss.insertSheet('_CACHE_ALL_');
            cacheSheet.hideSheet();
          } else {
            cacheSheet.clear();
          }
          var consolidated = [['TYPE'].concat(IRI_HEADERS)];
          snRows.forEach(function(r) { consolidated.push(['SN'].concat(r)); });
          iriRows.forEach(function(r) { consolidated.push(['IRI'].concat(r)); });
          if (consolidated.length > 1) {
            var maxCols = Math.max(SN_HEADERS.length, IRI_HEADERS.length) + 1;
            var padded = consolidated.map(function(r) {
              while (r.length < maxCols) r.push('');
              return r;
            });
            cacheSheet.getRange(1, 1, padded.length, maxCols).setValues(padded);
          }
        } catch (err) {
          console.warn('[CacheSheet] 寫入整併表失敗', err);
        }
      }

      var result = {
        sn: { headers: SN_HEADERS, rows: snRows },
        iri: { headers: IRI_HEADERS, rows: iriRows },
        lastUpdated: lastUpdated
      };

      setLargeCache('data_all', result);
      return jsonResponse({ success: true, ...result });

    } else if (type === 'sn') {
      if (!nocache) {
        const cached = getLargeCache('data_sn');
        if (cached) {
          return jsonResponse({ success: true, data: cached, cached: true });
        }
      }

      const ss     = SpreadsheetApp.openById(SS_ID);
      const sheets = ss.getSheets().filter(function(s) {
        return s.getName().indexOf('SN_') === 0;
      });

      var allData = [];
      sheets.forEach(function(sheet) {
        allData = allData.concat(readSheetObj(sheet, SN_HEADERS));
      });

      setLargeCache('data_sn', allData);
      return jsonResponse({ success: true, data: allData });

    } else if (type === 'iri') {
      if (!nocache) {
        const cached = getLargeCache('data_iri');
        if (cached) {
          return jsonResponse({ success: true, data: cached, cached: true });
        }
      }

      const ss     = SpreadsheetApp.openById(SS_ID);
      const sheets = ss.getSheets().filter(function(s) {
        return s.getName().indexOf('IRI_') === 0;
      });

      var allData = [];
      sheets.forEach(function(sheet) {
        allData = allData.concat(readSheetObj(sheet, IRI_HEADERS));
      });

      setLargeCache('data_iri', allData);
      return jsonResponse({ success: true, data: allData });

    } else if (type === 'iri_sheets') {
      // 回傳 IRI 有哪些工作表（方便前端列清單）
      const ss     = SpreadsheetApp.openById(SS_ID);
      const names  = ss.getSheets()
        .map(function(s) { return s.getName(); })
        .filter(function(n) { return n.indexOf('IRI_') === 0; });
      return jsonResponse({ success: true, sheets: names });
    }

    return jsonResponse({ success: false, error: 'type=all|sn|iri|iri_sheets|meta required' });
  } catch (err) {
    console.error('[doGet]', err);
    return jsonResponse({ success: false, error: 'Internal server error' });
  }
}

// ─── IRI 工作表命名規則 ──────────────────────────────────
// 格式：IRI_<route>_<direction>_<lane>
// 例如：IRI_國道1號_南下_外側車道

function iriSheetName(route, direction, lane) {
  var safeRoute = sanitizeRoute(route);
  var safeDir = function(s) {
    var d = String(s || '未知方向').replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_ ]/g, '').trim();
    return d.slice(0, 15) || '未知方向';
  };
  var safeLane = function(s) {
    var l = String(s || '未知車道').replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_ ]/g, '').trim();
    return l.slice(0, 15) || '未知車道';
  };
  return ('IRI_' + safeRoute + '_' + safeDir(direction) + '_' + safeLane(lane)).slice(0, 90);
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

function sanitizeCell(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  // 防範 Google Sheets Formula Injection (CSV / Excel Formula Injection)
  // 若字串以 '=', '+', '-', '@', '\t', '\r' 開頭，補上前綴單引號強制以純文字儲存
  if (/^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

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
    return headers.map(function(h) {
      return sanitizeCell(r[h]);
    });
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

function readSheetRawRows(sheet) {
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  // 跳過 header，並將 Date 物件預先格式化為 YYYY-MM-DD，減輕前端字串轉換負擔
  return vals.slice(1).map(function(row) {
    return row.map(function(cell) {
      if (cell instanceof Date) {
        return Utilities.formatDate(cell, 'Asia/Taipei', 'yyyy-MM-dd');
      }
      return cell;
    });
  });
}

function readSheetObj(sheet, headers) {
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  return vals.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      var val = row[i];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
      }
      obj[h] = val;
    });
    return obj;
  });
}

function setLargeCache(key, dataObj, ttl) {
  var cache = CacheService.getScriptCache();
  var json = JSON.stringify(dataObj);
  var chunkSize = 90000;
  var count = Math.ceil(json.length / chunkSize);

  // 若資料過大超過 CacheService 總額（~2MB），跳過快取改由 _CACHE_ALL_ 工作表提供秒級支援
  if (json.length > 2000000) {
    console.warn('[Cache] 資料量超過 CacheService 限制 (' + json.length + ' bytes)，依賴工作表快取');
    return false;
  }

  try {
    cache.put(key + '_count', String(count), ttl || 21600);
    // 改為單個 chunk 寫入，避免 putAll(dict) 總體積超過 100KB 拋錯
    for (var i = 0; i < count; i++) {
      cache.put(key + '_' + i, json.slice(i * chunkSize, (i + 1) * chunkSize), ttl || 21600);
    }
    return true;
  } catch (e) {
    console.warn('Cache put failed', e);
    return false;
  }
}

function getLargeCache(key) {
  var cache = CacheService.getScriptCache();
  var countStr = cache.get(key + '_count');
  if (!countStr) return null;
  var count = parseInt(countStr, 10);
  var keys = [];
  for (var i = 0; i < count; i++) {
    keys.push(key + '_' + i);
  }
  var chunks = cache.getAll(keys);
  var json = '';
  for (var i = 0; i < count; i++) {
    var chunk = chunks[key + '_' + i];
    if (!chunk) return null;
    json += chunk;
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function clearLargeCache(key) {
  var cache = CacheService.getScriptCache();
  try {
    var countStr = cache.get(key + '_count');
    if (countStr) {
      var count = parseInt(countStr, 10);
      var keys = [key + '_count'];
      for (var i = 0; i < count; i++) {
        keys.push(key + '_' + i);
      }
      cache.removeAll(keys);
    }
    cache.remove(key);
  } catch (_) {}
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
