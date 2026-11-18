// SPDX-License-Identifier: AGPL-3.0-only
import type {Field} from './catalog';
import type {Locale} from './copy';

export const inferenceCopy = {
  en: {
    free:'Free', thinking:'Analyzing your request…', modelsIntro:'Start a chat, create media, or get the API model ID.',
    classify:'Classification', model:'Model', all:'All models', api:'Use via API', chat:'Start chat', generate:'Create in chat',
    input:'Input', output:'Output', perMillion:'per 1M tokens', unavailable:'Rate unavailable',
    referencePrice:'Indicative unit price', quote:'Check price', generating:'Creating your output…',
    options:'Model settings', prompt:'Describe what to create…', text:'Text', add:'Add item', remove:'Remove',
    missing:'Complete the required fields.', quoteLimit:'Maximum reservation', approve:'Confirm and generate',
    refresh:'Check status',
    unknown:'The outcome is being checked. You can refresh its status here.', failed:'The generation could not be completed.',
    priceChanged:'Price changed. Request a fresh quote.', nothing:'A playable result is not available. Check the request in the console.',
    expired:'This local result has expired.', save:'Save output', openResult:'Open output', vision:'Attach image',
    analyze:'Analyze this screenshot.', useVision:'Choose a vision model to send this image.',
    renew:'Sign out and sign in again to authorize media generation.', fromChrome:'Screenshot from Chrome',
    tools:'MCP & Chrome', toolsHeading:'Connect Studio to your tools',
    browserHeading:'Chrome extension', browserText:'Preview a screenshot of the visible tab and attach it to a Studio chat. Send it when you are ready.',
    extension:'Download Chrome extension', install:'Extract the ZIP. Open Chrome Extensions, enable Developer mode and use Load unpacked.',
    mcpHeading:'Model Context Protocol', mcpText:'Use the read-only model catalog from an MCP client that supports Streamable HTTP with a Bearer key.',
    mcpKey:'Manage API keys', copy:'Copy', copied:'Copied', draftImage:'Image attachment',
    testMcp:'Check connection', mcpReady:'Connected · read-only model catalog', mcpError:'MCP connection unavailable.',
    imageError:'Unable to attach that image.', requestError:'Review the inputs and try again.', noFunds:'Your wallet has insufficient credit.',
    chooseFile:'Choose a file', fileReady:'File attached', fileError:'Unable to attach that file.',
  },
  fa: {
    free:'رایگان', thinking:'در حال بررسی و تحلیل درخواست…', modelsIntro:'گفتگو را شروع کنید، رسانه بسازید یا شناسهٔ مدل برای API را بگیرید.',
    classify:'دسته‌بندی', model:'مدل', all:'همهٔ مدل‌ها', api:'استفاده از API', chat:'شروع گفتگو', generate:'ساخت در گفتگو',
    input:'ورودی', output:'خروجی', perMillion:'به ازای یک میلیون توکن', unavailable:'نرخ در دسترس نیست',
    referencePrice:'تعرفهٔ تقریبی واحد', quote:'بررسی قیمت', generating:'در حال ساخت خروجی…',
    options:'تنظیمات مدل', prompt:'بگویید چه چیزی ساخته شود…', text:'متن', add:'افزودن مورد', remove:'حذف',
    missing:'فیلدهای الزامی را تکمیل کنید.', quoteLimit:'حداکثر مبلغ رزرو', approve:'تأیید و ساخت خروجی',
    refresh:'بررسی وضعیت',
    unknown:'نتیجه در حال بررسی است. وضعیت را از همین‌جا تازه کنید.', failed:'تولید خروجی کامل نشد.',
    priceChanged:'قیمت تغییر کرده است. قیمت تازه را بررسی کنید.', nothing:'خروجی قابل اجرا در دسترس نیست. درخواست را در کنسول بررسی کنید.',
    expired:'مهلت دسترسی به فایل محلی پایان یافته است.', save:'ذخیرهٔ خروجی', openResult:'باز کردن خروجی', vision:'پیوست تصویر',
    analyze:'این تصویر صفحه را تحلیل کن.', useVision:'برای ارسال تصویر یک مدل تصویری انتخاب کنید.',
    renew:'برای دادن مجوز تولید رسانه، یک‌بار خارج شوید و دوباره وارد شوید.', fromChrome:'تصویر صفحه از کروم',
    tools:'MCP و کروم', toolsHeading:'اتصال ابزارها به Studio',
    browserHeading:'افزونهٔ کروم', browserText:'از بخش دیده‌شدهٔ تب تصویر بگیرید، پیش‌نمایش را بررسی کنید و آن را به گفتگو پیوست کنید. ارسال تصویر با انتخاب شما انجام می‌شود.',
    extension:'دانلود افزونهٔ کروم', install:'ZIP را باز کنید. در صفحهٔ افزونه‌های کروم، حالت توسعه‌دهنده را روشن کنید و Load unpacked را بزنید.',
    mcpHeading:'پروتکل MCP', mcpText:'مرکز مدل‌ها را به‌صورت فقط‌خواندنی در کلاینت MCP با پشتیبانی از Streamable HTTP و کلید Bearer باز کنید.',
    mcpKey:'مدیریت کلیدهای API', copy:'کپی', copied:'کپی شد', draftImage:'تصویر پیوست',
    testMcp:'بررسی اتصال', mcpReady:'متصل · خواندن فهرست مدل‌ها', mcpError:'اتصال MCP در دسترس نیست.',
    imageError:'پیوست این تصویر ممکن نشد.', requestError:'ورودی‌ها را بررسی کنید و دوباره تلاش کنید.', noFunds:'اعتبار کیف پول کافی نیست.',
    chooseFile:'انتخاب فایل', fileReady:'فایل پیوست شد', fileError:'پیوست این فایل ممکن نشد.',
  },
  tr: {
    free:'Ücretsiz', thinking:'İsteğiniz analiz ediliyor…', modelsIntro:'Sohbet başlatın, medya üretin veya API model kimliğini alın.',
    classify:'Sınıflandırma', model:'Model', all:'Tüm modeller', api:'API ile kullan', chat:'Sohbet başlat', generate:'Sohbette oluştur',
    input:'Girdi', output:'Çıktı', perMillion:'1 milyon token başına', unavailable:'Kur kullanılamıyor',
    referencePrice:'Yaklaşık birim fiyatı', quote:'Fiyatı kontrol et', generating:'Çıktı oluşturuluyor…',
    options:'Model ayarları', prompt:'Ne oluşturulacağını açıklayın…', text:'Metin', add:'Öğe ekle', remove:'Kaldır',
    missing:'Zorunlu alanları doldurun.', quoteLimit:'En yüksek rezervasyon', approve:'Onayla ve oluştur',
    refresh:'Durumu kontrol et',
    unknown:'Sonuç kontrol ediliyor. Durumu buradan yenileyin.', failed:'Üretim tamamlanamadı.',
    priceChanged:'Fiyat değişti. Yeni fiyatı kontrol edin.', nothing:'Oynatılabilir çıktı yok. Konsoldaki isteği kontrol edin.',
    expired:'Yerel çıktı süresi doldu.', save:'Çıktıyı kaydet', openResult:'Çıktıyı aç', vision:'Görsel ekle',
    analyze:'Bu ekran görüntüsünü analiz et.', useVision:'Görsel göndermek için bir görsel anlama modeli seçin.',
    renew:'Medya üretimini yetkilendirmek için çıkış yapıp yeniden oturum açın.', fromChrome:'Chrome ekran görüntüsü',
    tools:'MCP ve Chrome', toolsHeading:'Studio’yu araçlarınıza bağlayın',
    browserHeading:'Chrome uzantısı', browserText:'Görünen sekmenin ekran görüntüsünü önizleyip Studio sohbetine ekleyin. Hazır olduğunuzda gönderin.',
    extension:'Chrome uzantısını indir', install:'ZIP’i çıkarın. Chrome Uzantılar sayfasında Geliştirici modunu açın ve Paketlenmemiş öğe yükle seçeneğini kullanın.',
    mcpHeading:'Model Context Protocol', mcpText:'Bearer anahtarı ve Streamable HTTP destekleyen bir MCP istemcisinden model kataloğunu salt okunur kullanın.',
    mcpKey:'API anahtarlarını yönet', copy:'Kopyala', copied:'Kopyalandı', draftImage:'Ekli görsel',
    testMcp:'Bağlantıyı denetle', mcpReady:'Bağlı · salt okunur model kataloğu', mcpError:'MCP bağlantısı kullanılamıyor.',
    imageError:'Görsel eklenemedi.', requestError:'Girdileri kontrol edip tekrar deneyin.', noFunds:'Cüzdan bakiyesi yetersiz.',
    chooseFile:'Dosya seç', fileReady:'Dosya eklendi', fileError:'Dosya eklenemedi.',
  },
};

type Translation = readonly [en: string, fa: string, tr: string];
const languageIndex = {en: 0, fa: 1, tr: 2} as const;
const translate = (values: Translation, locale: Locale) => values[languageIndex[locale]];

const fieldLabels: Record<string, Translation> = {
  absolute_max_tokens: ['Hard output token limit', 'سقف قطعی توکن خروجی', 'Kesin çıktı token sınırı'],
  aspect_ratio: ['Aspect ratio', 'نسبت تصویر', 'En-boy oranı'],
  audio: ['Audio', 'فایل صوتی', 'Ses dosyası'],
  audio_cover_strength: ['Source audio influence', 'تأثیر صدای مرجع', 'Kaynak ses etkisi'],
  auto_trim: ['Automatic trimming', 'برش خودکار', 'Otomatik kırpma'],
  background: ['Background', 'پس‌زمینه', 'Arka plan'],
  background_color: ['Background color', 'رنگ پس‌زمینه', 'Arka plan rengi'],
  bbox_list: ['Bounding boxes', 'کادرهای محدودکننده', 'Sınırlayıcı kutular'],
  bpm: ['Tempo (beats per minute)', 'تمپو (ضرب در دقیقه)', 'Tempo (dakikadaki vuruş)'],
  camera_fixed: ['Fixed camera', 'دوربین ثابت', 'Sabit kamera'],
  cfg: ['Prompt guidance strength (CFG)', 'شدت پایبندی به درخواست (CFG)', 'İsteme bağlılık düzeyi (CFG)'],
  chunk_length_s: ['Segment length (seconds)', 'طول بخش (ثانیه)', 'Bölüm uzunluğu (saniye)'],
  chunk_level: ['Segmentation level', 'سطح بخش‌بندی', 'Bölümleme düzeyi'],
  creativity: ['Creativity', 'خلاقیت', 'Yaratıcılık'],
  desired_increase: ['Upscaling factor', 'ضریب بزرگ‌نمایی', 'Büyütme katsayısı'],
  disable_prompt_upsampling: ['Disable prompt expansion', 'غیرفعال‌کردن گسترش درخواست', 'İstem genişletmeyi kapat'],
  disable_safety_checker: ['Disable safety checks', 'غیرفعال‌کردن بررسی ایمنی', 'Güvenlik denetimini kapat'],
  draft: ['Draft mode', 'حالت پیش‌نویس', 'Taslak modu'],
  driving_audio: ['Driving audio', 'صدای هدایت‌کننده', 'Yönlendirici ses'],
  duration: ['Duration (seconds)', 'مدت (ثانیه)', 'Süre (saniye)'],
  dynamic: ['Dynamics', 'پویایی', 'Dinamik'],
  enhance_prompt: ['Enhance prompt', 'بهبود درخواست', 'İstemi iyileştir'],
  enhance_ref_images: ['Enhance reference images', 'بهبود تصاویر مرجع', 'Referans görselleri iyileştir'],
  exaggeration: ['Expression intensity', 'شدت بیان', 'İfade yoğunluğu'],
  fast: ['Fast mode', 'حالت سریع', 'Hızlı mod'],
  first_clip: ['Starting clip', 'کلیپ آغازین', 'Başlangıç klibi'],
  first_frame: ['First frame', 'فریم اول', 'İlk kare'],
  first_frame_image: ['First-frame image', 'تصویر فریم اول', 'İlk kare görseli'],
  flow_edit: ['Edit toward the prompt', 'ویرایش طبق درخواست', 'İsteme göre düzenle'],
  flow_edit_source_caption: ['Source audio description', 'توضیح صدای اولیه', 'Kaynak ses açıklaması'],
  flow_edit_source_lyrics: ['Source lyrics', 'ترانهٔ اولیه', 'Kaynak şarkı sözleri'],
  force_background_detection: ['Force background detection', 'تشخیص اجباری پس‌زمینه', 'Arka plan algılamasını zorla'],
  fps: ['Frame rate (frames per second)', 'نرخ فریم (فریم بر ثانیه)', 'Kare hızı (saniyedeki kare)'],
  fractality: ['Fractal detail', 'جزئیات فراکتال', 'Fraktal ayrıntı'],
  frame_index: ['Frame index', 'شمارهٔ فریم', 'Kare indeksi'],
  generate_audio: ['Generate audio', 'تولید صدا', 'Ses oluştur'],
  generate_audio_switch: ['Generate audio', 'تولید صدا', 'Ses oluştur'],
  generate_multi_clip_switch: ['Allow multiple clips', 'تولید چند کلیپ', 'Birden çok klibe izin ver'],
  guidance_scale: ['Prompt guidance strength', 'شدت پایبندی به درخواست', 'İsteme bağlılık düzeyi'],
  height: ['Height', 'ارتفاع', 'Yükseklik'],
  image: ['Image', 'تصویر', 'Görsel'],
  image_urls: ['Reference images', 'تصاویر مرجع', 'Referans görseller'],
  images: ['Images', 'تصاویر', 'Görseller'],
  img_url: ['Image', 'تصویر', 'Görsel'],
  initial_prompt: ['Initial prompt', 'درخواست اولیه', 'İlk istem'],
  input: ['Input text', 'متن ورودی', 'Girdi metni'],
  input_image: ['Input image', 'تصویر ورودی', 'Girdi görseli'],
  instruct: ['Instruction', 'دستور', 'Talimat'],
  instruction: ['Instruction', 'دستور', 'Talimat'],
  instrumental: ['Instrumental', 'بی‌کلام', 'Enstrümantal'],
  ip_signal: ['Warn about possible intellectual property', 'هشدار مالکیت فکری احتمالی', 'Olası fikrî mülkiyet uyarısı'],
  item: ['Item', 'مورد', 'Öğe'],
  key_points: ['Control points', 'نقاط کنترلی', 'Kontrol noktaları'],
  language: ['Language', 'زبان', 'Dil'],
  language_code: ['Language', 'زبان', 'Dil'],
  language_id: ['Language code', 'کد زبان', 'Dil kodu'],
  last_frame: ['Last frame', 'فریم آخر', 'Son kare'],
  last_frame_image: ['Last-frame image', 'تصویر فریم آخر', 'Son kare görseli'],
  lyrics: ['Lyrics', 'متن ترانه', 'Şarkı sözleri'],
  mask: ['Mask', 'ماسک', 'Maske'],
  mask_type: ['Mask type', 'نوع ماسک', 'Maske türü'],
  match_image_size: ['Match input image size', 'هم‌اندازه با تصویر ورودی', 'Girdi görselinin boyutunu kullan'],
  max_audio_length_ms: ['Maximum audio length (milliseconds)', 'حداکثر مدت صدا (میلی‌ثانیه)', 'En uzun ses süresi (milisaniye)'],
  max_new_tokens: ['Maximum new tokens', 'حداکثر توکن تازه', 'En fazla yeni token'],
  max_tokens: ['Maximum tokens', 'حداکثر توکن', 'En fazla token'],
  media: ['Media references', 'رسانه‌های مرجع', 'Medya referansları'],
  min_p: ['Minimum sampling probability (Min P)', 'حداقل احتمال نمونه‌گیری (Min P)', 'En düşük örnekleme olasılığı (Min P)'],
  n: ['Number of outputs', 'تعداد خروجی', 'Çıktı sayısı'],
  negative_prompt: ['Exclude from the result', 'مواردی که باید از خروجی حذف شوند', 'Çıktıda yer almayacaklar'],
  num_images: ['Number of images', 'تعداد تصاویر', 'Görsel sayısı'],
  num_inference_steps: ['Generation steps', 'تعداد مراحل تولید', 'Üretim adımı sayısı'],
  num_layers: ['Number of layers', 'تعداد لایه‌ها', 'Katman sayısı'],
  num_results: ['Number of results', 'تعداد نتایج', 'Sonuç sayısı'],
  optimize_prompt_mode: ['Prompt optimization mode', 'حالت بهینه‌سازی درخواست', 'İstem iyileştirme modu'],
  orientation: ['Orientation', 'جهت تصویر', 'Yön'],
  original_quality: ['Original quality', 'کیفیت اصلی', 'Orijinal kalite'],
  output_container_and_codec: ['Video format and codec', 'قالب و کدک ویدئو', 'Video biçimi ve kodeği'],
  output_format: ['Output format', 'قالب خروجی', 'Çıktı biçimi'],
  output_type: ['Output type', 'نوع خروجی', 'Çıktı türü'],
  person_generation: ['People in the output', 'حضور افراد در خروجی', 'Çıktıda insan oluşturma'],
  preserve_alpha: ['Preserve transparency', 'حفظ شفافیت', 'Saydamlığı koru'],
  preserve_audio: ['Preserve audio', 'حفظ صدا', 'Sesi koru'],
  preset_voice: ['Voice preset', 'صدای از پیش تنظیم‌شده', 'Hazır ses'],
  prompt: ['Prompt', 'شرح درخواست', 'İstem'],
  prompt_extend: ['Extend prompt', 'گسترش درخواست', 'İstemi genişlet'],
  prompt_upsampling: ['Expand prompt', 'گسترش درخواست', 'İstemi genişlet'],
  quality: ['Quality', 'کیفیت', 'Kalite'],
  ratio: ['Aspect ratio', 'نسبت تصویر', 'En-boy oranı'],
  ref_images: ['Reference images', 'تصاویر مرجع', 'Referans görseller'],
  reference_images: ['Reference images', 'تصاویر مرجع', 'Referans görseller'],
  reference_voice: ['Reference voice', 'صدای مرجع', 'Referans ses'],
  refine_prompt: ['Refine prompt', 'پالایش درخواست', 'İstemi iyileştir'],
  repaint_end: ['Regeneration end (seconds)', 'پایان بازتولید (ثانیه)', 'Yeniden üretimin sonu (saniye)'],
  repaint_mode: ['Regeneration mode', 'حالت بازتولید', 'Yeniden üretim modu'],
  repaint_start: ['Regeneration start (seconds)', 'آغاز بازتولید (ثانیه)', 'Yeniden üretimin başlangıcı (saniye)'],
  repaint_strength: ['Regeneration strength', 'شدت بازتولید', 'Yeniden üretim düzeyi'],
  repetition_penalty: ['Repetition penalty', 'جریمهٔ تکرار', 'Tekrar cezası'],
  resemblance: ['Similarity to source', 'شباهت به ورودی', 'Kaynağa benzerlik'],
  resolution: ['Resolution', 'وضوح', 'Çözünürlük'],
  response_format: ['Response format', 'قالب پاسخ', 'Yanıt biçimi'],
  retake_seed: ['Variation seed', 'عدد پایهٔ نسخهٔ جایگزین', 'Varyasyon tohumu'],
  retake_variance: ['Amount of variation', 'میزان تفاوت نسخهٔ جایگزین', 'Varyasyon miktarı'],
  return_last_frame: ['Include last frame', 'افزودن فریم آخر به خروجی', 'Son kareyi çıktıya ekle'],
  return_timestamps: ['Include timestamps', 'درج زمان‌نما', 'Zaman damgalarını ekle'],
  sample_count: ['Number of samples', 'تعداد نمونه‌ها', 'Örnek sayısı'],
  sample_rate: ['Sample rate', 'نرخ نمونه‌برداری', 'Örnekleme hızı'],
  save_audio: ['Save audio', 'ذخیرهٔ صدا', 'Sesi kaydet'],
  scale: ['Scale', 'مقیاس', 'Ölçek'],
  scale_factor: ['Scale factor', 'ضریب مقیاس', 'Ölçek katsayısı'],
  seconds: ['Duration (seconds)', 'مدت (ثانیه)', 'Süre (saniye)'],
  seed: ['Random seed', 'عدد پایهٔ تصادفی (Seed)', 'Rastgelelik tohumu (Seed)'],
  shot_type: ['Shot type', 'نوع نما', 'Çekim türü'],
  size: ['Output dimensions', 'ابعاد خروجی', 'Çıktı boyutları'],
  speaker_audio: ['Speaker audio', 'صدای گوینده', 'Konuşmacı sesi'],
  speaker_transcript: ['Speaker transcript', 'متن گفتار گوینده', 'Konuşmacı dökümü'],
  speaking_rate: ['Speaking rate', 'سرعت گفتار', 'Konuşma hızı'],
  speed: ['Speed', 'سرعت', 'Hız'],
  steps_num: ['Generation steps', 'تعداد مراحل تولید', 'Üretim adımı sayısı'],
  structured_instruction: ['Structured instruction (JSON)', 'دستور ساختاریافته (JSON)', 'Yapılandırılmış talimat (JSON)'],
  structured_prompt: ['Structured prompt (JSON)', 'درخواست ساختاریافته (JSON)', 'Yapılandırılmış istem (JSON)'],
  style: ['Style', 'سبک', 'Stil'],
  target_max_tokens: ['Target maximum tokens', 'حداکثر توکن هدف', 'Hedef en fazla token'],
  target_megapixels: ['Target megapixels', 'مگاپیکسل هدف', 'Hedef megapiksel'],
  target_min_tokens: ['Target minimum tokens', 'حداقل توکن هدف', 'Hedef en az token'],
  task: ['Task', 'نوع کار', 'Görev'],
  temperature: ['Sampling temperature', 'دمای نمونه‌گیری', 'Örnekleme sıcaklığı'],
  text: ['Text', 'متن', 'Metin'],
  text_guidance_scale: ['Text guidance strength', 'شدت پایبندی به متن', 'Metne bağlılık düzeyi'],
  think: ['Reasoning', 'استدلال', 'Akıl yürütme'],
  thinking_mode: ['Reasoning mode', 'حالت استدلال', 'Akıl yürütme modu'],
  top_k: ['Sampling candidates (Top K)', 'تعداد گزینه‌های نمونه‌گیری (Top K)', 'Örnekleme adayı sayısı (Top K)'],
  top_p: ['Sampling probability (Top P)', 'احتمال تجمعی نمونه‌گیری (Top P)', 'Kümülatif örnekleme olasılığı (Top P)'],
  type: ['Type', 'نوع', 'Tür'],
  url: ['Reference media', 'رسانهٔ مرجع', 'Referans medya'],
  video: ['Video', 'ویدئو', 'Video'],
  video_prompt: ['Video prompt', 'شرح ویدئو', 'Video istemi'],
  voice: ['Voice', 'صدا', 'Ses'],
  voice_id: ['Voice ID', 'شناسهٔ صدا', 'Ses kimliği'],
  voice_language: ['Voice language', 'زبان صدا', 'Ses dili'],
  watermark: ['Watermark', 'نشان روی خروجی', 'Filigran'],
  width: ['Width', 'عرض', 'Genişlik'],
  x: ['X coordinate', 'مختصات افقی (X)', 'X koordinatı'],
  y: ['Y coordinate', 'مختصات عمودی (Y)', 'Y koordinatı'],
};

const fieldTypes: Record<Field['type'], Translation> = {
  string: ['Text field', 'فیلد متنی', 'Metin alanı'],
  integer: ['Whole number', 'عدد صحیح', 'Tam sayı'],
  number: ['Numeric field', 'فیلد عددی', 'Sayı alanı'],
  boolean: ['Switch', 'کلید تنظیم', 'Ayar düğmesi'],
  array: ['List', 'فهرست', 'Liste'],
  object: ['Settings group', 'گروه تنظیمات', 'Ayar grubu'],
  file: ['File', 'فایل', 'Dosya'],
};

const enumLabels: Record<string, Translation> = {
  '3d_animation': ['3D animation', 'انیمیشن سه‌بعدی', '3B animasyon'],
  adaptive: ['Adaptive', 'تطبیقی', 'Uyarlanabilir'],
  aggressive: ['Strong', 'زیاد', 'Güçlü'],
  allow_adult: ['Allow adults', 'افراد بزرگسال مجازند', 'Yetişkinlere izin ver'],
  anime: ['Anime', 'انیمه', 'Anime'],
  auto: ['Detect automatically', 'تشخیص خودکار', 'Otomatik algıla'],
  automatic: ['Automatic', 'خودکار', 'Otomatik'],
  balanced: ['Balanced', 'متعادل', 'Dengeli'],
  black: ['Black', 'سیاه', 'Siyah'],
  blue: ['Blue', 'آبی', 'Mavi'],
  clay: ['Clay animation', 'انیمیشن خمیری', 'Kil animasyonu'],
  comic: ['Comic', 'کمیک', 'Çizgi roman'],
  conservative: ['Subtle', 'ملایم', 'Hafif'],
  conversational_a: ['Conversational A', 'گفتگویی A', 'Sohbet A'],
  conversational_b: ['Conversational B', 'گفتگویی B', 'Sohbet B'],
  cover: ['Cover version', 'بازخوانی', 'Cover sürümü'],
  'cover-nofsq': ['Cover without FSQ', 'بازخوانی بدون FSQ', 'FSQ olmadan cover'],
  custom: ['Custom', 'سفارشی', 'Özel'],
  cyan: ['Cyan', 'فیروزه‌ای', 'Camgöbeği'],
  cyberpunk: ['Cyberpunk', 'سایبرپانک', 'Siberpunk'],
  default: ['Default', 'پیش‌فرض', 'Varsayılan'],
  dont_allow: ['Do not allow people', 'افراد مجاز نیستند', 'İnsanlara izin verme'],
  fast: ['Fast', 'سریع', 'Hızlı'],
  female: ['Female', 'زن', 'Kadın'],
  first_frame: ['First frame', 'فریم اول', 'İlk kare'],
  gray: ['Gray', 'خاکستری', 'Gri'],
  green: ['Green', 'سبز', 'Yeşil'],
  hq: ['High quality', 'کیفیت بالا', 'Yüksek kalite'],
  landscape: ['Landscape', 'افقی', 'Yatay'],
  magenta: ['Magenta', 'سرخابی', 'Macenta'],
  male: ['Male', 'مرد', 'Erkek'],
  manual: ['Manual', 'دستی', 'Manuel'],
  mp4_h264: ['MP4 (H.264)', 'MP4 (H.264)', 'MP4 (H.264)'],
  multi: ['Multiple shots', 'چند نما', 'Çoklu çekim'],
  negative: ['Negative', 'منفی', 'Olumsuz'],
  none: ['None', 'هیچ‌کدام', 'Yok'],
  opaque: ['Opaque', 'مات', 'Opak'],
  positive: ['Positive', 'مثبت', 'Olumlu'],
  read_speech_a: ['Narration A', 'خوانش A', 'Anlatım A'],
  read_speech_b: ['Narration B', 'خوانش B', 'Anlatım B'],
  read_speech_c: ['Narration C', 'خوانش C', 'Anlatım C'],
  read_speech_d: ['Narration D', 'خوانش D', 'Anlatım D'],
  red: ['Red', 'قرمز', 'Kırmızı'],
  reference_image: ['Reference image', 'تصویر مرجع', 'Referans görsel'],
  reference_video: ['Reference video', 'ویدئوی مرجع', 'Referans video'],
  repaint: ['Regenerate a segment', 'بازتولید یک بخش', 'Bir bölümü yeniden üret'],
  segment: ['Segment', 'بخش', 'Bölüm'],
  single: ['Single shot', 'یک نما', 'Tek çekim'],
  standard: ['Standard', 'استاندارد', 'Standart'],
  text2music: ['Text to music', 'تبدیل متن به موسیقی', 'Metinden müzik'],
  transcribe: ['Transcribe', 'تبدیل گفتار به متن', 'Yazıya dök'],
  translate: ['Translate', 'ترجمه', 'Çevir'],
  transparent: ['Transparent', 'شفاف', 'Saydam'],
  unknown: ['Unknown', 'نامشخص', 'Bilinmiyor'],
  white: ['White', 'سفید', 'Beyaz'],
  word: ['Word', 'واژه', 'Kelime'],
  yellow: ['Yellow', 'زرد', 'Sarı'],
};

const fieldHelp: Record<string, Translation> = {
  guidance_scale: ['Higher values follow the prompt more closely.', 'مقادیر بالاتر خروجی را به شرح درخواست نزدیک‌تر می‌کند.', 'Daha yüksek değerler çıktıyı isteme yaklaştırır.'],
  match_image_size: ['The first input image has index 0.', 'شمارهٔ اولین تصویر ورودی صفر است.', 'İlk girdi görselinin indeksi 0’dır.'],
  retake_seed: ['Used when the amount of variation is above zero.', 'وقتی میزان تفاوت بیشتر از صفر باشد استفاده می‌شود.', 'Varyasyon miktarı sıfırdan büyükse kullanılır.'],
  seed: ['Reuse a seed with the same settings for a more consistent result.', 'با تنظیمات یکسان، از همان عدد برای نتیجه‌ای نزدیک‌تر استفاده کنید.', 'Daha tutarlı bir sonuç için aynı ayarlarla aynı tohumu kullanın.'],
  text_guidance_scale: ['Higher values follow the text more closely.', 'مقادیر بالاتر خروجی را به متن نزدیک‌تر می‌کند.', 'Daha yüksek değerler çıktıyı metne yaklaştırır.'],
};

const mediaHelp: Record<string, Translation> = {
  audio: ['WAV file', 'فایل WAV', 'WAV dosyası'],
  image: ['PNG, JPEG or WebP', 'PNG، JPEG یا WebP', 'PNG, JPEG veya WebP'],
  reference: ['PNG, JPEG, WebP or MP4', 'PNG، JPEG، WebP یا MP4', 'PNG, JPEG, WebP veya MP4'],
  video: ['MP4 file', 'فایل MP4', 'MP4 dosyası'],
};

const languages: Record<string, string> = {
  chinese: 'zh', english: 'en', 'english (uk)': 'en-GB', 'english (us)': 'en-US', french: 'fr',
  german: 'de', hindi: 'hi', italian: 'it', japanese: 'ja', korean: 'ko', portuguese: 'pt',
  'portuguese (brazil)': 'pt-BR', russian: 'ru', spanish: 'es',
};

const voicePrefixes: Record<string, string> = {
  a: 'en-US', b: 'en-GB', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-BR', z: 'zh',
};

const voiceAliases: Record<string, Translation> = {
  broom_salesman: ['Broom Salesman', 'جارو فروش', 'Süpürge satıcısı'],
  en_man: ['English, male', 'انگلیسی، مرد', 'İngilizce, erkek'],
  en_woman: ['English, female', 'انگلیسی، زن', 'İngilizce, kadın'],
  zh_man_sichuan: ['Sichuan Chinese, male', 'چینی سیچوان، مرد', 'Siçuan Çincesi, erkek'],
};

const numberFormatters = {
  en: new Intl.NumberFormat('en', {useGrouping: false}),
  fa: new Intl.NumberFormat('fa', {useGrouping: false}),
  tr: new Intl.NumberFormat('tr', {useGrouping: false}),
};

const languageFormatters = {
  en: new Intl.DisplayNames('en', {type: 'language', fallback: 'none'}),
  fa: new Intl.DisplayNames('fa', {type: 'language', fallback: 'none'}),
  tr: new Intl.DisplayNames('tr', {type: 'language', fallback: 'none'}),
};

const numberLabel = (value: number, locale: Locale) => numberFormatters[locale].format(value);
const languageLabel = (code: string, locale: Locale) => languageFormatters[locale].of(code) ?? code;

export function fieldLabel(field: Field, locale: Locale) {
  const numberedImage = /^(input_image|image)_(\d+)$/.exec(field.name);
  const key = numberedImage?.[1] ?? field.name;
  if (Object.hasOwn(fieldLabels, key)) {
    const label = translate(fieldLabels[key], locale);
    return numberedImage ? label + ' ' + numberLabel(Number(numberedImage[2]), locale) : label;
  }
  return translate(fieldTypes[field.type], locale) + ' · ' + field.name;
}

export function fieldHint(field: Field, locale: Locale) {
  if (Object.hasOwn(fieldHelp, field.name)) return translate(fieldHelp[field.name], locale);
  if (field.type === 'file') {
    const format = field.media && Object.hasOwn(mediaHelp, field.media) ? mediaHelp[field.media] : mediaHelp.image;
    const size = numberLabel(4.8, locale);
    return translate(format, locale) + ' · ' + translate([`Up to ${size} MB`, `حداکثر ${size} مگابایت`, `En fazla ${size} MB`], locale);
  }
  if (field.minimum !== undefined && field.maximum !== undefined) {
    return numberLabel(field.minimum, locale) + ' – ' + numberLabel(field.maximum, locale);
  }
  if (field.type === 'string' && !field.enum && field.maxLength !== undefined) {
    const size = numberLabel(field.maxLength, locale);
    return translate([`Up to ${size} characters`, `حداکثر ${size} کاراکتر`, `En fazla ${size} karakter`], locale);
  }
  return null;
}

export function enumLabel(field: Field, option: string | number, locale: Locale) {
  if (typeof option === 'number') return numberLabel(option, locale);
  const value = option.toLowerCase();
  if (value === 'portrait' && field.name === 'style') return translate(['Portrait', 'پرتره', 'Portre'], locale);
  if (value === 'portrait') return translate(['Portrait', 'عمودی', 'Dikey'], locale);
  if (['voice', 'item'].includes(field.name)) {
    if (Object.hasOwn(voiceAliases, value)) return translate(voiceAliases[value], locale);
    const voice = /^([abefhijpz])([fm])_(.+)$/.exec(value);
    if (voice) {
      const name = voice[3].charAt(0).toUpperCase() + voice[3].slice(1);
      return [name, languageLabel(voicePrefixes[voice[1]], locale),
        translate(enumLabels[voice[2] === 'f' ? 'female' : 'male'], locale)].join(' · ');
    }
    const gender = /^(.+) \((female|male)\)$/i.exec(option);
    if (gender) return gender[1] + ' · ' + translate(enumLabels[gender[2].toLowerCase()], locale);
  }
  if (Object.hasOwn(enumLabels, value)) return translate(enumLabels[value], locale);
  if (['language', 'language_code', 'voice_language'].includes(field.name)) {
    const code = Object.hasOwn(languages, value) ? languages[value] : value;
    if (/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(code)) return languageLabel(code, locale);
  }
  if (/^(?:\d+[*x:]\d+|\d+(?:p|mp|k))$/i.test(value)) {
    return option.replace(/\d+/g, digits => numberLabel(Number(digits), locale)).replace(/[*x]/g, '×');
  }
  return ['flac', 'jpeg', 'jpg', 'mp3', 'opus', 'pcm', 'png', 'wav'].includes(value) ? value.toUpperCase() : option;
}
