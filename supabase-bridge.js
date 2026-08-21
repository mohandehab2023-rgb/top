// علامة إن دي النسخة السحابية: بتقفل أي كود مخصص للخادم المحلي
window.__TF_CLOUD__ = true;

// ============================================================================
// TOP FITNESS — Supabase Bridge (Complete Polyfill for Web Deployment)
// Version: 2.0 — Full audit, all 60+ IPC methods implemented.
//
// هذا الملف يعمل فقط عند فتح الواجهة من المتصفح (Vercel / GitHub Pages).
// عند فتح البرنامج من الـ EXE، لا يتدخل إطلاقاً.
// ============================================================================

(function () {
    'use strict';

    // ─── 1. الاكتشاف ─────────────────────────────────────────────────
    const isRealElectron = !!(window.process && window.process.versions && window.process.versions.electron);
    if (isRealElectron) return; // ← نحن في EXE الحقيقي، لا نتدخل.

    // ─── 2. Supabase Client ──────────────────────────────────────────
    function fatal(msg) {
        try { delete window.electronAPI; } catch (e) { window.electronAPI = undefined; }
        document.documentElement.innerHTML =
            '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;' +
            'background:#0f172a;color:#e2e8f0;font-family:Tajawal,sans-serif;direction:rtl;text-align:center">' +
            '<div style="max-width:420px;padding:32px"><div style="font-size:44px;margin-bottom:12px">⚠️</div>' +
            '<h2 style="color:#f87171;margin:0 0 10px">تعذّر تشغيل النظام</h2>' +
            '<p style="color:#94a3b8;line-height:1.7">' + msg + '</p></div></body>';
        throw new Error(msg);
    }

    if (!window.supabase || !window.supabase.createClient) {
        fatal('مكتبة الاتصال مااتحملتش. حدّث الصفحة، ولو المشكلة فضلت راجع اتصالك بالإنترنت.');
    }

    const cfg = window.TF_CONFIG || {};
    const SUPABASE_URL = cfg.SUPABASE_URL;
    const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        fatal('إعدادات الاتصال ناقصة (config.js). راجع ملف الإعدادات.');
    }

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseClient = sb;

    // ─── 3. Helper: UUID Generator ───────────────────────────────────
    const uuid = () => crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

    const cloudUser = (email) => ({
        username: email,
        name: email ? email.split('@')[0] : 'Cloud Admin',
        role: 'admin',
        gender: 'all'
    });

    const today = () => new Date().toISOString().split('T')[0];
    const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

    const toEmail = (v) => {
        const s = String(v == null ? '' : v).trim();
        return (s && !s.includes('@')) ? s + '@gmail.com' : s;
    };

    // ─── 4. The Complete API (mirrors preload.js 1:1) ────────────────
    const api = {

        // ═══════════════════════════════════════════════════════════════
        //  AUTHENTICATION
        // ═══════════════════════════════════════════════════════════════
        logout: async () => {
            try { await sb.auth.signOut(); } catch(e) {}
            try { localStorage.clear(); sessionStorage.clear(); } catch(e) {}
        },
        verifyLogin: async ({ username, password }) => {
            const email = toEmail(username);
            const { data: { session } } = await sb.auth.getSession();
            if (session && session.user && session.user.email === email) {
                return cloudUser(session.user.email);
            }
            const { data, error } = await sb.auth.signInWithPassword({
                email: email,
                password: password
            });
            if (error) return null;
            return cloudUser(data.user.email);
        },

        // ═══════════════════════════════════════════════════════════════
        //  CONFIG
        // ═══════════════════════════════════════════════════════════════
        getConfig: async () => ({
            gymName: 'TOP FITNESS',
            printerName: '',
            receiptFooter: 'Cloud Mode',
            premiumFeatureEnabled: true,
            cloudMode: true
        }),
        saveConfig: async () => {},

        // ═══════════════════════════════════════════════════════════════
        //  USERS
        // ═══════════════════════════════════════════════════════════════
        getUsers: async () => {
            const { data: { session } } = await sb.auth.getSession();
            const email = session && session.user ? session.user.email : '';
            return email ? [cloudUser(email)] : [];
        },
        addUser: async () => {},
        updateUser: async () => {},
        deleteUser: async () => {},
        changePassword: async () => ({ success: false, message: 'غير متاح من الويب' }),

        // ═══════════════════════════════════════════════════════════════
        //  MEMBERS
        // ═══════════════════════════════════════════════════════════════
        getMembers: async () => {
            const { data, error } = await sb.from('members').select('*');
            if (error) return [];
            return data || [];
        },
        addMember: async (m) => {
            if (!m.id) m.id = 'M-' + Date.now();
            const { error } = await sb.from('members').insert(m);
            if (error) throw new Error(error.message);
        },
        updateMember: async (m) => {
            const { error } = await sb.from('members').update(m).eq('id', m.id);
            if (error) throw new Error(error.message);
        },
        deleteMember: async (id) => {
            const { error } = await sb.from('members').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },
        updatePremiumBalance: async (id, newBalance, lastCheckin) => {
            const { error } = await sb.from('members').update({
                sessions_balance: newBalance,
                last_checkin: lastCheckin
            }).eq('id', id);
            if (error) throw new Error(error.message);
        },
        consumeSession: async (id, lastCheckin) => {
            const stamp = lastCheckin || new Date().toISOString();
            for (let attempt = 0; attempt < 5; attempt++) {
                const { data: cur, error: readErr } = await sb
                    .from('members').select('sessions_balance').eq('id', id).maybeSingle();
                if (readErr) throw new Error(readErr.message);
                if (!cur) return { ok: false, reason: 'not_found', balance: null };

                const currentBal = Number(cur.sessions_balance) || 0;
                if (currentBal <= 0) return { ok: false, reason: 'zero_balance', balance: 0 };

                const nextBal = currentBal - 1;
                const { data: updated, error: updErr } = await sb
                    .from('members')
                    .update({ sessions_balance: nextBal, last_checkin: stamp })
                    .eq('id', id)
                    .eq('sessions_balance', currentBal)
                    .select('sessions_balance');

                if (updErr) throw new Error(updErr.message);
                if (updated && updated.length > 0) {
                    return { ok: true, balance: nextBal };
                }
                await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
            }
            return { ok: false, reason: 'conflict_retry_exhausted', balance: null };
        },

        // ═══════════════════════════════════════════════════════════════
        //  PACKAGES
        // ═══════════════════════════════════════════════════════════════
        getPackages: async () => {
            const { data, error } = await sb.from('packages').select('*');
            if (error) return [];
            return data || [];
        },
        addPackage: async (p) => {
            if (!p.id) p.id = 'P-' + Date.now();
            const { error } = await sb.from('packages').insert(p);
            if (error) throw new Error(error.message);
        },
        updatePackage: async (p) => {
            const { error } = await sb.from('packages').update(p).eq('id', p.id);
            if (error) throw new Error(error.message);
        },
        deletePackage: async (id) => {
            const { error } = await sb.from('packages').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },

        // ═══════════════════════════════════════════════════════════════
        //  EXPENSES & REVENUES
        // ═══════════════════════════════════════════════════════════════
        getExpenses: async (filters) => {
            let q = sb.from('expenses').select('*');
            if (filters) {
                if (filters.startDate) q = q.gte('timestamp', filters.startDate);
                if (filters.endDate) q = q.lte('timestamp', filters.endDate);
                if (filters.category && filters.category !== 'all') q = q.eq('category', filters.category);
            }
            const { data, error } = await q.order('timestamp', { ascending: false });
            if (error) return [];
            return data || [];
        },
        addExpense: async (e) => {
            if (!e.id) e.id = 'EXP-' + Date.now();
            const { error } = await sb.from('expenses').insert(e);
            if (error) throw new Error(error.message);
        },
        updateExpense: async (e) => {
            const { error } = await sb.from('expenses').update(e).eq('id', e.id);
            if (error) throw new Error(error.message);
        },
        deleteExpense: async (id) => {
            const { error } = await sb.from('expenses').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },
        getRevenues: async (filters) => {
            let q = sb.from('revenues').select('*');
            if (filters) {
                if (filters.startDate) q = q.gte('timestamp', filters.startDate);
                if (filters.endDate) q = q.lte('timestamp', filters.endDate);
                if (filters.category && filters.category !== 'all') q = q.eq('category', filters.category);
            }
            const { data, error } = await q.order('timestamp', { ascending: false });
            if (error) return [];
            return data || [];
        },
        addRevenue: async (r) => {
            if (!r.id) r.id = 'REV-' + Date.now();
            const { error } = await sb.from('revenues').insert(r);
            if (error) throw new Error(error.message);
        },
        deleteRevenue: async (id) => {
            const { error } = await sb.from('revenues').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },

        // ═══════════════════════════════════════════════════════════════
        //  ATTENDANCE
        // ═══════════════════════════════════════════════════════════════
        getAttendance: async (filters) => {
            let q = sb.from('attendance').select('*');
            if (filters) {
                if (filters.startDate) q = q.gte('timestamp', filters.startDate);
                if (filters.endDate) q = q.lte('timestamp', filters.endDate + ' 23:59:59');
                if (filters.type && filters.type !== 'all') q = q.eq('user_type', filters.type);
            }
            const { data, error } = await q.order('timestamp', { ascending: false }).limit(500);
            if (error) return [];
            return data || [];
        },
        logAttendance: async (att) => {
            if (!att.id) att.id = 'ATT-' + Date.now();
            const { error } = await sb.from('attendance').insert(att);
            if (error) throw new Error(error.message);
        },

        // ═══════════════════════════════════════════════════════════════
        //  TRAINERS & EMPLOYEES
        // ═══════════════════════════════════════════════════════════════
        getTrainers: async () => {
            const { data, error } = await sb.from('trainers').select('*');
            if (error) return [];
            return data || [];
        },
        addTrainer: async (t) => {
            if (!t.id) t.id = 'TR-' + Date.now();
            const { error } = await sb.from('trainers').insert(t);
            if (error) throw new Error(error.message);
        },
        updateTrainer: async (t) => {
            const { error } = await sb.from('trainers').update(t).eq('id', t.id);
            if (error) throw new Error(error.message);
        },
        deleteTrainer: async (id) => {
            const { error } = await sb.from('trainers').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },
        getEmployees: async () => {
            const { data, error } = await sb.from('employees').select('*');
            if (error) return [];
            return data || [];
        },
        addEmployee: async (e) => {
            if (!e.id) e.id = 'EMP-' + Date.now();
            const { error } = await sb.from('employees').insert(e);
            if (error) throw new Error(error.message);
        },
        updateEmployee: async (e) => {
            const { error } = await sb.from('employees').update(e).eq('id', e.id);
            if (error) throw new Error(error.message);
        },
        deleteEmployee: async (id) => {
            const { error } = await sb.from('employees').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },

        // ═══════════════════════════════════════════════════════════════
        //  STORE & POS
        // ═══════════════════════════════════════════════════════════════
        getStoreProducts: async () => {
            const { data } = await sb.from('store_products').select('*');
            return data || [];
        },
        addStoreProduct: async (p) => {
            if (!p.id) p.id = 'SP-' + Date.now();
            await sb.from('store_products').insert(p);
        },
        updateStoreProduct: async (p) => {
            await sb.from('store_products').update(p).eq('id', p.id);
        },
        deleteStoreProduct: async (id) => {
            await sb.from('store_products').delete().eq('id', id);
        },
        createStoreSale: async (saleData) => {
            try {
                const saleId = 'SS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                const now = new Date().toISOString();
                const { items, buyerType, buyerName, buyerId, totalAmount, username, notes } = saleData || {};

                // 1. Insert into store_sales
                const { error: saleErr } = await sb.from('store_sales').insert({
                    id: saleId,
                    sale_date: now,
                    total_amount: Number(totalAmount || 0),
                    buyer_type: buyerType || 'walkin',
                    buyer_name: buyerName || 'عميل زائر',
                    buyer_id: buyerId || null,
                    username: username || 'admin',
                    notes: notes || ''
                });
                if (saleErr) {
                    console.error('store_sales insert error:', saleErr);
                }

                // 2. خصم المخزون — نفس ضمانات نسخة الديسكتوب
                if (Array.isArray(items) && items.length) {
                    const wanted = items.filter(i => i.productId && Number(i.quantity) > 0);
                    const ids = [...new Set(wanted.map(i => i.productId))];

                    // قراءة واحدة لكل الأصناف بدل قراءة لكل صنف
                    const { data: prods } = await sb.from('store_products')
                        .select('id, name, stock').in('id', ids);
                    const stockOf = new Map((prods || []).map(p => [p.id, p]));

                    // كل صنف بيتخصم بتحديث مشروط بقيمته القديمة. لو حد تاني
                    // باع نفس الصنف في نفس اللحظة، الشرط بيفشل فنعيد القراءة
                    // والمحاولة بدل ما نكتب فوق تحديثه.
                    const decrement = async (item) => {
                        const qty = parseInt(item.quantity, 10) || 0;
                        for (let attempt = 0; attempt < 4; attempt++) {
                            let row = attempt === 0 ? stockOf.get(item.productId) : null;
                            if (!row) {
                                const { data } = await sb.from('store_products')
                                    .select('id, name, stock').eq('id', item.productId).single();
                                row = data;
                            }
                            if (!row) return;                       // صنف اتمسح
                            const have = parseInt(row.stock, 10) || 0;
                            const next = Math.max(0, have - qty);
                            const { data: updated } = await sb.from('store_products')
                                .update({ stock: next })
                                .eq('id', item.productId)
                                .eq('stock', row.stock)             // ما نكتبش فوق تحديث غيرنا
                                .select('id');
                            if (updated && updated.length) return;  // نجح
                        }
                        console.warn('تعذّر خصم مخزون الصنف بعد عدة محاولات:', item.productId);
                    };

                    // التحديثات على التوازي بدل ورا بعض
                    await Promise.all(wanted.map(decrement));
                }

                // 3. Insert items into store_sale_items if table exists
                if (Array.isArray(items)) {
                    const saleItems = items.map((it, idx) => ({
                        id: 'SSI-' + Date.now() + '-' + idx,
                        sale_id: saleId,
                        product_id: it.productId,
                        product_name: it.productName || '',
                        quantity: Number(it.quantity || 1),
                        unit_price: Number(it.unitPrice || 0),
                        total_price: Number(it.totalPrice || 0)
                    }));
                    await sb.from('store_sale_items').insert(saleItems).catch(() => {});
                }

                return { success: true, saleId };
            } catch (err) {
                console.error('createStoreSale error:', err);
                return { success: false, error: err.message };
            }
        },
        getStoreSales: async (filters) => {
            const { data } = await sb.from('store_sales').select('*')
                .order('sale_date', { ascending: false }).limit(200);
            return data || [];
        },

        // ═══════════════════════════════════════════════════════════════
        //  WORKOUT & DIET PLANS
        // ═══════════════════════════════════════════════════════════════
        addCoachingReport: async (report) => {
            const r = report || {};
            const { error } = await sb.from('coaching_reports').insert({
                id: r.id || ('report_' + Date.now()),
                member_id: r.member_id,
                timestamp: r.timestamp || new Date().toISOString(),
                weight: r.weight, body_fat: r.body_fat, muscle_mass: r.muscle_mass,
                target: r.target, diet_calories: r.diet_calories,
                diet_meals: JSON.stringify(r.diet_meals || []),
                workout_phase: r.workout_phase,
                workout_days: JSON.stringify(r.workout_days || []),
                notes: r.notes
            });
            if (error) throw new Error(error.message);
            return true;
        },
        getCoachingReports: async (memberId) => {
            const { data, error } = await sb.from('coaching_reports')
                .select('*').eq('member_id', memberId).order('timestamp', { ascending: false });
            if (error) return [];
            return (data || []).map(r => ({
                ...r,
                diet_meals: typeof r.diet_meals === 'string' ? JSON.parse(r.diet_meals || '[]') : r.diet_meals,
                workout_days: typeof r.workout_days === 'string' ? JSON.parse(r.workout_days || '[]') : r.workout_days
            }));
        },

        // ═══════════════════════════════════════════════════════════════
        //  TRASH (Recycle Bin)
        // ═══════════════════════════════════════════════════════════════
        getTrash: async () => {
            const { data } = await sb.from('trash').select('*')
                .order('deleted_at', { ascending: false }).limit(500);
            return data || [];
        },
        addTrash: async (item) => {
            await sb.from('trash').insert(item);
        },
        restoreTrash: async (id) => {
            const { data: rows, error: readErr } = await sb.from('trash').select('*').eq('id', id).limit(1);
            if (readErr || !rows || !rows.length) return false;
            const item = rows[0];
            let d;
            try { d = typeof item.item_data === 'string' ? JSON.parse(item.item_data) : item.item_data; }
            catch (e) { return false; }
            if (!d || !d.id) return false;

            const TARGET = {
                member: 'members', expense: 'expenses', revenue: 'revenues',
                trainer: 'trainers', employee: 'employees'
            };
            const table = TARGET[item.type];
            if (!table) return false;

            const { error: insErr } = await sb.from(table).upsert(d);
            if (insErr) return false;

            await sb.from('trash').delete().eq('id', id);
            return true;
        },
        deleteTrashPermanent: async (id) => {
            await sb.from('trash').delete().eq('id', id);
        },

        // ═══════════════════════════════════════════════════════════════
        //  WHATSAPP & HARDWARE
        // ═══════════════════════════════════════════════════════════════
        getWhatsAppStatus: async () => 'غير متصل (وضع السحابة)',
        reconnectWhatsApp: async () => {},
        logoutWhatsApp: async () => {},
        sendWhatsApp: async (phone, message) => {
            // إرسال الأمر لسحابة Supabase ليتم التقاطه بواسطة الديسك توب
            const { error } = await sb.from('whatsapp_queue').insert({
                recipient_phone: phone,
                message_text: message,
                status: 'pending'
            });
            if (error) {
                console.error('فشل إرسال أمر الواتساب للسحابة:', error);
                return false; // للرجوع للطريقة اليدوية (فتح الرابط)
            }
            
            if (typeof showToast === 'function') {
                showToast('✅ تم إرسال الأمر بنجاح، سيقوم الديسك توب بإرسالها في الخلفية.', 'success');
            }
            return true;
        },
        getWhatsAppLogs: async (filters) => {
            let q = sb.from('whatsapp_messages').select('*');
            if (filters && filters.type && filters.type !== 'all') {
                q = q.eq('message_type', filters.type);
            }
            const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
            if (error) return [];
            return data || [];
        },
        logWhatsAppMessage: async (data) => {
            if (!data) return;
            const row = {
                id: data.id || ('WA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
                recipient_phone: String(data.phone || data.recipient_phone || ''),
                recipient_name: data.name || data.recipient_name || '',
                message_type: data.type || data.message_type || 'manual',
                message_text: data.message || data.message_text || '',
                status: data.status || 'sent',
                created_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
            };
            await sb.from('whatsapp_messages').insert(row);
        },
        getZkStatus: async () => 'غير متصل (وضع السحابة)',
        connectZk: async () => {},
        disconnectZk: async () => {},
        getZkUsers: async () => [],
        getNextZkId: async () => ({ nextId: 999 }),
        isZkIdFree: async () => true,
        deleteZkUser: async () => {},
        onZkLog: () => {},
        onWaStatus: () => {},

        // تحديث حيّ: لما أي جهاز تاني يعدّل بيانات، الواجهة هنا تعرف وتحدّث
        // نفسها. من غير الدالة دي كان الـ Proxy بيرجّع [] فالكولباك ما
        // بيتسجّلش أصلاً، والموقع بيفضل عارض بيانات قديمة لحد ريفريش يدوي.
        onSyncUpdate: (callback) => {
            if (typeof callback !== 'function') return;
            if (syncChannel) return;   // اشتراك واحد يكفي
            const tables = ['members', 'transactions', 'expenses', 'packages',
                            'store_sales', 'attendance'];
            syncChannel = sb.channel('web-sync-updates');
            tables.forEach(t => {
                syncChannel.on('postgres_changes',
                    { event: '*', schema: 'public', table: t },
                    () => {
                        // تجميع: عدة تعديلات ورا بعض تعمل تحديث واحد
                        clearTimeout(syncDebounce);
                        syncDebounce = setTimeout(() => { try { callback(); } catch (e) {} }, 400);
                    });
            });
            syncChannel.subscribe();
        },

        // على الديسكتوب دي بتتنادى عشان يبعت الواتساب (هو اللي متصل بيه).
        // في المتصفح مفيش واتساب متصل — الإرسال بيتم بوضع الرسالة في
        // whatsapp_queue والديسكتوب بياخدها. فلو نفّذنا الكولباك هنا كمان
        // كانت الرسالة هتتبعت مرتين. فدي بتتسجّل ومش بتتنادى، بقصد.
        onRemoteWhatsapp: () => {},

        // ═══════════════════════════════════════════════════════════════
        //  ACTIVITY LOG
        // ═══════════════════════════════════════════════════════════════
        getActivity: async (filters) => {
            let q = sb.from('activity_log').select('*');
            if (filters) {
                if (filters.startDate) q = q.gte('timestamp', filters.startDate);
                if (filters.endDate) q = q.lte('timestamp', filters.endDate + ' 23:59:59');
                if (filters.username && filters.username !== 'all') q = q.eq('username', filters.username);
                if (filters.action && filters.action !== 'all') q = q.eq('action', filters.action);
                if (filters.targetId) q = q.eq('target_id', filters.targetId);
            }
            const { data, error } = await q.order('timestamp', { ascending: false }).limit(1000);
            if (error) return [];
            return data || [];
        },

        // ═══════════════════════════════════════════════════════════════
        //  MISC
        // ═══════════════════════════════════════════════════════════════
        openExternalUrl: (url) => window.open(url, '_blank'),
        printReceipt: async () => { alert('الطباعة غير متاحة من المتصفح.'); },
        backupDatabase: async () => { alert('النسخ الاحتياطي متاح فقط من الكمبيوتر.'); },
        getMachineId: async () => 'WEB-MODE',
        activateLicense: async () => ({ success: true }),
        relaunchApp: async () => window.location.reload(),

        // ═══ المالية والحضور والدعوات والخطط ═══
        // اترجعت بعد ما أداة التجويف شالتها. بدونها الموقع مبيعملش تقارير
        // مالية ولا دفعات ولا حضور مدربين/موظفين ولا دعوات ولا خطط.
        getTransactions: async (filters) => {
            let q = sb.from('transactions').select('*').order('timestamp', { ascending: false }).limit(500);
            // filters could be a date string for "today"
            if (filters && typeof filters === 'string') {
                q = q.gte('timestamp', filters);
            }
            const { data } = await q;
            return data || [];
        },
        getMonthlyRevenue: async (months = 6) => {
            const { data } = await sb.from('transactions').select('amount, timestamp')
                .order('timestamp', { ascending: false }).limit(5000);
            if (!data) return [];
            const buckets = {};
            data.forEach(t => {
                const m = (t.timestamp || '').substring(0, 7);
                if (m) buckets[m] = (buckets[m] || 0) + (t.amount || 0);
            });
            return Object.keys(buckets).sort().reverse().slice(0, months)
                .map(m => ({ month_key: m, total: buckets[m] }));
        },
        getDailyRevenue: async (days = 7) => {
            const { data } = await sb.from('transactions').select('amount, timestamp')
                .order('timestamp', { ascending: false }).limit(2000);
            if (!data) return [];
            const buckets = {};
            data.forEach(t => {
                const d = (t.timestamp || '').split('T')[0].split(' ')[0];
                if (d) buckets[d] = (buckets[d] || 0) + (t.amount || 0);
            });
            return Object.keys(buckets).sort().reverse().slice(0, days)
                .map(d => ({ day: d, total: buckets[d] }));
        },
        getMemberTransactions: async (memberId) => {
            const { data } = await sb.from('transactions').select('*').eq('member_id', memberId).order('timestamp', { ascending: false });
            return data || [];
        },
        addTransaction: async (t) => {
            if (!t.id) t.id = 'TX-' + Date.now();
            await sb.from('transactions').insert(t);
        },
        addPayment: async (payment) => {
            const p = payment || {};
            const amount = Number(p.amount);
            if (!p.member_id) return { success: false, error: 'بيانات الدفعة ناقصة' };
            if (!isFinite(amount) || amount <= 0) {
                return { success: false, error: 'مبلغ الدفعة يجب أن يكون أكبر من صفر' };
            }

            for (let attempt = 0; attempt < 5; attempt++) {
                const { data: cur, error: readErr } = await sb
                    .from('members').select('price, paid').eq('id', p.member_id).maybeSingle();
                if (readErr) throw new Error(readErr.message);
                if (!cur) return { success: false, error: 'المشترك غير موجود' };

                const price = Number(cur.price || 0);
                const paid = Number(cur.paid || 0);
                const remaining = Math.max(0, price - paid);
                if (remaining <= 0) return { success: false, error: 'لا توجد مديونية على هذا المشترك' };
                if (amount > remaining + 0.001) {
                    return { success: false, error: `المبلغ أكبر من المتبقي (${remaining} ج.م)` };
                }

                const { data, error } = await sb.from('members')
                    .update({ paid: paid + amount })
                    .eq('id', p.member_id)
                    .eq('paid', cur.paid)          // الشرط: محدش دفع ورايا
                    .select('price, paid');
                if (error) throw new Error(error.message);
                if (!data || !data.length) continue;   // حد سبقنا — اقرا من جديد

                // الإيصال بعد ما الرصيد اتحدّث بنجاح، مش قبله
                const { error: txErr } = await sb.from('transactions').insert({
                    id: p.id || ('PAY-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
                    member_id: p.member_id,
                    amount: amount,
                    pkg: p.pkg || 'سداد مديونية',
                    timestamp: p.timestamp || new Date().toISOString(),
                    username: p.username || 'cloud'
                });
                if (txErr) {
                    // نرجّع الرصيد لأن الإيصال مااتسجلش
                    await sb.from('members').update({ paid: paid }).eq('id', p.member_id);
                    throw new Error(txErr.message);
                }

                const after = data[0];
                return {
                    success: true,
                    paid: Number(after.paid || 0),
                    remaining: Math.max(0, Number(after.price || 0) - Number(after.paid || 0))
                };
            }
            return { success: false, error: 'الرصيد بيتغيّر من مكان تاني — حاول تاني' };
        },
        getDebtors: async () => {
            const { data } = await sb.from('members').select('*');
            if (!data) return [];
            return data.filter(m => (m.paid || 0) < (m.price || 0));
        },
        getFinancialSummary: async (opts) => {
            const o = opts || {};
            const mode = o.mode || 'day';
            let from, to, label;
            if (mode === 'month') {
                const ym = String(o.date || new Date().toISOString().slice(0, 7));
                const [y, m] = ym.split('-').map(Number);
                from = ym + '-01';
                to = ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
                label = 'شهر ' + ym;
            } else if (mode === 'range') {
                from = String(o.from || o.date || '').slice(0, 10);
                to = String(o.to || o.date || '').slice(0, 10);
                label = 'من ' + from + ' إلى ' + to;
            } else {
                const d = String(o.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
                from = to = d;
                label = 'يوم ' + d;
            }
            // تحويل التواريخ المحلية إلى UTC لمطابقة التخزين في Supabase
            // مثال: اليوم 21 أغسطس بتوقيت مصر (UTC+3) يبدأ من 20 أغسطس 21:00 UTC
            const localStart = new Date(from + 'T00:00:00');
            const localEnd   = new Date(to   + 'T23:59:59');
            const lo = localStart.toISOString();
            const hi = localEnd.toISOString();

            const pull = async (table, col) => {
                const { data, error } = await sb.from(table).select('*').gte(col, lo).lte(col, hi);
                if (error) { console.error('[Cloud] تقرير ' + table + ':', error.message); return []; }
                return data || [];
            };

            const [subs, salesRaw, external, expenses] = await Promise.all([
                pull('transactions', 'timestamp'),
                pull('store_sales', 'sale_date'),
                // الجدول الحي اسمه revenues مش external_revenues (شوف الملاحظة في main.js)
                pull('revenues', 'timestamp'),
                pull('expenses', 'timestamp')
            ]);
            // نوحّد اسم عمود الوقت والمبلغ زي البرنامج المكتبي
            const sales = salesRaw.map(s => Object.assign({}, s, { timestamp: s.sale_date, amount: s.total_amount }));

            const filterMine = (rows) => o.username ? rows.filter(r => r.username === o.username) : rows;
            const S = filterMine(subs), SA = filterMine(sales), EX = filterMine(external), EP = filterMine(expenses);

            const sum = (rows) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
            const subsTotal = sum(S), salesTotal = sum(SA), extTotal = sum(EX), expTotal = sum(EP);
            const income = subsTotal + salesTotal + extTotal;

            let daily = [];
            if (mode !== 'day') {
                const byDay = {};
                const add = (rows, key) => rows.forEach(r => {
                    const d = String(r.timestamp || '').slice(0, 10);
                    if (!d) return;
                    byDay[d] = byDay[d] || { date: d, subs: 0, sales: 0, external: 0, expenses: 0 };
                    byDay[d][key] += Number(r.amount) || 0;
                });
                add(S, 'subs'); add(SA, 'sales'); add(EX, 'external'); add(EP, 'expenses');
                daily = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
                    .map(d => Object.assign(d, { income: d.subs + d.sales + d.external, net: d.subs + d.sales + d.external - d.expenses }));
            }

            return {
                ok: true, mode, from, to, label,
                income: { subscriptions: subsTotal, store: salesTotal, external: extTotal, total: income },
                expenses: { total: expTotal },
                net: income - expTotal,
                counts: { subs: S.length, sales: SA.length, external: EX.length, expenses: EP.length },
                rows: { subs: S, sales: SA, external: EX, expenses: EP },
                daily
            };
        },
        addAttendance: async (att) => {
            if (!att.id) att.id = 'ATT-' + Date.now();
            await sb.from('attendance').insert(att);
        },
        getAttendanceDaily: async (days = 7) => {
            const { data } = await sb.from('attendance').select('timestamp')
                .order('timestamp', { ascending: false }).limit(2000);
            if (!data) return [];
            const buckets = {};
            data.forEach(a => {
                // تحويل التوقيت من UTC إلى التوقيت المحلي قبل التجميع اليومي
                const raw = a.timestamp || '';
                let d;
                if (raw.includes('T') || raw.includes('Z')) {
                    d = new Date(raw).toLocaleDateString('en-CA'); // YYYY-MM-DD local
                } else {
                    d = raw.split(' ')[0];
                }
                if (d) buckets[d] = (buckets[d] || 0) + 1;
            });
            return Object.keys(buckets).sort().reverse().slice(0, days)
                .map(d => ({ day: d, total: buckets[d] }));
        },
        getTrainerAttendance: async (filters) => {
            let q = sb.from('trainer_attendance').select('*').order('date', { ascending: false }).limit(200);
            const { data } = await q;
            return data || [];
        },
        addTrainerAttendance: async (att) => {
            if (!att.id) att.id = 'TATT-' + Date.now();
            await sb.from('trainer_attendance').insert(att);
        },
        updateTrainerAttendance: async (att) => {
            await sb.from('trainer_attendance').update(att).eq('id', att.id);
        },
        deleteTrainerAttendance: async (id) => {
            await sb.from('trainer_attendance').delete().eq('id', id);
        },
        getEmployeeAttendance: async (filters) => {
            let q = sb.from('employee_attendance').select('*').order('date', { ascending: false }).limit(200);
            const { data } = await q;
            return data || [];
        },
        addEmployeeAttendance: async (att) => {
            if (!att.id) att.id = 'EATT-' + Date.now();
            await sb.from('employee_attendance').insert(att);
        },
        updateEmployeeAttendance: async (att) => {
            await sb.from('employee_attendance').update(att).eq('id', att.id);
        },
        deleteEmployeeAttendance: async (id) => {
            await sb.from('employee_attendance').delete().eq('id', id);
        },
        getExternalRevenues: async () => {
            // نفس الحكاية: الإيرادات الخارجية عمودها timestamp مش date
            const { data } = await sb.from('external_revenues').select('*').order('timestamp', { ascending: false });
            return data || [];
        },
        addExternalRevenue: async (r) => {
            if (!r.id) r.id = 'REV-' + Date.now();
            await sb.from('external_revenues').insert(r);
        },
        deleteExternalRevenue: async (id) => {
            await sb.from('external_revenues').delete().eq('id', id);
        },
        getInvitations: async () => {
            const { data } = await sb.from('invitations').select('*').order('id', { ascending: false });
            return data || [];
        },
        addInvitation: async (inv) => {
            if (!inv.id) inv.id = 'INV-' + Date.now();
            await sb.from('invitations').insert(inv);
        },
        updateInvitationStatus: async (id, status) => {
            await sb.from('invitations').update({ status }).eq('id', id);
        },
        deleteInvitation: async (id) => {
            await sb.from('invitations').delete().eq('id', id);
        },
        getMemberPlans: async (memberId) => {
            const { data } = await sb.from('member_plans').select('*').eq('member_id', memberId);
            return data || [];
        },
        saveMemberPlan: async (plan) => {
            if (!plan.id) plan.id = 'PLAN-' + Date.now();
            await sb.from('member_plans').upsert(plan, { onConflict: 'id' });
        },
        deleteMemberPlan: async (id) => {
            await sb.from('member_plans').delete().eq('id', id);
        },
        getAbsentMembers: async (daysThreshold) => {
            const { data: members } = await sb.from('members').select('*').eq('status', 'active');
            if (!members) return [];
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (daysThreshold || 7));
            return members.filter(m => {
                if (!m.last_checkin) return true;
                return new Date(m.last_checkin) < cutoff;
            });
        },
    };

    // حالة اشتراك التحديث الحيّ
    let syncChannel = null;
    let syncDebounce = null;

    // ─── 5. Proxy ───────────────────────────────────────────────────
    window.electronAPI = new Proxy(api, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return async (...args) => [];
        }
    });

    // ─── 6. Auth Guard: شاشة دخول احترافية ──────────────────────────
    async function enforceAuth() {
        const { data: { session } } = await sb.auth.getSession();
        if (session) return; // مسجل دخول بالفعل

        const overlay = document.createElement('div');
        overlay.id = 'cloud-auth-overlay';
        overlay.innerHTML = `
            <style>
                #cloud-auth-overlay input:focus {
                    border-color: #3b82f6 !important;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3) !important;
                    background: rgba(15, 23, 42, 0.9) !important;
                }
                #cloud-login-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px rgba(59, 130, 246, 0.4);
                }
                #cloud-login-btn:active {
                    transform: translateY(0);
                }
                @keyframes fade-in-up {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .cloud-auth-card {
                    animation: fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
            </style>
            <div style="
                position:fixed; inset:0; z-index:99999;
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                display:flex; align-items:center; justify-content:center;
                font-family: 'Tajawal', sans-serif; direction: rtl;
            ">
                <div class="cloud-auth-card" style="
                    background: rgba(30,41,59,0.9); backdrop-filter: blur(12px);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
                    padding: 40px; width: 90%; max-width: 380px; text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                ">
                    <img src="assets/icon.png" alt="TOP FITNESS" style="width: 80px; margin-bottom: 16px; border-radius: 16px;"
                         onerror="this.style.display='none'">
                    <h1 style="color: #3b82f6; font-size: 1.6rem; margin-bottom: 6px;">TOP FITNESS</h1>
                    <p style="color: #94a3b8; margin-bottom: 24px; font-size: 0.9rem;">Cloud Management Portal</p>
                    <input id="cloud-email" type="text" autocomplete="username" placeholder="اسم المستخدم"
                           style="width:100%; padding:12px 16px; margin-bottom:12px;
                                  background:rgba(15,23,42,0.7); border:1px solid rgba(255,255,255,0.15);
                                  border-radius:10px; color:#fff; font-size:1rem; outline:none;
                                  text-align:center; transition: all 0.2s ease;" />
                    <input id="cloud-pass" type="password" placeholder="كلمة المرور"
                           style="width:100%; padding:12px 16px; margin-bottom:16px;
                                  background:rgba(15,23,42,0.7); border:1px solid rgba(255,255,255,0.15);
                                  border-radius:10px; color:#fff; font-size:1rem; outline:none;
                                  text-align:center; transition: all 0.2s ease;" />
                    <button id="cloud-login-btn"
                            style="width:100%; padding:12px; border:none; border-radius:10px;
                                   background:linear-gradient(135deg, #3b82f6, #2563eb);
                                   color:#fff; font-size:1rem; font-weight:700; cursor:pointer;
                                   transition: all 0.2s ease;">
                        تسجيل الدخول
                    </button>
                    <p id="cloud-error" style="color:#ef4444; font-size:0.85rem; margin-top:12px; display:none;"></p>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const doLogin = async () => {
            const rawUser = document.getElementById('cloud-email').value;
            const email = toEmail(rawUser);
            const pass = document.getElementById('cloud-pass').value;
            const errEl = document.getElementById('cloud-error');
            const btn = document.getElementById('cloud-login-btn');

            if (!email || !pass) { 
                errEl.textContent = 'أدخل اسم المستخدم وكلمة المرور'; 
                errEl.style.display = 'block'; 
                return; 
            }

            btn.textContent = 'جاري التحقق…';
            btn.disabled = true;

            const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) {
                errEl.textContent = 'بيانات الدخول غير صحيحة';
                errEl.style.display = 'block';
                btn.textContent = 'تسجيل الدخول';
                btn.disabled = false;
            } else {
                overlay.remove();
                window.location.reload();
            }
        };

        document.getElementById('cloud-login-btn').addEventListener('click', doLogin);

        document.getElementById('cloud-email').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const passInput = document.getElementById('cloud-pass');
                if (passInput && !passInput.value) {
                    passInput.focus();
                } else {
                    doLogin();
                }
            }
        });

        document.getElementById('cloud-pass').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doLogin();
        });
    }

    // ─── 7. Session Refresh ─────────────────────────────────────────
    setInterval(async () => {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
            await sb.auth.refreshSession();
        }
    }, 30 * 60 * 1000);

    // ─── 8. تخطّي شاشة الدخول الداخلية ───────────────────────────────
    document.head.insertAdjacentHTML('beforeend', '<style>#loginOverlay { opacity: 0 !important; pointer-events: none !important; z-index: -9999 !important; visibility: hidden !important; }</style>');
    
    async function skipLocalLogin() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session || !session.user) return;

        for (let i = 0; i < 40; i++) {
            const overlay = document.getElementById('loginOverlay');
            const sel = document.getElementById('login-user');
            const pass = document.getElementById('login-pass');

            if (overlay && sel && pass && typeof window.attemptLogin === 'function') {
                sel.innerHTML = '<option value="' + session.user.email + '">admin</option>';
                sel.value = session.user.email;
                pass.value = '***';
                await window.attemptLogin();
                // Ensure it is completely hidden after successful login
                overlay.style.display = 'none';
                overlay.classList.remove('show-local-login');
                return;
            }
            await new Promise(r => setTimeout(r, 250));
        }
    }

    setTimeout(async () => {
        await enforceAuth();
        skipLocalLogin();
    }, 500);

})();
