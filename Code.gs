/*************************************************************
 *  HỆ THỐNG KIỂM TRA ONLINE – SK MỨC 3 (Apps Script Backend)
 *  Lưu ý: dùng thuật ngữ chính thức "SK" (Sáng kiến).
 *  Tạo các Sheet qua setupSheets(), deploy Web app để lấy URL /exec
 *************************************************************/

const CONFIG = {
  // DÁN Spreadsheet ID thực tế (chuỗi giữa /d/ và /edit)
  SHEET_ID: 'THAY_SHEET_ID',
  TOKEN_TTL_SEC: 2*60*60, // TTL token đăng nhập (giây)
  MAIL_SENDER: 'SK – Hệ thống kiểm tra (THPT Nguyễn Đình Chiểu)'
};

/* ============ TIỆN ÍCH CƠ BẢN ============ */
function sh(name){ return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(name); }
function nowISO(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); }
function jsonOut(obj){ const out = ContentService.createTextOutput(JSON.stringify(obj)); out.setMimeType(ContentService.MimeType.JSON); return out; }
function sha256(s){ return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(b=>('0'+(b&0xff).toString(16)).slice(-2)).join(''); }
function cache(){ return CacheService.getScriptCache(); }
function getBody(){ try{ return JSON.parse(echo().body||'{}'); }catch(_){ return {}; } }
function echo(){ return { body: (typeof this.__body!=='undefined')? this.__body : '' }; }

/* ============ AUTH ============ */
function makeToken(cccd){
  const payload = { cccd, exp: Date.now() + CONFIG.TOKEN_TTL_SEC*1000, rnd: Utilities.getUuid() };
  return Utilities.base64EncodeWebSafe(JSON.stringify(payload));
}
function verifyToken(token){
  try{
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString());
    if(!p || !p.cccd || !p.exp || Date.now()>p.exp) return null;
    return p;
  }catch(_){ return null; }
}

/* ============ ROUTER ============ */
function doGet(e){ return route('GET', e); }
function doPost(e){ return route('POST', e); }

function route(method, e){
  const action = (e && e.parameter && e.parameter.action || '').trim();
  this.__body = method==='POST' ? (e.postData && e.postData.contents || '') : '';
  try{
    if(action==='pingSheet'){ return jsonOut({ok:true, msg:'GET ok', echo:{}}); }
    if(action==='setupSheets'){ return jsonOut(setupSheets()); }
    if(action==='register'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(registerUser(body)); }
    if(action==='login'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(login(body)); }
    if(action==='getExams'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(getExams(body)); }
    if(action==='getQuestions'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(getQuestions(body)); }
    if(action==='submitExam'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(submitExam(body)); }
    if(action==='adminExportCSV'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(adminExportCSV(body)); }
    if(action==='adminStats'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(adminStats(body)); }
    if(action==='adminPercents'){ const body = JSON.parse(this.__body||'{}'); return jsonOut(adminPercents(body)); }
    return jsonOut({ok:false, reason:`Unknown action(${action||method.toLowerCase()})`});
  }catch(err){
    return jsonOut({ok:false, reason:String(err)});
  }
}

/* ============ TẠO SHEETS & HEADER ============ */
function ensureSheet(name, headers){
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let ws = ss.getSheetByName(name);
  if(!ws) ws = ss.insertSheet(name);
  if(headers && headers.length){
    const r = ws.getRange(1,1,1,headers.length); r.setValues([headers]); r.setFontWeight('bold');
  }
  return ws;
}

function setupSheets(){
  ensureSheet('USERS_SYS', ['cccd','passwordHash','email','role']);
  ensureSheet('USERS', ['timestamp','fullname','birth','gender','ethnicity','school','grade','classCode','cccd','email','note']);
  ensureSheet('EXAMS', ['ExamId','title','subject','grade','durationMin','active']);
  ensureSheet('QUESTIONS', ['ExamId','qid','type','text','choicesJson','answer']); // type: single|multi|tf
  ensureSheet('SUBMISSIONS', ['timestamp','cccd','fullname','email','examId','score','total','percent','durationUsedSec','detailJson']);
  ensureSheet('STATS', ['timestamp','examId','count','avgPercent','minPercent','maxPercent']);
  return {ok:true, msg:'Đã chuẩn hoá cấu trúc sheet (SK)'};
}

/* ============ ĐĂNG KÝ & ĐĂNG NHẬP ============ */
function normalizeFullname(s=''){
  s = (s||'').toLowerCase().trim()
    .replace(/\s+/g,' ')
    .replace(/\b(đ)/g,'Đ')
    .replace(/(^|\s)\S/g, m=>m.toUpperCase());
  return s;
}

function registerUser(p){
  const wsU = sh('USERS'), wsSys = sh('USERS_SYS');
  if(!wsU || !wsSys) throw 'Chưa setupSheets';
  const fullname = normalizeFullname(p.fullname||p.ho_ten||p['r_fullname']||'');
  const cccd = String(p.cccd||p['r_cccd']||'').trim();
  const email = String(p.email||p['r_email']||'').trim();
  if(!fullname || !cccd || !email) return {ok:false, reason:'Thiếu họ tên/CCCD/email'};

  const list = wsSys.getRange(2,1,Math.max(wsSys.getLastRow()-1,0),4).getValues()
    .reduce((m,[cc,pw,em,role])=>{ m[cc]=1; return m; },{});
  if(list[cccd]) return {ok:false, reason:'CCCD đã tồn tại'};

  const pass = (''+Math.floor(100000+Math.random()*900000));
  const passHash = sha256(pass);

  wsSys.appendRow([cccd, passHash, email, 'student']);
  wsU.appendRow([nowISO(), fullname, p.birth||'', p.gender||'', p.ethnicity||'', p.school||'',
                 p.grade||'', p.classCode||'', cccd, email, p.note||'']);

  try{
    MailApp.sendEmail({
      to: email,
      subject: `[SK – Hệ thống kiểm tra] Tài khoản đăng nhập`,
      htmlBody: `Xin chào <b>${fullname}</b>,<br>CCCD: <b>${cccd}</b><br>Mật khẩu: <b>${pass}</b><br>Vào hệ thống để đổi mật khẩu sau khi đăng nhập.`,
      name: CONFIG.MAIL_SENDER
    });
  }catch(_){}

  return {ok:true, msg:'Đăng ký thành công. Mật khẩu đã gửi email', cccd};
}

function login(p){
  const ws = sh('USERS_SYS');
  const cccd = String(p.cccd||'').trim();
  const pw = String(p.password||'').trim();
  if(!cccd || !pw) return {ok:false, reason:'Thiếu CCCD/mật khẩu'};
  const rows = ws.getRange(2,1,Math.max(ws.getLastRow()-1,0),4).getValues();
  for(const [cc, pwHash, email, role] of rows){
    if(String(cc)===cccd && String(pwHash)===sha256(pw)){
      const token = makeToken(cccd);
      return {ok:true, token, role: role||'student', email};
    }
  }
  return {ok:false, reason:'Sai CCCD hoặc mật khẩu'};
}

function getExams(p){
  const ws = sh('EXAMS');
  const arr = ws.getRange(2,1,Math.max(ws.getLastRow()-1,0),6).getValues()
    .filter(r => String(r[5]).toLowerCase()==='true' || String(r[5])==='1')
    .map(([ExamId,title,subject,grade,durationMin])=>({ExamId,title,subject,grade,durationMin:Number(durationMin||45)}));
  const grade = String(p.grade||'').trim();
  const subject = String(p.subject||'').trim().toLowerCase();
  return {ok:true, exams: arr.filter(x=> (!grade || String(x.grade)===grade) && (!subject || x.subject.toLowerCase()===subject))};
}

function getQuestions(p){
  const ws = sh('QUESTIONS');
  const examId = String(p.examId||'').trim();
  if(!examId) return {ok:false, reason:'Thiếu examId'};
  const rows = ws.getRange(2,1,Math.max(ws.getLastRow()-1,0),6).getValues()
    .filter(r => String(r[0])===examId)
    .map(([ExamId,qid,type,text,choicesJson,answer])=>{
      let choices=[]; try{choices=JSON.parse(choicesJson||'[]');}catch(_){}
      return {qid, type, text, choices};
    });
  return {ok:true, questions:rows};
}

function submitExam(p){
  const token = p.token||'';
  const pay = verifyToken(token);
  if(!pay) return {ok:false, reason:'Token hết hạn/không hợp lệ'};

  const wsQ = sh('QUESTIONS');
  const wsSub = sh('SUBMISSIONS');
  const wsUsers = sh('USERS');

  const examId = String(p.examId||'').trim();
  const answers = Array.isArray(p.answers)? p.answers : [];
  const durationUsedSec = Number(p.durationUsedSec||0);

  if(!examId || !answers.length) return {ok:false, reason:'Thiếu dữ liệu bài làm'};

  const qRows = wsQ.getRange(2,1,Math.max(wsQ.getLastRow()-1,0),6).getValues().filter(r=>String(r[0])===examId);
  const keyMap = {}; const qList = [];
  qRows.forEach(([ExamId,qid,type,text,choicesJson,answer])=>{
    keyMap[qid] = {type, answer: String(answer||'')};
    qList.push({qid,type,text});
  });

  let score=0, total=qRows.length, detail=[];
  const ansMap = answers.reduce((m,a)=>{ m[a.qid]=a; return m; },{});
  qRows.forEach(([_,qid,type,text])=>{
    const std = keyMap[qid]||{};
    const user = ansMap[qid]||{};
    let isCorrect=false;
    if(type==='single' || type==='tf'){ isCorrect = String(user.answer||'').trim() === String(std.answer); }
    else if(type==='multi'){
      const a = (String(user.answer||'').split(',').map(s=>s.trim()).filter(Boolean)).sort().join(',');
      const b = (String(std.answer||'').split(',').map(s=>s.trim()).filter(Boolean)).sort().join(',');
      isCorrect = a===b;
    }
    if(isCorrect) score++;
    detail.push({qid, type, correct: isCorrect, answer:user.answer||''});
  });

  let fullname='', email='';
  const uRows = wsUsers.getRange(2,1,Math.max(wsUsers.getLastRow()-1,0),11).getValues();
  for(const r of uRows){ if(String(r[8])===pay.cccd){ fullname=r[1]; email=r[9]; break; } }

  const percent = total? Math.round(score*1000/total)/10 : 0;

  wsSub.appendRow([nowISO(), pay.cccd, fullname, email, examId, score, total, percent, durationUsedSec, JSON.stringify(detail)]);

  try{
    MailApp.sendEmail({
      to: email,
      subject: `[SK – Kết quả] ${examId} – ${fullname}`,
      htmlBody: `Bạn được <b>${score}/${total}</b> (${percent}%).<br>Thời gian: ${Math.round(durationUsedSec/60)} phút.`,
      name: CONFIG.MAIL_SENDER
    });
  }catch(_){}

  return {ok:true, score, total, percent, detail};
}

function adminExportCSV(p){
  if(!isAdmin(p.adminSecret)) return {ok:false, reason:'Admin secret không đúng'};
  const ws = sh('SUBMISSIONS');
  const head = ws.getRange(1,1,1,ws.getLastColumn()).getValues()[0];
  const rows = ws.getRange(2,1,Math.max(ws.getLastRow()-1,0),ws.getLastColumn()).getValues()
    .filter(r => !p.examId || String(r[4])===String(p.examId));

  const csv = [head].concat(rows).map(r => r.map(x=>{
    const s = (x==null? '' : String(x));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');

  return {ok:true, filename:`SK_Exam_${p.examId||'ALL'}_${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMdd_HHmm')}.csv`, content:Utilities.base64Encode(csv)};
}

function adminStats(p){
  if(!isAdmin(p.adminSecret)) return {ok:false, reason:'Admin secret không đúng'};
  const ws = sh('SUBMISSIONS');
  const rows = ws.getRange(2,1,Math.max(ws.getLastRow()-1,0),ws.getLastColumn()).getValues();

  const byExam = {};
  rows.forEach(r=>{
    const examId = String(r[4]);
    const percent = Number(r[7]||0);
    (byExam[examId] ||= []).push(percent);
  });

  const stats = Object.entries(byExam).map(([examId, arr])=>{
    const count = arr.length;
    const avg = Math.round(arr.reduce((a,b)=>a+b,0)*10/(count||1))/10;
    const min = count? Math.min.apply(null, arr) : 0;
    const max = count? Math.max.apply(null, arr) : 0;
    return {examId, count, avgPercent:avg, minPercent:min, maxPercent:max};
  });

  const wsS = sh('STATS'); if(wsS){
    const values = stats.map(s=>[nowISO(), s.examId, s.count, s.avgPercent, s.minPercent, s.maxPercent]);
    if(values.length) wsS.getRange(wsS.getLastRow()+1,1,values.length,values[0].length).setValues(values);
  }
  return {ok:true, stats};
}

function adminPercents(p){
  if(!isAdmin(p.adminSecret)) return {ok:false, reason:'Admin secret không đúng'};
  const ws = sh('SUBMISSIONS');
  if(!ws) return {ok:false, reason:'Chưa có sheet SUBMISSIONS'};
  const lastRow = ws.getLastRow();
  if(lastRow < 2) return {ok:true, examId: p.examId||'', percents: []};

  const vals = ws.getRange(2, 1, lastRow-1, ws.getLastColumn()).getValues();
  const COL_EXAMID = 4, COL_PERCENT = 7, COL_TIME = 0;

  const want = String(p.examId||'').trim();
  if(!want) return {ok:false, reason:'Thiếu examId'};

  const fromISO = p.fromISO ? new Date(p.fromISO).getTime() : null;
  const toISO   = p.toISO   ? new Date(p.toISO).getTime()   : null;

  const out = [];
  vals.forEach(r=>{
    const ex = String(r[COL_EXAMID]||'').trim();
    if(ex !== want) return;
    const ts = new Date(r[COL_TIME]).getTime();
    if(fromISO && ts < fromISO) return;
    if(toISO   && ts > toISO)   return;
    const pc = Number(r[COL_PERCENT]||0);
    if(!isNaN(pc)) out.push(pc);
  });
  return {ok:true, examId: want, count: out.length, percents: out};
}

function isAdmin(adminSecret){
  const expect = sha256('ADMIN_'+CONFIG.SHEET_ID);
  return String(adminSecret||'')===expect;
}
