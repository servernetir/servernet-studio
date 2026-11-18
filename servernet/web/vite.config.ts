import {readFileSync} from 'node:fs';
import {zipSync} from 'fflate';
import {defineConfig} from 'vite';

const extensionFiles = ['manifest.json','popup.html','popup.css','popup.js','worker.js','README.txt'];

export default defineConfig({
  plugins: [{
    name: 'studio-chrome-extension',
    generateBundle() {
      const files = Object.fromEntries(extensionFiles.map(name => [name,
        readFileSync(new URL('../extension/' + name, import.meta.url))]));
      this.emitFile({type:'asset', fileName:'studio-chrome-extension.zip', source:zipSync(files)});
    },
  }],
  server:{proxy:{'/api':'http://127.0.0.1:8787','/auth':'http://127.0.0.1:8787','/assets/fonts':'http://127.0.0.1:8787','/legal':'http://127.0.0.1:8787'}},
});
