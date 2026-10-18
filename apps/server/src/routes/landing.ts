import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * What someone sees when they open a River invite, friend or sign-up link in a
 * browser: get River for their computer or phone (one download each, with what to
 * click past the "unsigned app" warnings), then "Open in River", which hands the
 * link to the app (river://open?link=…) so nothing has to be copied and pasted.
 * New to River, the app asks only for a name and then goes straight to the
 * community (2.14).
 *
 * The secret part of an invite is in the URL fragment, which browsers never
 * send to the server; the page reads it in the browser only to build the
 * river:// link and the copy button.
 */

const REPO = 'https://github.com/martex-dev/river';
const RELEASES = `${REPO}/releases/latest`;
const DOWNLOAD = `${RELEASES}/download`;

const SCRIPT = `
(function () {
  var path = location.pathname.replace(/\\/+$/, '').replace(/\\.html$/, '');
  var link = location.origin + path + location.hash;
  var open = document.getElementById('open');
  open.href = 'river://open?link=' + encodeURIComponent(link);
  var kind = /\\/add$/.test(path) ? (location.hash.indexOf('#s=') === 0 ? 'signup' : 'friend') : /\\/join$/.test(path) ? 'invite' : 'home';
  var titles = {
    invite: "You're invited to a River community",
    friend: 'Someone wants to be your friend on River',
    signup: 'Your River account is waiting for you',
    home: 'River — private messages, voice and communities'
  };
  if (kind === 'home' || !location.hash) document.getElementById('come-in').hidden = true;
  document.getElementById('title').textContent = titles[kind];
  document.title = titles[kind];
  var ua = navigator.userAgent;
  var os = /Windows/i.test(ua) ? 'windows' : /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Mac/i.test(ua) ? 'mac' : /Linux/i.test(ua) ? 'linux' : 'other';
  var shown = document.querySelectorAll('[data-os]');
  for (var i = 0; i < shown.length; i++) {
    var want = shown[i].getAttribute('data-os').split(' ');
    shown[i].hidden = want.indexOf(os) === -1 && want.indexOf('all') === -1;
  }
  var copy = document.getElementById('copy');
  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(link).then(function () { copy.textContent = 'Copied \\u2713 \\u2014 paste it anywhere in River'; });
  });
})();
`;

const SCRIPT_HASH = `sha256-${createHash('sha256').update(SCRIPT).digest('base64')}`;
const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src '${SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** The page; `head` adds tags (the static copy carries its security policy as a meta tag). */
const page = (head = ''): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}<title>River</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0%,#10233a 0,#05070d 55%);color:#e7ecf8;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px}
main{width:min(560px,100%)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.02em;color:#4fe3d1;margin-bottom:18px}
.dot{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#4fe3d1,#8b7bff)}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 6px}
.lead{color:#9ca8c6;margin:0 0 22px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:18px 18px 16px;margin-bottom:14px}
.step{display:flex;gap:12px;align-items:flex-start}
.num{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:.85rem;background:#1b2740;color:#4fe3d1}
h2{font-size:1.02rem;margin:2px 0 8px}
.btn{display:inline-block;text-decoration:none;border:0;cursor:pointer;font:inherit;font-weight:650;border-radius:10px;padding:11px 16px;margin:4px 6px 4px 0}
.primary{background:linear-gradient(135deg,#4fe3d1,#8b7bff);color:#05070d}
.ghost{background:#1b2740;color:#e7ecf8}
.hint{color:#9ca8c6;font-size:.88rem;margin:8px 0 0}
.hint b{color:#e7ecf8}
footer{color:#6f7a96;font-size:.82rem;margin-top:16px}
</style></head>
<body><main>
<div class="brand"><span class="dot"></span>River</div>
<h1 id="title">You're invited to River</h1>
<p class="lead">Private messages, voice and communities — end-to-end encrypted.</p>

<section class="card"><div class="step"><span class="num">1</span><div>
<h2>Get River</h2>
<div data-os="windows"><a class="btn primary" href="${DOWNLOAD}/River-Setup.exe">Download for Windows</a>
<p class="hint">Open the downloaded file. If Windows says <b>“Windows protected your PC”</b>, click <b>More info</b> → <b>Run anyway</b> — River is open source but not code-signed yet. Your antivirus may ask too: choose <b>Allow</b>.</p></div>
<div data-os="mac"><a class="btn primary" href="${DOWNLOAD}/River-mac-apple-silicon.dmg">Mac (Apple chip)</a><a class="btn ghost" href="${DOWNLOAD}/River-mac-intel.dmg">Mac (Intel)</a>
<p class="hint">Drag River into Applications. The first time, <b>right-click River → Open</b>. If macOS still refuses: <b>System Settings → Privacy &amp; Security → Open Anyway</b>.</p></div>
<div data-os="linux"><a class="btn primary" href="${DOWNLOAD}/River-linux.AppImage">AppImage</a><a class="btn ghost" href="${DOWNLOAD}/River-linux.deb">.deb</a><a class="btn ghost" href="${DOWNLOAD}/River-linux.rpm">.rpm</a>
<p class="hint">AppImage: make it executable (right-click → Properties → Allow executing), then open it.</p></div>
<div data-os="android"><a class="btn primary" href="${DOWNLOAD}/River-android.apk">Download for Android</a>
<p class="hint">Open the downloaded file and tap <b>Install</b>. If Android asks, let your browser <b>install unknown apps</b> — River is not in Google Play yet.</p></div>
<div data-os="ios"><a class="btn primary" href="${DOWNLOAD}/River-ios-unsigned.ipa">Download for iPhone</a>
<p class="hint">River is not in the App Store yet, so the iPhone app has to be installed with a sideloading app such as <b>AltStore</b> or <b>Sideloadly</b>. Easier for now: open this link on a computer.</p></div>
<div data-os="other"><a class="btn primary" href="${RELEASES}">All downloads</a></div>
<p class="hint" data-os="windows mac linux android ios">Other systems: <a style="color:#4fe3d1" href="${RELEASES}">all downloads</a> · <a style="color:#4fe3d1" href="${REPO}/blob/main/CODE_SIGNING.md">Code signing policy</a>.</p>
</div></div></section>

<section class="card"><div class="step"><span class="num">2</span><div>
<h2>Open River and type your name</h2>
<p class="hint" style="margin-top:0">That's all: your account is created by itself — no e-mail, no phone number.</p>
</div></div></section>

<section class="card" id="come-in"><div class="step"><span class="num">3</span><div>
<h2>Come in</h2>
<a id="open" class="btn primary" href="#">Open in River</a><button id="copy" class="btn ghost" type="button">Copy link</button>
<p class="hint">New to River: type your name and you're in. Already using it: River asks once, then opens it. If nothing happens, copy the link and paste it anywhere in River.</p>
</div></div></section>

<footer>The secret part of this link stays in your browser and never reaches this server. Messages are end-to-end encrypted.</footer>
</main>
<script>${SCRIPT}</script>
</body></html>`;
const PAGE = page();

function landing(reply: FastifyReply): FastifyReply {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('content-security-policy', CSP);
  reply.header('cache-control', 'no-store');
  return reply.send(PAGE);
}

export function registerLandingRoutes(app: FastifyInstance): void {
  app.get('/join', async (_request, reply) => landing(reply));
  app.get('/add', async (_request, reply) => landing(reply));
}

/**
 * The static copy published at River's permanent link address (GitHub Pages,
 * see scripts/site/build-site.ts): same page, policy in a meta tag
 * (frame-ancestors only works as a header, so it is left out there).
 */
export function staticLandingPage(): string {
  const csp = CSP.replace(/; frame-ancestors 'none'/, '');
  return page(`<meta http-equiv="Content-Security-Policy" content="${csp}">
`);
}

/** For tests. */
export const LANDING = { csp: CSP, page: PAGE, scriptHash: SCRIPT_HASH };
