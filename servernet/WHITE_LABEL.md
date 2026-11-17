# ServerNet Studio — نسخهٔ مشتری

این نسخه یک رابط ابری اختصاصی ServerNet است؛ فایل اجرایی/نصب‌کنندهٔ Desktop اصلی هنوز بازطراحی نشده است.
ورودی مشتری، پوشهٔ `servernet/web` و backend آن `servernet/hosted` است. همین نسخه را برای مشتری منتشر کنید، نه backend محلی upstream.

## رفتار پیاده‌شده

- نام، نشان، صفحه ورود، فضای گفتگو، موجودی و لینک‌های محصول ServerNet هستند. در صفحات عادی مشتری نام و تصویر برند upstream وجود ندارد. اعلان‌های مؤلف/مجوز در سورس و صفحهٔ جداگانهٔ حقوقی باقی می‌مانند.
- فارسی راست‌به‌چپ با IRANSans و نسخهٔ انگلیسی و ترکی؛ فونت از مسیر محلی `/assets/fonts/` بارگیری می‌شود. فایل‌های فونت موجود در پروژه سرورنت به صورت read-only نصب می‌شوند و داخل مخزن/آرشیو عمومی این نسخه کپی نمی‌شوند.
- حساب جدا یا API Key دستی لازم نیست؛ ورود حساب، ادامه با گوگل و ثبت‌نام از همان مسیرهای فعلی کنسول سرورنت انجام می‌شود؛ پس از ثبت‌نام یا ورود، کاربر به تأیید دسترسی Studio برمی‌گردد. رمز، OTP و کلیدهای تأمین‌کنندگان وارد Studio نمی‌شوند.
- code یک‌بارمصرف با PKCE و state متصل به مرورگر با کلید AI محدود همان مشتری تعویض می‌شود. کلید فقط در backend و به صورت رمز‌شده ذخیره می‌شود؛ cookie نشست HttpOnly و Secure و host-only است.
- مدل‌ها از کاتالوگ Gateway دریافت می‌شوند. چت متنی جریانی و هزینهٔ واقعی از Gateway است. مبلغ، موجودی قابل استفاده، رزرو و توکن مصرفی ماهانه در واحدهای جدا نمایش داده می‌شوند؛ شارژ در کنسول است.
- گفتگوهای دائمی به شناسهٔ مشتری متصل‌اند. هر درخواست شناسهٔ پایدار دارد؛ بازپخش جواب موفق هزینهٔ تازه ایجاد نمی‌کند. timeout، قطع استریم یا نبود رویداد نهایی صورتحساب، درخواست را برای بررسی نگه می‌دارد و خودکار ارسال نمی‌کند.

## مرز قابلیت‌ها

نسخهٔ مشتری فعلی **چت متنی Gateway** را ارائه می‌کند. رابط رسانه، آموزش مدل و امکانات محلی upstream در این ورودی مشتری وجود ندارند. این قابلیت‌ها برای ارائه عمومی، worker و سهمیه و صورتحساب جدا لازم دارند؛ پروژه هنوز آن‌ها را به‌عنوان خدمت فعال عرضه نمی‌کند. سورس موتور upstream حفظ شده و می‌توان بعداً آن را در worker ایزوله متصل کرد.
کلیدهای فعلی Studio به دلیل این محدوده فقط `ai:models:read`، `ai:chat` و `ai:wallet:read` دارند. هیچ کلید مدیر یا توکن wildcard به مشتری داده نمی‌شود.

## آماده‌سازی نصب

1. ابتدا تغییر SSO در مخزن `servernetir/server` بررسی و آزمون شود؛ migration جدید grant لازم است. feature تا پذیرش خصوصی خاموش بماند.
2. دامنهٔ پیشنهادی `studio.servernet.cloud` است، نه دامنهٔ نصب‌شده/آمادهٔ این نشست. HTTPS و reverse proxy باید به سرویس خصوصی پورت۸۷۸۷ وصل شوند.
3. در دو backend، یک client secret تصادفی حداقل۳۲نویسه و callback دقیق `https://<studio-host>/auth/callback` تنظیم کنید. کلید رمزگذاری نشست مستقل بسازید: `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`. خروجی فقط در secret manager/فایل خصوصی محیط ذخیره شود.
4. فایل `servernet/.env.example` را به فایل خصوصی `.env` کپی و مقادیر را جایگزین کنید. کلید رمزگذاری را هنگام restart عوض نکنید؛ تغییر آن نشست‌های موجود را غیرقابل‌خواندن می‌کند. مجوز پوشهٔ `runtime` باید فقط برای UID۱۰۰۰۱ سرویس باشد.
5. سه فایل کامل `IRANSans-web.woff2`، `IRANSans-Medium-web.woff2` و `IRANSans-Bold-web.woff2` از نصب فعلی سرورنت در مسیر mount‌شده موجود باشند. فونت در build مرورگر embed نمی‌شود.
6. از ریشهٔ مخزن: `docker compose --env-file servernet/.env -f servernet/compose.yaml up -d --build`. Docker build در این نشست اجرا نشده است.
7. پراکسی باید streaming را بدون buffering عبور دهد؛ log مسیر callback، query code و بدنهٔ exchange خاموش/پاک‌سازی شود. سرویس فقط پشت HTTPS منتشر شود. عنوان/مجوز و سورس متناظر همان commit در `/legal` در دسترس باشند.
8. با یک حساب آزمایشی، ورود حساب/گوگل، ثبت‌نام جدید با همان الزامات فعلی سایت و برگشت به Studio، ورود دومرحله‌ای، خروج، جداسازی دو حساب، دریافت مدل/موجودی، کسر واقعی یک درخواست با سقف تعیین‌شده و انطباق ledger/usage پذیرفته شود. سپس لینک محصول در کنسول عرضه شود.

## آزمون‌های انجام‌شده

`python -m pytest -c servernet/pytest.ini servernet/tests -q`: ۵۲ آزمون موفق در زمان آماده‌سازی. همهٔ تماس‌های خارجی fake هستند.
`npm ci --ignore-scripts` و `npm run build` در `servernet/web`: موفق؛ TypeScript و Vite.
آزمون مرورگر Chromium محلی به دلیل محدودیت ایجاد socket محیط اجرا نشد؛ مشاهدهٔ واقعی موبایل، دسترس‌پذیری و بارگیری فونت باید در پذیرش UI انجام شود. build جای این پذیرش را نمی‌گیرد.
کد PHP با parser دستور زبان بررسی شد؛ این محیط PHP ندارد و نتیجهٔ Laravel باید از CI/محیط آزمایشی تأیید شود.
نصب تولید، تنظیم DNS و درخواست پولی انجام نشده‌اند.

سمت Laravel در [PR323](https://github.com/servernetir/server/pull/323) ثبت شده است. روی SHA `07399493da48da2670b5959a770507cce79db93f`،۲۱تست/۱۶۵بررسی SSO و Gateway و هر۱۴گردش مرتبط GitHub موفق شدند. این تأیید CI است، نه نصب تولید. ثبت کد مشتری در مخزن جدید هنوز با خطای403 اتصال متوقف است.

تکمیل گوگل: CI روی `2382ddcedbeab4ef89f40f6daff0d8de836a7a9e` در run `44057595824`،۷۵تست/۹۸۵بررسی ورود، ثبت‌نام، SSO و Gateway را موفق گذراند؛ هنوز نصب زنده و آزمون واقعی گوگل انجام نشده‌اند.

## کلاینت نصبی مستقل

[راهنمای Desktop](desktop/README.md) تنظیمات و شواهد نسخهٔ0.2.0 را شرح می‌دهد. ZIPهای آزمایشی سه معماری ساخته شده‌اند؛ نسخهٔ TEST برای انتشار عمومی نیست. فایل Desktop upstream همچنان دست‌نخورده است و نباید آن را به جای کلاینت `servernet/desktop` توزیع کرد.

Update: the owner completed GitHub installation confirmation and granted repository access later in this session. Creating the new develop branch from the tested baseline succeeded. Source publication and native CI are proceeding; earlier 403 observations above describe the earlier state. The cPanel session is authenticated. No production installation or paid request has been performed.
