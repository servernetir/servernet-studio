// SPDX-License-Identifier: AGPL-3.0-only
const labels = {
  en: {title:'Attach a tab screenshot', hint:'Review the preview before opening Studio.', capture:'Capture visible tab', attach:'Attach in Studio',
    error:'This tab could not be captured.', changed:'The active tab changed. Please capture it again.',
    sending:'Opening Studio…', signIn:'Sign in to Studio and try sharing again.', image:'Screenshot preview'},
  fa: {title:'پیوست تصویر تب', hint:'قبل از باز کردن Studio پیش‌نمایش را ببینید.', capture:'گرفتن تصویر تب', attach:'پیوست در Studio',
    error:'گرفتن تصویر این تب ممکن نشد.', changed:'تب فعال عوض شد. دوباره تصویر بگیرید.',
    sending:'در حال باز کردن Studio…', signIn:'به Studio وارد شوید و دوباره تصویر را بفرستید.', image:'پیش‌نمایش تصویر'},
  tr: {title:'Sekme ekran görüntüsü', hint:'Studio’yu açmadan önce önizlemeyi kontrol edin.', capture:'Görünen sekmeyi yakala', attach:'Studio’ya ekle',
    error:'Bu sekme yakalanamadı.', changed:'Etkin sekme değişti. Yeniden yakalayın.',
    sending:'Studio açılıyor…', signIn:'Studio’ya giriş yapıp tekrar paylaşın.', image:'Ekran görüntüsü önizlemesi'},
};
const language = navigator.language.split('-')[0];
const text = labels[language] ?? labels.en;
document.documentElement.lang = labels[language] ? language : 'en';
document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
const elements = Object.fromEntries(['title','hint','capture','attach','status','preview'].map(id => [id, document.getElementById(id)]));
for (const id of ['title','hint','capture','attach']) elements[id].textContent = text[id];
elements.preview.alt = text.image;
let image = null;

async function downsize(data) {
  const file = await (await fetch(data)).blob();
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .9);
  } finally {
    bitmap.close();
  }
}

elements.capture.addEventListener('click', async () => {
  if (elements.capture.disabled) return;
  elements.capture.disabled = true;
  elements.attach.hidden = elements.preview.hidden = true;
  elements.status.textContent = '';
  image = null;
  try {
    const [before] = await chrome.tabs.query({currentWindow: true, active: true});
    if (!before?.id || !/^https?:\/\//.test(before.url ?? '') || before.incognito) throw new Error('Restricted tab');
    const capture = await chrome.tabs.captureVisibleTab(before.windowId, {format: 'jpeg', quality: 91});
    const [after] = await chrome.tabs.query({currentWindow: true, active: true});
    if (after?.id !== before.id || after.url !== before.url) {
      elements.status.textContent = text.changed;
      return;
    }
    image = await downsize(capture);
    elements.preview.src = image;
    elements.attach.hidden = elements.preview.hidden = false;
  } catch {
    elements.status.textContent = text.error;
  } finally {
    elements.capture.disabled = false;
  }
});

elements.attach.addEventListener('click', async () => {
  if (!image || elements.attach.disabled) return;
  elements.capture.disabled = elements.attach.disabled = true;
  elements.status.textContent = text.sending;
  try {
    const result = await chrome.runtime.sendMessage({type:'attach', image});
    if (!result?.accepted) elements.status.textContent = text.signIn;
    else {
      elements.preview.removeAttribute('src');
      image = null;
    }
  } catch {
    elements.status.textContent = text.signIn;
  } finally {
    elements.capture.disabled = elements.attach.disabled = false;
  }
});
