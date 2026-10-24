import './ui/mobile/mobile.css';
import { App } from './ui/app.ts';

const app = new App(document.getElementById('app')!);
app.boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String(e?.stack ?? e)}</pre>`);
});
