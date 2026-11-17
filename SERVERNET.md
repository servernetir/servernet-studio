# ServerNet Studio

محصول ابری مشتریان سرورنت: ورود با همان حساب کنسول یا گوگل، مدل‌های AI Gateway، مصرف از کیف پول همان حساب و رابط فارسی IRANSans با انگلیسی و ترکی.

**ورودی محصول مشتری:** `servernet/hosted`، `servernet/web` و کلاینت مستقل `servernet/desktop`؛ [راهنمای نسخهٔ اختصاصی](servernet/WHITE_LABEL.md).
موتور محلی و Desktop upstream در این مرحله ورودی عمومی مشتری نیستند. قابلیت فعال این نسخه چت متنی است؛ رسانه و آموزش مدل هنوز worker و قرارداد مصرف مستقل می‌خواهند.

| بخش | وضعیت |
| --- | --- |
| رابط اختصاصی ServerNet، fa/en/tr و CSS فونت IRANSans | کد و build آماده؛ فونت از نصب موجود سرورنت mount می‌شود |
| ورود حساب، گوگل و ثبت‌نام مرکزی با PKCE و کلید محدود مشتری | دو طرف پیاده‌سازی شده؛ سمت کنسول در [PR323](https://github.com/servernetir/server/pull/323)، پیش‌فرض خاموش |
| موجودی، مصرف، شارژ و گفتگو | API موجودی خواندنی، مصرف واقعی Gateway، شارژ در کنسول، تاریخچهٔ جدا برای هر مشتری |
| آزمون برنامه مشتری و connector | ۵۲ آزمون HTTP ساختگی و۸آزمون desktop موفق؛ build TypeScript/Vite موفق |
| نسخهٔ نصبی مستقل | ZIP آزمایشی مک Intel/Apple Silicon و ویندوز x64 ساخته شد؛ NSIS نیازمند اجرای Windows CI، امضا و پذیرش واقعی باقی است |
| مخزن GitHub Studio | fork ساخته شده؛ دسترسی نوشتن در ادامهٔ نشست باز شد؛ انتشار develop و CI در حال انجام است |
| استقرار و مالی زنده | اجرا نشده؛ نصب، دامنه و پذیرش خصوصی لازم است |

برای اجرا، Dockerfile و `servernet/compose.yaml`، تنظیمات نمونهٔ بدون راز و دستورهای راهنما را ببینید.
برای تست: `python -m pip install -r servernet/requirements-test.txt` و `python -m pytest -c servernet/pytest.ini servernet/tests -q`.
Frontend مشتری: `cd servernet/web && npm ci --ignore-scripts && npm run build`.

مجوز و اعلان‌های مؤلفان اولیه در سورس حفظ شده‌اند. صفحات عادی محصول برند ServerNet دارند؛ صفحهٔ `/legal` محل اعلان‌های حقوقی و دریافت سورس متناظر است. هستهٔ upstream را فقط در مسیرهای داخلی/workerهای ایزوله ادامه دهید؛ ابزار محلی یا دسترسی مدیر را برای ورود مشتری عمومی نکنید.
