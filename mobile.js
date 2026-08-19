// ============================================================================
// TOP FITNESS — طبقة الموبايل
// ============================================================================
// الغرض: تحويل واجهة مبنية للكمبيوتر لتجربة تطبيق موبايل حقيقية، من غير
// تعديل script.js (اللي مشترك مع نسخة سطح المكتب).
//
// بتعالج ٣ حاجات الـ CSS لوحده مش قادر يعملها:
//   ١. جداول ٥-١١ عمود  ->  كروت مكدّسة (محتاج نقرا العناوين ونلزقها على الخلايا)
//   ٢. ٢١ قسم في شريط بيسكرول  ->  ٥ أقسام + زر "المزيد" بيفتح لوحة
//   ٣. الجداول بتترسم من جديد باستمرار  ->  مراقب بيعيد التجهيز تلقائياً
//
// كل الكود هنا بيشتغل على الموبايل بس. على الشاشات الكبيرة بيخرج فوراً.
// ============================================================================

(function () {
    'use strict';

    const MOBILE_MAX = 768;
    const isMobile = () => window.innerWidth <= MOBILE_MAX;

    // الأقسام اللي تستاهل مكان دايم في الشريط السفلي.
    // الباقي بيتنقل للوحة "المزيد" — أهم من إن المستخدم يسكرول ويدوّر.
    const PRIMARY = ['dashboard', 'members', 'store', 'daily-reports'];

    // أسماء الأقسام في الشريط طويلة ("الرئيسية والإحصائيات") وبتتداخل مع بعض
    // في خانة عرضها ~72px. بنستخدم أسماء قصيرة في الشريط السفلي بس —
    // لوحة "كل الأقسام" بتفضل بالأسماء الكاملة.
    const SHORT_LABEL = {
        'dashboard': 'الرئيسية',
        'members': 'المشتركين',
        'store': 'المتجر',
        'daily-reports': 'التقارير'
    };

    // ─────────────────────────────────────────────────────────────────
    // ١) الجداول -> كروت
    // ─────────────────────────────────────────────────────────────────
    // بنقرا عناوين <thead> ونحطها على كل <td> في data-label، وبعدين الـ CSS
    // بيحوّل كل صف لكارت والعنوان بيظهر جنب القيمة.
    // كده أي جدول في النظام بيتحوّل تلقائياً من غير ما نلمس دوال الرسم.
    function labelTable(table) {
        if (!table || table.dataset.mobileReady === '1') return;

        const heads = [...table.querySelectorAll('thead th')].map(th =>
            (th.textContent || '').trim()
        );
        if (!heads.length) return;

        table.querySelectorAll('tbody tr').forEach(tr => {
            // صفوف الرسايل ("لا توجد بيانات") ليها خلية واحدة ممتدة — نسيبها
            const cells = tr.children;
            if (cells.length <= 1) {
                tr.classList.add('m-row-message');
                return;
            }
            for (let i = 0; i < cells.length; i++) {
                if (heads[i] && !cells[i].hasAttribute('data-label')) {
                    cells[i].setAttribute('data-label', heads[i]);
                }
            }
        });

        table.dataset.mobileReady = '1';
    }

    function labelAllTables() {
        if (!isMobile()) return;
        document.querySelectorAll('table').forEach(labelTable);
    }

    // الجداول بتتملي بـ innerHTML بعد كل تحميل، فالعناوين بتتمسح.
    // المراقب ده بيعيد التجهيز أول ما أي tbody يتغير.
    function watchTables() {
        // الصفحة فيها ٢٣ جدول. قبل كده أي تغيير في أي حتة (إشعار، نافذة،
        // رسم بياني) كان بيشغّل المرور على الجداول كلها فوراً — تهنيج على
        // الموبايل. دلوقتي بنجمّع التغييرات وننفّذها مرة واحدة قبل الرسم.
        let pending = null;
        let sweepAll = false;

        function flush() {
            pending = null;
            if (!isMobile()) { sweepAll = false; return; }
            if (sweepAll) { sweepAll = false; labelAllTables(); return; }
        }

        const obs = new MutationObserver(muts => {
            if (!isMobile()) return;
            for (const m of muts) {
                const t = m.target;
                const table = t && t.closest ? t.closest('table') : null;
                if (table) {
                    delete table.dataset.mobileReady;   // اتغيّر المحتوى، جهّزه من جديد
                    labelTable(table);
                    continue;
                }
                // جدول جديد اتضاف؟ ساعتها بس نمرّ على الكل.
                for (const node of m.addedNodes || []) {
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'TABLE' || (node.querySelector && node.querySelector('table'))) {
                        sweepAll = true;
                        break;
                    }
                }
            }
            if (sweepAll && !pending) pending = requestAnimationFrame(flush);
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // ─────────────────────────────────────────────────────────────────
    // ٢) الشريط السفلي: ٥ أقسام + لوحة "المزيد"
    // ─────────────────────────────────────────────────────────────────
    function sectionOf(link) {
        const m = (link.getAttribute('onclick') || '').match(/switchSection\('([a-z-]+)'/);
        return m ? m[1] : null;
    }

    function buildMoreSheet() {
        if (document.getElementById('m-more-sheet')) return;

        const navList = document.querySelector('.nav-list');
        if (!navList) return;

        // لوحة منزلقة من تحت فيها كل الأقسام
        const sheet = document.createElement('div');
        sheet.id = 'm-more-sheet';
        sheet.innerHTML =
            '<div class="m-sheet-backdrop"></div>' +
            '<div class="m-sheet-panel">' +
            '  <div class="m-sheet-grip"></div>' +
            '  <div class="m-sheet-title">كل الأقسام</div>' +
            '  <div class="m-sheet-grid"></div>' +
            '</div>';
        document.body.appendChild(sheet);

        const grid = sheet.querySelector('.m-sheet-grid');
        const links = [...navList.querySelectorAll('.nav-link')];
        const seen = new Set();

        links.forEach(link => {
            const sec = sectionOf(link);
            if (!sec || seen.has(sec)) return;   // بعض الروابط بتشاور على نفس القسم
            seen.add(sec);

            const item = document.createElement('button');
            item.className = 'm-sheet-item';
            item.type = 'button';
            const icon = link.querySelector('svg');
            const label = (link.textContent || '').trim().replace(/\s+/g, ' ');
            item.innerHTML = (icon ? icon.outerHTML : '') + '<span>' + label + '</span>';
            item.addEventListener('click', () => {
                closeSheet();
                if (typeof window.switchSection === 'function') window.switchSection(sec, link);
                syncActive();
            });
            grid.appendChild(item);
        });

        sheet.querySelector('.m-sheet-backdrop').addEventListener('click', closeSheet);
    }

    function openSheet() {
        const s = document.getElementById('m-more-sheet');
        if (s) { s.classList.add('open'); document.body.style.overflow = 'hidden'; }
    }
    function closeSheet() {
        const s = document.getElementById('m-more-sheet');
        if (s) { s.classList.remove('open'); document.body.style.overflow = ''; }
    }

    function buildBottomNav() {
        const navList = document.querySelector('.nav-list');
        if (!navList || document.getElementById('m-more-btn')) return;

        // نعلّم الأقسام الأساسية عشان الـ CSS يظهرها ويخفي الباقي،
        // ونستبدل الاسم الطويل بالقصير في الشريط بس.
        navList.querySelectorAll('.nav-link').forEach(link => {
            const sec = sectionOf(link);
            if (sec && PRIMARY.includes(sec) && !navList.querySelector(`[data-m-primary="${sec}"]`)) {
                link.setAttribute('data-m-primary', sec);
                const short = SHORT_LABEL[sec];
                if (short) {
                    // البنية: <span class="nav-icon">أيقونة</span><span>التسمية</span>
                    // بنغيّر الـ span اللي مش أيقونة بس، عشان الأيقونة تفضل.
                    const labelSpan = [...link.querySelectorAll('span')]
                        .find(sp => !sp.classList.contains('nav-icon'));
                    if (labelSpan) labelSpan.textContent = short;
                    // وننضّف أي عقد نصية سايبة جنب الـ spans عشان الاسم ما يتكررش
                    [...link.childNodes]
                        .filter(n => n.nodeType === 3 && n.textContent.trim())
                        .forEach(n => { n.textContent = ''; });
                }
            }
        });

        // زر "المزيد" كآخر عنصر في الشريط
        const more = document.createElement('a');
        more.id = 'm-more-btn';
        more.className = 'nav-link';
        more.setAttribute('data-m-primary', '__more');
        more.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/>' +
            '<circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>' +
            '<span>المزيد</span>';
        more.addEventListener('click', e => { e.preventDefault(); openSheet(); });
        navList.appendChild(more);
    }

    // القسم الحالي لو مش من الأساسية، نور زر "المزيد" بدل ما مفيش حاجة منوّرة
    function syncActive() {
        const more = document.getElementById('m-more-btn');
        if (!more) return;
        const active = document.querySelector('.view-section.active');
        const id = active ? active.id : '';
        more.classList.toggle('active', !PRIMARY.includes(id));
    }

    // ─────────────────────────────────────────────────────────────────
    // ٣) التشغيل
    // ─────────────────────────────────────────────────────────────────
    function init() {
        if (!isMobile()) return;
        document.documentElement.classList.add('is-mobile');
        // اللوحة الأول: بتقرا الأسماء الكاملة قبل ما الشريط يقصّرها
        buildMoreSheet();
        buildBottomNav();
        labelAllTables();
        watchTables();
        syncActive();

        // نتابع تغيير القسم عشان نظبّط التمييز
        document.addEventListener('click', () => setTimeout(syncActive, 60), true);

        // قفل اللوحة بزر الرجوع في الأندرويد
        window.addEventListener('popstate', closeSheet);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
    } else {
        setTimeout(init, 800);
    }

    // لو المستخدم لفّ الجهاز أو غيّر الحجم
    let rt = null;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
            if (isMobile() && !document.getElementById('m-more-btn')) init();
            document.documentElement.classList.toggle('is-mobile', isMobile());
        }, 250);
    });
})();
