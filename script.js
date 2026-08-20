// --- Global Error Handler ---
window.addEventListener('error', function(e) {
    (()=>{})('Uncaught Error: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
});
// أي عملية قاعدة بيانات بتفشل من غير ما حد يمسكها كانت بتختفي في الـ console
// والموظف يفضل شايف إن كل حاجة تمام. دلوقتي بتظهر له رسالة.
window.addEventListener('unhandledrejection', function(e) {
    (()=>{})('Unhandled Promise Rejection: ' + e.reason);
    try {
        const raw = (e.reason && e.reason.message) ? String(e.reason.message) : String(e.reason || '');
        const msg = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').trim();
        if (typeof showToast === 'function') {
            showToast('حصل خطأ لم يكتمل معه الحفظ: ' + (msg || 'خطأ غير معروف'), 'error');
        }
    } catch (x) { /* الواجهة لسه بتحمّل */ }
});

// Show local login overlay explicitly on load IF we are running locally without cloud override
document.addEventListener("DOMContentLoaded", () => {
    // If not using cloud bridge, or bridge failed, show the local login after a short delay
    setTimeout(() => {
        if (!window.supabaseClient) {
            const overlay = document.getElementById('loginOverlay');
            if (overlay && currentUser == null) {
                overlay.classList.add('show-local-login');
            }
        }
    }, 800);
});


// --- Global Chart Instances for Dashboard Analytics ---
let chartTrendInstance = null;
let chartDonutInstance = null;
let chartMonthlyInstance = null;
let chartAttInstance = null;
let members = [],
    packages = [],
    users = [],
    trainers = [],
    employees = [],
    currentUser = null,
    currentStatusFilter = 'all',
    dupFoundMember = null;

let confirmResolver = null;

function customConfirm(msg) {
    return new Promise(resolve => {
        document.getElementById('confirm-msg').innerText = msg;
        openModal('confirmModal');
        confirmResolver = resolve;
    });
}

function resolveConfirm(val) {
    closeModal('confirmModal');
    if (confirmResolver) confirmResolver(val);
    confirmResolver = null;
}

function showToast(msg, type = 'error') {
    const container = document.getElementById('toast-container');
    if (!container) return alert(msg);
    const toast = document.createElement('div');
    toast.style.background = type === 'error' ? '#e74c3c' : (type === 'success' ? '#2ecc71' : '#3498db');
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.fontWeight = 'bold';
    toast.style.transition = 'opacity 0.3s';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// كل عمليات الحفظ كانت تُرسل بلا انتظار ولا فحص نتيجة: لو فشلت الكتابة في قاعدة
// البيانات كانت الشاشة تقول "تم الحفظ" والبيانات لم تُحفظ. هذه الدالة تُظهر الفشل.
function dbWrite(promise, what) {
    return Promise.resolve(promise).catch(err => {
        const msg = (err && err.message) ? String(err.message).replace(/^Error invoking remote method '[^']*':\s*/, '') : 'خطأ غير معروف';
        showToast(` فشل حفظ ${what} في قاعدة البيانات: ${msg}`, 'error');
        (()=>{})('DB write failed:', what, err);
        return null;
    });
}

// state: 'ok' | 'warn' | 'bad' — يلوّن إطار الإشعار ليُقرأ من بعيد
function showLivePopup(popup, ms, state) {
    if (!popup) return;
    const backdrop = document.getElementById('live-attendance-backdrop');

    popup.classList.remove('state-ok', 'state-warn', 'state-bad');
    if (state) popup.classList.add('state-' + state);

    popup.classList.add('show');
    if (backdrop) backdrop.classList.add('show');

    if (window.livePopupTimeout) clearTimeout(window.livePopupTimeout);
    window.livePopupTimeout = setTimeout(() => {
        popup.classList.remove('show');
        if (backdrop) backdrop.classList.remove('show');
    }, ms);
}

// معالجة بصمة مدرب أو موظف: أول بصمة في اليوم حضور، والتالية انصراف.
// كانت هذه الكتلة مكتوبة مرتين بنصّها لكلا النوعين.
const STAFF_KINDS = {
    trainer: {
        label: 'مدرب',
        statusText: 'بصمة مدرب',
        idField: 'trainer_id',
        idPrefix: 'TATT-',
        list: () => window.electronAPI.getTrainerAttendance,
        get: (f) => window.electronAPI.getTrainerAttendance(f),
        add: (r) => window.electronAPI.addTrainerAttendance(r),
        update: (r) => window.electronAPI.updateTrainerAttendance(r),
        reload: () => loadTrainerAttendance()
    },
    employee: {
        label: 'موظف',
        statusText: 'بصمة موظف',
        idField: 'employee_id',
        idPrefix: 'EATT-',
        list: () => window.electronAPI.getEmployeeAttendance,
        get: (f) => window.electronAPI.getEmployeeAttendance(f),
        add: (r) => window.electronAPI.addEmployeeAttendance(r),
        update: (r) => window.electronAPI.updateEmployeeAttendance(r),
        reload: () => loadEmployeeAttendance()
    }
};

async function handleStaffScan(person, kind, ui) {
    const cfg = STAFF_KINDS[kind];
    const jobText = person.job_title ? ` (${person.job_title})` : ` (${cfg.label})`;
    if (ui.liveName) ui.liveName.innerText = person.name + jobText;
    if (ui.liveStatus) {
        ui.liveStatus.innerText = cfg.statusText;
        ui.liveStatus.style.backgroundColor = 'var(--primary)';
    }

    const now = new Date();
    const dateStr = localDateStr(now);
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    let allAtt = [];
    if (cfg.list()) {
        allAtt = await cfg.get({ dateStart: dateStr, dateEnd: dateStr }).catch(() => []);
    }

    const openRecord = (allAtt || []).find(a => String(a[cfg.idField]) === String(person.id) && !a.check_out);

    if (openRecord) {
        await dbWrite(cfg.update({ ...openRecord, check_out: timeStr }), 'تسجيل الانصراف');
        if (ui.liveMsg) ui.liveMsg.innerText = 'تم تسجيل الانصراف بنجاح (' + timeStr + ')';
    } else {
        await dbWrite(cfg.add({
            id: cfg.idPrefix + Date.now(),
            [cfg.idField]: person.id,
            check_in: timeStr,
            check_out: '',
            date: dateStr
        }), 'تسجيل الحضور');
        if (ui.liveMsg) ui.liveMsg.innerText = 'تم تسجيل الحضور بنجاح (' + timeStr + ')';
    }
    if (ui.liveMsg) ui.liveMsg.style.color = 'var(--primary)';

    cfg.reload();
}

// فحص اتصال جهاز البصمة من مؤشر الحالة — كان مكرراً حرفياً في ثلاثة مواضع
function isZkConnected() {
    if (!window.electronAPI) return false;
    const indicator = document.getElementById('zk-status-indicator');
    return !!indicator && indicator.classList.contains('connected');
}

// تسجيل بصمة حضور. كان مسار الباقة المتميزة يرسل zkid وحده بلا id ولا timestamp،
// فتُكتب صفوف بـ NULL تظهر في كارت المشترك كـ "Invalid Date" ولا تدخل أي تقرير.
// "YYYY-MM-DD" بيتقرا بـ new Date() على إنه منتصف ليل UTC، فلو الجهاز في
// منطقة سالبة (UTC-) بيرجّع اليوم اللي قبله ويرفض مشترك اشتراكه لسه ساري.
// بنفكّ النص بنفسنا عشان يبقى نفس اليوم مهما كانت منطقة الجهاز.
function parseLocalDate(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
        const d = new Date(s);
        return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function canEnterNow(m) {
    if (!m) return { allowed: false, reason: 'غير مسجل' };
    if (m.status === 'frozen') return { allowed: false, reason: 'الاشتراك مجمد' };
    if (m.status === 'expired') return { allowed: false, reason: 'الاشتراك منتهي' };

    // باقة الحصص: الرصيد هو الحكم
    const bal = Number(m.sessions_balance);
    if (Number.isFinite(bal) && bal > 0) return { allowed: true, reason: '' };

    if (!m.exp) return { allowed: false, reason: 'لا يوجد تاريخ انتهاء' };

    // مقارنة باليوم المحلي: الاشتراك اللي بينتهي النهاردة لسه ساري
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(m.exp);
    if (isNaN(e)) return { allowed: false, reason: 'تاريخ انتهاء غير صالح' };
    const expDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());

    if (expDay < today) {
        const daysLate = Math.round((today - expDay) / MS_PER_DAY);
        return { allowed: false, reason: `الاشتراك منتهي منذ ${daysLate} يوم` };
    }
    return { allowed: true, reason: '' };
}


// الحالة الفعلية للعرض والإحصائيات.
// حقل status لوحده مش كفاية: مفيش أي كود بيحوّله لـ 'expired' لما التاريخ
// يعدّي، فمشترك خلص من شهور كان بيظهر "ساري" وبيتحسب في عدّاد الساري.
function effectiveStatus(m) {
    if (!m) return 'expired';
    if (m.status === 'frozen') return 'frozen';
    return canEnterNow(m).allowed ? 'active' : 'expired';
}

function recordAttendance(zkid) {
    if (!window.electronAPI || !window.electronAPI.addAttendance) return Promise.resolve(null);
    return dbWrite(window.electronAPI.addAttendance({
        id: 'ATT-' + Date.now() + '-' + zkid,
        zkid: String(zkid),
        timestamp: new Date().toISOString()
    }), 'سجل الحضور');
}

// إعادة تحميل المشتركين من قاعدة البيانات: بعض الحقول تحسبها العملية الرئيسية
// (مثل رصيد حصص الباقة المتميزة) فلا تعرفها الواجهة بعد الحفظ
async function refreshMembersFromDb() {
    if (!window.electronAPI || !window.electronAPI.getMembers) return;
    try {
        const rows = await window.electronAPI.getMembers();
        if (Array.isArray(rows)) members = rows;
    } catch (err) {
        (()=>{})('Failed to refresh members', err);
    }
}

function clearInputs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('input').forEach(el => {
        if (el.type === 'text' || el.type === 'password' || el.type === 'number') el.value = '';
    });
}

function openAddPackageModal() {
    (()=>{})('openAddPackageModal triggered');
    try { clearInputs('addPackageModal'); } catch(e) {}
    openModal('addPackageModal');
}

function openAddUserModal() {
    (()=>{})('openAddUserModal triggered');
    try { clearInputs('addUserModal'); } catch(e) {}
    openModal('addUserModal');
}

// --- التخصيص الذكي لرقم البصمة ---
// الترقيم القديم كان max+1 محسوباً من ذاكرة الواجهة وحدها: مع الأرقام (1، 2، 20)
// يعطي 21 ويترك 3 مهدراً، ويتجاهل بصمات الكادر وذاكرة الجهاز تماماً.
// الحساب الآن في العملية الرئيسية على اتحاد أرقام القاعدة وأرقام الجهاز.
async function fillNextZkId() {
    const input = document.getElementById('reg-zkid');
    const hint = document.getElementById('reg-zkid-hint');
    if (!input) return;

    if (!window.electronAPI || !window.electronAPI.getNextZkId) {
        input.value = 1;
        if (hint) { hint.className = 'zkid-hint'; hint.innerText = ''; }
        return;
    }

    input.value = '';
    if (hint) { hint.className = 'zkid-hint'; hint.innerText = 'جارٍ حساب أصغر رقم متاح...'; }

    try {
        const res = await window.electronAPI.getNextZkId();
        input.value = res.id;
        if (!hint) return;
        if (res.deviceOnline) {
            hint.className = 'zkid-hint ok';
            hint.innerText = `الرقم ${res.id} أصغر رقم متاح — غير مستخدم في النظام (${res.dbCount}) ولا على الجهاز (${res.deviceCount}).`;
            if (res.orphanCount > 0) {
                hint.innerText += ` تنبيه: ${res.orphanCount} بصمة على الجهاز بلا صاحب في النظام.`;
            }
        } else {
            hint.className = 'zkid-hint warn';
            hint.innerText = `الرقم ${res.id} متاح في النظام، لكن جهاز البصمة غير متصل فلم تتم مطابقته مع ذاكرة الجهاز — تأكد يدوياً.`;
        }
    } catch (err) {
        (()=>{})('getNextZkId failed', err);
        input.value = '';
        if (hint) {
            hint.className = 'zkid-hint bad';
            hint.innerText = 'تعذّر حساب الرقم التلقائي، أدخله يدوياً.';
        }
    }
}

async function openRegisterModal() {
    clearInputs('registerModal');
    document.getElementById('duplicate-warning').classList.add('hidden');

    // clearInputs لا يمسح مربعات الاختيار، فنعيد ضبط خانات المدرب يدوياً
    document.getElementById('reg-has-trainer').checked = false;
    document.getElementById('reg-trainer-wrapper').style.display = 'none';
    document.getElementById('reg-trainer').value = '';

    if (document.getElementById('reg-has-private')) document.getElementById('reg-has-private').checked = false;
    if (document.getElementById('reg-private-wrapper')) document.getElementById('reg-private-wrapper').style.display = 'none';
    if (document.getElementById('reg-private-trainer')) document.getElementById('reg-private-trainer').value = '';

    if (currentUser && currentUser.gender && currentUser.gender !== 'all') {
        document.getElementById('reg-gender').value = currentUser.gender;
    }
    if (packages.length > 0) {
        document.getElementById('reg-package').value = packages[0].name + '|' + packages[0].price;
    }
    onPackageChange('reg');

    openModal('registerModal');
    // بعد فتح النافذة حتى لا ينتظر المستخدم قراءة الجهاز
    fillNextZkId();
}

// --- حاسبة الاشتراك ---
// prefix = 'reg' لنافذة التسجيل أو 'rn' لنافذة التجديد
function onPackageChange(prefix) {
    const sel = document.getElementById(prefix + '-package');
    if (!sel) return;
    const price = Number(sel.value.split('|')[1] || 0);
    const priceEl = document.getElementById(prefix + '-price');
    const paidEl = document.getElementById(prefix + '-paid');
    if (priceEl) priceEl.value = price;
    // الافتراض أن العميل يدفع كامل القيمة، ويُعدّلها المشرف عند الدفع الجزئي
    if (paidEl) paidEl.value = price;
    recalcPayment(prefix);
}

function recalcPayment(prefix) {
    const priceEl = document.getElementById(prefix + '-price');
    const paidEl = document.getElementById(prefix + '-paid');
    const box = document.getElementById(prefix + '-remaining-box');
    const out = document.getElementById(prefix + '-remaining');
    const note = document.getElementById(prefix + '-pay-note');
    if (!priceEl || !paidEl || !out) return 0;

    const price = Number(priceEl.value) || 0;
    const paid = Number(paidEl.value) || 0;
    const remaining = Math.round((price - paid) * 100) / 100;

    out.innerText = remaining.toLocaleString() + ' ج.م';
    if (box) {
        box.classList.toggle('is-debt', remaining > 0);
        box.classList.toggle('is-settled', remaining <= 0);
    }
    if (note) {
        if (paid > price) {
            note.className = 'pay-calc-note text-danger';
            note.innerText = 'المبلغ المدفوع أكبر من سعر الباقة — صحّح القيمة قبل الحفظ.';
        } else if (remaining > 0) {
            note.className = 'pay-calc-note text-warning';
            note.innerText = `سيُسجَّل المشترك بمديونية ${remaining.toLocaleString()} ج.م وسيظهر في جدول المديونيات.`;
        } else {
            note.className = 'pay-calc-note text-success';
            note.innerText = 'الاشتراك مسدَّد بالكامل.';
        }
    }
    return remaining;
}

// المتبقي على مشترك — مصدر واحد يستخدمه الجدول والتجديد ولوحة المديونيات
function remainingOf(m) {
    if (!m) return 0;
    return Math.max(0, Math.round(((Number(m.price) || 0) - (Number(m.paid) || 0)) * 100) / 100);
}

// تواريخ محلية (توقيت مصر) لا تواريخ UTC.
// toISOString يرجّع تاريخ UTC، فبين منتصف الليل و 3 فجراً يرجّع تاريخ الأمس،
// فتخسر الاشتراكات يوماً وتُحسب مقبوضات ما بعد منتصف الليل على اليوم السابق.
function localDateStr(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function todayStr() {
    return localDateStr(new Date());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// عدد الأيام المعتمد لتعريف "تنتهي قريباً": مصدر واحد للجدول وللوحة القيادة معاً.
function getExpiringDays() {
    return 3;
}

// "تنتهي قريباً" حالة عرض لا حالة مخزَّنة: لو كتبناها في m.status لانكسرت
// كل فحوص m.status === 'active' في تسجيل البصمة والتجديد والتجميد
function isExpiringSoon(m, today = todayStr(), days = getExpiringDays()) {
    if (!m || m.status === 'frozen' || !m.exp) return false;
    const diffDays = Math.ceil((new Date(m.exp) - new Date(today)) / MS_PER_DAY);
    return diffDays >= 0 && diffDays <= days;
}

// تهريب نص المستخدم قبل وضعه داخل سلسلة JS في خاصية onclick.
// escapeHTML لا يكفي هنا: المتصفح يفكّ ترميز &#39; قبل تنفيذ الجافاسكريبت.
function escapeJsArg(str) {
    return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    } [tag] || tag));
}
const escapeHtml = escapeHTML;

// أرقام الهواتف المصرية: 11 رقماً تبدأ بـ 01. لم يكن هناك أي تحقق من الصيغة،
// فتُحفظ أرقام لا تصلح لإرسال واتساب ولا للبحث
function isValidPhone(phone, required = true) {
    const v = String(phone == null ? '' : phone).trim();
    if (!v) return !required;
    return /^01[0-9]{9}$/.test(v);
}

// كود مصر: الرقم المحلي 01xxxxxxxxx بيتحول لـ 201xxxxxxxxx
const WA_COUNTRY_CODE = '20';

function waFormatPhone(phone) {
    let v = String(phone == null ? '' : phone).trim().replace(/[\s\-()+]/g, '');
    if (v.startsWith('0')) v = WA_COUNTRY_CODE + v.slice(1);
    return v;
}

function waOpenLink(phone, message) {
    const url = `https://wa.me/${waFormatPhone(phone)}?text=${encodeURIComponent(message)}`;
    if (window.electronAPI && window.electronAPI.openExternalUrl) {
        window.electronAPI.openExternalUrl(url);
    } else {
        window.open(url, '_blank');
    }
}

// إرسال يدوي (بضغطة من المستخدم): يجرب الواتساب المتصل الأول،
// ولو مش متصل يفتح رابط wa.me زي الأول عشان المستخدم ميفضلش مستني.
async function openWhatsApp(phone, message) {
    if (window.electronAPI && window.electronAPI.sendWhatsApp) {
        try {
            const ok = await window.electronAPI.sendWhatsApp(phone, message);
            if (ok) return 'sent';
        } catch (e) {
            (()=>{})('WhatsApp auto-send failed, falling back to link:', e);
        }
    }
    waOpenLink(phone, message);
    return 'manual';
}

// إرسال يدوي مع تسجيل النتيجة الحقيقية في سجل الرسائل:
// 'sent' يعني اتبعتت فعلاً من الواتساب المتصل، و'manual' يعني اتفتح رابط للمستخدم يبعت بنفسه.
async function waManualSend(phone, name, type, message) {
    const result = await openWhatsApp(phone, message);
    if (window.electronAPI && window.electronAPI.logWhatsAppMessage) {
        window.electronAPI.logWhatsAppMessage({
            recipient_phone: phone || '',
            recipient_name: name || '',
            message_type: type,
            message_text: message,
            status: result === 'sent' ? 'sent' : 'manual'
        });
    }
    return result;
}

// إرسال تلقائي في الخلفية (حضور/ولي أمر/غياب): لا يفتح أي نافذة متصفح أبداً،
// لأن ده كان هيفتح تبويب مع كل بصمة. لو الواتساب مش متصل تتسجل الرسالة كـ failed.
async function waAutoSend(phone, name, type, message) {
    let status = 'failed';
    if (phone && window.electronAPI && window.electronAPI.sendWhatsApp) {
        try {
            status = (await window.electronAPI.sendWhatsApp(phone, message)) ? 'sent' : 'failed';
        } catch (e) {
            (()=>{})('WhatsApp auto-send error:', e);
        }
    }
    if (window.electronAPI && window.electronAPI.logWhatsAppMessage) {
        window.electronAPI.logWhatsAppMessage({
            recipient_phone: phone || '',
            recipient_name: name || '',
            message_type: type,
            message_text: message,
            status
        });
    }
    return status;
}


async function init() {
    if (window.electronAPI) {
        try {
            users = await window.electronAPI.getUsers().catch(() => []) || [];
            members = await window.electronAPI.getMembers().catch(() => []) || [];
            packages = await window.electronAPI.getPackages().catch(() => []) || [];
            trainers = await window.electronAPI.getTrainers().catch(() => []) || [];
            employees = await window.electronAPI.getEmployees().catch(() => []) || [];

            populateLoginUsersSelect();

            if (window.electronAPI.onZkLog) {
                window.electronAPI.onZkLog(async (data) => {
                    if (!currentUser) return;

                    let scannedId = '';
                    if (data && typeof data === 'object') {
                        scannedId = String(data.userId || data.deviceUserId || data.userSn || data.id || data.uid || '').trim();
                    } else {
                        scannedId = String(data || '').trim();
                    }

                    if (!scannedId) return;

                    // --- ANTI DOUBLE-PUNCH DEBOUNCE (45 Seconds Protection) ---
                    if (!window._zkPunchDebounceMap) window._zkPunchDebounceMap = new Map();
                    const nowPunch = Date.now();
                    const lastPunchTime = window._zkPunchDebounceMap.get(scannedId);
                    if (lastPunchTime && (nowPunch - lastPunchTime) < 45000) {
                        showToast(`تم تسجيل الحضور بالفعل منذ قليل للمعرف (${scannedId}) — منع البصمة المزدوجة`, 'info');
                        return;
                    }
                    window._zkPunchDebounceMap.set(scannedId, nowPunch);

                    const member = (members || []).find(m => m.zkid && String(m.zkid).trim() === scannedId);
                    const trainer = (trainers || []).find(t => t.zkid && String(t.zkid).trim() === scannedId);
                    const employee = (employees || []).find(e => e.zkid && String(e.zkid).trim() === scannedId);

                    const popup = document.getElementById('live-attendance-popup');
                    const liveName = document.getElementById('live-name');
                    const liveStatus = document.getElementById('live-status');
                    const liveMsg = document.getElementById('live-msg');

                    const playSound = (type) => {
                        try {
                            const ctx = new(window.AudioContext || window.webkitAudioContext)();
                            const osc = ctx.createOscillator();
                            const gainNode = ctx.createGain();
                            osc.connect(gainNode);
                            gainNode.connect(ctx.destination);
                            if (type === 'success') {
                                osc.type = 'sine';
                                osc.frequency.setValueAtTime(800, ctx.currentTime);
                                gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                                osc.start();
                                osc.stop(ctx.currentTime + 0.2);
                            } else {
                                osc.type = 'sawtooth';
                                osc.frequency.setValueAtTime(200, ctx.currentTime);
                                gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                                osc.start();
                                osc.stop(ctx.currentTime + 0.5);
                            }
                        } catch (e) {}
                    };

                    // كتلتا "بصمة مدرب" و"بصمة موظف" كانتا متطابقتين حرفياً (~100 سطر مكرر)
                    const staffHit = trainer ?
                        { person: trainer, kind: 'trainer' } :
                        (employee ? { person: employee, kind: 'employee' } : null);

                    if (staffHit) {
                        playSound('success');
                        await handleStaffScan(staffHit.person, staffHit.kind, { liveName, liveStatus, liveMsg });
                        showLivePopup(popup, 5000, 'ok');
                        return;
                    }

                    // حالة الإشعار تُضبط أثناء تحليل البصمة وتُستخدم عند العرض
                    let liveState = 'ok';

                    if (!member) {
                        playSound('error');
                        liveState = 'bad';
                        if (liveName) liveName.innerText = 'مستخدم غير معروف (' + scannedId + ')';
                        if (liveStatus) {
                            liveStatus.innerText = 'غير مسجل';
                            liveStatus.style.backgroundColor = 'var(--text-muted)';
                        }
                        if (liveMsg) {
                            liveMsg.innerText = 'لم يتم ربط هذه البصمة بأي مشترك';
                            liveMsg.style.color = 'var(--danger)';
                        }
                    } else {
                        if (liveName) liveName.innerText = member.name;

                        if (currentUser.role !== 'admin' && currentUser.gender && currentUser.gender !== 'all' && member.gender !== currentUser.gender) {
                            playSound('error');
                            const currentShiftName = currentUser.gender === 'male' ? 'الأولاد' : 'البنات';
                            const memberGenderName = member.gender === 'male' ? 'ولد' : 'بنت';

                            liveState = 'bad';
                            if (liveStatus) {
                                liveStatus.innerText = 'ممنوع الدخول ';
                                liveStatus.style.backgroundColor = 'var(--danger)';
                            }
                            if (liveMsg) {
                                liveMsg.innerText = 'لا يمكن دخول ' + memberGenderName + ' في شيفت ' + currentShiftName + '!';
                                liveMsg.style.color = 'var(--danger)';
                            }
                        } else {
                            if (member.status === 'active') {
                                playSound('success');
                                if (liveStatus) {
                                    liveStatus.innerText = 'ساري (ينتهي في ' + member.exp + ')';
                                    liveStatus.style.backgroundColor = 'var(--primary)';
                                }
                                if (liveMsg) {
                                    liveMsg.innerText = 'تم تسجيل الحضور بنجاح ';
                                    liveMsg.style.color = 'var(--primary)';
                                }

                                // --- PREMIUM PACKAGE PATCH ---
                                if (member.pkg && member.pkg.includes('الباقة المتميزة')) {
                                    const now = new Date();
                                    let expDate = new Date(member.exp);
                                    if (isNaN(expDate)) expDate = new Date(0);
                                    
                                    if (now > expDate) {
                                        showToast('مرفوض: الباقة منتهية الصلاحية للمشترك ' + member.name + '!', 'error');
                                        return;
                                    }
                                    
                                    let inCooldown = false;
                                    if (member.last_checkin) {
                                        const lastCheckin = new Date(member.last_checkin);
                                        if (!isNaN(lastCheckin)) {
                                            const diffMins = (now - lastCheckin) / 1000 / 60;
                                            if (diffMins < 120) {
                                                inCooldown = true;
                                            }
                                        }
                                    }
                                    
                                    if (inCooldown) {
                                        showToast('مرور ناجح (فترة سماح) للمشترك ' + member.name, 'info');
                                        await recordAttendance(scannedId);
                                        loadDailyReports();
                                        return;
                                    }
                                    
                                    // الخصم بيحصل جوّا قاعدة البيانات في جملة واحدة. قبل كده كنا
                                    // بنقرا الرصيد من الذاكرة ونكتب الناتج، فمسحتين بسرعة كانوا
                                    // يقروا نفس الرقم ويكتبوا نفس الناتج — حصة بتضيع.
                                    const res = await dbWrite(
                                        window.electronAPI.consumeSession(member.id, now.toISOString()),
                                        'خصم الحصة'
                                    );
                                    if (res === null) return;
                                    if (!res.ok) {
                                        showToast('مرفوض: لقد استنفدت جميع حصصك (0 متبقي) للمشترك ' + member.name + '!', 'error');
                                        return;
                                    }
                                    const newBalance = res.balance;
                                    member.sessions_balance = newBalance;   // نسخة الذاكرة تفضل مطابقة
                                    showToast('حضور ناجح: تم خصم حصة (المتبقي: ' + newBalance + ' حصة) للمشترك ' + member.name, 'success');
                                    
                                    // Delete fingerprint from device if sessions are finished
                                    if (newBalance === 0) {
                                        if (isZkConnected()) {
                                            window.electronAPI.deleteZkUser(scannedId).catch(e => (()=>{})(e));
                                            // كان النص يقول "12 حصة" دائماً حتى لباقة الـ 16
                                            const pkgTotal = String(member.pkg).includes('16') ? 16 : 12;
                                            showToast('استنفد المشترك ' + pkgTotal + ' حصة، وتم مسح بصمته من الجهاز أوتوماتيكياً!', 'info');
                                        }
                                    }
                                    
                                    await recordAttendance(scannedId);
                                    await refreshMembersFromDb();
                                    renderMembers();
                                    loadDailyReports();
                                    return;
                                }
                                // --- END PREMIUM PACKAGE PATCH ---
                                await recordAttendance(scannedId);
                                triggerAttendanceWhatsApp(member);

                            } else if (member.status === 'frozen') {
                                playSound('error');
                                liveState = 'warn';
                                if (liveStatus) {
                                    liveStatus.innerText = 'مجمد ';
                                    liveStatus.style.backgroundColor = 'var(--info)';
                                }
                                if (liveMsg) {
                                    liveMsg.innerText = 'الاشتراك مجمد حاليا!';
                                    liveMsg.style.color = '#f59e0b';
                                }
                            } else {
                                playSound('error');
                                liveState = 'bad';
                                if (liveStatus) {
                                    liveStatus.innerText = 'منتهي ';
                                    liveStatus.style.backgroundColor = 'var(--danger)';
                                }
                                if (liveMsg) {
                                    liveMsg.innerText = 'الاشتراك منتهي! (تم مسح البصمة)';
                                    liveMsg.style.color = 'var(--danger)';
                                }
                            }
                        }
                    }

                    showLivePopup(popup, 4000, liveState);
                });
            }

            if (window.electronAPI.getZkStatus) {
                const st = await window.electronAPI.getZkStatus().catch(() => 'Not Connected');
                updateZkStatusDot(st);
            }

            renderUsers();
            renderMembers();

            const todayDate = todayStr();
            const rStart = document.getElementById('report-date-start');
            const rEnd = document.getElementById('report-date-end');
            if (rStart) rStart.value = todayDate;
            if (rEnd) rEnd.value = todayDate;

            renderTrainers();
            loadDailyReports();
            renderPackages();
            loadDashboardStats();
            // تحميل الدعوات مبكراً حتى يعمل تحذير "استهلك دعوة هذا الشهر"
            // قبل زيارة قسم الدعوات، لا بعدها فقط
            loadInvitations();
            // شارة المديونيات يجب أن تظهر من أول شاشة
            loadDebtors();
            loadSessionPrices();
            loadWhatsAppConfig();

            if (window.electronAPI.getConfig) {
                const config = await window.electronAPI.getConfig().catch(() => ({}));
                if (config && config.zkIp) {
                    const zkIpInput = document.getElementById('zk-ip');
                    const zkPortInput = document.getElementById('zk-port');
                    if (zkIpInput) zkIpInput.value = config.zkIp;
                    if (config.zkPort && zkPortInput) zkPortInput.value = config.zkPort;
                    setTimeout(() => connectZkDevice(), 1000);
                }
            }
        } catch (err) {
            (()=>{})('CRASH IN INIT:', err);
        }
    } else {
        users = [{ username: 'admin', name: 'المدير العام', role: 'admin' }];
        populateLoginUsersSelect();
        document.getElementById('loginOverlay').classList.add('show-local-login');
        showToast('خطأ في الاتصال بقاعدة البيانات.', 'error');
    }
}

async function attemptLogin() {
    const userSelect = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');
    if (!userSelect || !passInput) return;

    const u = (userSelect.value || '').trim();
    const p = (passInput.value || '').trim();

    if (!u) {
        showToast('الرجاء اختيار الحساب أولاً', 'error');
        return;
    }
    if (!p) {
        showToast('الرجاء إدخال كلمة المرور', 'error');
        return;
    }

    let found = null;
    if (window.electronAPI && window.electronAPI.verifyLogin) {
        try {
            found = await window.electronAPI.verifyLogin({
                username: u,
                password: p
            });
        } catch(err) {
            showToast('حدث خطأ أثناء محاولة تسجيل الدخول', 'error');
            (()=>{})('Login error:', err);
            return;
        }
    } else {
        // كان هنا باب خلفي: أي حد يكتب 123 يدخل كمدير. لو طبقة
        // التحقق مش متحملة، المفروض نرفض مش نفتح.
        showToast('نظام التحقق مش جاهز — حدّث الصفحة وحاول تاني', 'error');
        (()=>{})('verifyLogin مش متاحة — تسجيل الدخول اترفض');
        return;
    }

    if (found) {
        currentUser = found;
        document.getElementById('login-error').classList.add('hidden');
        document.getElementById('login-pass').value = '';
        
        const overlay = document.getElementById('loginOverlay');
        if (overlay) {
            overlay.classList.remove('show-local-login');
            overlay.style.display = 'none';
        }

        // Setup UI for role
        document.getElementById('top-user-name').innerText = currentUser.name;
        document.getElementById('top-user-role').innerText = currentUser.role === 'admin' ? 'مدير نظام' : 'مشرف صالة';
        document.getElementById('role-badge').innerText = currentUser.role === 'admin' ? 'الإدارة' : 'إشراف';

        if (currentUser.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));

            // Pre-select gender in registration form based on supervisor's shift
            if (currentUser.gender && currentUser.gender !== 'all') {
                document.getElementById('reg-gender').value = currentUser.gender;
                document.getElementById('reg-gender').disabled = true;
            }

            // Align Supervisor non-admin charts side-by-side cleanly in 1 balanced row
            const grid1 = document.getElementById('analytics-grid-row1');
            const grid2 = document.getElementById('analytics-grid-row2');
            const wrap = document.getElementById('supervisor-charts-wrap');
            if (grid1) grid1.style.gridTemplateColumns = '1fr';
            if (grid2) grid2.style.gridTemplateColumns = '1fr';
            if (wrap) {
                wrap.style.display = 'grid';
                wrap.style.gridTemplateColumns = '1fr 1fr';
                wrap.style.gap = '14px';
            }
        } else {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            document.getElementById('reg-gender').disabled = false;

            const grid1 = document.getElementById('analytics-grid-row1');
            const grid2 = document.getElementById('analytics-grid-row2');
            const wrap = document.getElementById('supervisor-charts-wrap');
            if (grid1) grid1.style.gridTemplateColumns = '2fr 1fr';
            if (grid2) grid2.style.gridTemplateColumns = '1fr 1fr';
            if (wrap) {
                wrap.style.display = 'block';
            }
        }

        renderPackages();
        renderMembers();
        renderUsers();
        renderTrainers();
    } else {
        document.getElementById('login-error').classList.remove('hidden');
    }
}

async function logout() {
    if (await customConfirm('تأكيد تسجيل الخروج؟')) {
        currentUser = null;
        if (window.electronAPI && typeof window.electronAPI.logout === 'function') {
            await window.electronAPI.logout();
        } else if (window.supabaseClient && window.supabaseClient.auth) {
            await window.supabaseClient.auth.signOut();
        }
        try { localStorage.clear(); sessionStorage.clear(); } catch(e) {}
        window.location.reload();
    }
}

// نص نوع المشترك: بعض السجلات المستوردة نوعها غير محدد،
// وكان يظهر "ذكر" خطأً لأن الشرط كان ثنائياً فقط
function genderText(gender) {
    if (gender === 'female') return 'أنثى';
    if (gender === 'male') return 'ذكر';
    return 'غير محدد';
}

// Filter members dynamically based on the current user's gender shift assignment
function getAllowedMembers() {
    if (!currentUser) return [];
    // Admin sees everyone, or if a user has gender "all"
    if (currentUser.role === 'admin' || !currentUser.gender || currentUser.gender === 'all') {
        return members;
    }
    // المشرف يرى شيفته + السجلات غير المحددة النوع حتى لا تختفي عن الجميع فتُنسى
    return (members || []).filter(m => m.gender === currentUser.gender || m.gender !== 'male' && m.gender !== 'female');
}

function renderPackages() {
    const grid = document.getElementById('packages-grid');
    grid.innerHTML = '';
    let selectHTML = '';
    let cardsHTML = '';
    (packages || []).forEach(p => {
        let cleanName = (p.name || '').replace(/[\?\uFFFD]/g, '').trim();
        let safeName = escapeHTML(cleanName);
        selectHTML += `<option value="${safeName}|${p.price}">${safeName} - ${p.price} ج.م</option>`;

        let editBtn = currentUser && currentUser.role === 'admin' ?
            `<button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="openEditPackage('${p.id}')">تعديل السعر</button>` : '';
        
        let deleteBtn = '';
        if (currentUser && currentUser.role === 'admin' && !isPremiumPackage(p)) {
            deleteBtn = `<button class="btn btn-sm btn-danger" style="margin-top:10px;" onclick="deletePackage('${escapeJsArg(p.id)}')">حذف</button>`;
        }

        cardsHTML += `
          <div class="stat-card" style="flex-direction:column; align-items:flex-start; gap:8px;">
            <div style="font-weight:700; font-size:1.1rem;">${safeName}</div>
            <div style="font-size:0.85rem; color:var(--text-muted);">المدة: ${p.duration} يوم</div>
            <div style="font-size:1.4rem; font-weight:800; color:var(--primary);">${p.price} ج.م</div>
            <div style="display:flex; gap:5px;">
              ${editBtn}
              ${deleteBtn}
            </div>
          </div>
        `;
    });
    grid.innerHTML = cardsHTML;
    document.getElementById('reg-package').innerHTML = selectHTML;
    document.getElementById('rn-package').innerHTML = selectHTML;
    if (packages.length > 0) {
        document.getElementById('reg-paid').value = packages[0].price;
        document.getElementById('rn-paid').value = packages[0].price;
    }
}

async function saveNewPackage() {
    const name = document.getElementById('pkg-name').value.trim();
    const price = document.getElementById('pkg-price').value.trim();
    const dur = document.getElementById('pkg-duration').value.trim();
    if (!name || !price || !dur || isNaN(Number(price)) || isNaN(Number(dur)) || Number(dur) <= 0) return showToast('يرجى إدخال البيانات بشكل صحيح.', 'error');
    if ((packages || []).some(p => p.name === name)) return showToast('يوجد باقة بنفس الاسم بالفعل!', 'error');
    const newPkg = {
        id: Date.now().toString(),
        name,
        price: Number(price),
        duration: Number(dur)
    };
    // الحفظ في القاعدة أولاً: كانت الواجهة تعرض الباقة حتى لو فشلت الكتابة
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addPackage(newPkg), 'الباقة');
        if (ok === null) return;
    }
    packages.push(newPkg);
    renderPackages();
    closeModal('addPackageModal');
    showToast('تمت إضافة الباقة بنجاح', 'success');
}

const PREMIUM_PKG_MARKER = 'الباقة المتميزة';

// الباقة المتميزة تُعرف باسمها لا بمعرِّفها: الحارس القديم كان يقارن بـ 'premium_pkg_01'
// وهو معرّف غير موجود (الفعليان premium_pkg_12 و premium_pkg_16)، ويبحث عن اسم عربي داخل الـ id
function isPremiumPackage(pkg) {
    if (!pkg) return false;
    return String(pkg.name || '').includes(PREMIUM_PKG_MARKER) || String(pkg.id || '').startsWith('premium_pkg_');
}

async function deletePackage(id) {
    const pkg = (packages || []).find(x => String(x.id) === String(id));
    if (isPremiumPackage(pkg)) {
        showToast('لا يمكن حذف الباقة المتميزة لأنها مرتبطة بنظام حضور مختلف!', 'error');
        return;
    }
    if (await customConfirm('هل أنت متأكد من حذف هذه الباقة؟')) {
        if (window.electronAPI) {
            const ok = await dbWrite(window.electronAPI.deletePackage(id), 'حذف الباقة');
            if (ok === null) return;
        }
        packages = (packages || []).filter(x => x.id !== id);
        renderPackages();
        showToast('تم الحذف بنجاح', 'success');
    }
}

function openEditPackage(id) {
    const p = (packages || []).find(x => x.id === id);
    if (!p) return;
    document.getElementById('epkg-id').value = p.id;
    document.getElementById('epkg-name').value = p.name;
    document.getElementById('epkg-price').value = p.price;
    document.getElementById('epkg-duration').value = p.duration;
    openModal('editPackageModal');
}

async function saveEditedPackage() {
    const id = document.getElementById('epkg-id').value;
    const p = (packages || []).find(x => x.id === id);
    if (!p) return;
    const name = document.getElementById('epkg-name').value.trim();
    const price = document.getElementById('epkg-price').value.trim();
    const dur = document.getElementById('epkg-duration').value.trim();
    if (!name || !price || !dur || isNaN(Number(price)) || isNaN(Number(dur)) || Number(dur) <= 0) return showToast('يرجى إدخال البيانات بشكل صحيح.', 'error');

    const updated = { id: p.id, name, price: Number(price), duration: Number(dur) };
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.updatePackage(updated), 'تعديل الباقة');
        if (ok === null) return;
    }
    Object.assign(p, updated);
    renderPackages();
    closeModal('editPackageModal');
    showToast('تم تعديل الباقة بنجاح', 'success');
}

function renderMembers(searchQuery = '') {
    const tbody = document.getElementById('members-table-body');
    tbody.innerHTML = '';

    const allowedMembers = getAllowedMembers();
    const today = todayStr();

    // Update status dynamically based on exp date
    allowedMembers.forEach(m => {
        if (m.status !== 'frozen') {
            m.status = m.exp >= today ? 'active' : 'expired';
        }
    });

    let filtered = allowedMembers;
    // "تنتهي قريباً" لا تُخزَّن في m.status، فتُفلتر بالحساب لا بالمقارنة،
    // وإلا خرج الجدول فارغاً دائماً بينما العدّاد يعرض رقماً غير صفري
    if (currentStatusFilter === 'expiring') {
        filtered = allowedMembers.filter(m => isExpiringSoon(m, today));
    } else if (currentStatusFilter !== 'all') {
        filtered = allowedMembers.filter(m => m.status === currentStatusFilter);
    }

    if (searchQuery) {
        filtered = filtered.filter(m =>
            (m.name && m.name.toLowerCase().includes(searchQuery)) ||
            (m.phone && m.phone.includes(searchQuery)) ||
            (m.zkid && String(m.zkid).includes(searchQuery))
        );
    }

    let activeCnt = 0,
        expiringCnt = 0,
        expiredCnt = 0,
        frozenCnt = 0;

    allowedMembers.forEach(m => {
        if (m.status === 'active') {
            activeCnt++;
            if (isExpiringSoon(m, today)) expiringCnt++;
        } else if (m.status === 'expired') {
            expiredCnt++;
        } else if (m.status === 'frozen') {
            frozenCnt++;
        }
    });

    // Update Dashboard properly instead of duplicating logic
    if (typeof loadDashboardStats === 'function') {
        loadDashboardStats();
    }

    if (document.getElementById('tab-all-cnt')) document.getElementById('tab-all-cnt').innerText = allowedMembers.length;
    if (document.getElementById('tab-act-cnt')) document.getElementById('tab-act-cnt').innerText = activeCnt;
    if (document.getElementById('tab-expng-cnt')) document.getElementById('tab-expng-cnt').innerText = expiringCnt;
    if (document.getElementById('tab-exp-cnt')) document.getElementById('tab-exp-cnt').innerText = expiredCnt;
    if (document.getElementById('tab-frz-cnt')) document.getElementById('tab-frz-cnt').innerText = frozenCnt;

    let rowsHTML = '';
    filtered.forEach(m => {
        const mSt = effectiveStatus(m);
        let badge = mSt === 'active' ? '<span class="badge badge-success">ساري</span>' :
            (mSt === 'expired' ? '<span class="badge badge-danger">منتهي</span>' : '<span class="badge badge-neutral">متوقف</span>');

        let genderTxt = genderText(m.gender);

        const due = remainingOf(m);
        const dueCell = due > 0 ?
            `<b class="text-danger">${due.toLocaleString()} ج.م</b>` :
            `<span class="text-success">مسدَّد</span>`;

        let actions = `<div class="action-cell" style="display:flex; align-items:center; justify-content:center; gap:8px;">`;
        if (due > 0) {
            actions += `<button class="icon-btn-sleek" style="color:var(--danger);" title="تسديد مديونية ${due} ج.م" onclick="openPaymentModal('${escapeJsArg(m.id)}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </button>`;
        }
        // زر التجديد الذكي: يظهر فقط للمشتركين المنتهيين أو الذين تنتهي اشتراكاتهم قريباً
        const needsRenewal = mSt === 'expired' || isExpiringSoon(m, today);
        if (needsRenewal) {
            actions += `<button class="icon-btn-sleek" style="color:var(--success);" title="تجديد الاشتراك" onclick="openRenewModal('${m.id}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-5.46-5.46"/></svg>
            </button>`;
        }
        actions += `<button class="icon-btn-sleek" style="color:var(--text-main);" title="الكارت والخيارات" onclick="openMemberProfile('${m.id}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>`;
        actions += `</div>`;

        const dueClass = due > 0 ? '' : 'hide-on-mobile';

        rowsHTML += `
          <tr>
            <td><b>${escapeHTML(m.zkid)}</b></td>
            <td><b>${escapeHTML(m.name)}</b></td>
            <td class="hide-on-mobile">${genderTxt}</td>
            <td>${escapeHTML(m.phone)}</td>
            <td class="hide-on-mobile">${escapeHTML(m.address || '-')}</td>
            <td class="hide-on-mobile">${
              (m.pkg && m.pkg.includes('الباقة المتميزة')) 
              ? ('<div style="display:flex; flex-direction:column; align-items:center; gap:4px;"><span>الباقة المتميزة</span><span class="badge" style="background-color:rgba(16,185,129,0.15); color:#10b981; font-size:0.75rem; font-weight:bold;">متبقي: ' + (m.sessions_balance || 0) + ' حصة</span></div>') 
              : escapeHTML((m.pkg || '').replace(/[\?\uFFFD]/g, '').trim())
            }</td>
            <td class="hide-on-mobile">${Number(m.paid || 0).toLocaleString()} ج.م</td>
            <td class="${dueClass}">${dueCell}</td>
            <td>${m.exp}</td>
            <td>${badge}</td>
            <td>${actions}</td>
          </tr>
        `;
    });
    tbody.innerHTML = rowsHTML;
}

// تحديث أرقام لوحة القيادة فقط، بدون إعادة بناء جدول المشتركين
function loadDashboardStats() {
    const allowedMembers = getAllowedMembers();
    const today = todayStr();

    let activeCnt = 0,
        expiredCnt = 0,
        frozenCnt = 0,
        expiringCnt = 0;

    // نفس تصنيف renderMembers بالضبط: "تنتهي قريباً" مجموعة فرعية من السارية لا حالة مستقلة
    allowedMembers.forEach(m => {
        const st = effectiveStatus(m);
        if (st === 'active') {
            activeCnt++;
            if (isExpiringSoon(m, today)) expiringCnt++;
        } else if (st === 'expired') {
            expiredCnt++;
        } else {
            frozenCnt++;
        }
    });

    const elAct = document.getElementById('count-active');
    const elExp = document.getElementById('count-expired');
    const elFrz = document.getElementById('count-frozen');
    const dashExpiringEl = document.getElementById('count-expiring');

    if (elAct) elAct.innerText = activeCnt;
    if (elExp) elExp.innerText = expiredCnt;
    if (elFrz) elFrz.innerText = frozenCnt;
    if (dashExpiringEl) dashExpiringEl.innerText = expiringCnt;

    // تحديث رقم المشتركين الجدد اليوم
    const newMembersToday = allowedMembers.filter(m => m.joinDate === today || m.startDate === today).length;
    const elNewMembersText = document.getElementById('today-new-members-text');
    if (elNewMembersText) elNewMembersText.innerText = newMembersToday;

    if (currentUser && window.electronAPI) {
        window.electronAPI.getTransactions(today).then(txns => {
            if (!currentUser) return;
            let myTxns = txns || [];
            if (currentUser.role !== 'admin') {
                const myUsername = currentUser.username || currentUser.name;
                const myName = currentUser.name;
                myTxns = myTxns.filter(t => t.username === myUsername || t.username === myName);
            }
            const todayRev = myTxns.reduce((sum, t) => sum + Number(t.amount || 0), 0);
            const elRev = document.getElementById('total-revenue');
            if (elRev) elRev.innerText = todayRev.toLocaleString() + ' ج.م';

            // تحديث إحصائيات ملخص اليوم (التجديدات والمبيعات)
            const renewalsToday = myTxns.filter(t => t.type === 'renew' || t.type === 'subscription' || (t.desc && String(t.desc).includes('تجديد'))).length;
            const storeRevenue = myTxns.filter(t => t.type === 'store').reduce((sum, t) => sum + Number(t.amount || 0), 0);
            
            const elRenewalsText = document.getElementById('today-renewals-text');
            const elStoreText = document.getElementById('today-store-text');
            if (elRenewalsText) elRenewalsText.innerText = renewalsToday;
            if (elStoreText) elStoreText.innerText = storeRevenue.toLocaleString();
        });
        
        // جلب عدد الحضور اليوم لدعم شريط الملخص
        if (window.electronAPI.getAttendanceDaily) {
            // مسار تطبيق الديسك توب
            window.electronAPI.getAttendanceDaily(1).then(att => {
                const elAtt = document.getElementById('today-attendance-text');
                if (elAtt && att && att.length > 0 && att[0].day === today) {
                    elAtt.innerText = att[0].total;
                }
            }).catch(()=>{});
        } else if (window.electronAPI.getAttendance) {
            // مسار تطبيق الموبايل (السحابي)
            window.electronAPI.getAttendance({ startDate: today, endDate: today }).then(atts => {
                const elAtt = document.getElementById('today-attendance-text');
                if (elAtt) elAtt.innerText = atts ? atts.length : 0;
            }).catch(()=>{});
        }
    }

    // Render / Update Chart.js Visualizations
    renderDashboardCharts(activeCnt, expiringCnt, expiredCnt, frozenCnt);
}

// الرسم غير متزامن (ينتظر استعلامات القاعدة)، و loadDashboardStats تُستدعى من
// عدة مواضع، فكان استدعاءان متداخلان يمرّان معاً قبل أن يسجّل أيهما نسخته
// فيرمي Chart.js "Canvas is already in use". هذا الحارس يمنع التداخل.
let dashboardChartsRendering = false;
let dashboardChartsPending = null;

// يهدم أي رسم مرتبط بهذا الـ canvas أياً كان مصدره، لا المتغيّر العام وحده
function destroyChartOn(canvas) {
    if (!canvas) return;
    const existing = (typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : null;
    if (existing) existing.destroy();
}

async function renderDashboardCharts(activeCnt, expiringCnt, expiredCnt, frozenCnt) {
    if (typeof Chart === 'undefined') return;

    if (dashboardChartsRendering) {
        // احتفظ بآخر طلب فقط ونفّذه بعد انتهاء الجاري
        dashboardChartsPending = [activeCnt, expiringCnt, expiredCnt, frozenCnt];
        return;
    }
    dashboardChartsRendering = true;
    try {
        await renderDashboardChartsInner(activeCnt, expiringCnt, expiredCnt, frozenCnt);
    } finally {
        dashboardChartsRendering = false;
        const next = dashboardChartsPending;
        dashboardChartsPending = null;
        if (next) renderDashboardCharts(...next);
    }
}

async function renderDashboardChartsInner(activeCnt, expiringCnt, expiredCnt, frozenCnt) {

    // 1. Membership Status Donut Chart
    const ctxDonut = document.getElementById('memberStatusChart');
    if (ctxDonut) {
        destroyChartOn(ctxDonut);
        chartDonutInstance = new Chart(ctxDonut, {
            type: 'doughnut',
            data: {
                labels: ['نشط ساري', 'تنتهي قريباً', 'منتهي', 'متوقف مجمد'],
                datasets: [{
                    data: [Math.max(0, activeCnt - expiringCnt), expiringCnt, expiredCnt, frozenCnt],
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#06b6d4'],
                    borderWidth: 2,
                    borderColor: '#1e293b'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { family: 'Tajawal, sans-serif', size: 11 } } }
                },
                cutout: '72%'
            }
        });
    }

    try {
        // التواريخ محلية لا UTC: كان toISOString يزيح اليوم بعد منتصف الليل بتوقيت مصر
        // فتظهر مقبوضات الليلة على عمود اليوم التالي
        const last7Days = [];
        const labels = [];

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(localDateStr(d));
            labels.push(d.toLocaleDateString('ar-EG', { weekday: 'short', month: 'numeric', day: 'numeric' }));
        }

        // التجميع يتم في SQL بالتوقيت المحلي بدل جلب كل الصفوف وتجميعها هنا
        const dailyRevRows = window.electronAPI && window.electronAPI.getDailyRevenue ?
            (await window.electronAPI.getDailyRevenue(7).catch(() => [])) || [] : [];
        const revByDay = new Map(dailyRevRows.map(r => [r.day, Number(r.total || 0)]));
        const revData = last7Days.map(d => revByDay.get(d) || 0);

        // 2. Daily Revenue Trend Line Chart
        const ctxTrend = document.getElementById('revenueTrendChart');
        if (ctxTrend) {
            destroyChartOn(ctxTrend);
            chartTrendInstance = new Chart(ctxTrend, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'الإيرادات اليومية (ج.م)',
                        data: revData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 3. Monthly Performance Chart — مقبوضات فعلية من قاعدة البيانات
        // (كانت الأعمدة تُرسم بـ mSum*0.8 و mSum*1.1 أي أرقاماً مخترعة)
        const ctxMonthly = document.getElementById('monthlyPerfChart');
        if (ctxMonthly) {
            destroyChartOn(ctxMonthly);
            const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

            const monthKeys = [];
            const monthLabels = [];
            const nowD = new Date();
            for (let i = 2; i >= 0; i--) {
                const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
                monthKeys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
                monthLabels.push(monthNames[d.getMonth()]);
            }

            const monthlyRows = window.electronAPI && window.electronAPI.getMonthlyRevenue ?
                (await window.electronAPI.getMonthlyRevenue(3).catch(() => [])) || [] : [];
            const revByMonth = new Map(monthlyRows.map(r => [r.month_key, Number(r.total || 0)]));
            const monthlyData = monthKeys.map(k => revByMonth.get(k) || 0);

            chartMonthlyInstance = new Chart(ctxMonthly, {
                type: 'bar',
                data: {
                    labels: monthLabels,
                    datasets: [{
                        label: 'المقبوضات (ج.م)',
                        data: monthlyData,
                        backgroundColor: '#8b5cf6',
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                        y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 4. Attendance Activity Bar Chart — عدد بصمات فعلي
        // (كانت البيانات ثوابت مكتوبة يدوياً [4, 8, 12, 9, 15, 18, ...])
        const ctxAtt = document.getElementById('attendanceActivityChart');
        if (ctxAtt) {
            destroyChartOn(ctxAtt);

            const attRows = window.electronAPI && window.electronAPI.getAttendanceDaily ?
                (await window.electronAPI.getAttendanceDaily(7).catch(() => [])) || [] : [];
            const attByDay = new Map(attRows.map(r => [r.day, Number(r.total || 0)]));
            const attData = last7Days.map(d => attByDay.get(d) || 0);

            chartAttInstance = new Chart(ctxAtt, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'تسجيلات الحضور',
                        data: attData,
                        backgroundColor: '#f97316',
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                        y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

    } catch (err) {
        (()=>{})("Chart rendering error:", err);
    }
}


function sendWhatsAppFromList(id) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    let msg = `مرحباً ${m.name}، `;
    if (m.status === 'active') msg += `نتمنى لك تمريناً ممتعاً. نذكرك بأن اشتراكك ينتهي في ${m.exp}.`;
    else if (m.status === 'expired') msg += `نأسف لإبلاغك بأن اشتراكك قد انتهى في ${m.exp}. نتمنى رؤيتك قريباً لتجديد الاشتراك.`;
    else msg += `نود التواصل معك من إدارة الصالة الرياضية.`;
    openWhatsApp(m.phone, msg);
}

function openEditMember(id) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    document.getElementById('edit-member-id').value = m.id;
    document.getElementById('edit-name').value = m.name;
    document.getElementById('edit-phone').value = m.phone;
    // لا نفترض نوعاً للسجلات غير المحددة، حتى لا يُسجَّل نوع خاطئ بمجرد الحفظ
    document.getElementById('edit-gender').value = (m.gender === 'male' || m.gender === 'female') ? m.gender : '';
    document.getElementById('edit-zkid').value = m.zkid;
    document.getElementById('edit-address').value = m.address;
    if (document.getElementById('edit-guardian-phone')) {
        document.getElementById('edit-guardian-phone').value = m.guardian_phone || '';
    }
    if (document.getElementById('edit-notes')) {
        document.getElementById('edit-notes').value = m.notes || '';
    }
    if (document.getElementById('emem-exp')) {
        document.getElementById('emem-exp').value = m.exp || '';
    }

    // بيانات المدرب الحالية
    populateTrainersDropdown();
    const hasTrainer = !!m.trainer;
    document.getElementById('edit-has-trainer').checked = hasTrainer;
    document.getElementById('edit-trainer-wrapper').style.display = hasTrainer ? 'block' : 'none';
    document.getElementById('edit-trainer').value = m.trainer || '';
    ensureTrainerOption('edit-trainer', m.trainer);

    const hasPrivate = !!m.privateTrainer;
    if (document.getElementById('edit-has-private')) {
        document.getElementById('edit-has-private').checked = hasPrivate;
        document.getElementById('edit-private-wrapper').style.display = hasPrivate ? 'block' : 'none';
        document.getElementById('edit-private-trainer').value = m.privateTrainer || '';
        ensureTrainerOption('edit-private-trainer', m.privateTrainer);
    }

    openModal('editMemberModal');
}

async function saveEditedMember() {
    const id = document.getElementById('edit-member-id').value;
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    const name = document.getElementById('edit-name').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    const zkid = document.getElementById('edit-zkid').value.trim();
    if (!name || !phone || !zkid) return showToast('أكمل البيانات الأساسية', 'error');
    if (!isValidPhone(phone)) return showToast('رقم الهاتف غير صحيح (11 رقماً يبدأ بـ 01)', 'error');
    if ((members || []).find(x => (x.zkid === zkid || x.phone === phone) && x.id !== id)) return showToast('رقم البصمة أو الهاتف مستخدم بالفعل لمشترك آخر!', 'error');

    const updated = {
        ...m,
        name,
        phone,
        gender: document.getElementById('edit-gender').value,
        zkid,
        address: document.getElementById('edit-address').value,
        guardian_phone: document.getElementById('edit-guardian-phone') ? document.getElementById('edit-guardian-phone').value.trim() : '',
        notes: document.getElementById('edit-notes') ? document.getElementById('edit-notes').value.trim() : '',
        trainer: document.getElementById('edit-has-trainer').checked ? document.getElementById('edit-trainer').value : '',
    };
    if (document.getElementById('emem-exp') && document.getElementById('emem-exp').value) {
        updated.exp = document.getElementById('emem-exp').value;
    }
    if (document.getElementById('edit-has-private')) {
        updated.privateTrainer = document.getElementById('edit-has-private').checked ? document.getElementById('edit-private-trainer').value : '';
    }

    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.updateMember(updated, { reason: 'data_edit' }), 'بيانات المشترك');
        if (ok === null) return;
    }
    Object.assign(m, updated);

    // If manually edited to an old date, it might be expired
    const expDate = new Date(m.exp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expDate < today) {
        if (isZkConnected()) {
            window.electronAPI.deleteZkUser(m.zkid).catch(e => (()=>{})(e));
            showToast(`تم تحديث المشترك ومسح بصمته لأن التاريخ قديم`, 'info');
        }
    }

    renderMembers();
    renderTrainers();
    closeModal('editMemberModal');
}

async function deleteMember(id) {
    if (await customConfirm('هل أنت متأكد من نقل هذا المشترك إلى سلة المهملات؟')) {
        const member = (members || []).find(m => m.id === id);
        if (member && window.electronAPI) {
            window.electronAPI.deleteZkUser(member.zkid).catch(e => (()=>{})(e));
            if (window.electronAPI.addTrash) {
                const trashOk = await dbWrite(window.electronAPI.addTrash({
                    id: 'trash_' + Date.now(),
                    type: 'member',
                    item_data: member,
                    deleted_by: currentUser ? (currentUser.username || currentUser.name) : 'admin'
                }), 'نقل لسلة المهملات');
                if (trashOk === null) return;   // ماتنقلش للمهملات — منحذفش
            }
            const ok = await dbWrite(window.electronAPI.deleteMember(id), 'حذف المشترك');
            if (ok === null) return;
            members = (members || []).filter(m => m.id !== id);
            renderMembers();
            renderTrainers();
            showToast('تم نقل المشترك إلى سلة المهملات ', 'success');
        }
    }
}

async function saveNewMember() {
    const phone = document.getElementById('reg-phone').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const zkid = document.getElementById('reg-zkid').value.trim();
    const gender = document.getElementById('reg-gender').value;
    const pkgVal = document.getElementById('reg-package').value;
    const pkgName = pkgVal.split('|')[0];
    const price = Number(document.getElementById('reg-price').value) || 0;
    const paid = Number(document.getElementById('reg-paid').value) || 0;

    if (!name || !phone || !zkid) return showToast('يرجى إدخال البيانات بشكل صحيح.', 'error');
    if (!isValidPhone(phone)) return showToast('رقم الهاتف غير صحيح (11 رقماً يبدأ بـ 01)', 'error');
    if (price < 0 || paid < 0) return showToast('المبالغ لا يمكن أن تكون سالبة.', 'error');
    if (paid > price) return showToast('المبلغ المدفوع أكبر من سعر الباقة.', 'error');

    const existingMember = (members || []).find(x => x.zkid === zkid || x.phone === phone);
    if (existingMember) {
        showToast('هذا المشترك مسجل مسبقاً! جاري تحويلك لصفحة التجديد والإدارة.', 'error');
        closeModal('registerModal');
        return openRenewModal(existingMember.id);
    }

    // إعادة التحقق لحظة الحفظ: مشرف آخر قد يكون حجز نفس الرقم
    // بين فتح النافذة والضغط على حفظ
    if (window.electronAPI && window.electronAPI.isZkIdFree) {
        const check = await window.electronAPI.isZkIdFree(zkid).catch(() => null);
        if (check && !check.free) {
            return showToast(check.reason, 'error');
        }
    }

    const pkgRef = (packages || []).find(p => p.name === pkgName) || {
        duration: 30
    };
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + pkgRef.duration);
    const customExp = document.getElementById('reg-custom-exp') ? document.getElementById('reg-custom-exp').value : '';
    const finalExpStr = customExp ? customExp : localDateStr(expDate);

    const trainerSelect = document.getElementById('reg-trainer').value;
    const trainer = document.getElementById('reg-has-trainer').checked ? trainerSelect : '';

    const privateSelect = document.getElementById('reg-private-trainer') ? document.getElementById('reg-private-trainer').value : '';
    const privateTrainer = (document.getElementById('reg-has-private') && document.getElementById('reg-has-private').checked) ? privateSelect : '';

    const newMember = {
        id: 'MEM-' + Date.now(),
        zkid,
        name,
        gender,
        phone,
        guardian_phone: document.getElementById('reg-guardian-phone') ? document.getElementById('reg-guardian-phone').value.trim() : '',
        notes: document.getElementById('reg-notes') ? document.getElementById('reg-notes').value.trim() : '',
        address: document.getElementById('reg-address').value,
        pkg: pkgName,
        price: price,
        paid: paid,
        exp: finalExpStr,
        // يُسجَّل في سجل التعديلات: هل اختار المشرف التاريخ أم حُسب من الباقة
        expManual: !!customExp,
        status: 'active',
        frozenDays: 0,
        trainer: trainer,
        privateTrainer: privateTrainer
    };
    // الحفظ في القاعدة أولاً ثم التحديث المحلي: كانت الواجهة تعرض المشترك
    // وتؤكد النجاح حتى لو فشلت الكتابة، فيختفي عند أول إعادة تشغيل
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addMember(newMember), 'المشترك الجديد');
        if (ok === null) return;
        if (paid > 0) {
            await dbWrite(window.electronAPI.addTransaction({
                id: 'TXN-' + Date.now(),
                member_id: newMember.id,
                amount: paid,
                pkg: pkgName,
                timestamp: new Date().toISOString(),
                username: currentUser.username || currentUser.name
            }), 'دفعة الاشتراك');
        }
        // رصيد حصص الباقة المتميزة تحسبه العملية الرئيسية
        await refreshMembersFromDb();
    } else {
        members.unshift(newMember);
    }
    renderMembers();
    renderTrainers();
    closeModal('registerModal');

    const sendWa = await customConfirm('تم الحفظ بنجاح! هل تريد إرسال رسالة ترحيبية عبر واتساب للعميل الجديد؟');
    if (sendWa) {
        const msg = `مرحباً ${name}، نرحب بك في الصالة الرياضية! تم تفعيل اشتراكك بنجاح في باقة (${pkgName}). نتمنى لك تمريناً ممتعاً!`;
        openWhatsApp(phone, msg);
    }
}

function openRenewModal(id) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    document.getElementById('rn-member-id').value = m.id;
    document.getElementById('rn-name').innerText = m.name;
    document.getElementById('rn-gender').innerText = genderText(m.gender);

    const badgeEl = document.getElementById('rn-status-badge');
    if (badgeEl) {
        if (effectiveStatus(m) === 'active') {
            badgeEl.className = 'badge badge-success';
            badgeEl.innerText = 'ساري';
        } else if (m.status === 'expired') {
            badgeEl.className = 'badge badge-danger';
            badgeEl.innerText = 'منتهي';
        } else {
            badgeEl.className = 'badge badge-danger';
            badgeEl.innerText = 'مجمد ';
        }
    }

    const currentExpEl = document.getElementById('rn-current-exp');
    if (currentExpEl) currentExpEl.innerText = m.exp || '-';

    // تفريغ حقول التجديد السابق: التاريخ المخصص كان يبقى محفوظاً
    // فيُطبَّق على المشترك التالي بصمت ويعطيه تاريخ انتهاء خاطئ
    const customExpEl = document.getElementById('rn-custom-exp');
    if (customExpEl) customExpEl.value = '';

    const pkgSelect = document.getElementById('rn-package');
    // ابدأ من الباقة الحالية للمشترك إن وُجدت، وإلا فأول باقة في القائمة
    if (pkgSelect && pkgSelect.options.length > 0) {
        const match = [...pkgSelect.options].find(o => o.value.split('|')[0] === m.pkg);
        pkgSelect.value = match ? match.value : pkgSelect.options[0].value;
    }
    onPackageChange('rn');

    // منع التجديد قبل سداد المديونية (قرار العمل: الدين يُسدَّد أولاً)
    const due = remainingOf(m);
    const banner = document.getElementById('rn-debt-banner');
    const formWrap = document.getElementById('rn-form-wrap');
    const confirmBtn = document.getElementById('rn-confirm-btn');
    const payBtn = document.getElementById('rn-debt-pay-btn');

    if (due > 0) {
        document.getElementById('rn-debt-text').innerText =
            `على المشترك ${m.name} مديونية قدرها ${due.toLocaleString()} ج.م من الاشتراك الحالي ` +
            `(سعر الباقة ${Number(m.price || 0).toLocaleString()} ج.م، المدفوع ${Number(m.paid || 0).toLocaleString()} ج.م). ` +
            `يجب تحصيلها قبل تجديد الاشتراك.`;
        if (banner) banner.style.display = 'block';
        if (formWrap) formWrap.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (payBtn) payBtn.onclick = () => { closeModal('renewModal'); openPaymentModal(m.id); };
    } else {
        if (banner) banner.style.display = 'none';
        if (formWrap) formWrap.style.display = '';
        if (confirmBtn) confirmBtn.style.display = '';
    }

    openModal('renewModal');
}

async function confirmRenew() {
    const id = document.getElementById('rn-member-id').value;
    const m = (members || []).find(x => x.id === id);
    if (!m) return;

    // حارس مكرر في الواجهة، والحارس الحقيقي في العملية الرئيسية
    const due = remainingOf(m);
    if (due > 0) {
        return showToast(`لا يمكن التجديد: على المشترك مديونية ${due.toLocaleString()} ج.م يجب سدادها أولاً.`, 'error');
    }

    const price = Number(document.getElementById('rn-price').value) || 0;
    const paidRaw = document.getElementById('rn-paid').value;
    const paid = Number(paidRaw);
    if (paidRaw === '' || isNaN(paid) || paid < 0) return showToast('الرجاء إدخال مبلغ صحيح.', 'error');
    if (price < 0) return showToast('سعر الباقة لا يمكن أن يكون سالباً.', 'error');
    if (paid > price) return showToast('المبلغ المدفوع أكبر من سعر الباقة.', 'error');

    const pkgName = document.getElementById('rn-package').value.split('|')[0];
    const pkgRef = (packages || []).find(p => p.name === pkgName) || {
        duration: 30
    };

    let extraDays = pkgRef.duration;

    // If frozen, unfreeze and add remaining frozen days + new package duration
    if (m.status === 'frozen' && m.frozenDays) {
        extraDays += m.frozenDays;
        m.frozenDays = 0;
    }
    // If active, extend current expiration date
    else if (effectiveStatus(m) === 'active') {
        const today = new Date();
        const exp = new Date(m.exp);
        if (exp > today) {
            extraDays += Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
        }
    }

    const customExp = document.getElementById('rn-custom-exp') ? document.getElementById('rn-custom-exp').value : '';
    if (customExp) {
        m.exp = customExp;
    } else {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + extraDays);
        m.exp = localDateStr(expDate);
    }
    m.pkg = pkgName;
    // اشتراك جديد = دورة مالية جديدة: السعر والمدفوع يخصّان هذه الدورة وحدها.
    // (لا يوجد دين مرحَّل لأن التجديد ممنوع قبل السداد.)
    m.price = price;
    m.paid = paid;
    m.status = 'active';

    if (window.electronAPI) {
        // renewal: true حتى يُعاد رصيد حصص الباقة المتميزة عند التجديد،
        // بينما يبقى محفوظاً عند التجميد وتعديل المدة وتعديل البيانات
        const ok = await dbWrite(window.electronAPI.updateMember(m, { renewal: true, reason: 'renewal' }), 'تجديد الاشتراك');
        if (ok === null) return;
        if (paid > 0) {
            await dbWrite(window.electronAPI.addTransaction({
                id: 'TXN-' + Date.now(),
                member_id: m.id,
                amount: paid,
                pkg: pkgName,
                timestamp: new Date().toISOString(),
                username: currentUser.username || currentUser.name
            }), 'دفعة التجديد');
        }
        await refreshMembersFromDb();
    }

    renderMembers();
    renderTrainers();
    closeModal('renewModal');
    showToast('تم تجديد الاشتراك وتنشيطه بنجاح ', 'success');

    // قالب التجديد قابل للتعديل من إعدادات الواتساب، وكان متسمّر هنا فالتعديل مكانش بيأثر
    if (waConfig && waConfig.notifyRenewal !== false) {
        const sendWa = await customConfirm('تم تجديد الاشتراك بنجاح! هل تريد إرسال رسالة واتساب للعميل؟');
        if (sendWa) {
            const msg = (waConfig.tplRenewal || "أهلاً {NAME}، تم تجديد اشتراكك بنجاح!\nالباقة: {PACKAGE}\nالمبلغ المدفوع: {PAID} ج.م\nتاريخ الانتهاء الجديد: {EXP_DATE}")
                .replace(/{NAME}/g, m.name)
                .replace(/{PACKAGE}/g, m.pkg || '')
                .replace(/{PAID}/g, paid || 0)
                .replace(/{EXP_DATE}/g, m.exp || '');
            waManualSend(m.phone, m.name, 'renewal', msg);
        }
    }
}

async function toggleFreezeMember(id, fromModal = false) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;

    if (m.status === 'expired') {
        return showToast('لا يمكن تجميد أو استئناف اشتراك منتهي! يرجى التجديد أولاً.', 'error');
    }

    if (m.status === 'active') {
        if (await customConfirm(`هل تريد تجميد اشتراك المشترك (${m.name}) مؤقتاً؟`)) {
            const today = new Date();
            const exp = new Date(m.exp);
            const diffDays = Math.ceil((exp - today) / MS_PER_DAY);
            const payload = { ...m, status: 'frozen', frozenDays: diffDays > 0 ? diffDays : 0 };
            if (window.electronAPI) {
                const ok = await dbWrite(window.electronAPI.updateMember(payload, { reason: 'freeze' }), 'بيانات المشترك');
                if (ok === null) return;
            }
            Object.assign(m, payload);
            renderMembers();
            renderTrainers();
            if (fromModal) openMemberProfile(id);
            showToast(`تم تجميد اشتراك ${m.name} بنجاح `, 'info');
        }
    } else if (m.status === 'frozen') {
        if (await customConfirm(`هل تريد استئناف (فك تجميد) اشتراك المشترك (${m.name})؟`)) {
            const extraDays = m.frozenDays || 0;
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + extraDays);
            const payload = { ...m, exp: localDateStr(expDate), frozenDays: 0, status: 'active' };
            if (window.electronAPI) {
                const ok = await dbWrite(window.electronAPI.updateMember(payload, { reason: 'unfreeze' }), 'بيانات المشترك');
                if (ok === null) return;
            }
            Object.assign(m, payload);
            renderMembers();
            renderTrainers();
            if (fromModal) openMemberProfile(id);
            showToast(`تم فك تجميد اشتراك ${m.name} وتمديده إلى ${m.exp} `, 'success');
        }
    }
}

function openCustomDurationModal(id) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    document.getElementById('cd-member-id').value = m.id;
    document.getElementById('cd-name').innerText = m.name;
    document.getElementById('cd-current-exp').innerText = m.exp || 'غير محدد';
    document.getElementById('cd-add-days').value = '';
    document.getElementById('cd-new-exp').value = m.exp || '';
    openModal('customDurationModal');
}

function calculateCustomDateFromDays() {
    const days = parseInt(document.getElementById('cd-add-days').value);
    if (isNaN(days)) return;
    
    const currentExpText = document.getElementById('cd-current-exp').innerText;
    let baseDate = new Date();
    
    if (currentExpText && currentExpText !== 'غير محدد' && currentExpText !== '-') {
        const expDate = new Date(currentExpText);
        if (expDate > baseDate) {
            baseDate = expDate;
        }
    }
    
    baseDate.setDate(baseDate.getDate() + days);
    document.getElementById('cd-new-exp').value = localDateStr(baseDate);
}

async function saveCustomDuration() {
    const id = document.getElementById('cd-member-id').value;
    const m = (members || []).find(x => x.id === id);
    if (!m) return;

    const newExp = document.getElementById('cd-new-exp').value;
    if (!newExp) {
        return showToast('الرجاء تحديد تاريخ الانتهاء الجديد', 'error');
    }

    // status = active لأن التاريخ الجديد قد يكون بعد انتهاء سابق
    const payload = { ...m, exp: newExp, status: 'active', frozenDays: 0 };
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.updateMember(payload, { reason: 'duration_edit' }), 'تعديل مدة الاشتراك');
        if (ok === null) return;
    }
    Object.assign(m, payload);

    renderMembers();
    closeModal('customDurationModal');
    showToast('تم تعديل مدة الاشتراك بنجاح', 'success');
}

// ==========================================
// المدفوعات والمديونيات
// ==========================================
let allDebtors = [];

function openPaymentModal(memberId) {
    const m = (members || []).find(x => String(x.id) === String(memberId));
    if (!m) return showToast('تعذر العثور على المشترك', 'error');

    const due = remainingOf(m);
    if (due <= 0) return showToast('لا توجد مديونية على هذا المشترك', 'info');

    document.getElementById('pay-member-id').value = m.id;
    document.getElementById('pay-member-name').innerText = m.name;
    document.getElementById('pay-price').innerText = Number(m.price || 0).toLocaleString() + ' ج.م';
    document.getElementById('pay-already').innerText = Number(m.paid || 0).toLocaleString() + ' ج.م';
    document.getElementById('pay-remaining').innerText = due.toLocaleString() + ' ج.م';

    const amountEl = document.getElementById('pay-amount');
    amountEl.value = '';
    amountEl.max = due;
    previewPayment();

    openModal('paymentModal');
    setTimeout(() => amountEl.focus(), 50);
}

// معاينة المتبقي بعد الدفعة قبل تأكيدها
function previewPayment() {
    const m = (members || []).find(x => String(x.id) === String(document.getElementById('pay-member-id').value));
    if (!m) return;
    const due = remainingOf(m);
    const amount = Number(document.getElementById('pay-amount').value) || 0;
    const after = Math.round((due - amount) * 100) / 100;

    const box = document.getElementById('pay-after-box');
    const out = document.getElementById('pay-after');
    const note = document.getElementById('pay-note');
    const btn = document.getElementById('pay-submit-btn');

    out.innerText = Math.max(0, after).toLocaleString() + ' ج.م';
    box.classList.toggle('is-debt', after > 0);
    box.classList.toggle('is-settled', after <= 0 && amount > 0);

    if (amount > due) {
        note.className = 'pay-calc-note text-danger';
        note.innerText = `المبلغ أكبر من المتبقي (${due.toLocaleString()} ج.م).`;
        if (btn) btn.disabled = true;
    } else if (amount <= 0) {
        note.className = 'pay-calc-note text-muted';
        note.innerText = 'أدخل مبلغ الدفعة.';
        if (btn) btn.disabled = true;
    } else if (after === 0) {
        note.className = 'pay-calc-note text-success';
        note.innerText = 'ستُسدَّد المديونية بالكامل وسيخرج المشترك من جدول المديونيات.';
        if (btn) btn.disabled = false;
    } else {
        note.className = 'pay-calc-note text-warning';
        note.innerText = `سيتبقى على المشترك ${after.toLocaleString()} ج.م بعد هذه الدفعة.`;
        if (btn) btn.disabled = false;
    }
}

async function submitPayment() {
    const id = document.getElementById('pay-member-id').value;
    const amount = Number(document.getElementById('pay-amount').value);
    const m = (members || []).find(x => String(x.id) === String(id));
    if (!m) return;
    if (!isFinite(amount) || amount <= 0) return showToast('أدخل مبلغ دفعة صحيحاً', 'error');

    const btn = document.getElementById('pay-submit-btn');
    if (btn) btn.disabled = true;

    try {
        const res = await window.electronAPI.addPayment({
            id: 'PAY-' + Date.now(),
            member_id: id,
            amount: amount,
            pkg: 'سداد مديونية - ' + (m.pkg || ''),
            timestamp: new Date().toISOString(),
            username: currentUser ? (currentUser.username || currentUser.name) : 'admin'
        });

        if (!res || !res.success) {
            return showToast((res && res.error) || 'فشل تسجيل الدفعة', 'error');
        }

        // نأخذ القيم من القاعدة لا من حساب محلي، فهي مصدر الحقيقة
        m.paid = res.paid;
        closeModal('paymentModal');
        showToast(res.remaining > 0 ?
            `تم تحصيل ${amount.toLocaleString()} ج.م — المتبقي ${res.remaining.toLocaleString()} ج.م` :
            `تم تحصيل ${amount.toLocaleString()} ج.م — سُدِّدت المديونية بالكامل`, 'success');

        await refreshMembersFromDb();
        renderMembers();
        loadDebtors();
        loadDailyReports();
        loadDashboardStats();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function loadDebtors() {
    if (!window.electronAPI || !window.electronAPI.getDebtors) return;
    try {
        const rows = await window.electronAPI.getDebtors() || [];
        // نفس تصفية الشيفت المطبَّقة على جدول المشتركين
        const allowedIds = new Set(getAllowedMembers().map(m => String(m.id)));
        allDebtors = rows.filter(r => allowedIds.has(String(r.id)));
        renderDebtors(allDebtors);
        updateDebtorsBadge();
    } catch (err) {
        (()=>{})('loadDebtors failed', err);
        showToast('خطأ في تحميل جدول المديونيات', 'error');
    }
}

function updateDebtorsBadge() {
    const badge = document.getElementById('debtors-badge');
    if (!badge) return;
    const n = (allDebtors || []).length;
    badge.innerText = n;
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
}

function renderDebtors(list) {
    const tbody = document.getElementById('debtors-tbody');
    if (!tbody) return;

    const total = (list || []).reduce((s, r) => s + Number(r.remaining || 0), 0);
    const max = (list || []).reduce((s, r) => Math.max(s, Number(r.remaining || 0)), 0);

    const elCount = document.getElementById('debt-count');
    const elTotal = document.getElementById('debt-total');
    const elMax = document.getElementById('debt-max');
    const elFoot = document.getElementById('debtors-foot-total');
    if (elCount) elCount.innerText = (list || []).length;
    if (elTotal) elTotal.innerText = total.toLocaleString() + ' ج.م';
    if (elMax) elMax.innerText = max.toLocaleString() + ' ج.م';
    if (elFoot) elFoot.innerText = total.toLocaleString() + ' ج.م';

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;" class="text-success">لا توجد مديونيات — كل المشتركين مسدِّدون بالكامل</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(r => `
        <tr>
            <td><b>${escapeHTML(r.name)}</b></td>
            <td><span class="badge badge-primary">${escapeHTML(r.zkid)}</span></td>
            <td style="direction:ltr; text-align:right;">${escapeHTML(r.phone || '-')}</td>
            <td>${Number(r.price || 0).toLocaleString()} ج.م</td>
            <td>${Number(r.paid || 0).toLocaleString()} ج.م</td>
            <td class="text-danger" style="font-weight:800;">${Number(r.remaining || 0).toLocaleString()} ج.م</td>
            <td>${escapeHTML(r.exp || '-')}</td>
            <td class="action-buttons">
                <div class="action-cell">
                    <button class="btn btn-sm" style="background:var(--success); border-color:var(--success); color:#fff;"
                            onclick="openPaymentModal('${escapeJsArg(r.id)}')">تسديد دفعة</button>
                    <button class="btn btn-sm btn-outline" onclick="openMemberProfile('${escapeJsArg(r.id)}')">الكارت</button>
                </div>
            </td>
        </tr>`).join('');
}

function filterDebtorsTable(val) {
    const q = (val || '').toLowerCase().trim();
    if (!q) return renderDebtors(allDebtors);
    renderDebtors((allDebtors || []).filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(q) ||
        String(r.zkid || '').includes(q)
    ));
}

function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';
    let rowsHTML = '';
    (users || []).forEach(u => {
        let act = `<div class="action-cell">` +
            `<button class="btn btn-sm btn-outline" onclick="openEditUser('${escapeJsArg(u.username)}')"> تعديل</button>` +
            (u.username !== 'admin' ?
                `<button class="btn btn-sm btn-danger" onclick="deleteUser('${escapeJsArg(u.username)}')">حذف</button>` :
                `<span style="color:var(--text-dim); font-size:0.8rem;">لا يمكن حذفه</span>`) +
            `</div>`;
        let shiftTxt = 'إدارة عامة';
        if (u.gender === 'male') shiftTxt = 'شيفت ذكور';
        if (u.gender === 'female') shiftTxt = 'شيفت إناث';

        rowsHTML += `<tr><td>${escapeHTML(u.username)}</td><td>${escapeHTML(u.name)}</td><td>${u.role === 'admin'?'مدير نظام':'مشرف'}</td><td>${shiftTxt}</td><td>${act}</td></tr>`;
    });
    tbody.innerHTML = rowsHTML;
    populateLoginUsersSelect();
}

function populateLoginUsersSelect() {
    const select = document.getElementById('login-user');
    if (!select) return;

    const validUsers = (users || []).filter(u => u && (u.username || u.name));

    select.innerHTML = '';

    if (validUsers.length === 0) {
        // كان بيحط خيار admin مثبت. على الموقع ده كان بيخلي
        // الدخول يفشل دايماً، لأن السحابة بتتحقق بالإيميل مش بـ admin.
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— مفيش حسابات متاحة —';
        opt.disabled = true;
        select.appendChild(opt);
        return;
    }

    validUsers.forEach(u => {
        const uname = (u.username || 'admin').trim();
        const name = (u.name || uname).trim();
        const roleTxt = u.role === 'admin' ? 'مدير نظام' : 'مشرف صالة';
        const opt = document.createElement('option');
        opt.value = uname;
        opt.textContent = `${name} (${uname}) - ${roleTxt}`;
        select.appendChild(opt);
    });
}

async function saveNewUser() {
    const u = document.getElementById('u-user').value.trim();
    const p = document.getElementById('u-pass').value;
    const n = document.getElementById('u-name').value.trim();
    const g = document.getElementById('u-gender').value;
    const r = document.getElementById('u-role').value;
    if (!u || !p || !n) return showToast('أكمل البيانات', 'error');
    if (p.length < 4) return showToast('كلمة المرور يجب أن تكون 4 أحرف على الأقل', 'error');
    if ((users || []).find(x => x.username === u)) return showToast('اسم المستخدم مسجل مسبقاً!', 'error');
    const newUser = {
        username: u,
        password: p,
        name: n,
        gender: g,
        role: r
    };
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addUser(newUser), 'الحساب');
        if (ok === null) return;
    }
    // لا نحتفظ بكلمة المرور في ذاكرة الواجهة بعد حفظها
    users.push({ username: u, name: n, gender: g, role: r });
    renderUsers();
    closeModal('addUserModal');
    showToast(`تمت إضافة حساب ${n} بنجاح`, 'success');
}

function openEditUser(username) {
    const u = (users || []).find(x => x.username === username);
    if (!u) return;
    document.getElementById('eu-user').value = u.username;
    document.getElementById('eu-user-display').value = u.username;
    document.getElementById('eu-name').value = u.name || '';
    document.getElementById('eu-gender').value = u.gender || 'all';
    document.getElementById('eu-role').value = u.role || 'supervisor';
    document.getElementById('eu-pass').value = '';
    openModal('editUserModal');
}

async function saveEditedUser() {
    const username = document.getElementById('eu-user').value;
    const u = (users || []).find(x => x.username === username);
    if (!u) return;
    const name = document.getElementById('eu-name').value.trim();
    const gender = document.getElementById('eu-gender').value;
    const role = document.getElementById('eu-role').value;
    const newPass = document.getElementById('eu-pass').value.trim();

    if (!name) return showToast('أدخل الاسم الكامل', 'error');
    if (newPass && newPass.length < 4) return showToast('كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل', 'error');
    // لا تترك النظام بلا مدير واحد على الأقل
    if (u.role === 'admin' && role !== 'admin' && (users || []).filter(x => x.role === 'admin').length <= 1) {
        return showToast('لا يمكن إزالة صلاحية المدير من الحساب الإداري الوحيد!', 'error');
    }

    const payload = {
        username,
        name,
        gender,
        role
    };
    if (newPass) payload.password = newPass;
    const res = await dbWrite(window.electronAPI.updateUser(payload), 'تعديل الحساب');
    if (res === null) return;

    u.name = name;
    u.gender = gender;
    u.role = role;
    // لو المستخدم عدّل حسابه هو، حدّث الشاشة فوراً بصلاحياته الجديدة
    if (currentUser && currentUser.username === username) {
        currentUser = {
            ...currentUser,
            name,
            gender,
            role
        };
        document.getElementById('top-user-name').innerText = name;
        document.getElementById('top-user-role').innerText = role === 'admin' ? 'مدير نظام' : 'مشرف صالة';
        document.getElementById('role-badge').innerText = role === 'admin' ? 'الإدارة' : 'إشراف';
    }

    renderUsers();
    renderMembers();
    renderTrainers();
    closeModal('editUserModal');
    showToast(newPass ? `تم تعديل حساب ${name} وتغيير كلمة المرور` : `تم تعديل حساب ${name}`, 'success');
}

async function deleteUser(username) {
    if (currentUser && currentUser.username === username) return showToast('لا يمكنك حذف الحساب الذي تستخدمه حالياً!', 'error');
    // الحارس كان يعتمد على اسم المستخدم 'admin' وحده، فيمكن حذف آخر مدير لو اسمه مختلف
    const target = (users || []).find(u => u.username === username);
    if (target && target.role === 'admin' && (users || []).filter(u => u.role === 'admin').length <= 1) {
        return showToast('لا يمكن حذف الحساب الإداري الوحيد في النظام!', 'error');
    }
    if (await customConfirm('حذف هذا الحساب؟')) {
        if (window.electronAPI) {
            const ok = await dbWrite(window.electronAPI.deleteUser(username), 'حذف الحساب');
            if (ok === null) return;
        }
        users = (users || []).filter(usr => usr.username !== username);
        renderUsers();
        showToast('تم حذف الحساب', 'success');
    }
}

// --- المدربين ---
// العلاقة بالمدرب نوعان مستقلان: اشتراك يتبعه (trainer) وتدريب خاص (privateTrainer)
function getTrainerMembers(trainerName) {
    return (members || []).filter(m => m.trainer === trainerName || m.privateTrainer === trainerName);
}

// إحصائية مدرب: العاديون والبريفت من أصحاب الاشتراكات السارية + الإجمالي بدون تكرار
function getTrainerStats(trainerName) {
    const today = todayStr();
    const all = getTrainerMembers(trainerName);
    const current = all.filter(m => m.status !== 'frozen' && m.exp >= today);
    return {
        regular: current.filter(m => m.trainer === trainerName).length,
        private: current.filter(m => m.privateTrainer === trainerName).length,
        current: current.length,
        all: all.length,
        revenue: all.reduce((sum, m) => sum + Number(m.paid || 0), 0)
    };
}

function trainerGenderText(gender) {
    if (gender === 'male') return 'مدرب ذكور';
    if (gender === 'female') return 'مدربة إناث';
    return 'للشيفتين';
}

// المدربون الظاهرون للمستخدم الحالي عند اختيار مدرب للمشترك: تصفية الموظفين حسب الشيفت وحسب الوظيفة (مدربين فقط)
function getVisibleTrainers() {
    if (!trainers) return [];
    let list = trainers;
    if (currentUser && currentUser.role !== 'admin' && currentUser.gender && currentUser.gender !== 'all') {
        list = list.filter(t => !t.gender || t.gender === 'all' || t.gender === currentUser.gender);
    }
    // إظهار الموظفين برتبة "مدرب صالة" أو المدربين فقط في خيارات المشتركين
    return list.filter(t => !t.job_title || t.job_title === 'مدرب صالة' || t.job_title.includes('مدرب'));
}

function renderTrainers() {
    const tbody = document.getElementById('trainers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterEl = document.getElementById('trainer-job-filter');
    const selectedJob = filterEl ? filterEl.value : 'all';

    let list = trainers || [];
    if (selectedJob !== 'all') {
        list = list.filter(t => (t.job_title || 'مدرب صالة') === selectedJob);
    }

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted)">لا يوجد موظفين مسجلين في هذه الفئة — اضغط "+ إضافة موظف / مدرب جديد"</td></tr>';
        populateTrainersDropdown();
        return;
    }
    let rowsHTML = '';
    list.forEach(t => {
        const s = getTrainerStats(t.name);
        const zkidBadge = t.zkid ? `<span class="badge badge-primary">${escapeHTML(t.zkid)}</span>` : '<span class="badge badge-neutral">بدون بصمة</span>';
        const jobBadge = `<span class="badge badge-success">${escapeHTML(t.job_title || 'مدرب صالة')}</span>`;
        
        const act = `<div class="action-cell">` +
            `<button class="btn btn-sm btn-outline" onclick="openTrainerReport('${escapeJsArg(t.id)}')">المشتركين (${s.current})</button>` +
            `<button class="btn btn-sm btn-outline" onclick="openEditTrainerModal('${escapeJsArg(t.id)}')">تعديل</button>` +
            `<button class="btn btn-sm btn-danger" onclick="deleteTrainer('${escapeJsArg(t.id)}')">حذف</button>` +
            `</div>`;
        rowsHTML += `<tr>
          <td><b>${escapeHTML(t.name)}</b></td>
          <td>${jobBadge}</td>
          <td>${zkidBadge}</td>
          <td style="direction:ltr; text-align:right;">${escapeHTML(t.phone || '-')}</td>
          <td>${trainerGenderText(t.gender)}</td>
          <td><b style="color:var(--primary)">${s.current} مشترك</b></td>
          <td>${act}</td>
        </tr>`;
    });
    tbody.innerHTML = rowsHTML;
    populateTrainersDropdown();
}

// تعبئة قوائم المدربين في نوافذ التسجيل والتعديل والبريفت (حسب شيفت المستخدم)
function populateTrainersDropdown() {
    const visible = getVisibleTrainers();
    ['reg-trainer', 'edit-trainer', 'pt-trainer', 'reg-private-trainer', 'edit-private-trainer'].forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '<option value="">بدون مدرب</option>';
        visible.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.gender === 'all' ? t.name : `${t.name} (${trainerGenderText(t.gender)})`;
            select.appendChild(opt);
        });
        if (previous) select.value = previous;
    });
}

// يضمن بقاء المدرب المعيَّن حالياً ظاهراً في القائمة حتى لو كان من شيفت آخر،
// وإلا يُفقد الارتباط بمجرد الحفظ من مشرف الشيفت الآخر
function ensureTrainerOption(selectId, trainerName) {
    if (!trainerName) return;
    const select = document.getElementById(selectId);
    if (!select) return;
    if (![...select.options].some(o => o.value === trainerName)) {
        const opt = document.createElement('option');
        opt.value = trainerName;
        opt.textContent = trainerName + ' (من شيفت آخر)';
        select.appendChild(opt);
    }
    select.value = trainerName;
}

// تقرير تفصيلي بمشتركي مدرب معيّن
function openTrainerReport(id) {
    const t = (trainers || []).find(x => x.id === id);
    if (!t) return;
    const s = getTrainerStats(t.name);
    const today = todayStr();

    document.getElementById('trainer-report-title').innerText = 'مشتركو المدرب: ' + t.name;
    document.getElementById('trainer-report-summary').innerText =
        `الإجمالي: ${s.all} مشترك — ساري: ${s.current} (عادي: ${s.regular} | بريفت: ${s.private}) — إجمالي المدفوعات: ${s.revenue.toLocaleString()} ج.م`;

    const tbody = document.getElementById('trainer-report-body');
    tbody.innerHTML = '';
    const list = getTrainerMembers(t.name);
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted)">لا يوجد مشتركون مرتبطون بهذا المدرب</td></tr>';
    } else {
        // الساري أولاً ثم الأحدث انتهاءً
        list.sort((a, b) => String(b.exp).localeCompare(String(a.exp)));
        let rowsHTML = '';
        list.forEach(m => {
            const isCurrent = m.status !== 'frozen' && m.exp >= today;
            const badge = m.status === 'frozen' ? '<span class="badge badge-neutral">متوقف</span>' :
                (isCurrent ? '<span class="badge badge-success">ساري</span>' : '<span class="badge badge-danger">منتهي</span>');
            const isRegular = m.trainer === t.name;
            const isPrivate = m.privateTrainer === t.name;
            const priveTag = '<span style="color:var(--warning); font-weight:bold;">بريفت</span>';
            const typeTxt = isRegular && isPrivate ? ('عادي + ' + priveTag) : (isPrivate ? priveTag : 'عادي');
            rowsHTML += `<tr>
            <td><b>${escapeHTML(m.name)}</b></td>
            <td style="direction:ltr; text-align:right;">${escapeHTML(m.phone)}</td>
            <td>${typeTxt}</td>
            <td>${escapeHTML((m.pkg || '').replace(/[\?\uFFFD]/g, '').trim())}</td>
            <td>${Number(m.paid || 0).toLocaleString()} ج.م</td>
            <td>${m.exp}</td>
            <td>${badge}</td>
            <td><button class="btn btn-sm btn-outline" onclick="closeModal('trainerReportModal'); openMemberProfile('${m.id}')">الكارت</button></td>
          </tr>`;
        });
        tbody.innerHTML = rowsHTML;
    }
    openModal('trainerReportModal');
}

function openAddTrainerModal() {
    clearInputs('addTrainerModal');
    document.getElementById('trainer-edit-id').value = '';
    const g = document.getElementById('trainer-gender');
    if (g) g.value = 'male';
    const j = document.getElementById('trainer-job');
    if (j) j.selectedIndex = 0;
    document.getElementById('trainer-modal-title').innerText = 'إضافة مدرب جديد';
    document.getElementById('trainer-save-btn').innerText = 'حفظ المدرب';
    openModal('addTrainerModal');
}

// نفس النافذة تخدم التعديل: كان db-update-trainer موجوداً في العملية الرئيسية
// ومعروضاً في preload بلا أي زر يستدعيه
function openEditTrainerModal(id) {
    const t = (trainers || []).find(x => x.id === id);
    if (!t) return;
    document.getElementById('trainer-edit-id').value = t.id;
    document.getElementById('trainer-name').value = t.name || '';
    document.getElementById('trainer-phone').value = t.phone || '';
    document.getElementById('trainer-zkid').value = t.zkid || '';
    document.getElementById('trainer-job').value = t.job_title || 'مدرب صالة';
    document.getElementById('trainer-gender').value = t.gender || 'all';
    document.getElementById('trainer-modal-title').innerText = 'تعديل بيانات المدرب';
    document.getElementById('trainer-save-btn').innerText = 'حفظ التعديلات';
    openModal('addTrainerModal');
}

async function saveNewTrainer() {
    const editingId = document.getElementById('trainer-edit-id').value;
    const n = document.getElementById('trainer-name').value.trim();
    const jEl = document.getElementById('trainer-job');
    const j = jEl ? jEl.value : 'مدرب صالة';
    const pEl = document.getElementById('trainer-phone');
    const p = pEl ? pEl.value.trim() : '';
    const zEl = document.getElementById('trainer-zkid');
    const z = zEl ? zEl.value.trim() : '';
    const g = document.getElementById('trainer-gender').value;

    if (!n) return showToast('أدخل اسم الموظف / المدرب', 'error');
    if (!isValidPhone(p, false)) return showToast('رقم الهاتف غير صحيح (11 رقماً يبدأ بـ 01)', 'error');
    if ((trainers || []).find(t => t.name === n && t.id !== editingId)) return showToast('هذا الاسم مسجل مسبقاً!', 'error');

    if (editingId) {
        const existing = (trainers || []).find(t => t.id === editingId);
        if (!existing) return;
        const prevName = existing.name;
        const updated = { id: editingId, name: n, job_title: j, phone: p, zkid: z, gender: g };
        if (window.electronAPI) {
            const ok = await dbWrite(window.electronAPI.updateTrainer(updated), 'تعديل المدرب');
            if (ok === null) return;
            // تغيير الاسم يفكّ ارتباط المشتركين لأن الربط بالاسم لا بالمعرِّف
            if (prevName !== n) await refreshMembersFromDb();
        }
        Object.assign(existing, updated);
        renderTrainers();
        renderMembers();
        closeModal('addTrainerModal');
        showToast(`تم تعديل بيانات ${n} بنجاح`, 'success');
        return;
    }

    const newTrainer = {
        id: 'TRN-' + Date.now(),
        name: n,
        job_title: j,
        phone: p,
        zkid: z,
        gender: g
    };
    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addTrainer(newTrainer), 'الموظف/المدرب');
        if (ok === null) return;
    }
    trainers.push(newTrainer);
    renderTrainers();
    closeModal('addTrainerModal');
    showToast(`تمت إضافة الموظف/المدرب ${n} (${j}) بنجاح`, 'success');
}

// --- مدرب البريفت (تدريب خاص) — يُدار من كارت المشترك ومستقل عن مدرب الاشتراك ---
function openPrivateTrainerModal(memberId) {
    const m = (members || []).find(x => x.id === memberId);
    if (!m) return;
    if (getVisibleTrainers().length === 0 && !m.privateTrainer) {
        return showToast(trainers.length === 0 ?
            'أضف مدربين أولاً من قسم "المدربين"' :
            'لا يوجد مدربين متاحين لهذا الشيفت', 'error');
    }

    document.getElementById('pt-member-id').value = m.id;
    document.getElementById('pt-member-info').innerText = m.privateTrainer ?
        `${m.name} — مدرب البريفت الحالي: ${m.privateTrainer}` :
        `${m.name} — لا يوجد تدريب خاص حالياً`;
    populateTrainersDropdown();
    document.getElementById('pt-trainer').value = m.privateTrainer || '';
    ensureTrainerOption('pt-trainer', m.privateTrainer);
    document.getElementById('pt-remove-btn').style.display = m.privateTrainer ? 'inline-flex' : 'none';
    openModal('privateTrainerModal');
}

async function savePrivateTrainer() {
    const id = document.getElementById('pt-member-id').value;
    const m = (members || []).find(x => x.id === id);
    if (!m) return;
    const chosen = document.getElementById('pt-trainer').value;
    if (!chosen) return showToast('اختر مدرب البريفت أو اضغط "إزالة البريفت"', 'error');

    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.updateMember({ ...m, privateTrainer: chosen }), 'بيانات المشترك');
        if (ok === null) return;
    }
    m.privateTrainer = chosen;
    renderMembers();
    renderTrainers();
    closeModal('privateTrainerModal');
    showToast(`تم تعيين ${chosen} مدرب بريفت للمشترك ${m.name} `, 'success');
    openMemberProfile(id);
}

async function removePrivateTrainer() {
    const id = document.getElementById('pt-member-id').value;
    const m = (members || []).find(x => x.id === id);
    if (!m || !m.privateTrainer) return;
    if (await customConfirm(`إزالة التدريب الخاص (${m.privateTrainer}) من ${m.name}؟`)) {
        if (window.electronAPI) {
            const ok = await dbWrite(window.electronAPI.updateMember({ ...m, privateTrainer: '' }), 'بيانات المشترك');
            if (ok === null) return;
        }
        m.privateTrainer = '';
        renderMembers();
        renderTrainers();
        closeModal('privateTrainerModal');
        showToast('تم إزالة التدريب الخاص', 'success');
        openMemberProfile(id);
    }
}

async function deleteTrainer(id) {
    const t = (trainers || []).find(x => x.id === id);
    if (!t) return;
    const cnt = getTrainerMembers(t.name).length;
    const msg = cnt > 0 ?
        `حذف المدرب ${t.name}؟ سيتم نقل بياناته لسلة المهملات وفك ارتباطه من ${cnt} مشترك.` :
        `هل أنت متأكد من نقل المدرب ${t.name} إلى سلة المهملات؟`;
    if (!await customConfirm(msg)) return;

    if (window.electronAPI) {
        if (window.electronAPI.addTrash) {
            const trashOk = await dbWrite(window.electronAPI.addTrash({
                id: 'trash_' + Date.now(),
                type: 'trainer',
                item_data: t,
                deleted_by: currentUser ? (currentUser.username || currentUser.name) : 'admin'
            }), 'نقل لسلة المهملات');
            if (trashOk === null) return;   // ماتنقلش للمهملات — منحذفش
        }
        const res = await dbWrite(window.electronAPI.deleteTrainer(id), 'حذف المدرب');
        if (res === null) return;
    }
    (members || []).forEach(m => {
        if (m.trainer === t.name) m.trainer = '';
        if (m.privateTrainer === t.name) m.privateTrainer = '';
    });
    trainers = (trainers || []).filter(x => x.id !== id);

    renderTrainers();
    renderMembers();
    showToast(cnt > 0 ? `تم نقل ${t.name} لسلة المهملات وفك ارتباطه من ${cnt} مشترك` : `تم نقل ${t.name} إلى سلة المهملات `, 'success');
}

function filterStatus(st, el) {
    currentStatusFilter = st;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    // كروت لوحة القيادة تستدعي الدالة بلا زر، فنطابق التبويب بالحالة
    // وإلا بقيت التبويبات مؤشِّرة على "الكل" بينما الجدول مُفلتر
    const target = el || document.querySelector('.tab-btn[data-status="' + st + '"]');
    if (target) target.classList.add('active');
    renderMembers();
}

// Search Duplicate & Filter
let dupTimeout = null;

function checkDuplicate(val) {
    clearTimeout(dupTimeout);
    dupTimeout = setTimeout(() => {
        const q = val.trim().toLowerCase();
        if (q.length < 4) {
            document.getElementById('duplicate-warning').classList.add('hidden');
            return;
        }
        // Search globally across all members, not just allowed
        const found = (members || []).find(m => (m.phone && m.phone.includes(q)) || (m.name && m.name.toLowerCase().includes(q)));
        if (found) {
            dupFoundMember = found;
            document.getElementById('dup-info').innerText = `الاسم: ${found.name}`;
            document.getElementById('duplicate-warning').classList.remove('hidden');
        } else {
            document.getElementById('duplicate-warning').classList.add('hidden');
        }
    }, 300);
}

let filterTimeout = null;

function filterMembers(q) {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        const query = q.trim().toLowerCase();
        renderMembers(query);
    }, 300);
}

function switchSection(secId, el) {
    if (currentUser && currentUser.role !== 'admin' && ['users', 'external-revenues', 'activity'].includes(secId)) {
        showToast('هذا القسم متاح للمدير العام فقط', 'warning');
        return;
    }
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const targetSec = document.getElementById(secId);
    if (targetSec) targetSec.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(nav => nav.classList.remove('active'));
    // بعض الاستدعاءات تأتي من كروت لوحة القيادة بلا زر، فنطابق رابط القائمة بالقسم
    const navEl = el || [...document.querySelectorAll('.nav-link')]
        .find(a => (a.getAttribute('onclick') || '').includes(`'${secId}'`));
    if (navEl) navEl.classList.add('active');

    if (secId === 'dashboard') loadDashboardStats();
    if (secId === 'members') renderMembers();
    if (secId === 'packages') renderPackages();
    if (secId === 'store') loadStore();
    if (secId === 'plans') loadMemberPlans();
    if (secId === 'absence-bot') loadAbsentMembers();
    if (secId === 'trainers') renderTrainers();
    if (secId === 'employees') renderEmployees();
    if (secId === 'users') renderUsers();
    if (secId === 'daily-reports') loadDailyReports();
    if (secId === 'external-revenues') loadExternalRevenues();
    if (secId === 'trainer-attendance') loadTrainerAttendance();
    if (secId === 'employee-attendance') loadEmployeeAttendance();
    if (secId === 'invitations') loadInvitations();
    if (secId === 'debtors') loadDebtors();
    if (secId === 'activity') loadActivity();
    if (secId === 'trash') loadTrash();
}

function renderEmployees() {
    loadEmployees();
}

// ==========================================
// سجل التعديلات (للأدمن)
// ==========================================
let allActivity = [];

const ACTION_LABELS = {
    exp_changed: 'تغيير تاريخ الانتهاء',
    member_created: 'تسجيل مشترك جديد'
};

async function loadActivity() {
    const tbody = document.getElementById('activity-tbody');
    if (!tbody || !window.electronAPI || !window.electronAPI.getActivity) return;

    // تعبئة قائمة المستخدمين مرة واحدة
    const userSel = document.getElementById('act-user');
    if (userSel && userSel.options.length <= 1) {
        (users || []).forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.name || u.username;
            userSel.appendChild(opt);
        });
    }

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">جارٍ التحميل...</td></tr>';
    try {
        allActivity = await window.electronAPI.getActivity({
            startDate: document.getElementById('act-date-start').value || null,
            endDate: document.getElementById('act-date-end').value || null,
            username: userSel ? userSel.value : 'all',
            action: document.getElementById('act-action').value
        }) || [];
        renderActivity(allActivity);
    } catch (err) {
        (()=>{})('loadActivity failed', err);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;" class="text-danger">خطأ في تحميل السجل</td></tr>';
    }
}

function renderActivity(list) {
    const tbody = document.getElementById('activity-tbody');
    if (!tbody) return;

    const countEl = document.getElementById('activity-count');
    if (countEl) countEl.innerText = (list || []).length + ' سجل';

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;" class="text-muted">لا توجد تعديلات مسجَّلة في هذه الفترة</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(a => {
        const when = a.timestamp ? new Date(a.timestamp).toLocaleString('ar-EG') : '-';
        const roleTag = a.user_role === 'admin' ?
            '<span class="badge badge-warning">مدير</span>' :
            '<span class="badge badge-info">مشرف</span>';
        return `<tr>
            <td style="direction:ltr; text-align:right;">${when}</td>
            <td><b>${escapeHTML(a.username)}</b> ${roleTag}</td>
            <td>${escapeHTML(ACTION_LABELS[a.action] || a.action)}</td>
            <td><b>${escapeHTML(a.target_name || '-')}</b></td>
            <td class="text-muted">${escapeHTML(a.old_value || '—')}</td>
            <td class="text-primary" style="font-weight:700;">${escapeHTML(a.new_value || '—')}</td>
            <td class="text-muted" style="font-size:0.8rem;">${escapeHTML(a.note || '-')}</td>
        </tr>`;
    }).join('');
}

function filterActivityTable(val) {
    const q = (val || '').toLowerCase().trim();
    if (!q) return renderActivity(allActivity);
    renderActivity((allActivity || []).filter(a =>
        (a.target_name || '').toLowerCase().includes(q) ||
        (a.username || '').toLowerCase().includes(q) ||
        (a.note || '').toLowerCase().includes(q)
    ));
}

async function loadTrash() {
    const tbody = document.getElementById('trash-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">جاري تحميل سلة المهملات...</td></tr>';
    
    if (window.electronAPI && window.electronAPI.getTrash) {
        try {
            const trashItems = await window.electronAPI.getTrash() || [];
            if (trashItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">سلة المهملات فارغة حالياً </td></tr>';
                return;
            }
            
            const typeNames = {
                member: ' مشترك',
                trainer: ' مدرب',
                employee: ' موظف',
                expense: ' مصروف',
                revenue: ' إيراد خارجي'
            };

            const html = [];
            trashItems.forEach(item => {
                let dataObj = {};
                try { dataObj = typeof item.item_data === 'string' ? JSON.parse(item.item_data) : item.item_data; } catch(e) {}
                
                // القيم دي جاية من item_data اللي الموظف كتبها، وبتتحط في innerHTML.
                // من غير هروب، مشترك اسمه <img onerror=...> بيشغّل كود في المتصفح.
                let details = escapeHTML(dataObj.name || dataObj.description || dataObj.id || '-');
                if (item.type === 'member') details += ` (${escapeHTML(dataObj.pkg || 'اشتراك')}) - هاتف: ${escapeHTML(dataObj.phone || '-')}`;
                if (item.type === 'employee' || item.type === 'trainer') details += ` (${escapeHTML(dataObj.job_title || 'كادر')}) - هاتف: ${escapeHTML(dataObj.phone || '-')}`;
                if (item.type === 'expense' || item.type === 'revenue') details += ` - المبلغ: ${escapeHTML(String(dataObj.amount || 0))} ج.م`;

                const dateStr = item.deleted_at ? new Date(item.deleted_at).toLocaleString('ar-EG') : '-';

                html.push(`
                    <tr>
                        <td><b>${typeNames[item.type] || item.type}</b></td>
                        <td>${escapeHTML(details)}</td>
                        <td>${dateStr}</td>
                        <td>${escapeHTML(item.deleted_by || 'admin')}</td>
                        <td>
                            <button class="btn btn-sm btn-outline" style="color:var(--success); border-color:var(--success);" onclick="restoreTrashItem('${item.id}')"> استرجاع</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteTrashItemPermanent('${item.id}')"> حذف نهائي</button>
                        </td>
                    </tr>
                `);
            });
            tbody.innerHTML = html.join('');
        } catch(err) {
            (()=>{})(err);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger);">حدث خطأ أثناء تحميل السلة</td></tr>';
        }
    }
}

async function restoreTrashItem(id) {
    if (await customConfirm('هل أنت متأكد من استرجاع هذا السجل من سلة المهملات؟')) {
        if (window.electronAPI && window.electronAPI.restoreTrash) {
            const ok = await window.electronAPI.restoreTrash(id);
            if (ok) {
                showToast('تم استرجاع السجل بنجاح ', 'success');
                loadTrash();
                const resM = await window.electronAPI.getMembers();
                if (resM) members = resM;
                const resT = await window.electronAPI.getTrainers();
                if (resT) trainers = resT;
                const resE = await window.electronAPI.getEmployees();
                if (resE) employees = resE;
                renderMembers();
                renderTrainers();
                loadEmployees();
                if (typeof loadDailyReports === 'function') loadDailyReports();
                if (typeof loadRevenues === 'function') loadRevenues();
                if (typeof renderDashboardStats === 'function') renderDashboardStats();
            } else {
                showToast('فشل استرجاع السجل', 'error');
            }
        }
    }
}

async function deleteTrashItemPermanent(id) {
    if (await customConfirm('هل أنت متأكد من حذف هذا السجل نهائياً؟ لا يمكن التراجع عن هذا الإجراء!')) {
        if (window.electronAPI && window.electronAPI.deleteTrashPermanent) {
            const ok = await window.electronAPI.deleteTrashPermanent(id);
            if (ok) {
                showToast('تم الحذف النهائي بنجاح', 'success');
                loadTrash();
            } else {
                showToast('فشل الحذف النهائي', 'error');
            }
        }
    }
}

function openModal(id) {
    (()=>{})('openModal called for:', id);
    const el = document.getElementById(id);
    if (!el) {
        (()=>{})('Modal element not found:', id);
        showToast('خطأ: النافذة غير موجودة ' + id, 'error');
        return;
    }
    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('z-index', '99999', 'important');
    el.classList.add('active');
}

function closeModal(id) {
    (()=>{})('closeModal called for:', id);
    const el = document.getElementById(id);
    if (!el) return;
    el.style.setProperty('display', 'none', 'important');
    el.classList.remove('active');
}

function switchToRenewFromDup() {
    if (!dupFoundMember) return;
    closeModal('registerModal');
    openRenewModal(dupFoundMember.id);
}


// حُذفت showAttendance و attendanceModal: لم تكن مستدعاة من أي مكان،
// وتبويب "سجل الحضور والبصمة" داخل كارت المشترك يؤدي نفس الغرض.

// اسم المشترك في صف معاملة — الحصص اليومية تُخزَّن بـ member_id = "WALKIN:الاسم"
function txnMemberName(t) {
    if (t.member_id && String(t.member_id).startsWith('WALKIN:')) {
        return escapeHTML(String(t.member_id).replace('WALKIN:', '') || 'حصة يومية (زائر)');
    }
    const mem = (members || []).find(m => m.id === t.member_id);
    return mem ? escapeHTML(mem.name) : 'مستخدم غير معروف';
}

// بناء صفوف المعاملات والمصروفات — كان مكرراً حرفياً بين
// loadDailyReports و openSupervisorDetailReport باختلاف عمود المشرف فقط
function buildTxnRows(txns, withSupervisorCol) {
    return (txns || []).map(t => {
        const timeStr = new Date(t.timestamp).toLocaleString('ar-EG');
        const supCol = withSupervisorCol ? `<td>${escapeHTML(t.username)}</td>` : '';
        return `<tr><td style="direction:ltr; text-align:right;">${timeStr}</td>` +
            `<td><b>${txnMemberName(t)}</b></td><td>${escapeHTML(t.pkg)}</td>` +
            `<td class="text-primary" style="font-weight:bold;">${Number(t.amount || 0).toLocaleString()} ج.م</td>${supCol}</tr>`;
    }).join('');
}

function buildExpenseRows(exps, withSupervisorCol, withDeleteCol) {
    const canDelete = withDeleteCol && currentUser && currentUser.role === 'admin';
    return (exps || []).map(e => {
        const timeStr = new Date(e.timestamp).toLocaleString('ar-EG');
        const supCol = withSupervisorCol ? `<td>${escapeHTML(e.username || '-')}</td>` : '';
        const actCol = withDeleteCol ?
            `<td class="action-cell">${canDelete ? `<button class="btn btn-sm btn-danger" title="حذف المصروف" onclick="deleteExpense('${escapeJsArg(e.id)}')">حذف</button>` : ''}</td>` : '';
        return `<tr><td style="direction:ltr; text-align:right;">${timeStr}</td>` +
            `<td>${escapeHTML(e.description || '-')}</td>` +
            `<td class="text-danger" style="font-weight:bold;">${Number(e.amount || 0).toLocaleString()} ج.م</td>${supCol}${actCol}</tr>`;
    }).join('');
}

function sumAmounts(rows) {
    return (rows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

// ---------------------------------------------------------------------------
// التقرير المالي الشامل — يومي أو شهري
// ---------------------------------------------------------------------------
// بيجمع كل مصادر الدخل (اشتراكات + متجر + إيرادات خارجية) مطروح منها
// المصروفات. القسم القديم كان بيحسب الاشتراكات والمصروفات بس، فالصافي
// اللي بيظهر لصاحب الصالة كان ناقص مصدرين دخل كاملين.
async function loadFinancialReport(mode) {
    if (!window.electronAPI || !window.electronAPI.getFinancialSummary) {
        showToast('التقرير المالي غير متاح', 'error');
        return;
    }
    const now = new Date();
    const opts = { mode: mode || 'day' };
    if (opts.mode === 'month') opts.date = localDateStr(now).slice(0, 7);
    else opts.date = localDateStr(now);

    // المشرف يشوف حركاته هو بس
    if (currentUser && currentUser.role !== 'admin') {
        opts.username = currentUser.username || currentUser.name;
    }

    const money = (v) => (Number(v) || 0).toLocaleString('ar-EG') + ' ج.م';
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };

    // حالة تحميل واضحة بدل ما الأرقام تفضل قديمة
    ['report-total', 'report-expenses', 'report-net', 'fin-subs', 'fin-store', 'fin-external']
        .forEach(id => setTxt(id, '…'));

    let r;
    try {
        r = await window.electronAPI.getFinancialSummary(opts);
    } catch (err) {
        showToast('تعذّر تحميل التقرير: ' + (err.message || err), 'error');
        return;
    }
    if (!r || !r.ok) { showToast('تعذّر تحميل التقرير', 'error'); return; }

    setTxt('report-total', money(r.income.total));
    setTxt('report-expenses', money(r.expenses.total));
    setTxt('report-net', money(r.net));
    setTxt('fin-subs', money(r.income.subscriptions));
    setTxt('fin-store', money(r.income.store));
    setTxt('fin-external', money(r.income.external));
    setTxt('fin-subs-count', r.counts.subs + ' عملية');
    setTxt('fin-store-count', r.counts.sales + ' فاتورة');
    setTxt('fin-external-count', r.counts.external + ' بند');
    setTxt('report-collected-sub', r.label);

    // الصافي بيتلوّن حسب ربح ولا خسارة
    const netEl = document.getElementById('report-net');
    if (netEl) netEl.style.color = r.net >= 0 ? 'var(--success)' : 'var(--danger)';

    // جدول الاشتراكات والمصروفات (نفس جداول القسم)
    const tbody = document.getElementById('report-tbody');
    if (tbody) {
        const all = [
            ...r.rows.subs.map(x => ({ ...x, kind: 'اشتراك', label: x.pkg || 'تجديد' })),
            ...r.rows.sales.map(x => ({ ...x, kind: 'متجر', label: x.buyer_name || 'عميل' })),
            ...r.rows.external.map(x => ({ ...x, kind: 'إيراد خارجي', label: x.description || '' }))
        ].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        tbody.innerHTML = all.length ? all.map(x => `
            <tr>
                <td>${escapeHtml(String(x.timestamp || '').slice(0, 16))}</td>
                <td>${escapeHtml(x.kind)}</td>
                <td>${escapeHtml(x.label)}</td>
                <td style="font-weight:800; color:var(--success);">${money(x.amount)}</td>
                <td>${escapeHtml(x.username || '')}</td>
            </tr>`).join('')
            : '<tr><td colspan="5" style="text-align:center; padding:20px;">لا توجد إيرادات في هذه الفترة</td></tr>';
    }

    const expBody = document.getElementById('report-exp-tbody');
    if (expBody) {
        expBody.innerHTML = r.rows.expenses.length ? r.rows.expenses.map(x => `
            <tr>
                <td>${escapeHtml(String(x.timestamp || '').slice(0, 16))}</td>
                <td>${escapeHtml(x.description || '')}</td>
                <td style="font-weight:800; color:var(--danger);">${money(x.amount)}</td>
                <td>${escapeHtml(x.username || '')}</td>
            </tr>`).join('')
            : '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد مصروفات في هذه الفترة</td></tr>';
    }

    showToast(`تقرير ${r.label}: دخل ${money(r.income.total)} · مصروف ${money(r.expenses.total)} · صافي ${money(r.net)}`,
        r.net >= 0 ? 'success' : 'warning');
}

async function loadDailyReports() {
    const titleEl = document.getElementById('report-sec-title');
    const descEl = document.getElementById('report-sec-desc');
    const supervisorFilterEl = document.getElementById('report-supervisor-filter');

    const isSupervisor = currentUser && currentUser.role !== 'admin';
    const myUsername = currentUser ? (currentUser.username || currentUser.name) : '';
    const myName = currentUser ? currentUser.name : '';

    // Populate supervisor dropdown
    if (supervisorFilterEl && supervisorFilterEl.options.length <= 1 && users.length > 0) {
        (users || []).forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.name;
            supervisorFilterEl.appendChild(opt);
        });
    }

    if (titleEl && descEl) {
        if (!isSupervisor) {
            titleEl.innerText = 'التقارير والمصروفات';
            descEl.innerText = 'تتبع الإيرادات والمصروفات في فترة محددة';
        } else {
            titleEl.innerText = `التقارير والمصروفات (المشرف: ${myName || myUsername})`;
            descEl.innerText = 'عرض وتتبع الإيرادات والمصروفات الخاصة بك';
        }
    }

    let startDate = document.getElementById('report-date-start').value;
    let endDate = document.getElementById('report-date-end').value;

    if (!startDate) {
        startDate = todayStr();
        document.getElementById('report-date-start').value = startDate;
    }
    if (!endDate) {
        endDate = todayStr();
        document.getElementById('report-date-end').value = endDate;
    }

    let selectedUser = isSupervisor ? myUsername : (supervisorFilterEl ? supervisorFilterEl.value : 'all');
    const filters = {
        startDate: startDate,
        endDate: endDate,
        username: selectedUser
    };

    const tbody = document.getElementById('reports-table-body');
    const expBody = document.getElementById('expenses-table-body');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">جاري جلب البيانات...</td></tr>';
    expBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">جاري جلب البيانات...</td></tr>';

    const txns = await window.electronAPI.getTransactions(filters) || [];
    const exps = await window.electronAPI.getExpenses(filters) || [];

    const totalRev = sumAmounts(txns);
    const totalExp = sumAmounts(exps);

    tbody.innerHTML = (txns && txns.length) ?
        buildTxnRows(txns, true) :
        `<tr><td colspan="5" style="text-align:center;" class="text-muted">لا توجد معاملات مسجلة في هذه الفترة</td></tr>`;

    expBody.innerHTML = (exps && exps.length) ?
        buildExpenseRows(exps, true, true) :
        `<tr><td colspan="5" style="text-align:center;" class="text-muted">لا توجد مصروفات مسجلة في هذه الفترة</td></tr>`;

    document.getElementById('report-total').innerText = totalRev.toLocaleString() + ' ج.م';

    // تفصيل المحصَّل: كم منه سداد مديونيات قديمة وكم اشتراكات جديدة.
    // سداد المديونية يُسجَّل بـ pkg يبدأ بـ "سداد مديونية".
    const debtCollected = (txns || [])
        .filter(t => String(t.pkg || '').startsWith('سداد مديونية'))
        .reduce((s, t) => s + Number(t.amount || 0), 0);
    const subEl = document.getElementById('report-collected-sub');
    if (subEl) {
        subEl.innerText = debtCollected > 0 ?
            `منها ${debtCollected.toLocaleString()} ج.م تحصيل مديونيات` :
            'نقد داخل الخزينة خلال الفترة';
    }

    // المديونيات القائمة: رصيد لحظي لا يتأثر بفلتر التاريخ، ولا يُضاف
    // إلى صافي الخزينة لأنه لم يدخل الخزينة أصلاً
    const outEl = document.getElementById('report-outstanding');
    const outSub = document.getElementById('report-outstanding-sub');
    if (outEl && window.electronAPI && window.electronAPI.getDebtors) {
        try {
            const debtors = await window.electronAPI.getDebtors() || [];
            const allowedIds = new Set(getAllowedMembers().map(m => String(m.id)));
            const mine = debtors.filter(d => allowedIds.has(String(d.id)));
            const outstanding = mine.reduce((s, d) => s + Number(d.remaining || 0), 0);
            outEl.innerText = outstanding.toLocaleString() + ' ج.م';
            if (outSub) {
                outSub.innerText = mine.length > 0 ?
                    `${mine.length} مشترك — اضغط للتفاصيل` :
                    'لا توجد مديونيات';
            }

            // جدول المديونيات داخل التقرير ليخرج مع الطباعة
            const panel = document.getElementById('report-debtors-panel');
            const body = document.getElementById('report-debtors-body');
            const foot = document.getElementById('report-debtors-total');
            if (panel && body) {
                panel.style.display = mine.length > 0 ? '' : 'none';
                body.innerHTML = mine.map(d => `
                    <tr>
                        <td><b>${escapeHTML(d.name)}</b></td>
                        <td>${escapeHTML(d.zkid)}</td>
                        <td style="direction:ltr; text-align:right;">${escapeHTML(d.phone || '-')}</td>
                        <td>${Number(d.price || 0).toLocaleString()} ج.م</td>
                        <td>${Number(d.paid || 0).toLocaleString()} ج.م</td>
                        <td class="text-danger" style="font-weight:800;">${Number(d.remaining || 0).toLocaleString()} ج.م</td>
                    </tr>`).join('');
                if (foot) foot.innerText = outstanding.toLocaleString() + ' ج.م';
            }
        } catch (err) {
            (()=>{})('outstanding failed', err);
        }
    }
    if (document.getElementById('report-expenses')) document.getElementById('report-expenses').innerText = totalExp.toLocaleString() + ' ج.م';
    if (document.getElementById('report-net')) {
        const net = totalRev - totalExp;
        const netEl = document.getElementById('report-net');
        netEl.innerText = net.toLocaleString() + ' ج.م';
        netEl.style.color = net >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Populate Supervisors Summary Table for Admin
    const supReportBody = document.getElementById('supervisors-report-body');
    if (supReportBody) {
        supReportBody.innerHTML = '';

        let allTxns = txns;
        let allExps = exps;
        if (selectedUser !== 'all') {
            allTxns = await window.electronAPI.getTransactions({
                startDate,
                endDate,
                username: 'all'
            }) || [];
            allExps = await window.electronAPI.getExpenses({
                startDate,
                endDate,
                username: 'all'
            }) || [];
        }

        const userMap = new Map();
        (users || []).forEach(u => userMap.set(u.username, {
            username: u.username,
            name: u.name,
            role: u.role,
            gender: u.gender
        }));
        if (currentUser && !userMap.has(currentUser.username)) {
            userMap.set(currentUser.username, {
                username: currentUser.username,
                name: currentUser.name,
                role: currentUser.role,
                gender: currentUser.gender
            });
        }
        allTxns.forEach(t => {
            if (t.username && !userMap.has(t.username)) {
                userMap.set(t.username, {
                    username: t.username,
                    name: t.username,
                    role: 'supervisor',
                    gender: 'male'
                });
            }
        });
        allExps.forEach(e => {
            if (e.username && !userMap.has(e.username)) {
                userMap.set(e.username, {
                    username: e.username,
                    name: e.username,
                    role: 'supervisor',
                    gender: 'male'
                });
            }
        });

        if (userMap.size === 0) {
            supReportBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">لا يوجد مشرفون مسجلون في النظام</td></tr>';
        } else {
            let rowsHTML = '';
            userMap.forEach(u => {
                const uTxns = allTxns.filter(t => t.username === u.username);
                const uExps = allExps.filter(e => e.username === u.username);

                const rev = uTxns.reduce((sum, t) => sum + Number(t.amount || 0), 0);
                const exp = uExps.reduce((sum, e) => sum + Number(e.amount || 0), 0);
                const net = rev - exp;
                const count = uTxns.length;

                let roleBadge = u.role === 'admin' ? '<span class="badge badge-warning">مدير النظام</span>' : `<span class="badge badge-info">${u.gender === 'female' ? 'مشرفة إناث' : 'مشرف ذكور'}</span>`;

                rowsHTML += `
              <tr>
                <td><b>${escapeHTML(u.name)}</b> <span style="font-size:0.75rem; color:var(--text-muted);">(@${escapeHTML(u.username)})</span></td>
                <td>${roleBadge}</td>
                <td style="font-weight:bold; text-align:center;">${count} معاملة</td>
                <td style="color:var(--primary); font-weight:bold;">${rev.toLocaleString()} ج.م</td>
                <td style="color:var(--danger); font-weight:bold;">${exp.toLocaleString()} ج.م</td>
                <td style="color:var(--success); font-weight:bold;">${net.toLocaleString()} ج.م</td>
                <td>
                  <button class="action-btn action-btn-text action-btn-primary" onclick="openSupervisorDetailReport('${escapeJsArg(u.username)}')">
                     تفاصيل التقرير
                  </button>
                </td>
              </tr>
            `;
            });
            supReportBody.innerHTML = rowsHTML;
        }
    }
}

// --- الحصص المنفردة (بدون عضوية) ---
// أسعار الحصص تُحفظ في config.json بدل تثبيتها في الكود: أول مرة يُدخل
// المشرف السعر، وبعدها يُملأ تلقائياً لكل نوع حصة على حدة.
let sessionPrices = {};

async function loadSessionPrices() {
    if (!window.electronAPI || !window.electronAPI.getConfig) return;
    try {
        const cfg = await window.electronAPI.getConfig();
        sessionPrices = (cfg && cfg.sessionPrices) || {};
    } catch (e) {
        sessionPrices = {};
    }
}

function onSessionTypeChange() {
    const typeEl = document.getElementById('session-type');
    const paidEl = document.getElementById('session-paid');
    if (!typeEl || !paidEl) return;
    const saved = sessionPrices[typeEl.value];
    paidEl.value = (saved !== undefined && saved !== null) ? saved : '';
    paidEl.placeholder = saved !== undefined ? '' : 'أدخل سعر هذه الحصة...';
}

function openSessionModal() {
    document.getElementById('session-name').value = '';
    const typeEl = document.getElementById('session-type');
    if (typeEl) typeEl.selectedIndex = 0;
    onSessionTypeChange();
    openModal('sessionModal');
}

async function saveSession() {
    const name = document.getElementById('session-name').value.trim();
    const paid = Number(document.getElementById('session-paid').value);
    const type = document.getElementById('session-type') ? document.getElementById('session-type').value : 'حصة يومية';

    if (isNaN(paid) || paid <= 0) return showToast('برجاء إدخال مبلغ صحيح', 'error');

    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addTransaction({
            id: 'TXN-' + Date.now(),
            member_id: 'WALKIN:' + name,
            amount: paid,
            pkg: type,
            timestamp: new Date().toISOString(),
            username: currentUser.username || currentUser.name
        }), 'الحصة اليومية');
        if (ok === null) return; // لا تقل "تم" إذا لم يُحفظ فعلاً
    }

    // تذكّر سعر هذا النوع ليُملأ تلقائياً في المرة القادمة
    sessionPrices[type] = paid;
    if (window.electronAPI && window.electronAPI.saveConfig) {
        window.electronAPI.saveConfig({ sessionPrices }).catch(e => (()=>{})(e));
    }

    showToast(`تم تسجيل ${type} بمبلغ ${paid.toLocaleString()} ج.م في التقارير`, 'success');
    closeModal('sessionModal');
    document.getElementById('session-name').value = '';
    renderMembers();
    if (typeof loadDashboardStats === 'function') loadDashboardStats();
    loadDailyReports();
}

// --- EXPENSES ---
function openExpenseModal() {
    document.getElementById('expense-desc').value = '';
    document.getElementById('expense-amount').value = '';
    if (document.getElementById('expense-category')) document.getElementById('expense-category').value = 'مصاريف يومية';
    openModal('expenseModal');
}

async function saveExpense() {
    const category = document.getElementById('expense-category') ? document.getElementById('expense-category').value : 'أخرى';
    const descInput = document.getElementById('expense-desc').value.trim();
    const amount = Number(document.getElementById('expense-amount').value);

    if (isNaN(amount) || amount <= 0) return showToast('برجاء إدخال المبلغ بشكل صحيح', 'error');

    const desc = descInput ? `[${category}] ${descInput}` : `[${category}]`;

    if (window.electronAPI) {
        const ok = await dbWrite(window.electronAPI.addExpense({
            id: 'EXP-' + Date.now(),
            description: desc,
            amount: amount,
            timestamp: new Date().toISOString(),
            username: currentUser.username || currentUser.name
        }), 'المصروف');
        if (ok === null) return;
    }

    showToast('تم إضافة المصروف بنجاح', 'success');
    closeModal('expenseModal');
    loadDailyReports();
}

async function deleteExpense(id) {
    if (await customConfirm('هل أنت متأكد من نقل هذا المصروف إلى سلة المهملات؟')) {
        if (window.electronAPI) {
            try {
                const filters = { startDate: '2000-01-01', endDate: '2099-12-31' };
                const allExps = await window.electronAPI.getExpenses(filters) || [];
                const exp = allExps.find(e => String(e.id) === String(id));
                if (exp && window.electronAPI.addTrash) {
                    const trashOk = await dbWrite(window.electronAPI.addTrash({
                        id: 'trash_' + Date.now(),
                        type: 'expense',
                        item_data: exp,
                        deleted_by: currentUser ? (currentUser.username || currentUser.name) : 'admin'
                    }), 'نقل لسلة المهملات');
                    if (trashOk === null) return;   // ماتنقلش للمهملات — منحذفش
                }
            } catch(err) {}
            const ok = await dbWrite(window.electronAPI.deleteExpense(id), 'حذف المصروف');
            if (ok === null) return;
            showToast('تم نقل المصروف إلى سلة المهملات ', 'success');
            loadDailyReports();
        }
    }
}

// --- SECURITY & BACKUP ---
function openChangePasswordModal() {
    document.getElementById('cp-old').value = '';
    document.getElementById('cp-new').value = '';
    openModal('changePasswordModal');
}

async function saveNewPassword() {
    const oldPassword = document.getElementById('cp-old').value;
    const newPassword = document.getElementById('cp-new').value;

    if (!oldPassword || !newPassword) return showToast('برجاء إدخال كلمات المرور', 'error');
    if (newPassword.length < 4) return showToast('كلمة المرور الجديدة قصيرة جداً (4 أحرف على الأقل)', 'error');

    if (window.electronAPI) {
        const success = await window.electronAPI.changePassword({
            username: currentUser.username,
            oldPassword,
            newPassword
        });

        if (success) {
            showToast('تم تغيير كلمة المرور بنجاح', 'success');
            closeModal('changePasswordModal');
        } else {
            showToast('كلمة المرور الحالية غير صحيحة!', 'error');
        }
    }
}

async function backupDatabase() {
    if (window.electronAPI) {
        const success = await window.electronAPI.backupDatabase();
        if (success) {
            showToast('تم حفظ النسخة الاحتياطية بنجاح!', 'success');
        } else {
            // Could be canceled or failed
        }
    }
}

// --- MEMBER PROFILE ---
async function openMemberProfile(id) {
    const m = (members || []).find(x => x.id === id);
    if (!m) return;

    document.getElementById('hist-title').innerText = 'كارت المشترك: ' + m.name;
    
    // Status Badge
    const badgeEl = document.getElementById('hist-status-badge');
    if (badgeEl) {
        const st = effectiveStatus(m);
        if (st === 'active') {
            badgeEl.className = 'badge badge-success';
            badgeEl.innerText = 'ساري';
        } else if (m.status === 'expired' || st === 'expired') {
            badgeEl.className = 'badge badge-danger';
            badgeEl.innerText = 'منتهي';
        } else {
            badgeEl.className = 'badge badge-neutral';
            badgeEl.innerText = 'مجمد';
        }
    }

    // Populate all info boxes
    if (document.getElementById('hist-zkid')) document.getElementById('hist-zkid').innerText = m.zkid || '-';
    if (document.getElementById('hist-phone')) document.getElementById('hist-phone').innerText = m.phone || '-';
    if (document.getElementById('hist-gender')) document.getElementById('hist-gender').innerText = genderText(m.gender) || '-';
    if (document.getElementById('hist-address')) document.getElementById('hist-address').innerText = m.address || 'غير محدد';
    if (document.getElementById('hist-pkg')) document.getElementById('hist-pkg').innerText = (m.pkg || '-').replace(/[\?\uFFFD]/g, '').trim();
    if (document.getElementById('hist-exp')) document.getElementById('hist-exp').innerText = m.exp || '-';
    if (document.getElementById('hist-trainer')) document.getElementById('hist-trainer').innerText = m.trainer || 'بدون مدرب';
    if (document.getElementById('hist-private-trainer')) document.getElementById('hist-private-trainer').innerText = m.privateTrainer || 'لا يوجد';

    // Optional guardian phone
    const guardianBox = document.getElementById('hist-guardian-box');
    if (guardianBox) {
        if (m.guardian_phone && m.guardian_phone.trim()) {
            guardianBox.style.display = 'flex';
            document.getElementById('hist-guardian').innerText = m.guardian_phone;
        } else {
            guardianBox.style.display = 'none';
        }
    }

    // Optional notes
    const notesBox = document.getElementById('hist-notes-box');
    if (notesBox) {
        if (m.notes && m.notes.trim()) {
            notesBox.style.display = 'flex';
            document.getElementById('hist-notes').innerText = m.notes;
        } else {
            notesBox.style.display = 'none';
        }
    }

    // Sessions balance
    const balanceBox = document.getElementById('hist-balance-box');
    if (balanceBox) {
        if (m && m.pkg && m.pkg.includes('الباقة المتميزة')) {
            balanceBox.style.display = 'flex';
            const balance = m.sessions_balance !== undefined ? m.sessions_balance : 0;
            document.getElementById('hist-balance').innerText = balance + ' حصة';
        } else {
            balanceBox.style.display = 'none';
        }
    }

    // Financial Info Box
    const finBox = document.getElementById('hist-finance-box');
    if (finBox) {
        const due = remainingOf(m);
        const dueTxt = due > 0 ? `متبقي: ${due.toLocaleString()} ج.م` : 'مسدَّد بالكامل';
        const dueColor = due > 0 ? '#ef4444' : '#10b981';
        finBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <span class="label" style="font-weight:700;">الحالة المالية للاشتراك</span>
                <span class="badge" style="background:${due > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'}; color:${dueColor}; font-weight:800; font-size:0.82rem; border:1px solid ${due > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}; padding:2px 8px; border-radius:8px;">${dueTxt}</span>
            </div>
            <div style="display:flex; gap:14px; margin-top:4px; font-size:0.85rem; color:var(--text-main); flex-wrap:wrap;">
                <span>السعر: <b>${Number(m.price || 0).toLocaleString()} ج.م</b></span>
                <span>المدفوع: <b style="color:#10b981;">${Number(m.paid || 0).toLocaleString()} ج.م</b></span>
                ${due > 0 ? `<span style="color:#ef4444;">المتبقي: <b>${due.toLocaleString()} ج.م</b></span>` : ''}
            </div>
        `;
    }

    // Populate Member Card Actions Bar
    const actionsBar = document.getElementById('hist-actions-bar');
    if (actionsBar) {
        let freezeBtnHTML = '';
        if (m.status === 'frozen') {
            freezeBtnHTML = `<button class="btn-card-action btn-action-unfreeze" onclick="toggleFreezeMember('${m.id}', true)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5l-10 14M5 5l10 14M2 12h20"/></svg>فك التجميد</button>`;
        } else if (m.status === 'active') {
            freezeBtnHTML = `<button class="btn-card-action btn-action-freeze" onclick="toggleFreezeMember('${m.id}', true)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>تجميد الاشتراك</button>`;
        } else {
            freezeBtnHTML = `<button class="btn-card-action" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>الاشتراك منتهي</button>`;
        }

        let actionsHTML = '';
        // 1. تجديد الاشتراك (دائماً في المقدمة)
        actionsHTML += `<button class="btn-card-action" style="color:#10b981; border-color:rgba(16,185,129,0.35); background:rgba(16,185,129,0.06);" onclick="closeModal('memberHistoryModal'); openRenewModal('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-5.46-5.46"/></svg>تجديد الاشتراك</button>`;

        // 2. تسديد مديونية (إن وُجدت)
        const memberDue = remainingOf(m);
        if (memberDue > 0) {
            actionsHTML += `<button class="btn-card-action btn-action-delete" style="color:#ef4444; border-color:rgba(239,68,68,0.35); background:rgba(239,68,68,0.06);" onclick="closeModal('memberHistoryModal'); openPaymentModal('${escapeJsArg(m.id)}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>تسديد ${memberDue.toLocaleString()} ج.م</button>`;
        }

        // 3. التجميد / فك التجميد
        actionsHTML += freezeBtnHTML;

        // 4. واتساب
        actionsHTML += `<button class="btn-card-action btn-action-whatsapp" onclick="sendWhatsAppFromList('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>مراسلة واتساب</button>`;

        // 5. دعوة صديق
        actionsHTML += `<button class="btn-card-action btn-action-invite" onclick="closeModal('memberHistoryModal'); openAddInvitationModal('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14"/></svg>إرسال دعوة</button>`;

        // 6. مدرب بريفت
        const priveLabel = m.privateTrainer ? 'تعديل البريفت' : 'إضافة بريفت';
        actionsHTML += `<button class="btn-card-action btn-action-ptrainer" onclick="openPrivateTrainerModal('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M3 21v-2a7 7 0 0 1 14 0v2"/><circle cx="19" cy="8" r="3"/><path d="M21 21v-2a5 5 0 0 0-7.5-4.2"/></svg>${priveLabel}</button>`;

        // 7. تعديل المدة
        actionsHTML += `<button class="btn-card-action" style="color:var(--primary); border-color:rgba(0,229,255,0.35);" onclick="closeModal('memberHistoryModal'); openCustomDurationModal('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg>تعديل المدة</button>`;

        if (currentUser && currentUser.role === 'admin') {
            actionsHTML += `<button class="btn-card-action btn-action-edit" onclick="closeModal('memberHistoryModal'); openEditMember('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>تعديل البيانات</button>`;
            actionsHTML += `<button class="btn-card-action btn-action-delete" onclick="closeModal('memberHistoryModal'); deleteMember('${m.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>حذف المشترك</button>`;
        }

        actionsBar.innerHTML = `<div class="hist-actions-grid">${actionsHTML}</div>`;
    }

    const tbodyTxn = document.getElementById('hist-txns-body');
    const tbodyAtt = document.getElementById('hist-att-body');

    tbodyTxn.innerHTML = '<tr><td colspan="4" style="text-align:center;">جاري التحميل...</td></tr>';
    tbodyAtt.innerHTML = '<tr><td colspan="1" style="text-align:center;">جاري التحميل...</td></tr>';

    openModal('memberHistoryModal');

    if (window.electronAPI) {
        const txns = await window.electronAPI.getMemberTransactions(id);
        tbodyTxn.innerHTML = '';
        if (!txns || txns.length === 0) {
            tbodyTxn.innerHTML = '<tr><td colspan="4" style="text-align:center;">لا توجد تجديدات مسجلة</td></tr>';
        } else {
            let txnsHTML = '';
            txns.forEach(t => {
                const timeStr = new Date(t.timestamp).toLocaleDateString('ar-EG');
                txnsHTML += `<tr><td>${timeStr}</td><td>${escapeHTML(t.pkg)}</td><td style="color:var(--primary); font-weight:bold;">${t.amount} ج.م</td><td>${escapeHTML(t.username)}</td></tr>`;
            });
            tbodyTxn.innerHTML = txnsHTML;
        }

        if (m.zkid) {
            const att = await window.electronAPI.getAttendance(m.zkid);
            tbodyAtt.innerHTML = '';
            if (!att || att.length === 0) {
                tbodyAtt.innerHTML = '<tr><td colspan="1" style="text-align:center;">لم يسجل حضور</td></tr>';
            } else {
                let attHTML = '';
                // Limit to recent 200 items to prevent DOM bloat
                const recentAtt = att.slice(0, 200);
                recentAtt.forEach(a => {
                    // سجلات قديمة كُتبت بلا وقت (خطأ سابق) كانت تظهر "Invalid Date"
                    const dateObj = a.timestamp ? new Date(a.timestamp) : null;
                    const dateStr = (dateObj && !isNaN(dateObj)) ?
                        (dateObj.toLocaleDateString('ar-EG') + ' ' + dateObj.toLocaleTimeString('ar-EG')) :
                        'سجل قديم بلا وقت مسجَّل';
                    attHTML += `<tr><td style="direction:ltr; text-align:right;">${escapeHTML(dateStr)}</td></tr>`;
                });
                tbodyAtt.innerHTML = attHTML;
            }
        } else {
            tbodyAtt.innerHTML = '<tr><td colspan="1" style="text-align:center;">ليس لديه رقم بصمة</td></tr>';
        }
    }
}

function switchCardTab(tab, btn) {
    document.querySelectorAll('.member-card-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (tab === 'txns') {
        document.getElementById('card-tab-txns').classList.remove('hidden');
        document.getElementById('card-tab-att').classList.add('hidden');
    } else {
        document.getElementById('card-tab-att').classList.remove('hidden');
        document.getElementById('card-tab-txns').classList.add('hidden');
    }
}
// --- ZKTECO INTEGRATION ---
let isConnecting = false;
async function connectZkDevice() {
    if (!window.electronAPI) return;
    if (isConnecting) return;

    const ip = document.getElementById('zk-ip').value.trim();
    if (!ip) return showToast('يرجى إدخال عنوان الـ IP أولاً.', 'error');
    const port = document.getElementById('zk-port').value || 4370;

    // Save for auto-connect
    await window.electronAPI.saveConfig({
        zkIp: ip,
        zkPort: port
    });

    isConnecting = true;
    showToast('جاري الاتصال بجهاز البصمة...', 'success');
    const indicator = document.getElementById('zk-status-indicator');
    indicator.innerHTML = 'جاري الاتصال...';
    indicator.classList.remove('connected');

    try {
        const success = await window.electronAPI.connectZk({
            ip,
            port
        });
        isConnecting = false;
        if (success) {
            indicator.innerText = 'حالة الجهاز: متصل ';
            indicator.classList.add('connected');
            indicator.style.color = '';
            showToast('تم الاتصال بنجاح!', 'success');
            // Start auto-sync to delete expired users from device
            setTimeout(syncDeviceUsers, 2000);
        } else {
            indicator.innerText = 'جهاز البصمة: فشل الاتصال (Rejected) ';
            indicator.classList.remove('connected');
            indicator.style.color = '';
            showToast('فشل الاتصال بجهاز البصمة، تأكد من الـ IP والشبكة.', 'error');
        }
    } catch (uiErr) {
        isConnecting = false;
        indicator.innerText = 'جهاز البصمة: خطأ برمجي ' + uiErr.message;
        indicator.classList.remove('connected');
        indicator.style.color = '';
    }
}

// تحديث مؤشر حالة جهاز البصمة من الحالة المحفوظة في العملية الرئيسية
function updateZkStatusDot(status) {
    const indicator = document.getElementById('zk-status-indicator');
    if (!indicator) return;
    if (status === 'Connected') {
        indicator.innerText = 'حالة الجهاز: متصل ';
        indicator.classList.add('connected');
        indicator.style.color = '';
    } else {
        indicator.innerText = 'جهاز البصمة: غير متصل ';
        indicator.classList.remove('connected');
        indicator.style.color = '';
    }
}

async function disconnectZkDevice() {
    if (!window.electronAPI) return;
    await window.electronAPI.disconnectZk();

    const indicator = document.getElementById('zk-status-indicator');
    indicator.innerText = 'جهاز البصمة: غير متصل ';
    indicator.style.color = 'var(--text-muted)';
    showToast('تم قطع الاتصال', 'success');
}

async function syncDeviceUsers() {
    if (!window.electronAPI) return;
    try {
        const zkUsers = await window.electronAPI.getZkUsers();
        if (!zkUsers || zkUsers.length === 0) return;

        let deletedCount = 0;

        for (const zUser of zkUsers) {
            const zId = String(zUser.userId);
            const member = (members || []).find(m => String(m.zkid) === zId);

            if (member) {
                // Check if member is expired
                let isExpired = false;
                if (member.status === 'active') {
                    const expDate = new Date(member.exp);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    if (expDate < today) isExpired = true;
                } else if (member.status === 'expired') {
                    isExpired = true;
                }

                if (isExpired) {
                    await window.electronAPI.deleteZkUser(zId);
                    deletedCount++;
                }
            }
        }

        if (deletedCount > 0) {
            showToast(`تم مزامنة الجهاز: تم مسح ${deletedCount} بصمة منتهية من الجهاز`, 'info');
        }

    } catch (err) {
        (()=>{})('Sync failed:', err);
    }
}

async function openSupervisorDetailReport(username) {
    let startDate = document.getElementById('report-date-start').value || todayStr();
    let endDate = document.getElementById('report-date-end').value || todayStr();

    const uObj = (users || []).find(u => u.username === username) || {
        name: username,
        username,
        role: 'admin'
    };
    const supervisorName = uObj.name || username;

    document.getElementById('sup-report-title').innerText = ' التقرير التفصيلي للمشرف: ' + supervisorName;
    document.getElementById('sup-report-dates').innerText = `الفترة من ${startDate} إلى ${endDate}`;

    const filters = {
        startDate,
        endDate,
        username
    };
    const txns = await window.electronAPI.getTransactions(filters) || [];
    const exps = await window.electronAPI.getExpenses(filters) || [];

    const totalRev = sumAmounts(txns);
    const totalExp = sumAmounts(exps);

    const txnsBody = document.getElementById('sup-report-txns-body');
    const expsBody = document.getElementById('sup-report-exps-body');

    txnsBody.innerHTML = txns.length ?
        buildTxnRows(txns, false) :
        '<tr><td colspan="4" style="text-align:center;" class="text-muted">لا توجد مقبوضات مسجلة لهذا المشرف</td></tr>';

    expsBody.innerHTML = exps.length ?
        buildExpenseRows(exps, false, false) :
        '<tr><td colspan="3" style="text-align:center;" class="text-muted">لا توجد مصروفات مسجلة لهذا المشرف</td></tr>';

    document.getElementById('sup-report-rev').innerText = totalRev.toLocaleString() + ' ج.م';
    document.getElementById('sup-report-exp').innerText = totalExp.toLocaleString() + ' ج.م';
    document.getElementById('sup-report-net').innerText = (totalRev - totalExp).toLocaleString() + ' ج.م';
    document.getElementById('sup-report-count').innerText = txns.length;

    openModal('supervisorDetailModal');
}

// لا تنتظر تحميل الصور والخطوط (window.onload) قبل تشغيل init،
// وإلا تبقى قائمة الحساب فاضية طالما هناك مورد خارجي لم يكتمل تحميله.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
// ==========================================
// EXTERNAL REVENUES
// ==========================================
let allRevenues = [];

async function loadExternalRevenues() {
    if (!window.electronAPI || !window.electronAPI.getExternalRevenues) return;
    try {
        allRevenues = await window.electronAPI.getExternalRevenues();
        filterRevenues();
    } catch (e) {
        (()=>{})(e);
        showToast('خطأ في تحميل الإيرادات الخارجية', 'error');
    }
}

function filterRevenues() {
    const elStart = document.getElementById('rev-filter-start');
    const elEnd = document.getElementById('rev-filter-end');
    const dStart = elStart ? elStart.value : '';
    const dEnd = elEnd ? elEnd.value : '';
    
    let filtered = (allRevenues || []).filter(r => {
        let match = true;
        const rDate = r.date || (r.timestamp ? r.timestamp.split('T')[0] : '');
        if (dStart && rDate < dStart) match = false;
        if (dEnd && rDate > dEnd) match = false;
        return match;
    });
    
    renderRevenues(filtered);
}

function renderRevenues(list) {
    const tbody = document.getElementById('revenues-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let total = 0;
    list.forEach(r => {
        total += Number(r.amount);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="direction:ltr; text-align:right;">${new Date(r.timestamp).toLocaleString('ar-EG')}</td>
            <td>${escapeHTML(r.description)}</td>
            <td style="color:var(--success); font-weight:bold;">${Number(r.amount).toLocaleString()} ج.م</td>
            <td>${escapeHTML(r.username || 'admin')}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteRevenue('${escapeHTML(String(r.id))}')" title="حذف">حذف</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    document.getElementById('total-revenues-amount').innerText = total.toLocaleString() + ' ج.م';
}

async function submitRevenue() {
    if (!window.electronAPI || !window.electronAPI.addExternalRevenue) return;
    
    const desc = document.getElementById('rev-desc').value.trim();
    const amount = parseFloat(document.getElementById('rev-amount').value);
    
    if (!desc || isNaN(amount) || amount <= 0) {
        showToast('الرجاء إدخال بيانات صحيحة', 'error');
        return;
    }
    
    const btn = document.querySelector('#addRevenueModal button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
        const ok = await dbWrite(window.electronAPI.addExternalRevenue({
            id: 'REV-' + Date.now(),
            description: desc,
            amount: amount,
            timestamp: new Date().toISOString(),
            username: (currentUser && (currentUser.username || currentUser.name)) ? (currentUser.username || currentUser.name) : 'admin'
        }), 'الإيراد');
        if (ok === null) return;
        closeModal('addRevenueModal');
        document.getElementById('rev-desc').value = '';
        document.getElementById('rev-amount').value = '';
        showToast('تمت إضافة الإيراد بنجاح', 'success');
        loadExternalRevenues();
        loadDashboardStats();
        loadDailyReports();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteRevenue(id) {
    if (!await customConfirm('هل أنت متأكد من نقل هذا الإيراد إلى سلة المهملات؟')) return;
    if (!window.electronAPI || !window.electronAPI.deleteExternalRevenue) return;
    try {
        const rev = (allRevenues || []).find(r => String(r.id) === String(id));
        if (rev && window.electronAPI.addTrash) {
            const trashOk = await dbWrite(window.electronAPI.addTrash({
                id: 'trash_' + Date.now(),
                type: 'revenue',
                item_data: rev,
                deleted_by: currentUser ? (currentUser.username || currentUser.name) : 'admin'
            }), 'نقل لسلة المهملات');
            if (trashOk === null) return;   // ماتنقلش للمهملات — منحذفش
        }
        await window.electronAPI.deleteExternalRevenue(id);
        showToast('تم نقل الإيراد إلى سلة المهملات ', 'success');
        loadExternalRevenues();
    } catch (err) {
        (()=>{})(err);
        showToast('خطأ أثناء النقل لسلة المهملات', 'error');
    }
}

// ==========================================
// INVITATIONS SYSTEM
// ==========================================
let allInvitations = [];
// نفس القائمة المسموح بها في العملية الرئيسية
const INVITATION_STATUSES = ['مرسلة', 'حضر', 'لم يحضر'];

// نص دعوة الصديق — كان مكرراً حرفياً في مكانين
function invitationMessage(guestName, memberName) {
    return `مرحباً ${guestName}\nصديقك المشترك (${memberName}) يهديك دعوة تمرين مجانية بقاعة TOP FITNESS!\nيسعدنا زيارتك والاستمتاع بتجربة رياضية مميزة.`;
}

async function updateInvitationStatus(id, status) {
    if (!window.electronAPI || !window.electronAPI.updateInvitationStatus) return;
    const res = await window.electronAPI.updateInvitationStatus(id, status);
    if (res && res.success) {
        const inv = (allInvitations || []).find(i => String(i.id) === String(id));
        if (inv) inv.status = status;
        showToast('تم تحديث حالة الدعوة', 'success');
    } else {
        showToast((res && res.error) || 'فشل تحديث حالة الدعوة', 'error');
        loadInvitations();
    }
}

function sendInvitationWhatsApp(id) {
    const inv = (allInvitations || []).find(i => String(i.id) === String(id));
    if (!inv) return;
    openWhatsApp(inv.guest_phone || '', invitationMessage(inv.guest_name, inv.member_name));
}

async function loadInvitations() {
    const tbody = document.getElementById('invitations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">جاري تحميل سجل الدعوات...</td></tr>';
    
    if (window.electronAPI && window.electronAPI.getInvitations) {
        try {
            allInvitations = await window.electronAPI.getInvitations() || [];
            
            const totalCnt = allInvitations.length;
            const nowMonthKey = localDateStr(new Date()).substring(0, 7);
            const monthCnt = allInvitations.filter(i => (i.month_key || i.created_at || '').startsWith(nowMonthKey)).length;
            
            if (document.getElementById('count-invitations-total')) document.getElementById('count-invitations-total').innerText = totalCnt;
            if (document.getElementById('count-invitations-month')) document.getElementById('count-invitations-month').innerText = monthCnt;

            renderInvitations(allInvitations);
        } catch (err) {
            (()=>{})('Error loading invitations:', err);
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--danger);">خطأ في تحميل سجل الدعوات</td></tr>';
        }
    }
}

function renderInvitations(list) {
    const tbody = document.getElementById('invitations-tbody');
    if (!tbody) return;
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">لا توجد دعوات مسجلة حتى الآن</td></tr>';
        return;
    }

    const html = [];
    list.forEach(inv => {
        const dateStr = inv.created_at ? new Date(inv.created_at).toLocaleString('ar-EG') : '-';
        const status = inv.status || 'مرسلة';
        // قائمة قابلة للتغيير: كان العمود نصاً ثابتاً بلا أي طريقة لتحديثه
        const statusOptions = INVITATION_STATUSES
            .map(s => `<option value="${escapeHTML(s)}"${s === status ? ' selected' : ''}>${escapeHTML(s)}</option>`)
            .join('');

        html.push(`
            <tr>
                <td>${dateStr}</td>
                <td><b>${escapeHTML(inv.member_name || '-')}</b></td>
                <td><b>${escapeHTML(inv.guest_name || '-')}</b></td>
                <td style="direction:ltr; text-align:right;">${escapeHTML(inv.guest_phone || '-')}</td>
                <td>
                    <select class="form-control" style="height:34px !important; padding:2px 8px !important; font-size:0.82rem;"
                            onchange="updateInvitationStatus(${Number(inv.id)}, this.value)">
                        ${statusOptions}
                    </select>
                </td>
                <td>${escapeHTML(inv.notes || '-')}</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-sm btn-outline" style="color:#25D366; border-color:#25D366;"
                                onclick="sendInvitationWhatsApp(${Number(inv.id)})" title="إرسال عبر الواتساب">واتساب</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteInvitation(${Number(inv.id)})" title="حذف الدعوة">حذف</button>
                    </div>
                </td>
            </tr>
        `);
    });
    tbody.innerHTML = html.join('');
}

function filterInvitationsTable(val) {
    const q = (val || '').toLowerCase().trim();
    if (!q) return renderInvitations(allInvitations);
    const filtered = (allInvitations || []).filter(i => 
        (i.member_name || '').toLowerCase().includes(q) ||
        (i.guest_name || '').toLowerCase().includes(q) ||
        (i.guest_phone || '').toLowerCase().includes(q)
    );
    renderInvitations(filtered);
}

async function openAddInvitationModal(memberId) {
    const member = (members || []).find(m => String(m.id) === String(memberId));
    if (!member) return showToast('تعذر العثور على المشترك', 'error');

    document.getElementById('inv-member-id').value = member.id;
    document.getElementById('inv-member-name').value = member.name;
    document.getElementById('inv-guest-name').value = '';
    document.getElementById('inv-guest-phone').value = '';
    document.getElementById('inv-notes').value = '';

    const monthKey = localDateStr(new Date()).substring(0, 7);
    const existing = (allInvitations || []).find(i => String(i.member_id) === String(member.id) && (i.month_key || '').startsWith(monthKey));

    const banner = document.getElementById('invitation-limit-banner');
    const saveBtn = document.getElementById('btn-save-invitation');

    if (existing) {
        if (banner) banner.style.display = 'block';
        if (saveBtn) saveBtn.disabled = true;
    } else {
        if (banner) banner.style.display = 'none';
        if (saveBtn) saveBtn.disabled = false;
    }

    openModal('invitationModal');
}

async function saveInvitation(e) {
    if (e) e.preventDefault();
    if (!window.electronAPI || !window.electronAPI.addInvitation) return;

    const memberId = document.getElementById('inv-member-id').value;
    const memberName = document.getElementById('inv-member-name').value;
    const guestName = document.getElementById('inv-guest-name').value.trim();
    const guestPhone = document.getElementById('inv-guest-phone').value.trim();
    const notes = document.getElementById('inv-notes').value.trim();

    if (!guestName || !guestPhone) return showToast('يرجى إدخال اسم الصديق ورقم الهاتف', 'error');
    if (!isValidPhone(guestPhone)) return showToast('رقم هاتف الصديق غير صحيح (11 رقماً يبدأ بـ 01)', 'error');

    const monthKey = localDateStr(new Date()).substring(0, 7);
    const nowIso = new Date().toISOString();

    const invData = {
        member_id: memberId,
        member_name: memberName,
        guest_name: guestName,
        guest_phone: guestPhone,
        month_key: monthKey,
        created_at: nowIso,
        status: 'مرسلة',
        notes: notes
    };

    const res = await window.electronAPI.addInvitation(invData);
    if (res && res.success) {
        showToast('تم حفظ الدعوة بنجاح ', 'success');
        closeModal('invitationModal');
        loadInvitations();
        // openUrl غير موجودة في preload (الصحيح openExternalUrl داخل openWhatsApp)،
        // فكان يسقط على window.open ويفتح نافذة Electron إضافية بدل المتصفح
        openWhatsApp(guestPhone, invitationMessage(guestName, memberName));
    } else {
        showToast((res && res.error) ? res.error : 'فشل إضافة الدعوة', 'error');
    }
}

async function deleteInvitation(id) {
    if (!await customConfirm('هل أنت متأكد من حذف هذه الدعوة؟')) return;
    if (window.electronAPI && window.electronAPI.deleteInvitation) {
        const res = await window.electronAPI.deleteInvitation(id);
        if (res && res.success) {
            showToast('تم حذف الدعوة بنجاح', 'success');
            loadInvitations();
        } else {
            showToast('فشل حذف الدعوة', 'error');
        }
    }
}

// ==========================================
// TRAINER ATTENDANCE
// ==========================================
let allTrainerAtt = [];

async function loadTrainerAttendance() {
    if (!window.electronAPI || !window.electronAPI.getTrainerAttendance) return;
    try {
        const elStart = document.getElementById('tatt-filter-start');
        const elEnd = document.getElementById('tatt-filter-end');
        const dStart = elStart ? elStart.value : '';
        const dEnd = elEnd ? elEnd.value : '';
        allTrainerAtt = (await window.electronAPI.getTrainerAttendance({ dateStart: dStart, dateEnd: dEnd })) || [];
        
        // Populate trainers dropdown if empty
        const select = document.getElementById('tatt-filter-trainer');
        if (select && select.options.length <= 1 && Array.isArray(trainers) && trainers.length > 0) {
            (trainers || []).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.name} (${t.job_title || 'موظف'})`;
                select.appendChild(opt);
            });
        }
        
        filterTrainerAttendance();
    } catch (e) {
        (()=>{})("Attendance load error:", e);
        showToast('خطأ في تحميل حضور المدربين', 'error');
    }
}

function filterTrainerAttendance() {
    const select = document.getElementById('tatt-filter-trainer');
    const trainerId = select ? select.value : 'all';
    
    let filtered = (allTrainerAtt || []).filter(a => {
        let match = true;
        if (trainerId !== 'all' && String(a.trainer_id) !== String(trainerId)) match = false;
        return match;
    });
    
    renderTrainerAttendance(filtered);
}

function calculateWorkingHours(checkIn, checkOut) {
    if (!checkIn) return { text: '-', mins: 0 };
    if (!checkOut) return { text: 'جارٍ العمل ⏱', mins: 0 };
    const [h1, m1] = checkIn.split(':').map(Number);
    const [h2, m2] = checkOut.split(':').map(Number);
    if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return { text: '-', mins: 0 };
    let diffMins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diffMins < 0) diffMins += 24 * 60;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    let parts = [];
    if (hours > 0) parts.push(`${hours} ساعة`);
    if (mins > 0) parts.push(`${mins} دقيقة`);
    return { text: parts.length > 0 ? parts.join(' و ') : 'أقل من دقيقة', mins: diffMins };
}

function renderTrainerAttendance(list) {
    const tbody = document.getElementById('trainer-att-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let totalMins = 0;
    // تاريخ محلي: السجلات تُكتب بـ localDateStr، فمقارنتها بتاريخ UTC
    // كانت تُظهر "0 حاضر اليوم" بعد التاسعة مساءً بتوقيت مصر
    const today = todayStr();
    const todayCheckedInSet = new Set();

    list.forEach(a => {
        const trainer = (trainers || []).find(t => String(t.id) === String(a.trainer_id));
        const trainerName = trainer ? trainer.name : 'موظف محذوف';
        const jobTitle = trainer && trainer.job_title ? trainer.job_title : 'مدرب/موظف';
        
        const workInfo = calculateWorkingHours(a.check_in, a.check_out);
        totalMins += workInfo.mins;
        
        if (a.date === today) {
            todayCheckedInSet.add(a.trainer_id);
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${a.date}</strong></td>
            <td><b>${escapeHTML(trainerName)}</b></td>
            <td><span class="badge badge-neutral">${escapeHTML(jobTitle)}</span></td>
            <td><span class="badge badge-success">${a.check_in || '-'}</span></td>
            <td><span class="badge ${a.check_out ? 'badge-primary' : 'badge-warning'}">${a.check_out || 'لم ينصرف'}</span></td>
            <td style="font-weight:bold; color:var(--text-main);">${workInfo.text}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteTrainerAttendance('${a.id}')" title="حذف السجل">حذف</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update Stats Summary Cards
    const totalHoursNum = Math.floor(totalMins / 60);
    const totalMinsRem = totalMins % 60;
    let totalHoursText = `${totalHoursNum} ساعة`;
    if (totalMinsRem > 0) totalHoursText += ` و ${totalMinsRem} دقيقة`;

    const elTotal = document.getElementById('tatt-stat-total');
    const elHours = document.getElementById('tatt-stat-hours');
    const elToday = document.getElementById('tatt-stat-today');

    if (elTotal) elTotal.innerText = list.length;
    if (elHours) elHours.innerText = totalHoursText;
    if (elToday) elToday.innerText = `${todayCheckedInSet.size} موظف`;
}

async function deleteTrainerAttendance(id) {
    // كانت تستخدم confirm() الأصلي بينما بقية البرنامج يستخدم customConfirm
    if (!await customConfirm('هل أنت متأكد من حذف هذا السجل؟')) return;
    if (!window.electronAPI || !window.electronAPI.deleteTrainerAttendance) return;
    const ok = await dbWrite(window.electronAPI.deleteTrainerAttendance(id), 'حذف السجل');
    if (ok === null) return;
    showToast('تم حذف السجل بنجاح', 'success');
    loadTrainerAttendance();
}


// --- Employee Functions ---
function loadEmployees() {
    const tbody = document.getElementById('employees-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!employees || employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">لا يوجد موظفين مسجلين — اضغط "+ إضافة موظف جديد"</td></tr>';
        return;
    }
    
    let rowsHTML = '';
    (employees || []).forEach(emp => {
        const jobBadge = `<span class="badge badge-success">${escapeHTML(emp.job_title || 'موظف')}</span>`;
        const zkidBadge = emp.zkid ? `<span class="badge badge-primary">${escapeHTML(emp.zkid)}</span>` : '<span class="badge badge-neutral">بدون بصمة</span>';
        const genderText = emp.gender === 'male' ? 'شيفت ذكور (رجال)' : (emp.gender === 'female' ? 'شيفت إناث (بنات)' : 'للشيفتين / إدارة');
        
        rowsHTML += `<tr>
            <td><b>${escapeHTML(emp.name)}</b></td>
            <td>${jobBadge}</td>
            <td>${zkidBadge}</td>
            <td style="direction:ltr; text-align:right;">${escapeHTML(emp.phone || '-')}</td>
            <td>${genderText}</td>
            <td class="action-cell">
                <button class="btn btn-sm btn-outline" onclick="openEditEmployeeModal('${escapeJsArg(emp.id)}')">تعديل</button>
                <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${escapeJsArg(emp.id)}')">حذف</button>
            </td>
        </tr>`;
    });
    tbody.innerHTML = rowsHTML;
}

function openAddEmployeeModal() {
    clearInputs('addEmployeeModal');
    document.getElementById('employee-edit-id').value = '';
    const j = document.getElementById('employee-job');
    if (j) j.selectedIndex = 0;
    const g = document.getElementById('employee-gender');
    if (g) g.selectedIndex = 0;
    document.getElementById('employee-modal-title').innerText = 'إضافة موظف جديد';
    document.getElementById('employee-save-btn').innerText = 'حفظ الموظف';
    openModal('addEmployeeModal');
}

// نفس النافذة تخدم التعديل: كان db-update-employee موجوداً بلا أي زر يستدعيه
function openEditEmployeeModal(id) {
    const emp = (employees || []).find(x => x.id === id);
    if (!emp) return;
    document.getElementById('employee-edit-id').value = emp.id;
    document.getElementById('employee-name').value = emp.name || '';
    document.getElementById('employee-phone').value = emp.phone || '';
    document.getElementById('employee-zkid').value = emp.zkid || '';
    document.getElementById('employee-job').value = emp.job_title || 'موظف استقبال';
    document.getElementById('employee-gender').value = emp.gender || 'all';
    document.getElementById('employee-modal-title').innerText = 'تعديل بيانات الموظف';
    document.getElementById('employee-save-btn').innerText = 'حفظ التعديلات';
    openModal('addEmployeeModal');
}

async function saveNewEmployee() {
    if (!window.electronAPI || !window.electronAPI.addEmployee) return;
    const editingId = document.getElementById('employee-edit-id').value;
    const name = document.getElementById('employee-name').value.trim();
    const jobEl = document.getElementById('employee-job');
    const job_title = jobEl ? jobEl.value : 'موظف';
    const phone = document.getElementById('employee-phone').value.trim();
    const zkid = document.getElementById('employee-zkid').value.trim();
    const genderEl = document.getElementById('employee-gender');
    const gender = genderEl ? genderEl.value : 'all';

    if (!name) return showToast('الرجاء إدخال اسم الموظف', 'error');
    if (!isValidPhone(phone, false)) return showToast('رقم الهاتف غير صحيح (11 رقماً يبدأ بـ 01)', 'error');
    if ((employees || []).some(x => x.name === name && x.id !== editingId)) return showToast('هذا الاسم مسجل مسبقاً!', 'error');

    const btn = document.getElementById('employee-save-btn');
    if (btn) btn.disabled = true;

    try {
        const empData = {
            id: editingId || ('EMP-' + Date.now()),
            name: name,
            job_title: job_title,
            phone: phone || '',
            zkid: zkid || '',
            gender: gender
        };
        const ok = editingId ?
            await dbWrite(window.electronAPI.updateEmployee(empData), 'تعديل الموظف') :
            await dbWrite(window.electronAPI.addEmployee(empData), 'الموظف');
        if (ok === null) return;

        closeModal('addEmployeeModal');
        showToast(editingId ? 'تم تعديل بيانات الموظف بنجاح' : 'تمت إضافة الموظف بنجاح', 'success');
        employees = await window.electronAPI.getEmployees() || [];
        loadEmployees();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteEmployee(id) {
    if (!(await customConfirm('هل أنت متأكد من نقل هذا الموظف إلى سلة المهملات؟'))) return;
    if (!window.electronAPI || !window.electronAPI.deleteEmployee) return;
    const emp = (employees || []).find(e => e.id === id);
    try {
        if (emp && window.electronAPI.addTrash) {
            const trashOk = await dbWrite(window.electronAPI.addTrash({
                id: 'trash_' + Date.now(),
                type: 'employee',
                item_data: emp,
                deleted_by: currentUser ? (currentUser.username || currentUser.name) : 'admin'
            }), 'نقل لسلة المهملات');
            if (trashOk === null) return;   // ماتنقلش للمهملات — منحذفش
        }
        await window.electronAPI.deleteEmployee(id);
        showToast('تم نقل الموظف إلى سلة المهملات ', 'success');
        employees = await window.electronAPI.getEmployees() || [];
        loadEmployees();
    } catch (e) {
        (()=>{})(e);
        showToast('خطأ أثناء النقل لسلة المهملات', 'error');
    }
}

async function loadEmployeeAttendance() {
    if (!window.electronAPI || !window.electronAPI.getEmployeeAttendance) return;
    
    if (!employees || employees.length === 0) {
        try { employees = await window.electronAPI.getEmployees() || []; } catch(e) {}
    }
    
    let startDate = document.getElementById('eatt-filter-start')?.value || '';
    let endDate = document.getElementById('eatt-filter-end')?.value || '';
    let empId = document.getElementById('eatt-filter-employee')?.value || 'all';
    
    const empSelect = document.getElementById('eatt-filter-employee');
    if (empSelect && empSelect.options.length <= 1 && (employees || []).length > 0) {
        (employees || []).forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} (${e.job_title || 'موظف'})`;
            empSelect.appendChild(opt);
        });
    }
    
    const tbody = document.getElementById('employee-att-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">جاري التحميل...</td></tr>';
    try {
        const filters = { dateStart: startDate, dateEnd: endDate };
        if (empId && empId !== 'all') filters.employeeId = empId;
        
        let atts = await window.electronAPI.getEmployeeAttendance(filters) || [];
        tbody.innerHTML = '';
        if (atts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted)">لا يوجد حضور مسجل في هذه الفترة</td></tr>';
            return;
        }
        
        let totalHours = 0;
        // الكارت عنوانه "الحاضرون اليوم"، وكان يعدّ كل موظفي الفترة المعروضة
        const today = todayStr();
        const todayEmps = new Set();

        let rowsHTML = '';
        atts.forEach(a => {
            const empObj = (employees || []).find(e => String(e.id) === String(a.employee_id) || String(e.zkid) == String(a.employee_id));
            const empName = empObj ? empObj.name : 'مجهول (' + (a.employee_id || '-') + ')';
            const jobTitle = empObj && empObj.job_title ? empObj.job_title : 'موظف';
            const checkIn = a.check_in ? a.check_in : '-';
            const checkOut = a.check_out ? a.check_out : '-';
            const dateStr = a.date || '-';
            
            let workHoursText = '-';
            if (a.check_in && a.check_out) {
                const workInfo = typeof calculateWorkingHours === 'function' ? calculateWorkingHours(a.check_in, a.check_out) : { text: '-', mins: 0 };
                workHoursText = workInfo.text;
                totalHours += (workInfo.mins / 60);
            }
            if (a.employee_id && a.date === today) todayEmps.add(a.employee_id);
            
            rowsHTML += `<tr>
                <td style="direction:ltr; text-align:right;">${dateStr}</td>
                <td><b>${escapeHTML(empName)}</b></td>
                <td><span class="badge badge-neutral">${escapeHTML(jobTitle)}</span></td>
                <td><span class="badge badge-success">${checkIn}</span></td>
                <td><span class="badge ${a.check_out ? 'badge-primary' : 'badge-warning'}">${checkOut}</span></td>
                <td style="font-weight:bold; color:var(--text-main);">${workHoursText}</td>
                <td class="action-buttons">
                    <button class="btn btn-sm btn-danger" title="حذف السجل" onclick="deleteEmployeeAttendance('${a.id}')">حذف</button>
                </td>
            </tr>`;
        });
        tbody.innerHTML = rowsHTML;
        
        const elTotal = document.getElementById('eatt-stat-total');
        const elHours = document.getElementById('eatt-stat-hours');
        const elToday = document.getElementById('eatt-stat-today');
        
        if (elTotal) elTotal.innerText = atts.length;
        if (elHours) elHours.innerText = totalHours.toFixed(1) + ' ساعة';
        if (elToday) elToday.innerText = todayEmps.size + ' موظف';
        
    } catch (e) {
        (()=>{})("Employee attendance load error:", e);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--danger)">خطأ في جلب البيانات</td></tr>';
    }
}

async function deleteEmployeeAttendance(id) {
    if (!(await customConfirm('هل أنت متأكد من حذف سجل الحضور هذا؟'))) return;
    if (!window.electronAPI || !window.electronAPI.deleteEmployeeAttendance) return;
    try {
        await window.electronAPI.deleteEmployeeAttendance(id);
        showToast('تم حذف السجل', 'success');
        loadEmployeeAttendance();
    } catch (e) {
        (()=>{})(e);
        showToast('خطأ أثناء الحذف', 'error');
    }
}

function openManualAttendanceModal(targetType = 'trainer') {
    document.getElementById('manual-att-target-type').value = targetType;
    const typeSelect = document.getElementById('manual-att-type-select');
    if (typeSelect) typeSelect.value = targetType;
    
    document.getElementById('manual-att-date').value = todayStr();
    const now = new Date();
    document.getElementById('manual-att-checkin').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    document.getElementById('manual-att-checkout').value = '';
    
    onManualAttTypeChange();
    openModal('addManualAttendanceModal');
}

function onManualAttTypeChange() {
    const type = document.getElementById('manual-att-type-select').value;
    document.getElementById('manual-att-target-type').value = type;
    const personSelect = document.getElementById('manual-att-person-select');
    if (!personSelect) return;
    
    personSelect.innerHTML = '<option value="">اختر الشخص...</option>';
    if (type === 'trainer') {
        (trainers || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.name} (${t.job_title || 'مدرب'})`;
            personSelect.appendChild(opt);
        });
    } else {
        (employees || []).forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} (${e.job_title || 'موظف'})`;
            personSelect.appendChild(opt);
        });
    }
}

async function saveManualAttendance() {
    const type = document.getElementById('manual-att-target-type').value;
    const personId = document.getElementById('manual-att-person-select').value;
    const attDate = document.getElementById('manual-att-date').value;
    const checkIn = document.getElementById('manual-att-checkin').value;
    const checkOut = document.getElementById('manual-att-checkout').value;
    
    if (!personId || !attDate || !checkIn) {
        return showToast('يرجى ملء البيانات الأساسية', 'error');
    }
    if (checkOut && checkOut <= checkIn) {
        return showToast('وقت الانصراف يجب أن يكون بعد وقت الحضور', 'error');
    }
    if (attDate > todayStr()) {
        return showToast('لا يمكن تسجيل حضور بتاريخ مستقبلي', 'error');
    }

    if (!window.electronAPI) return;

    const record = {
        check_in: checkIn,
        check_out: checkOut || '',
        date: attDate
    };

    if (type === 'trainer') {
        const ok = await dbWrite(window.electronAPI.addTrainerAttendance({
            ...record,
            id: 'TATT-' + Date.now(),
            trainer_id: personId
        }), 'حضور المدرب');
        if (ok === null) return;
        showToast('تم تسجيل حضور المدرب بنجاح', 'success');
        loadTrainerAttendance();
    } else {
        const ok = await dbWrite(window.electronAPI.addEmployeeAttendance({
            ...record,
            id: 'EATT-' + Date.now(),
            employee_id: personId
        }), 'حضور الموظف');
        if (ok === null) return;
        showToast('تم تسجيل حضور الموظف بنجاح', 'success');
        loadEmployeeAttendance();
    }
    closeModal('addManualAttendanceModal');
}

// ==========================================================================
// TOP FITNESS STORE & POS MODULE LOGIC
// ==========================================================================
let allStoreProducts = [];
let storeCart = []; // [{ product, quantity, unitPrice, totalPrice }]
let currentStoreCategory = 'all';
let storeSearchQuery = '';
let storeBuyerType = 'walkin'; // 'walkin' | 'member'

async function loadStore() {
    if (!window.electronAPI || !window.electronAPI.getStoreProducts) return;
    try {
        allStoreProducts = await window.electronAPI.getStoreProducts() || [];
        renderStoreProducts();
        updateStoreKPIs();
        populateStoreMembers();
        renderStoreCart();
    } catch (err) {
        (()=>{})('loadStore error:', err);
    }
}

function updateStoreKPIs() {
    const totalProds = allStoreProducts.length;
    let invValue = 0;
    let lowStock = 0;

    allStoreProducts.forEach(p => {
        const qty = parseInt(p.stock, 10) || 0;
        const price = parseFloat(p.price) || 0;
        invValue += (qty * price);
        if (qty <= 5) lowStock++;
    });

    const elCount = document.getElementById('store-kpi-products-count');
    if (elCount) elCount.textContent = totalProds;

    const elVal = document.getElementById('store-kpi-inventory-value');
    if (elVal) elVal.textContent = invValue.toLocaleString('ar-EG') + ' ج.م';

    const elLow = document.getElementById('store-kpi-low-stock');
    if (elLow) elLow.textContent = lowStock;

    // Calculate today's store sales from revenues if available
    calculateTodayStoreSales();
}

async function calculateTodayStoreSales() {
    const elToday = document.getElementById('store-kpi-today-sales');
    if (!elToday || !window.electronAPI || !window.electronAPI.getStoreSales) return;
    try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const sales = await window.electronAPI.getStoreSales({ startDate: todayStr, endDate: todayStr }) || [];
        let total = 0;
        sales.forEach(s => { total += (parseFloat(s.total_amount) || 0); });
        elToday.textContent = total.toLocaleString('ar-EG') + ' ج.م';
    } catch (e) {
        if (elToday) elToday.textContent = '0 ج.م';
    }
}

function filterStoreCategory(cat, btn) {
    currentStoreCategory = cat;
    document.querySelectorAll('.store-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderStoreProducts();
}

function searchStoreProducts() {
    const input = document.getElementById('store-search');
    storeSearchQuery = (input ? input.value : '').trim().toLowerCase();
    renderStoreProducts();
}

function getCategoryPlaceholderIcon(category) {
    if (!category) category = '';
    if (category.includes('مشروبات')) {
        return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="12" x2="18" y2="12"/></svg>`;
    } else if (category.includes('مكملات')) {
        return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h12v3H6z"/><path d="M7 5v14a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V5"/><line x1="6" y1="12" x2="18" y2="12"/></svg>`;
    } else {
        // أدوات رياضية
        return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="6" y1="5" x2="6" y2="19"/><line x1="18" y1="5" x2="18" y2="19"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="8" x2="2" y2="16"/><line x1="22" y1="8" x2="22" y2="16"/></svg>`;
    }
}

function renderStoreProducts() {
    const grid = document.getElementById('store-products-grid');
    if (!grid) return;

    let filtered = allStoreProducts.filter(p => {
        let matchesCat = (currentStoreCategory === 'all');
        if (!matchesCat) {
            const cat = p.category || '';
            if (currentStoreCategory === 'مكملات') {
                matchesCat = cat === 'مكملات' || cat.includes('مكملات');
            } else if (currentStoreCategory === 'مشروبات') {
                matchesCat = cat === 'مشروبات' || cat.includes('مشروبات');
            } else if (currentStoreCategory === 'أدوات رياضية') {
                matchesCat = cat === 'أدوات رياضية' || cat.includes('أدوات') || cat.includes('إكسسوارات') || cat.includes('أحزمة');
            } else {
                matchesCat = (cat === currentStoreCategory);
            }
        }
        const name = (p.name || '').toLowerCase();
        const barcode = (p.barcode || '').toLowerCase();
        const matchesSearch = !storeSearchQuery || name.includes(storeSearchQuery) || barcode.includes(storeSearchQuery);
        return matchesCat && matchesSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle);">
                <div style="font-size: 2.2rem; margin-bottom: 8px;">📦</div>
                <div style="font-weight: 700; font-size: 1.1rem; color: var(--text-main);">لم يتم العثور على منتجات</div>
                <p style="margin: 4px 0 0; font-size: 0.85rem;">جرب تغيير التصنيف أو البحث بكلمات أخرى، أو أضف منتجات جديدة للمتجر.</p>
            </div>
        `;
        return;
    }

    const isAdmin = currentUser && currentUser.role === 'admin';

    grid.innerHTML = filtered.map(p => {
        const stock = parseInt(p.stock, 10) || 0;
        let stockTagClass = 'stock-available';
        let stockTagText = `متوفر: ${stock}`;
        if (stock === 0) {
            stockTagClass = 'stock-out';
            stockTagText = 'نفذت الكمية';
        } else if (stock <= 5) {
            stockTagClass = 'stock-low';
            stockTagText = `متبقي: ${stock}`;
        }

        const imgHtml = p.image ?
            `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" onerror="this.parentElement.innerHTML='<div class=\\'product-placeholder-icon\\'>${getCategoryPlaceholderIcon(p.category)}</div>'">` :
            `<div class="product-placeholder-icon">${getCategoryPlaceholderIcon(p.category)}</div>`;

        const price = parseFloat(p.price) || 0;

        return `
            <div class="store-product-card" id="prod-card-${p.id}">
                <div class="product-img-wrap">
                    ${imgHtml}
                    <span class="product-stock-tag ${stockTagClass}">${stockTagText}</span>
                </div>
                <div class="product-card-body">
                    <div class="product-card-category">${escapeHtml(p.category || 'أدوات رياضية')}</div>
                    <div class="product-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                    <div class="product-card-price-row">
                        <span class="product-card-price">${price.toLocaleString('ar-EG')} <small style="font-size:0.75rem; font-weight:normal;">ج.م</small></span>
                        ${p.barcode ? `<small style="font-size:0.7rem; color:var(--text-dim);">${escapeHtml(p.barcode)}</small>` : ''}
                    </div>
                    <div class="product-card-actions">
                        <button type="button" class="btn-add-cart" onclick="addToStoreCart('${p.id}')" ${stock === 0 ? 'disabled' : ''}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            <span>${stock === 0 ? 'نفذ' : 'إضافة'}</span>
                        </button>
                        ${isAdmin ? `
                            <button type="button" class="product-card-tool-btn" onclick="openRestockModal('${p.id}')" title="تزويد المخزن (+)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            </button>
                            <button type="button" class="product-card-tool-btn" onclick="openEditProductModal('${p.id}')" title="تعديل المنتج">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                            </button>
                            <button type="button" class="product-card-tool-btn" onclick="deleteStoreProduct('${p.id}')" title="حذف">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// -------------------------------------------------------------
// STORE POS CART OPERATIONS
// -------------------------------------------------------------
function addToStoreCart(productId) {
    const prod = allStoreProducts.find(p => p.id === productId);
    if (!prod) return;

    const availableStock = parseInt(prod.stock, 10) || 0;
    if (availableStock <= 0) {
        return showToast('هذا المنتج غير متوفر في المخزن حالياً', 'warning');
    }

    const existing = storeCart.find(item => item.productId === productId);
    if (existing) {
        if (existing.quantity + 1 > availableStock) {
            return showToast(`لا يمكن إضافة أكثر من ${availableStock} قطع (الكمية المتاحة بالمخزن)`, 'warning');
        }
        existing.quantity += 1;
        existing.totalPrice = existing.quantity * existing.unitPrice;
    } else {
        const unitPrice = parseFloat(prod.price) || 0;
        storeCart.push({
            productId: prod.id,
            productName: prod.name,
            unitPrice: unitPrice,
            quantity: 1,
            totalPrice: unitPrice,
            stock: availableStock
        });
    }

    showToast(`تمت إضافة "${prod.name}" إلى السلة`, 'success');
    renderStoreCart();
}

function changeCartItemQty(productId, delta) {
    const item = storeCart.find(i => i.productId === productId);
    if (!item) return;

    const prod = allStoreProducts.find(p => p.id === productId);
    const maxStock = prod ? (parseInt(prod.stock, 10) || 0) : item.stock;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
        storeCart = storeCart.filter(i => i.productId !== productId);
    } else if (newQty > maxStock) {
        return showToast(`أقصى كمية متاحة في المخزن هي ${maxStock}`, 'warning');
    } else {
        item.quantity = newQty;
        item.totalPrice = item.quantity * item.unitPrice;
    }
    renderStoreCart();
}

function clearStoreCart() {
    storeCart = [];
    renderStoreCart();
}

function renderStoreCart() {
    const container = document.getElementById('store-cart-items');
    const totalEl = document.getElementById('store-cart-total-price');
    const badgeEl = document.getElementById('store-cart-badge');
    const submitBtn = document.getElementById('btn-submit-store-sale');

    let totalAmount = 0;
    let totalItemsCount = 0;

    storeCart.forEach(i => {
        totalAmount += i.totalPrice;
        totalItemsCount += i.quantity;
    });

    if (totalEl) totalEl.textContent = totalAmount.toLocaleString('ar-EG') + ' ج.م';

    if (badgeEl) {
        badgeEl.textContent = totalItemsCount;
        badgeEl.style.display = totalItemsCount > 0 ? 'inline-flex' : 'none';
    }

    if (submitBtn) {
        submitBtn.disabled = storeCart.length === 0;
    }

    if (!container) return;

    if (storeCart.length === 0) {
        container.innerHTML = `
            <div class="store-cart-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" style="margin-bottom: 8px;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                <div style="font-weight: 700;">السلة فارغة حالياً</div>
                <span style="font-size: 0.75rem; color: var(--text-dim);">اضغط على أي منتج لإضافته فوراً</span>
            </div>
        `;
        return;
    }

    container.innerHTML = storeCart.map(item => `
        <div class="store-cart-item">
            <div class="store-cart-item-info">
                <div class="store-cart-item-name">${escapeHtml(item.productName)}</div>
                <div class="store-cart-item-unit-price">${item.unitPrice} ج × ${item.quantity}</div>
            </div>
            <div class="store-cart-item-stepper">
                <button type="button" class="cart-step-btn" onclick="changeCartItemQty('${item.productId}', -1)">-</button>
                <span class="cart-item-qty">${item.quantity}</span>
                <button type="button" class="cart-step-btn" onclick="changeCartItemQty('${item.productId}', 1)">+</button>
            </div>
            <div class="store-cart-item-subtotal">${item.totalPrice} ج</div>
        </div>
    `).join('');
}

function setStoreBuyerType(type) {
    storeBuyerType = type;
    const btnWalkin = document.getElementById('buyer-type-walkin');
    const btnMember = document.getElementById('buyer-type-member');
    const memberWrap = document.getElementById('buyer-member-select-wrap');
    const buyerNameInput = document.getElementById('store-cart-buyer-name');

    if (type === 'walkin') {
        if (btnWalkin) btnWalkin.classList.add('active');
        if (btnMember) btnMember.classList.remove('active');
        if (memberWrap) memberWrap.style.display = 'none';
        if (buyerNameInput) {
            buyerNameInput.value = '';
            buyerNameInput.placeholder = 'اسم العميل الزائر...';
            buyerNameInput.readOnly = false;
        }
    } else {
        if (btnWalkin) btnWalkin.classList.remove('active');
        if (btnMember) btnMember.classList.add('active');
        if (memberWrap) memberWrap.style.display = 'block';
        if (buyerNameInput) {
            buyerNameInput.placeholder = 'اسم المشترك المحدد';
            buyerNameInput.readOnly = true;
        }
    }
}

function populateStoreMembers() {
    const sel = document.getElementById('store-cart-member-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- اختر المشترك من القائمة --</option>';
    (members || []).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.phone || 'بدون هاتف'})`;
        sel.appendChild(opt);
    });
}

function onStoreMemberSelected() {
    const sel = document.getElementById('store-cart-member-select');
    const nameInput = document.getElementById('store-cart-buyer-name');
    if (!sel || !nameInput) return;
    const selectedId = sel.value;
    const m = (members || []).find(x => String(x.id) === String(selectedId));
    if (m) {
        nameInput.value = m.name;
    } else {
        nameInput.value = '';
    }
}

function openStoreCheckoutModal() {
    if (storeCart.length === 0) {
        return showToast('السلة فارغة، أضف منتجات أولاً', 'warning');
    }
    document.getElementById('storeCheckoutModal').style.display = 'flex';
}

async function submitStoreSale() {
    if (storeCart.length === 0) {
        return showToast('السلة فارغة، أضف منتجات أولاً', 'warning');
    }

    if (!window.electronAPI || !window.electronAPI.createStoreSale) {
        return showToast('الخدمة غير متوفرة', 'error');
    }

    let buyerName = 'عميل زائر';
    let buyerId = '';

    if (storeBuyerType === 'member') {
        const sel = document.getElementById('store-cart-member-select');
        buyerId = sel ? sel.value : '';
        const m = (members || []).find(x => String(x.id) === String(buyerId));
        if (m) buyerName = m.name;
        else {
            return showToast('يرجى اختيار المشترك من القائمة', 'warning');
        }
    } else {
        const nameInput = document.getElementById('store-cart-buyer-name');
        if (nameInput && nameInput.value.trim()) {
            buyerName = nameInput.value.trim();
        }
    }

    let totalAmount = 0;
    storeCart.forEach(i => { totalAmount += i.totalPrice; });

    const saleData = {
        items: storeCart,
        buyerType: storeBuyerType,
        buyerName: buyerName,
        buyerId: buyerId,
        totalAmount: totalAmount,
        username: currentUser ? currentUser.username : 'admin'
    };

    const submitBtn = document.getElementById('btn-submit-store-sale');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري تسجيل العملية...'; }

    try {
        const res = await window.electronAPI.createStoreSale(saleData);
        if (res && res.success) {
            showToast(`تم إتمام عملية البيع وتوريد ${totalAmount} ج.م إلى الخزينة بنجاح! 🧾`, 'success');
            closeModal('storeCheckoutModal');
            
            if (waConfig && waConfig.notifyStore) {
                let targetPhone = '';
                if (storeBuyerType === 'member') {
                    const m = (members || []).find(x => String(x.id) === String(buyerId));
                    if (m) targetPhone = m.phone;
                }
                const itemsList = saleData.items.map(i => `${i.productName} (${i.quantity}x)`).join(', ');
                const dateStr = new Date().toLocaleDateString('ar-EG');
                let receiptMsg = (waConfig.tplStore || "إيصال مشتريات من متجر TOP FITNESS 🛍️:\nعزيزي {NAME}، شكراً لتعاملك معنا!\nالأصناف: {ITEMS}\nالإجمالي: {TOTAL} ج.م\nتاريخ العملية: {DATE}")
                    .replace(/{NAME}/g, buyerName)
                    .replace(/{ITEMS}/g, itemsList)
                    .replace(/{TOTAL}/g, totalAmount)
                    .replace(/{DATE}/g, dateStr);

                if (targetPhone) {
                    await waManualSend(targetPhone, buyerName, 'store_receipt', receiptMsg);
                } else if (window.electronAPI && window.electronAPI.logWhatsAppMessage) {
                    // عميل زائر بلا رقم: نسجّل الإيصال فقط بدون إرسال
                    window.electronAPI.logWhatsAppMessage({
                        recipient_phone: 'عميل زائر',
                        recipient_name: buyerName,
                        message_type: 'store_receipt',
                        message_text: receiptMsg,
                        status: 'failed'
                    });
                }
            }

            clearStoreCart();
            await loadStore();
            if (typeof loadDailyReports === 'function') loadDailyReports();
        } else {
            showToast((res && res.error) || 'فشل إتمام عملية البيع', 'error');
        }
    } catch (err) {
        showToast('حدث خطأ أثناء تسجيل الفاتورة: ' + err.message, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>🛒 تأكيد البيع وتوريد الخزينة</span>'; }
    }
}

// -------------------------------------------------------------
// STORE PRODUCT CRUD & RESTOCK
// -------------------------------------------------------------
function openAddProductModal() {
    const title = document.getElementById('store-product-modal-title');
    if (title) title.textContent = 'إضافة منتج جديد للمتجر';
    
    document.getElementById('sp-id').value = '';
    document.getElementById('sp-name').value = '';
    document.getElementById('sp-category').value = 'أدوات رياضية';
    document.getElementById('sp-price').value = '';
    document.getElementById('sp-cost').value = '';
    document.getElementById('sp-stock').value = '10';
    document.getElementById('sp-barcode').value = '';
    document.getElementById('sp-image').value = '';
    document.getElementById('sp-notes').value = '';
    
    const previewWrap = document.getElementById('sp-image-preview-wrap');
    if (previewWrap) previewWrap.style.display = 'none';

    openModal('storeProductModal');
}

function openEditProductModal(productId) {
    const prod = allStoreProducts.find(p => p.id === productId);
    if (!prod) return;

    const title = document.getElementById('store-product-modal-title');
    if (title) title.textContent = 'تعديل منتج في المتجر';

    document.getElementById('sp-id').value = prod.id;
    document.getElementById('sp-name').value = prod.name || '';
    document.getElementById('sp-category').value = prod.category || 'أدوات رياضية';
    document.getElementById('sp-price').value = prod.price || '';
    document.getElementById('sp-cost').value = prod.cost || '';
    document.getElementById('sp-stock').value = prod.stock || '0';
    document.getElementById('sp-barcode').value = prod.barcode || '';
    document.getElementById('sp-image').value = prod.image || '';
    document.getElementById('sp-notes').value = prod.notes || '';

    const previewWrap = document.getElementById('sp-image-preview-wrap');
    const previewImg = document.getElementById('sp-image-preview');
    if (prod.image && previewWrap && previewImg) {
        previewImg.src = prod.image;
        previewWrap.style.display = 'block';
    } else if (previewWrap) {
        previewWrap.style.display = 'none';
    }

    openModal('storeProductModal');
}

function handleProductImageUpload(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;
            document.getElementById('sp-image').value = dataUrl;
            const previewWrap = document.getElementById('sp-image-preview-wrap');
            const previewImg = document.getElementById('sp-image-preview');
            if (previewWrap && previewImg) {
                previewImg.src = dataUrl;
                previewWrap.style.display = 'block';
            }
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function saveStoreProduct(event) {
    event.preventDefault();
    if (!window.electronAPI) return;

    const id = document.getElementById('sp-id').value;
    const name = document.getElementById('sp-name').value.trim();
    const category = document.getElementById('sp-category').value;
    const price = parseFloat(document.getElementById('sp-price').value) || 0;
    const cost = parseFloat(document.getElementById('sp-cost').value) || 0;
    const stock = parseInt(document.getElementById('sp-stock').value, 10) || 0;
    const barcode = document.getElementById('sp-barcode').value.trim();
    const image = document.getElementById('sp-image').value.trim();
    const notes = document.getElementById('sp-notes').value.trim();

    if (!name) return showToast('يرجى كتابة اسم المنتج', 'warning');
    if (price <= 0) return showToast('يرجى تحديد سعر بيع صحيح', 'warning');

    const productData = {
        name,
        category,
        price,
        cost,
        stock,
        barcode,
        image,
        notes,
        username: currentUser ? currentUser.username : 'admin'
    };

    if (id) {
        productData.id = id;
        const res = await window.electronAPI.updateStoreProduct(productData);
        if (res && res.success) {
            showToast('تم تعديل بيانات المنتج بنجاح', 'success');
        } else {
            return showToast('فشل تعديل المنتج', 'error');
        }
    } else {
        const res = await window.electronAPI.addStoreProduct(productData);
        if (res && res.success) {
            showToast('تمت إضافة المنتج الجديد للمتجر بنجاح', 'success');
        } else {
            return showToast('فشل إضافة المنتج', 'error');
        }
    }

    closeModal('storeProductModal');
    loadStore();
}

function openRestockModal(productId) {
    const prod = allStoreProducts.find(p => p.id === productId);
    if (!prod) return;

    document.getElementById('restock-prod-id').value = prod.id;
    document.getElementById('restock-prod-name').textContent = prod.name;
    document.getElementById('restock-current-stock').textContent = prod.stock || 0;
    document.getElementById('restock-add-qty').value = 5;

    openModal('storeRestockModal');
}

async function submitProductRestock(event) {
    event.preventDefault();
    const prodId = document.getElementById('restock-prod-id').value;
    const addQty = parseInt(document.getElementById('restock-add-qty').value, 10) || 0;
    if (addQty <= 0) return showToast('الكمية يجب أن تكون أكبر من صفر', 'warning');

    const prod = allStoreProducts.find(p => p.id === prodId);
    if (!prod) return;

    const newStock = (parseInt(prod.stock, 10) || 0) + addQty;
    const res = await window.electronAPI.updateStoreProduct({
        ...prod,
        stock: newStock,
        username: currentUser ? currentUser.username : 'admin'
    });

    if (res && res.success) {
        showToast(`تم تزويد المخزن بـ (+${addQty}) قطعة بنجاح!`, 'success');
        closeModal('storeRestockModal');
        loadStore();
    } else {
        showToast('فشل تزويد المخزن', 'error');
    }
}

async function deleteStoreProduct(productId) {
    const prod = allStoreProducts.find(p => p.id === productId);
    if (!prod) return;

    if (!confirm(`هل أنت متأكد من حذف منتج "${prod.name}" من المتجر؟`)) return;

    const res = await window.electronAPI.deleteStoreProduct(productId);
    if (res && res.success) {
        showToast('تم حذف المنتج ونقله إلى سلة المهملات', 'success');
        storeCart = storeCart.filter(i => i.productId !== productId);
        loadStore();
    } else {
        showToast('فشل حذف المنتج', 'error');
    }
}

// -------------------------------------------------------------
// STORE SALES HISTORY MODAL
// -------------------------------------------------------------
async function openStoreSalesModal() {
    openModal('storeSalesModal');
    const tbody = document.getElementById('store-sales-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">جاري تحميل الفواتير...</td></tr>';

    if (!window.electronAPI || !window.electronAPI.getStoreSales) return;
    try {
        const sales = await window.electronAPI.getStoreSales() || [];
        if (sales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد فواتير مبيعات مسجلة حتى الآن</td></tr>';
            return;
        }
        tbody.innerHTML = sales.map(s => {
            const itemsSummary = (s.items || []).map(i => `${escapeHtml(i.product_name)} (${i.quantity})`).join(', ') || 'منتجات متعددة';
            const total = parseFloat(s.total_amount) || 0;
            return `
                <tr>
                    <td style="font-weight:700; color:var(--primary);">${escapeHtml(s.id)}</td>
                    <td style="font-size:0.85rem;">${escapeHtml(s.sale_date ? s.sale_date.slice(0, 16) : '')}</td>
                    <td style="font-weight:700;">${escapeHtml(s.buyer_name || 'عميل زائر')}</td>
                    <td style="font-size:0.85rem; max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${itemsSummary}">${itemsSummary}</td>
                    <td style="font-weight:800; color:#10b981;">${total.toLocaleString('ar-EG')} ج.م</td>
                    <td style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(s.username || 'admin')}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger);">خطأ في تحميل الفواتير: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ==========================================================================
// TOP FITNESS WHATSAPP AUTOMATION & NOTIFICATIONS ENGINE
// ==========================================================================
let waConfig = {
    notifyAttendance: true,
    notifyGuardian: true,
    notifyRenewal: true,
    notifyStore: true,
    notifyAbsence: true,
    absenceDaysThreshold: 2,
    tplAttendance: "أهلاً بك يا {NAME} في TOP FITNESS! 💪\nتم تسجيل حضورك بنجاح اليوم الساعة {TIME}.\nمتبقي في باقتك {DAYS_LEFT} يوماً. تمرين موفق ووحش! 🔥",
    tplGuardian: "إشعار صالة TOP FITNESS 📢:\nتم تسجيل حضور ابنكم ({NAME}) اليوم الساعة {TIME}.\nنتمنى له تمريناً ممتعاً وآمناً. 🛡️",
    tplAbsence: "وحشتنا في TOP FITNESS يا {NAME}! 🏋️🔥\nلاحظنا غيابك منذ {ABSENCE_DAYS} أيام.. صحتك ولياقتك تهمنا، مستنينك النهاردة تكمل فورمتك وتمرينك بقوة!",
    tplStore: "إيصال مشتريات من متجر TOP FITNESS 🛍️:\nعزيزي {NAME}، شكراً لتعاملك معنا!\nالأصناف: {ITEMS}\nالإجمالي: {TOTAL} ج.م\nتاريخ العملية: {DATE}",
    tplRenewal: "أهلاً {NAME}، تم تجديد اشتراكك بنجاح في TOP FITNESS! 🌟\nالباقة: {PACKAGE}\nالمبلغ المدفوع: {PAID} ج.م\nتاريخ الانتهاء الجديد: {EXP_DATE}"
};

let waQueue = [];
let isWaQueueRunning = false;
let stopWaQueueFlag = false;

async function loadWhatsAppConfig() {
    if (window.electronAPI && window.electronAPI.getConfig) {
        try {
            const cfg = await window.electronAPI.getConfig();
            if (cfg && cfg.whatsapp) {
                waConfig = { ...waConfig, ...cfg.whatsapp };
            }
        } catch (e) {}
    }
}

function renderWhatsAppConfigUI() {
    if (document.getElementById('waset-notify-attendance')) document.getElementById('waset-notify-attendance').checked = !!waConfig.notifyAttendance;
    if (document.getElementById('waset-notify-guardian')) document.getElementById('waset-notify-guardian').checked = !!waConfig.notifyGuardian;
    if (document.getElementById('waset-notify-renewal')) document.getElementById('waset-notify-renewal').checked = !!waConfig.notifyRenewal;
    if (document.getElementById('waset-notify-store')) document.getElementById('waset-notify-store').checked = !!waConfig.notifyStore;
    if (document.getElementById('waset-tpl-attendance')) document.getElementById('waset-tpl-attendance').value = waConfig.tplAttendance;
    if (document.getElementById('waset-tpl-guardian')) document.getElementById('waset-tpl-guardian').value = waConfig.tplGuardian;
    if (document.getElementById('waset-tpl-absence')) document.getElementById('waset-tpl-absence').value = waConfig.tplAbsence;
}

function openWhatsAppSettingsModal() {
    renderWhatsAppConfigUI();
    openModal('whatsAppSettingsModal');
}

// ---------------------------------------------------------------
// سجل رسائل الواتساب: الرسائل كانت بتتسجل في قاعدة البيانات من غير أي شاشة تعرضها
// ---------------------------------------------------------------
const WA_LOG_TYPES = {
    attendance: 'حضور',
    guardian: 'ولي أمر',
    absence: 'غياب',
    renewal: 'تجديد',
    store_receipt: 'إيصال متجر',
    plan: 'خطة تدريب'
};

const WA_LOG_STATUS = {
    sent: { text: 'تم الإرسال', color: '#10b981' },
    manual: { text: 'إرسال يدوي', color: '#f59e0b' },
    failed: { text: 'فشل', color: 'var(--danger)' }
};

function openWhatsAppLogsModal() {
    openModal('whatsAppLogsModal');
    loadWhatsAppLogs();
}

async function loadWhatsAppLogs() {
    const tbody = document.getElementById('wa-logs-tbody');
    const summary = document.getElementById('wa-logs-summary');
    if (!tbody) return;

    if (!window.electronAPI || !window.electronAPI.getWhatsAppLogs) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">سجل الرسائل غير متاح</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">جاري التحميل...</td></tr>';
    try {
        const typeSel = document.getElementById('wa-logs-type');
        const logs = await window.electronAPI.getWhatsAppLogs({ type: typeSel ? typeSel.value : 'all' }) || [];

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد رسائل مسجلة</td></tr>';
            if (summary) summary.textContent = '';
            return;
        }

        tbody.innerHTML = logs.map(l => {
            const st = WA_LOG_STATUS[l.status] || { text: l.status || '-', color: 'var(--text-muted)' };
            const when = (l.created_at || '').replace('T', ' ').slice(0, 16);
            const msg = String(l.message_text || '').replace(/\n/g, ' ');
            return `
                <tr>
                    <td style="font-size:0.82rem; white-space:nowrap;">${escapeHtml(when)}</td>
                    <td style="font-weight:700;">${escapeHtml(l.recipient_name || '-')}</td>
                    <td style="font-size:0.85rem; direction:ltr; text-align:right;">${escapeHtml(l.recipient_phone || '-')}</td>
                    <td style="font-size:0.82rem;">${escapeHtml(WA_LOG_TYPES[l.message_type] || l.message_type || '-')}</td>
                    <td style="font-weight:700; color:${st.color}; font-size:0.82rem; white-space:nowrap;">${escapeHtml(st.text)}</td>
                    <td style="font-size:0.8rem; color:var(--text-muted); max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(msg)}">${escapeHtml(msg)}</td>
                </tr>
            `;
        }).join('');

        const failed = logs.filter(l => l.status === 'failed').length;
        if (summary) {
            summary.textContent = `${logs.length} رسالة` + (failed ? ` — منها ${failed} فشلت` : '');
            summary.style.color = failed ? 'var(--danger)' : 'var(--text-muted)';
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger);">خطأ في تحميل السجل: ${escapeHtml(e.message)}</td></tr>`;
    }
}

async function saveWhatsAppSettings(event) {
    if (event) event.preventDefault();
    waConfig.notifyAttendance = document.getElementById('waset-notify-attendance').checked;
    waConfig.notifyGuardian = document.getElementById('waset-notify-guardian').checked;
    waConfig.notifyRenewal = document.getElementById('waset-notify-renewal').checked;
    waConfig.notifyStore = document.getElementById('waset-notify-store').checked;
    waConfig.tplAttendance = document.getElementById('waset-tpl-attendance').value;
    waConfig.tplGuardian = document.getElementById('waset-tpl-guardian').value;
    waConfig.tplAbsence = document.getElementById('waset-tpl-absence').value;

    if (window.electronAPI && window.electronAPI.saveConfig) {
        await window.electronAPI.saveConfig({ whatsapp: waConfig });
    }
    showToast('تم حفظ إعدادات وقوالب واتساب بنجاح 📲', 'success');
    closeModal('whatsAppSettingsModal');
}

function triggerAttendanceWhatsApp(member) {
    if (!member || !waConfig) return;
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    let daysLeft = 0;
    try {
        if (member.exp) {
            const expDate = new Date(member.exp);
            const now = new Date();
            daysLeft = Math.max(0, Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)));
        }
    } catch(e) {}

    // 1. Send to Member if enabled
    if (waConfig.notifyAttendance && member.phone) {
        let msg = (waConfig.tplAttendance || "أهلاً بك يا {NAME} في TOP FITNESS! 💪")
            .replace(/{NAME}/g, member.name)
            .replace(/{TIME}/g, timeStr)
            .replace(/{DAYS_LEFT}/g, daysLeft);

        waAutoSend(member.phone, member.name, 'attendance', msg);
    }

    // 2. Send to Guardian if enabled and guardian_phone is set
    if (waConfig.notifyGuardian && member.guardian_phone) {
        let gmsg = (waConfig.tplGuardian || "إشعار صالة TOP FITNESS: تم تسجيل حضور ابنكم {NAME} الساعة {TIME}.")
            .replace(/{NAME}/g, member.name)
            .replace(/{TIME}/g, timeStr);

        waAutoSend(member.guardian_phone, member.name + ' (ولي الأمر)', 'guardian', gmsg);
    }
}

// ==========================================================================
// WORKOUT & DIET PLANS MODULE LOGIC
// ==========================================================================
let allMemberPlans = [];
let currentPlansFilter = 'all';

async function loadMemberPlans() {
    if (!window.electronAPI || !window.electronAPI.getMemberPlans) return;
    try {
        allMemberPlans = await window.electronAPI.getMemberPlans() || [];
        renderMemberPlans();
        updatePlansKPIs();
        populatePlanMembersDropdown();
    } catch (e) {
        (()=>{})('loadMemberPlans error:', e);
    }
}

function updatePlansKPIs() {
    let total = allMemberPlans.length;
    let bulk = 0, cut = 0, fitness = 0;
    allMemberPlans.forEach(p => {
        const t = (p.title || '') + ' ' + (p.plan_type || '');
        if (t.includes('تضخيم') || t.includes('Bulk')) bulk++;
        else if (t.includes('تنشيف') || t.includes('Cut') || t.includes('تخسيس')) cut++;
        else fitness++;
    });
    if (document.getElementById('kpi-plans-total')) document.getElementById('kpi-plans-total').textContent = total;
    if (document.getElementById('kpi-plans-bulk')) document.getElementById('kpi-plans-bulk').textContent = bulk;
    if (document.getElementById('kpi-plans-cut')) document.getElementById('kpi-plans-cut').textContent = cut;
    if (document.getElementById('kpi-plans-fitness')) document.getElementById('kpi-plans-fitness').textContent = fitness;
}

function filterPlansType(type, btn) {
    currentPlansFilter = type;
    document.querySelectorAll('#plans-filter-tabs .store-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderMemberPlans();
}

function searchMemberPlans() {
    renderMemberPlans();
}

function populatePlanMembersDropdown() {
    const sel = document.getElementById('plan-member-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- اختر المشترك من القائمة --</option>';
    (members || []).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.phone || 'بدون هاتف'})`;
        sel.appendChild(opt);
    });
}

function onPlanMemberChange() {
    const sel = document.getElementById('plan-member-select');
    const memberId = sel ? sel.value : '';
    const m = (members || []).find(x => String(x.id) === String(memberId));
    if (m) {
        const titleInput = document.getElementById('plan-title');
        if (titleInput) titleInput.value = `خطة تدريب وتغذية - ${m.name}`;
    }
}

function applyPlanTemplatePreset(type) {
    const titleInput = document.getElementById('plan-title');
    const workoutInput = document.getElementById('plan-workout-content');
    const dietInput = document.getElementById('plan-diet-content');
    const notesInput = document.getElementById('plan-notes');
    const typeSelect = document.getElementById('plan-type-select');

    if (typeSelect) typeSelect.value = type;

    if (type === 'تضخيم') {
        if (!titleInput.value || titleInput.value.startsWith('خطة')) titleInput.value = 'جدول تضخيم وبناء عضل 4 أيام';
        workoutInput.value = `السبت (صدر + ترايسبس):\n- بنش برس مستوي بالبار (4x10)\n- تجميع بالدمبلز مائل عالي (3x12)\n- تفتيح كابل كروس أوفر (3x15)\n- غطس بار متوازي (3x12)\n- تمديد ترايسبس بالحبل (4x12)\n\nالأحد (ظهر + بايسبس):\n- سحب عالي واسع (4x10)\n- تجديف بالبار مقلوب (4x10)\n- ديدليفت تقليدي (3x8)\n- تبادل بالدمبلز جالس (3x12)\n- هامر كيرل بالحبل (3x12)\n\nالثلاثاء (أكتاف + ترابيس):\n- ضغط دمبلز جالس (4x10)\n- رفرفة جانبي واقف (4x15)\n- رفرفة خلفي فراشة (3x15)\n- شراجز بالدمبلز (4x15)\n\nالأربعاء (أرجل + بطن):\n- سكوات حر بالبار (4x10)\n- دفع أجهزة Leg Press (4x12)\n- مرجحة خلفي هامسترينج (3x15)\n- سمانة واقف (4x20)\n- بلانك + رفع أرجل للبطن (3 مجموعات)`;
        dietInput.value = `وجبة 1 (الإفطار):\n4 بيضات كاملة + 80 جم شوفان مع حليب وموزة وملعقة عسل.\n\nوجبة 2 (الغداء):\n200 جم صدور دجاج مشوية + 200 جم أرز بسمتي + طبق سلطة خضراء مضاف إليها زيت زيتون.\n\nوجبة 3 (قبل التمرين):\nبطاطا مشوية متوسطة + كوب قهوة سادة.\n\nوجبة 4 (بعد التمرين):\nشيك بروتين (أو 4 بياض بيض) + موزة أو تمر.\n\nوجبة 5 (العشاء):\n150 جم جبن قريش + رغيف سن + شرائح خيار وطماطم.`;
        notesInput.value = 'شرب 3.5 لتر ماء يومياً، النوم 8 ساعات ليلاً، وزيادة الأوزان تدريجياً كل أسبوع.';
    } else if (type === 'تنشيف') {
        if (!titleInput.value || titleInput.value.startsWith('خطة')) titleInput.value = 'جدول تنشيف وحرق دهون كارديو + أثقال';
        workoutInput.value = `نظام Push - Pull - Legs + كارديو HIIT:\n\nيوم 1 (Push - دفع):\n- بنش مائل دمبلز (4x12)\n- ضغط أكتاف بار (3x12)\n- تجميع كابل للصدر (3x15)\n- ترايسبس كابل مستقيم (4x15)\n- 20 دقيقة مشي مائل على المشاية (Incline Treadmill).\n\nيوم 2 (Pull - سحب):\n- سحب أرضي كابل (4x12)\n- سحب عالي قبضة ضيقة (3x12)\n- فيس بول للأكتاف الخلفية (4x15)\n- بايسبس بار زجزاج (3x12)\n- 15 دقيقة سبرينتات متقطعة HIIT.\n\nيوم 3 (Legs - أرجل):\n- سكوات دمبلز Goblet (4x15)\n- لانجز طعن متحرك (3x12 لكل رجل)\n- Leg Extension (3x15)\n- بطن كرانشز + رفع أرجل (4x20).`;
        dietInput.value = `نظام عجز السعرات محسوب البروتين:\n\nوجبة 1 (الإفطار):\n3 بيضات (1 كاملة + 2 بياض) + 50 جم شوفان مع ماء وقرفة + شرائح خيار.\n\nوجبة 2 (الغداء):\n200 جم صدور دجاج أو سمك فيليه مشوي + 100 جم بطاطس مسلوقة + طبق سلطة خضراء كبير.\n\nوجبة 3 (قبل التمرين):\nتفاحة خضراء + كوب شاي أخضر.\n\nوجبة 4 (بعد التمرين):\nعلبة تونة مصفاة من الزيت + سلطة خضراء.`;
        notesInput.value = 'الامتناع التام عن السكريات والمياه الغازية، شرب 4 لتر ماء، والمشي 8000-10000 خطوة يومياً.';
    } else if (type === 'فتنس') {
        if (!titleInput.value || titleInput.value.startsWith('خطة')) titleInput.value = 'جدول لياقة بدنية وتناسق عام 3 أيام';
        workoutInput.value = `تمارين شاملة لكل الجسم (Full Body) 3 أيام بينها يوم راحة:\n\nيوم 1 (قوة عامة):\n- سكوات بالبار أو دمبلز (3x12)\n- بنش برس دمبلز مستوي (3x12)\n- سحب أرضي كابل (3x12)\n- ضغط أكتاف دمبلز جالس (3x12)\n- بلانك ثابت (3 مجموعات × 40 ثانية)\n\nيوم 2 (تحمل وكارديو):\n- 25 دقيقة مشي سريع أو دراجة ثابتة\n- لانجز طعن ثابت (3x12 لكل رجل)\n- سحب عالي مساعد (3x10)\n- تجميع كابل للصدر (3x15)\n- كرانشز بطن (3x20)\n\nيوم 3 (تناسق وشد):\n- ديدليفت روماني دمبلز (3x12)\n- بنش مائل دمبلز (3x12)\n- تجديف دمبلز مفرد (3x12 لكل ذراع)\n- رفرفة جانبي واقف (3x15)\n- سمانة واقف (3x20)\n- 15 دقيقة كارديو خفيف ختامي`;
        dietInput.value = `نظام متوازن للحفاظ على الوزن وتحسين اللياقة:\n\nوجبة 1 (الإفطار):\n2 بيضة + رغيف بلدي سن + جبن قريش + طبق خضار (خيار وطماطم).\n\nوجبة 2 (سناك):\nزبادي يوناني + حفنة مكسرات نيئة (20 جم) أو ثمرة فاكهة.\n\nوجبة 3 (الغداء):\n150 جم بروتين (دجاج / سمك / لحم قليل الدهن) + 150 جم أرز أو مكرونة أسمر + سلطة خضراء.\n\nوجبة 4 (قبل التمرين بساعة):\nثمرة فاكهة + كوب قهوة سادة.\n\nوجبة 5 (العشاء):\nسلطة تونة أو بيض مسلوق + شوربة خضار خفيفة.`;
        notesInput.value = 'الالتزام بـ 3 أيام تمرين أسبوعياً مع يوم راحة بينها، شرب 3 لتر ماء يومياً، النوم 7-8 ساعات، والمشي 6000-8000 خطوة في أيام الراحة.';
    }
}

function openMemberPlanModal() {
    document.getElementById('plan-id').value = '';
    document.getElementById('plan-member-select').value = '';
    document.getElementById('plan-title').value = '';
    document.getElementById('plan-type-select').value = 'تضخيم';
    applyPlanTemplatePreset('تضخيم');
    openModal('memberPlanModal');
}

function openEditPlanModal(planId) {
    const plan = allMemberPlans.find(p => p.id === planId);
    if (!plan) return;

    document.getElementById('plan-id').value = plan.id;
    document.getElementById('plan-member-select').value = plan.member_id || '';
    document.getElementById('plan-title').value = plan.title || '';
    document.getElementById('plan-type-select').value = plan.plan_type || 'تضخيم';
    document.getElementById('plan-workout-content').value = plan.workout_content || '';
    document.getElementById('plan-diet-content').value = plan.diet_content || '';
    document.getElementById('plan-notes').value = plan.notes || '';

    openModal('memberPlanModal');
}

async function saveMemberPlanForm(event) {
    event.preventDefault();
    if (!window.electronAPI || !window.electronAPI.saveMemberPlan) return;

    const memberId = document.getElementById('plan-member-select').value;
    const member = (members || []).find(m => String(m.id) === String(memberId));
    if (!member) return showToast('يرجى اختيار المشترك', 'warning');

    const planData = {
        id: document.getElementById('plan-id').value || '',
        member_id: member.id,
        member_name: member.name,
        plan_type: document.getElementById('plan-type-select').value,
        title: document.getElementById('plan-title').value.trim(),
        workout_content: document.getElementById('plan-workout-content').value.trim(),
        diet_content: document.getElementById('plan-diet-content').value.trim(),
        notes: document.getElementById('plan-notes').value.trim()
    };

    const res = await window.electronAPI.saveMemberPlan(planData);
    if (res && res.success) {
        showToast('تم حفظ الخطة التدريبية بنجاح 📋', 'success');
        closeModal('memberPlanModal');
        loadMemberPlans();
    } else {
        showToast('فشل حفظ الخطة', 'error');
    }
}

async function deleteMemberPlan(planId) {
    if (!confirm('هل أنت متأكد من حذف هذه الخطة؟')) return;
    if (!window.electronAPI || !window.electronAPI.deleteMemberPlan) return;

    const res = await window.electronAPI.deleteMemberPlan(planId);
    if (res && res.success) {
        showToast('تم حذف الخطة بنجاح', 'success');
        loadMemberPlans();
    } else {
        showToast('فشل حذف الخطة', 'error');
    }
}

function sendPlanWhatsApp(planId) {
    const plan = allMemberPlans.find(p => p.id === planId);
    if (!plan) return;
    const member = (members || []).find(m => String(m.id) === String(plan.member_id));
    const phone = member ? member.phone : '';
    if (!phone) return showToast('المشترك ليس لديه رقم هاتف مسجل', 'warning');

    let msg = `🏋️ *TOP FITNESS - الخطة التدريبية والغذائية* 🥗\n\n`;
    msg += `أهلاً بك يا بطل *${plan.member_name}*! 💪\n`;
    msg += `إليك خطتك المخصصة بعنوان: *${plan.title}*\n\n`;
    
    if (plan.workout_content) {
        msg += `📋 *جدول التمارين وتقسيم الأيام:*\n${plan.workout_content}\n\n`;
    }
    if (plan.diet_content) {
        msg += `🥗 *النظام والجدول الغذائي:*\n${plan.diet_content}\n\n`;
    }
    if (plan.notes) {
        msg += `💡 *إرشادات وتوصيات الكابتن:*\n${plan.notes}\n\n`;
    }
    msg += `🔥 بالتوفيق في التمرين وتحقيق أفضل فورمة مع أسرة *TOP FITNESS*! 🚀`;

    waManualSend(phone, plan.member_name, 'plan', msg);
}

function renderMemberPlans() {
    const grid = document.getElementById('plans-grid');
    const search = (document.getElementById('search-plans') ? document.getElementById('search-plans').value : '').trim().toLowerCase();
    if (!grid) return;

    let filtered = allMemberPlans.filter(p => {
        const matchesCat = (currentPlansFilter === 'all' || (p.plan_type || '').includes(currentPlansFilter) || (p.title || '').includes(currentPlansFilter));
        const name = (p.member_name || '').toLowerCase();
        const title = (p.title || '').toLowerCase();
        const matchesSearch = !search || name.includes(search) || title.includes(search);
        return matchesCat && matchesSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding: 40px 20px; background:var(--bg-card); border-radius:12px; border:1px solid var(--border-subtle); color:var(--text-muted);">
                <div style="font-size: 2.2rem; margin-bottom: 8px;">📋</div>
                <div style="font-weight:700; color:var(--text-main); font-size:1.1rem;">لا توجد خطط مسجلة حالياً</div>
                <p style="margin:4px 0 14px; font-size:0.85rem;">أنشئ خطة تدريب وغذاء مخصصة للاعبين بضغطة زر وأرسلها عبر واتساب.</p>
                <button class="btn btn-sm" onclick="openMemberPlanModal()" style="background:var(--primary); color:#0f172a; font-weight:700;">+ إنشاء أول خطة</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(p => `
        <div class="panel" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px; display:flex; flex-direction:column; justify-content:space-between; transition: transform 0.2s ease;">
            <div>
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
                    <span style="font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:10px; background:rgba(56,189,248,0.15); color:var(--primary); border:1px solid rgba(56,189,248,0.3);">${escapeHtml(p.plan_type || 'تضخيم')}</span>
                    <small style="font-size:0.72rem; color:var(--text-dim);">${p.created_at ? p.created_at.slice(0, 10) : ''}</small>
                </div>
                <div style="font-weight:800; font-size:1.05rem; color:var(--text-main); margin-bottom:4px;">${escapeHtml(p.title)}</div>
                <div style="font-size:0.85rem; color:var(--primary); margin-bottom:12px;">👤 المشترك: <b>${escapeHtml(p.member_name)}</b></div>
                
                <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:10px; border:1px solid var(--border-subtle); font-size:0.8rem; color:var(--text-muted); margin-bottom:14px; max-height:100px; overflow-y:auto; line-height:1.5; white-space:pre-line;">
                    ${escapeHtml(p.workout_content || p.diet_content || 'لا توجد تفاصيل إضافية')}
                </div>
            </div>

            <div style="display:flex; gap:6px; border-top:1px solid var(--border-subtle); padding-top:10px;">
                <button type="button" class="btn btn-sm" onclick="sendPlanWhatsApp('${p.id}')" style="flex:1; justify-content:center; background:#10b981; color:#fff; border:none; font-weight:700; gap:4px;">
                    <span>📲 إرسال واتساب</span>
                </button>
                <button type="button" class="btn btn-sm btn-outline" onclick="openEditPlanModal('${p.id}')" title="تعديل">✏️</button>
                <button type="button" class="btn btn-sm btn-outline" onclick="deleteMemberPlan('${p.id}')" title="حذف" style="color:var(--danger); border-color:rgba(239,68,68,0.3);">🗑️</button>
            </div>
        </div>
    `).join('');
}

// ==========================================================================
// ABSENCE & RETENTION BOT LOGIC
// ==========================================================================
let absentMembersList = [];

async function loadAbsentMembers() {
    const sel = document.getElementById('absence-threshold-select');
    const threshold = sel ? sel.value : 2;
    if (!window.electronAPI || !window.electronAPI.getAbsentMembers) return;
    try {
        absentMembersList = await window.electronAPI.getAbsentMembers(threshold) || [];
        renderAbsentMembers();
        const countEl = document.getElementById('kpi-absent-count');
        const badgeEl = document.getElementById('absence-badge');
        if (countEl) countEl.textContent = absentMembersList.length;
        if (badgeEl) {
            badgeEl.textContent = absentMembersList.length;
            badgeEl.style.display = absentMembersList.length > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) {
        (()=>{})('loadAbsentMembers error:', e);
    }
}

function filterAbsentTable(search) {
    renderAbsentMembers(search);
}

function renderAbsentMembers(searchQuery = '') {
    const tbody = document.getElementById('absent-members-tbody');
    if (!tbody) return;

    const query = searchQuery.trim().toLowerCase();
    let filtered = absentMembersList.filter(m => {
        if (!query) return true;
        return (m.name || '').toLowerCase().includes(query) || (m.phone || '').includes(query);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">🎉 رائع! لا يوجد مشتركون غائبون حالياً متجاوزين للمدة المحددة.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(m => {
        const days = m.days_since_last || 2;
        const lastAtt = m.last_attendance ? m.last_attendance.slice(0, 16) : 'لم يسجل حضوراً';
        return `
            <tr>
                <td style="font-weight:700; color:var(--text-main);">${escapeHtml(m.name)}</td>
                <td style="font-family:monospace;">${escapeHtml(m.phone || 'بدون هاتف')}</td>
                <td style="font-family:monospace; color:var(--text-muted);">${escapeHtml(m.guardian_phone || '-')}</td>
                <td><span style="font-size:0.8rem; color:var(--primary); font-weight:700;">${escapeHtml((m.pkg || 'باقة شهرية').replace(/[\?\uFFFD]/g, '').trim())}</span></td>
                <td style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(lastAtt)}</td>
                <td><span style="font-size:0.82rem; font-weight:800; color:#ef4444; background:rgba(239,68,68,0.15); padding:2px 8px; border-radius:10px;">${days} أيام غياب</span></td>
                <td>
                    <button type="button" class="btn btn-sm" onclick="sendSingleAbsenceReminder('${m.id}')" style="background:#10b981; color:#fff; border:none; padding:4px 10px; font-weight:700; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;">
                        <span>📲 إرسال تحفيز</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function sendSingleAbsenceReminder(memberId) {
    const member = (members || []).find(m => String(m.id) === String(memberId)) || absentMembersList.find(m => String(m.id) === String(memberId));
    if (!member || !member.phone) return showToast('المشترك ليس لديه رقم هاتف مسجل', 'warning');

    const days = member.days_since_last || 2;
    let msg = (waConfig.tplAbsence || "وحشتنا في TOP FITNESS يا {NAME}! 🏋️🔥\nلاحظنا غيابك منذ {ABSENCE_DAYS} أيام.. صحتك ولياقتك تهمنا، مستنينك النهاردة تكمل فورمتك وتمرينك بقوة!")
        .replace(/{NAME}/g, member.name)
        .replace(/{ABSENCE_DAYS}/g, days);

    waManualSend(member.phone, member.name, 'absence', msg);
}

async function sendBulkAbsenceReminders() {
    if (absentMembersList.length === 0) {
        return showToast('لا يوجد مشتركون غائبون لإرسال الرسائل إليهم', 'info');
    }

    if (!confirm(`سيتم إرسال رسائل تشجيعية آمنة إلى (${absentMembersList.length}) مشتركين غائبين.\n\n🛡️ نظام الأمان مفعل: فواصل زمنية متغيرة 4-7 ثوانٍ لمنع الحظر. هل تريد المتابعة؟`)) {
        return;
    }

    waQueue = [...absentMembersList];
    isWaQueueRunning = true;
    stopWaQueueFlag = false;

    openModal('whatsappBulkModal');
    processNextInBulkQueue(0, waQueue.length);
}

function stopBulkWhatsAppQueue() {
    stopWaQueueFlag = true;
    isWaQueueRunning = false;
    closeModal('whatsappBulkModal');
    showToast('تم إيقاف طابور الإرسال', 'info');
}

async function processNextInBulkQueue(currentIndex, totalCount) {
    if (stopWaQueueFlag || currentIndex >= totalCount) {
        const statusEl = document.getElementById('bulk-queue-status');
        if (statusEl) statusEl.textContent = '🎉 اكتملت عملية الإرسال بنجاح!';
        setTimeout(() => closeModal('whatsappBulkModal'), 2000);
        showToast(`تم إتمام إرسال رسائل التحفيز بنجاح!`, 'success');
        return;
    }

    const currentMember = waQueue[currentIndex];
    const recipientEl = document.getElementById('bulk-current-recipient');
    const progressText = document.getElementById('bulk-progress-text');
    const progressBar = document.getElementById('bulk-progress-bar');
    const countdownEl = document.getElementById('bulk-next-countdown');

    if (recipientEl) recipientEl.textContent = `${currentMember.name} (${currentMember.phone || 'بدون هاتف'})`;
    if (progressText) progressText.textContent = `${currentIndex + 1} / ${totalCount}`;
    if (progressBar) progressBar.style.width = `${Math.round(((currentIndex + 1) / totalCount) * 100)}%`;

    if (currentMember.phone) {
        const days = currentMember.days_since_last || 2;
        let msg = (waConfig.tplAbsence || "وحشتنا في TOP FITNESS يا {NAME}! 🏋️🔥")
            .replace(/{NAME}/g, currentMember.name)
            .replace(/{ABSENCE_DAYS}/g, days);
        
        // إرسال جماعي: لازم يعدي على الواتساب المتصل فقط.
        // فتح رابط لكل مشترك كان هيفتح عشرات التبويبات في وش المستخدم.
        await waAutoSend(currentMember.phone, currentMember.name, 'absence', msg);
    }

    // Safe delay between 4 to 7 seconds
    const delaySecs = Math.floor(Math.random() * 4) + 4; // 4 to 7
    let remain = delaySecs;

    const timer = setInterval(() => {
        if (stopWaQueueFlag) {
            clearInterval(timer);
            return;
        }
        remain--;
        if (countdownEl) countdownEl.textContent = `⏳ فاصل أمان قبل الرسالة القادمة: ${remain} ثوانٍ...`;
        if (remain <= 0) {
            clearInterval(timer);
            processNextInBulkQueue(currentIndex + 1, totalCount);
        }
    }, 1000);
}

// --- Connection Heartbeat (خادم محلي فقط) ---
// في النسخة السحابية (GitHub Pages) مفيش /api/ خالص، فالنبضة دي كانت
// بتطلع 404 كل شوية وتسيب لافتة "غير متصل" ظاهرة على طول.
// كمان مفتاح الخادم المحلي لازم ما يتحطش في ملف عام — بيتقرا من متغير
// بيحطه البناء المحلي بس.
if (window.location.protocol !== 'file:' && !window.__TF_CLOUD__ && window.__TF_LOCAL_API_KEY__) {
    setInterval(async () => {
        try {
            const res = await fetch(`${window.location.origin}/api/ping`, {
                headers: { 'Authorization': 'Bearer ' + window.__TF_LOCAL_API_KEY__ }
            });
            const banner = document.getElementById('connection-status');
            if (banner) {
                if (res.ok) {
                    if (banner.style.display === 'block') {
                        banner.style.display = 'none';
                        if (typeof showToast === 'function') showToast('تم استعادة الاتصال بالخادم بنجاح.', 'success');
                        document.body.classList.remove('offline-mode');
                    }
                } else {
                    banner.style.display = 'block';
                    document.body.classList.add('offline-mode');
                }
            }
        } catch (e) {
            const banner = document.getElementById('connection-status');
            if (banner) {
                banner.style.display = 'block';
                document.body.classList.add('offline-mode');
            }
        }
    }, 5000);
}

// --- WHATSAPP BAILEYS LOGIC ---
let waPollTimer = null;

async function pollWaStatus() {
    if (!window.electronAPI || !window.electronAPI.getWhatsAppStatus) return;
    
    const modal = document.getElementById('whatsAppSettingsModal');
    if (!modal || modal.style.display === 'none') {
        clearInterval(waPollTimer);
        return;
    }

    try {
        const res = await window.electronAPI.getWhatsAppStatus();
        const statusEl = document.getElementById('wa-connection-status');
        const qrContainer = document.getElementById('wa-qr-container');
        const qrImg = document.getElementById('wa-qr-img');
        const logoutBtn = document.getElementById('wa-logout-btn');
        const reconnectBtn = document.getElementById('wa-reconnect-btn');
        
        if (res.status === 'connecting') {
            statusEl.textContent = '⏳ جاري تجهيز اتصال الواتساب وإنشاء QR...';
            statusEl.style.color = '#38bdf8';
            qrContainer.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (reconnectBtn) reconnectBtn.style.display = 'inline-block';
        } else if (res.status === 'qrcode') {
            statusEl.textContent = '📲 يرجى مسح الـ QR Code من تطبيق واتساب بهاتفك الآن';
            statusEl.style.color = '#eab308';
            if (res.qr) {
                qrImg.src = res.qr;
                qrContainer.style.display = 'flex';
            }
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (reconnectBtn) reconnectBtn.style.display = 'inline-block';
        } else if (res.status === 'connected') {
            statusEl.textContent = '✅ متصل بنجاح وجاهز للإرسال التلقائي الصامت!';
            statusEl.style.color = '#10b981';
            qrContainer.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            if (reconnectBtn) reconnectBtn.style.display = 'none';
        } else {
            statusEl.textContent = '❌ غير متصل - اضغط على (بدء الربط) لتوليد الـ QR Code';
            statusEl.style.color = '#ef4444';
            qrContainer.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (reconnectBtn) reconnectBtn.style.display = 'inline-block';
        }
    } catch (e) {
        (()=>{})('Failed to poll WA status:', e);
    }
}

async function handleWaReconnect() {
    const statusEl = document.getElementById('wa-connection-status');
    if (statusEl) {
        statusEl.textContent = '⏳ جاري إنشاء QR Code جديد...';
        statusEl.style.color = '#38bdf8';
    }
    if (window.electronAPI && window.electronAPI.reconnectWhatsApp) {
        await window.electronAPI.reconnectWhatsApp();
        pollWaStatus();
    } else if (window.electronAPI && window.electronAPI.getWhatsAppStatus) {
        pollWaStatus();
    }
}

async function handleWaLogout() {
    if (window.electronAPI && window.electronAPI.logoutWhatsApp) {
        await window.electronAPI.logoutWhatsApp();
        showToast('تم تسجيل الخروج بنجاح', 'success');
        pollWaStatus();
    }
}

// Hook into openWhatsAppSettingsModal
const originalOpenWhatsAppSettingsModal = openWhatsAppSettingsModal;
openWhatsAppSettingsModal = function() {
    originalOpenWhatsAppSettingsModal();
    if (window.electronAPI && window.electronAPI.getWhatsAppStatus) {
        pollWaStatus();
        if (waPollTimer) clearInterval(waPollTimer);
        waPollTimer = setInterval(pollWaStatus, 1500);
    }
};
