// SPDX-License-Identifier: AGPL-3.0-only
import type {Locale} from './copy';

export const installCopy = {
  en: {
    button: 'Install web app',
    title: 'Studio, one click away',
    description: 'Add ServerNet Studio to your desktop or home screen as a web app. It uses your existing ServerNet account, but may require signing in again. No installer is needed.',
    chrome: 'Open the Chrome menu (⋮), then select Cast, save and share → Install page as app. On Android, use Add to Home screen or Install app if available.',
    edge: 'Open the Edge menu (⋯) → Apps → Install this site as an app.',
    mac: 'In Safari on macOS Sonoma 14 or later, choose File → Add to Dock.',
    ios: 'In Safari, tap Share → Add to Home Screen. If offered, turn on Open as Web App, then tap Add.',
    fallback: 'Menu names and installation availability depend on your browser version and device. You can always use Studio in your browser.',
    limits: 'An internet connection is required. Installing the web app does not enable native mouse, keyboard or desktop connections.',
    done: 'Done',
    close: 'Close',
  },
  fa: {
    button: 'نصب برنامه وب',
    title: 'استودیو، فقط یک کلیک دورتر',
    description: 'سرورنت استودیو را به‌صورت برنامه وب به دسکتاپ یا صفحه اصلی دستگاه اضافه کنید. با همان حساب سرورنت کار می‌کند، اما ممکن است نیاز به ورود مجدد باشد. نیازی به دانلود نصب‌کننده نیست.',
    chrome: 'از منوی کروم (⋮)، گزینه Cast, save and share و سپس Install page as app را انتخاب کنید. در اندروید، در صورت وجود از Add to Home screen یا Install app استفاده کنید.',
    edge: 'در منوی اِج (⋯)، گزینه Apps و سپس Install this site as an app را انتخاب کنید.',
    mac: 'در سافاری در macOS Sonoma 14 یا جدیدتر، از منوی File گزینه Add to Dock را انتخاب کنید.',
    ios: 'در سافاری، روی Share و سپس Add to Home Screen بزنید. اگر گزینه Open as Web App وجود دارد، آن را فعال و سپس Add را انتخاب کنید.',
    fallback: 'نام منوها و امکان نصب به نسخه مرورگر و دستگاه بستگی دارد. همیشه می‌توانید استودیو را در مرورگر استفاده کنید.',
    limits: 'اتصال اینترنت ضروری است. نصب برنامه وب دسترسی بومی به ماوس، صفحه‌کلید یا دسکتاپ ایجاد نمی‌کند.',
    done: 'متوجه شدم',
    close: 'بستن',
  },
  tr: {
    button: 'Web uygulamasını yükle',
    title: 'Studio, bir tık uzağınızda',
    description: 'ServerNet Studio’yu web uygulaması olarak masaüstünüze veya ana ekranınıza ekleyin. Mevcut ServerNet hesabınız kullanılır; yeniden oturum açmanız gerekebilir. Kurulum dosyası gerekmez.',
    chrome: 'Chrome menüsünü (⋮) açın; Yayınla, kaydet ve paylaş → Sayfayı uygulama olarak yükle seçeneğini kullanın. Android’de varsa Ana ekrana ekle veya Uygulamayı yükle seçeneğini kullanın.',
    edge: 'Edge menüsünden (⋯) Uygulamalar → Bu siteyi uygulama olarak yükle seçeneğini seçin.',
    mac: 'macOS Sonoma 14 veya sonraki sürümlerde Safari’de Dosya → Dock’a ekle seçeneğini kullanın.',
    ios: 'Safari’de Paylaş → Ana Ekrana Ekle’ye dokunun. Varsa Web Uygulaması Olarak Aç seçeneğini etkinleştirin ve Ekle’ye dokunun.',
    fallback: 'Menü adları ve yükleme desteği tarayıcı sürümüne ve cihaza göre değişir. Studio’yu her zaman tarayıcınızda kullanabilirsiniz.',
    limits: 'İnternet bağlantısı gerekir. Web uygulaması yerel fare, klavye veya masaüstü bağlantılarını etkinleştirmez.',
    done: 'Tamam',
    close: 'Kapat',
  },
} satisfies Record<Locale, Record<string, string>>;
