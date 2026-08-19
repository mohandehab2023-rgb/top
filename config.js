// ============================================================================
// TOP FITNESS — إعدادات الاتصال بالسحابة
// ============================================================================
// ده الملف الوحيد اللي بتعدّله لو غيّرت مشروع Supabase.
// باقي ملفات الموقع مالهاش دعوة بالمفاتيح خالص.
//
// ⚠️ المفتاح ده عام (anon) ومقصود إنه يتنشر — مالوش أي صلاحية لوحده.
//    كل الجداول محمية بـ RLS، يعني من غير تسجيل دخول مش بيقرا ولا بيكتب أي حاجة.
//    ممنوع منعاً باتاً تحط هنا مفتاح service_role — ده مفتاح أدمن بيتخطى الحماية.
// ============================================================================

window.TF_CONFIG = {
    SUPABASE_URL: 'https://vgisfimzyncjutwtejfx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnaXNmaW16eW5janV0d3RlamZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MjA1MTIsImV4cCI6MjEwMjQ5NjUxMn0.tkY_ChY7UPHMjqAVO0XRPkavx879eH-tM8kg2MB2yRw'
};
