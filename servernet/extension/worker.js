// SPDX-License-Identifier: AGPL-3.0-only
const studio = 'https://studio.servernet.cloud';

function loaded(id) {
  return new Promise((resolve,reject) => {
    const cleanup = () => {chrome.tabs.onUpdated.removeListener(changed); clearTimeout(timer);};
    const changed = (tab, patch) => {if (tab === id && patch.status === 'complete') {cleanup();resolve();}};
    const timer = setTimeout(() => {cleanup();reject(new Error('Studio load timed out'));}, 14000);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.tabs.get(id).then(tab => {
      if (tab.status === 'complete') {cleanup();resolve();}
    }).catch(error => {cleanup();reject(error);});
  });
}

async function attach(image) {
  const tab = await chrome.tabs.create({url:studio + '/#chat', active:false});
  await loaded(tab.id);
  const [{result:accepted} = {}] = await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    args:[image, crypto.randomUUID()],
    func:(capture,id) => {
      if (location.origin !== 'https://studio.servernet.cloud') return false;
      return new Promise(resolve => {
        let retry;
        const finish = value => {clearTimeout(timer);clearInterval(retry);window.removeEventListener('message',ack);resolve(value);};
        const ack = event => {
          if (event.source===window && event.origin===location.origin && event.data?.type==='servernet.browser-capture.ack' && event.data.id===id) {
            finish(Boolean(event.data.accepted));
          }
        };
        const timer = setTimeout(() => finish(false), 6000);
        window.addEventListener('message',ack);
        const send = () => {
          if (document.querySelector('.workspace')) window.postMessage({type:'servernet.browser-capture.v1',id,image:capture},location.origin);
        };
        retry=setInterval(send,400);
        send();
      });
    },
  });
  await chrome.tabs.update(tab.id,{active:true});
  return {accepted:Boolean(accepted)};
}

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html') || request?.type !== 'attach'
    || typeof request.image !== 'string' || request.image.length > 2_800_000
    || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(request.image)) return false;
  attach(request.image).then(reply).catch(() => reply({accepted:false}));
  return true;
});
