/* Dry Meadow page logic: menu, smooth scroll, music + visualizer, share, cookies, auth.
   Independent of the 3D star module so the page works even if WebGPU/CDN fails. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- smooth scroll for in-page anchors ---------- */
  function scrollToId(id) {
    var el = id === 'top' ? document.body : document.getElementById(id);
    if (!el) return;
    var y = id === 'top' ? 0 : el.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    if (id !== 'top') { el.setAttribute('tabindex', '-1'); try { el.focus({ preventScroll: true }); } catch (e) {} }
    try { history.replaceState(null, '', id === 'top' ? location.pathname : '#' + id); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    e.preventDefault();
    closeMenu(true);
    scrollToId(id);
  });

  /* ---------- side menu ---------- */
  var menu = $('#sideMenu'), openBtn = $('#menu-btn'), closeBtn = $('#menu-close'), scrim = $('#menu-scrim');
  var lastFocus = null;
  function openMenu() {
    lastFocus = document.activeElement;
    menu.classList.add('open'); scrim.classList.add('open');
    menu.setAttribute('aria-hidden', 'false'); openBtn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { closeBtn.focus(); }, 30);
  }
  function closeMenu(skipFocus) {
    if (!menu.classList.contains('open')) return;
    menu.classList.remove('open'); scrim.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true'); openBtn.setAttribute('aria-expanded', 'false');
    if (skipFocus !== true && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  openBtn.addEventListener('click', openMenu);
  closeBtn.addEventListener('click', function () { closeMenu(); });
  scrim.addEventListener('click', function () { closeMenu(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Tab' && menu.classList.contains('open')) {
      var f = $$('a,button', menu); var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $$('a:not([href^="#"])', menu).forEach(function (a) { a.addEventListener('click', function () { closeMenu(true); }); });

  /* ---------- music + sine-wave visualizer ---------- */
  var base = 'https://raw.githubusercontent.com/dartsolarpunk/dartmeadow-space/main/music/';
  var tracks = ['clinical_bloom', 'skyboard_journey', 'colder_than_the_sun', 'temple_of_light', 'velvet_horizon']
    .map(function (n) { return base + n + '.mp3'; });
  var audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.preload = 'none';
  var speaker = $('#speaker'), wave = $('#waveform'), dock = $('#hero-dock'), wctx = wave.getContext('2d');
  var actx = null, analyser = null, data = null, source = null, playing = false, phase = 0, amp = 0;
  var last = -1;
  function playRandom() {
    var i; do { i = Math.floor(Math.random() * tracks.length); } while (tracks.length > 1 && i === last);
    last = i; audio.src = tracks[i];
    var p = audio.play(); if (p && p.catch) p.catch(function () {});
  }
  audio.addEventListener('ended', playRandom);
  function setUi() {
    speaker.setAttribute('aria-pressed', playing ? 'true' : 'false');
    speaker.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
    speaker.classList.toggle('on', playing);
    dock.classList.toggle('playing', playing);
  }
  speaker.addEventListener('click', function () {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC(); analyser = actx.createAnalyser(); analyser.fftSize = 512;
        data = new Uint8Array(analyser.fftSize);
        source = actx.createMediaElementSource(audio);
        source.connect(analyser); analyser.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { analyser = null; }
    if (!playing) { if (!audio.src) playRandom(); else { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } playing = true; }
    else { audio.pause(); playing = false; }
    setUi();
  });
  function sizeWave() {
    var r = wave.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    wave.width = Math.max(1, Math.round(r.width * d)); wave.height = Math.max(1, Math.round(r.height * d));
  }
  function draw() {
    requestAnimationFrame(draw);
    var w = wave.width, h = wave.height;
    amp += ((playing ? 1 : 0) - amp) * 0.06;
    wctx.clearRect(0, 0, w, h);
    if (amp < 0.01) return;
    var level = 0.35;
    if (analyser && playing) {
      analyser.getByteTimeDomainData(data);
      var s = 0; for (var i = 0; i < data.length; i += 4) { var v = (data[i] - 128) / 128; s += v * v; }
      level = Math.min(1, Math.sqrt(s / (data.length / 4)) * 4 + 0.15);
    }
    phase += 0.04;
    var mid = h / 2;
    [[1, 0.9, 'rgba(255,200,100,0.85)', 2.2], [0.6, 1.6, 'rgba(255,160,60,0.5)', 1.4], [0.35, 2.4, 'rgba(255,230,170,0.35)', 1]]
      .forEach(function (L) {
        wctx.beginPath(); wctx.lineWidth = L[3] * (window.devicePixelRatio || 1); wctx.strokeStyle = L[2];
        for (var x = 0; x <= w; x += 3) {
          var t = x / w, env = Math.sin(Math.PI * t);
          var y = mid + Math.sin(t * Math.PI * 2 * 3 * L[1] + phase * L[1]) * mid * 0.85 * level * L[0] * env * amp;
          if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
        }
        wctx.stroke();
      });
  }
  window.addEventListener('resize', sizeWave);
  sizeWave(); draw(); setUi();

  /* ---------- back to top visibility ---------- */
  var hero = $('#hero');
  var btt = $('#back-to-top');
  function onScroll() { btt.classList.toggle('show', window.pageYOffset > hero.offsetHeight * 0.6); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- share ---------- */
  var toast = $('#share-toast');
  function showToast(t) { toast.textContent = t; toast.classList.add('show'); setTimeout(function () { toast.classList.remove('show'); }, 2000); }
  $('#share-btn').addEventListener('click', function () {
    var d = { title: document.title, text: 'Check out the official Dry Meadow website!', url: location.href };
    if (navigator.share) { navigator.share(d).catch(function () {}); return; }
    var done = function () { showToast('Link Copied!'); }, fail = function () { showToast('Failed to Copy'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(d.url).then(done, fail);
    else { try { var ta = document.createElement('textarea'); ta.value = d.url; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy') ? done() : fail(); ta.remove(); } catch (e) { fail(); } }
  });

  /* ---------- newsletter (mailto signup request) ---------- */
  $('#newsletter-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var m = $('#newsletter-email').value.trim();
    if (!m) return;
    location.href = 'mailto:justin@drymeadow.com?subject=' + encodeURIComponent('Newsletter signup') + '&body=' + encodeURIComponent('Please add me to the Dry Meadow newsletter: ' + m);
    showToast('Opening your email app');
  });

  /* ---------- cookie banner + optional GitHub sign-in ---------- */
  var banner = $('#cookie-banner');
  if (!lsGet('cookieAccepted_v1')) banner.style.display = 'flex';
  $('#cookie-accept').addEventListener('click', function () { lsSet('cookieAccepted_v1', 'true'); banner.style.display = 'none'; });
  $('#cookie-more').addEventListener('click', function () { window.open($('#privacy-link').href, '_blank', 'noopener'); });
  var ghBtn = $('#cookie-gh-btn');
  var authLoaded = null;
  function loadAuth() {
    if (authLoaded) return authLoaded;
    authLoaded = new Promise(function (res, rej) {
      if (window.DART_AUTH) return res();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/DART-Skyboard/Ariel@main/static/auth.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return authLoaded;
  }
  ghBtn.addEventListener('click', function () {
    ghBtn.disabled = true; ghBtn.textContent = 'Connecting…';
    loadAuth().then(function () { window.DART_AUTH.beginOAuth(); })
      .catch(function () { ghBtn.disabled = false; ghBtn.textContent = 'Sign in with GitHub'; showToast('Sign-in unavailable'); });
  });
  var pill = $('#dm-user-pill');
  function loggedIn(u) {
    banner.style.display = 'none'; lsSet('cookieAccepted_v1', 'true');
    pill.hidden = false; $('#dm-username').textContent = '@' + u.login;
    try { $('#dm-avatar').src = window.DART_AUTH.getAvatar(); } catch (e) {}
  }
  {
    loadAuth().then(function () {
      window.DART_AUTH.init({ onLogin: loggedIn, onLogout: function () { pill.hidden = true; }, onError: function () {} });
    }).catch(function () {});
  }
  pill.addEventListener('click', function () { if (window.DART_AUTH && confirm('Disconnect GitHub?')) window.DART_AUTH.logout(); });

  /* loader safety net if the 3D module never starts */
  setTimeout(function () { var l = $('#loader'); if (l) l.remove(); }, 6000);
})();
