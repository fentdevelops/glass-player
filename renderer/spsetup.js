'use strict';
// "Play Spotify inside Glass" setup. Three steps, and Glass does the work itself:
//   1. Spotify permission: the browser opens Spotify's own consent page (one click there)
//   2. castlabs account: Glass gets castlabs' free tool ready (installs it if missing), then creates or logs
//      into the account from the details typed here; castlabs emails a code, typed here too
//   3. signing: Glass signs its own install (Widevine/VMP, which Spotify requires) and restarts
// Every field checks itself as you type (red with a message when it won't work), castlabs' answers land on
// the field they're about, and long steps show a real 0-100% bar with the tool's own log lines.
// Passwords go to castlabs' tool privately (main process -> Python over stdin) and are never stored by Glass.
// Uses app.js globals: $, esc, toast, openModal, modalClose, anim, S, save.
(() => {
  const evs = window.glass.evs;
  const OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  const EYE = '<svg class="eye-on" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>'
    + '<svg class="eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.4 6.5C3.9 8.2 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  let st = null, sp = null, busy = false, mode = 'create', pending = null;   // pending: account waiting for its code
  let typed = {}, touched = {}, serverErr = {}, nameAuto = true, task = null;

  async function refresh() {
    [st, sp] = await Promise.all([evs.status().catch(() => ({})), Promise.resolve(window.Spot ? Spot.status() : {})]);
  }
  const step1 = () => !!(sp && sp.canStream);
  const step2 = () => !!(st && st.account);
  const step3 = () => !!(st && st.signed);

  // ---------- account name: your Spotify name, or "glassy" + first name + a number ----------
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.-]+/g, '').replace(/_/g, '').slice(0, 24);
  const digits = () => String(1000 + Math.floor(Math.random() * 9000));
  function autoName(withNumber = false) {
    const fromSpotify = slug(sp && sp.user && sp.user.name);
    if (fromSpotify.length >= 3 && !withNumber) return fromSpotify;
    if (fromSpotify.length >= 3) return `${fromSpotify}-${digits()}`;
    const first = slug(typed.first);
    return `glassy${first ? '-' + first : ''}-${digits()}`;
  }

  // ---------- checks: each field turns red with a message as soon as it can't work ----------
  const RULES = {
    email: (v) => (!v ? 'castlabs sends a code here' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'That doesn’t look like an email'),
    first: (v) => (v ? '' : 'castlabs asks for a first name'),
    last: (v) => (v ? '' : 'castlabs asks for a last name'),
    account: (v) => (!v ? 'Pick an account name' : v.length < 3 ? 'At least 3 characters' : /^[A-Za-z0-9._-]+$/.test(v) ? '' : 'Letters, digits, dots, dashes only'),
    // only what's certain is checked here; castlabs' own password rules come back on this field if it says no
    password: (v) => (!v ? 'Type a password' : mode === 'login' ? '' : v.length < 8 ? `${8 - v.length} more character${v.length === 7 ? '' : 's'} (8 or more)` : ''),
    code: (v) => (!v ? 'Type the code from the email' : /^\d{6}$/.test(v) ? '' : 'The code is 6 digits'),
  };
  const fieldsFor = () => (pending ? ['code'] : mode === 'create' ? ['email', 'first', 'last', 'account', 'password'] : ['account', 'password']);
  const problem = (k) => serverErr[k] || (RULES[k] ? RULES[k](String(typed[k] || '').trim()) : '');
  function paintField(k) {
    const wrap = form && form.querySelector(`[data-f="${k}"]`);
    if (!wrap) return;
    const msg = touched[k] ? problem(k) : '';
    wrap.classList.toggle('bad', !!msg);
    wrap.classList.toggle('good', !!touched[k] && !msg && !!typed[k]);
    const em = wrap.querySelector('.ferr');
    if (em.textContent !== msg) {
      em.textContent = msg;
      if (msg) anim(em, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
    }
  }
  const allGood = () => fieldsFor().every((k) => !problem(k));
  function field(k, label, type = 'text', extra = '') {
    const v = typed[k] == null ? '' : typed[k];
    const pass = type === 'password';
    return `<label class="field sps-f" data-f="${k}"><span>${label}</span>
      <span class="sps-in"><input type="${type}" name="sps_${k}" value="${esc(v)}" ${extra} />${pass ? `<button type="button" class="sps-eye" data-eye title="Show password" aria-label="Show password">${EYE}</button>` : ''}</span>
      <em class="ferr"></em></label>`;
  }

  // ---------- live progress: 0-100% with the tool's own lines ----------
  function progressHTML(title) {
    return `<div class="sps-task"><div class="sps-ptop"><b>${esc(title)}</b><span class="sps-pct">0%</span></div>
      <div class="sps-pbar"><i style="width:0%"></i></div><div class="sps-log" aria-live="polite"></div></div>`;
  }
  function startTask(name, title, into) {
    task = { name, pct: 0 };
    const host = into || form.querySelector('.sps-panel');
    const old = host.querySelector('.sps-task');
    if (old) old.remove();
    host.insertAdjacentHTML('beforeend', progressHTML(title));
    anim(host.querySelector('.sps-task'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380 });
  }
  function onProgress(d) {
    if (!task || !form || !d || d.task !== task.name) return;
    const box = form.querySelector('.sps-task');
    if (!box) return;
    if (typeof d.pct === 'number' && d.pct > task.pct) {
      task.pct = Math.min(100, d.pct);
      box.querySelector('.sps-pbar i').style.width = task.pct + '%';
      box.querySelector('.sps-pct').textContent = Math.round(task.pct) + '%';
    }
    if (d.line) {
      const log = box.querySelector('.sps-log');
      const row = document.createElement('div');
      row.textContent = d.line;
      log.appendChild(row);
      while (log.childElementCount > 40) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
    }
  }
  evs.onProgress?.(onProgress);
  const endTask = (ok) => { if (task) onProgress({ task: task.name, pct: ok ? 100 : task.pct }); task = null; };

  // ---------- the window ----------
  function stepRow(n, title, done, active, sub) {
    return `<div class="sps-step${done ? ' done' : ''}${active ? ' active' : ''}"><i>${done ? OK : n}</i><div><b>${title}</b><span>${sub}</span></div></div>`;
  }
  function body() {
    const s1 = step1(), s2 = step2(), s3 = step3();
    const cur = !s1 ? 1 : !s2 ? 2 : !s3 ? 3 : 4;
    let panel = '';
    if (cur === 1) {
      panel = `<p class="sps-text">Spotify asks you once to let Glass play music. Your browser opens on Spotify's page: click <b>Agree</b>, then come back here.</p>
        <div class="modal-actions"><span class="grow"></span><button type="button" class="btn primary" data-sps="allow">Open Spotify</button></div>`;
    } else if (cur === 2 && st && st.portable) {
      panel = `<p class="sps-text">This is the portable Glass. Open the installed Glass from the Start menu to finish setup there.</p>`;
    } else if (cur === 2 && st && (!st.python || !st.evs)) {
      panel = `<p class="sps-text">Getting castlabs' free signing tool ready${st.python ? '' : ', installing Python first'}.</p>`;
    } else if (cur === 2 && pending) {
      panel = `<p class="sps-text">castlabs emailed a 6-digit code to <b>${esc(pending.email || 'your email')}</b>.</p>
        <div class="sps-form">${field('code', 'Code', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"')}</div>
        <div class="modal-actions"><button type="button" class="btn ghost" data-sps="resend">Send it again</button><span class="grow"></span><button type="button" class="btn primary" data-sps="confirm">Confirm</button></div>`;
    } else if (cur === 2) {
      const create = mode === 'create';
      if (create && nameAuto && !typed.account) typed.account = autoName();
      panel = `<p class="sps-text">Spotify only plays inside apps signed through castlabs. The account is free; Glass uses it once to sign itself.</p>
        <div class="set-chips sps-mode"><button type="button" class="schip${create ? ' on' : ''}" data-sps-mode="create">New account</button><button type="button" class="schip${create ? '' : ' on'}" data-sps-mode="login">I have one</button></div>
        <div class="sps-form">
          ${create ? field('email', 'Email', 'text', 'autocomplete="email" placeholder="you@example.com"') + `<div class="sps-two">${field('first', 'First name')}${field('last', 'Last name')}</div>` : ''}
          ${field('account', create ? 'Account name <small>picked for you, change it if you like</small>' : 'Account name', 'text', 'autocomplete="username" spellcheck="false"')}
          ${field('password', create ? 'Password <small>8 or more characters</small>' : 'Password', 'password', `autocomplete="${create ? 'new-password' : 'current-password'}"`)}
        </div>
        <div class="modal-actions"><span class="grow"></span><button type="button" class="btn primary" data-sps="${create ? 'signup' : 'login'}">${create ? 'Create account' : 'Log in'}</button></div>`;
    } else if (cur === 3) {
      panel = `<p class="sps-text">Signing Glass for Spotify, then Glass restarts by itself.</p>`;
    } else {
      panel = `<p class="sps-text">All set. Spotify plays right inside Glass now, no Spotify app needed.</p>
        <div class="modal-actions"><span class="grow"></span><button type="button" class="btn primary" data-cancel>Done</button></div>`;
    }
    return `
      <div class="modal-head"><h3 class="modal-title">Play Spotify inside Glass</h3></div>
      <div class="sps-steps">
        ${stepRow(1, 'Spotify permission', s1, cur === 1, s1 ? 'Allowed' : 'One click in your browser')}
        ${stepRow(2, 'castlabs account', s2, cur === 2, s2 ? `Signed in as ${esc(st.account)}` : 'Free, used once to sign Glass')}
        ${stepRow(3, 'Sign Glass and restart', s3, cur === 3, s3 ? 'Signed' : 'Glass does this itself')}
      </div>
      <div class="sps-panel">${panel}</div>
      ${cur < 4 ? '<div class="modal-actions sps-foot"><button type="button" class="btn ghost" data-cancel>Not now</button></div>' : ''}`;
  }

  let form = null;
  function paint() {
    if (!form || !form.isConnected) return;
    form.innerHTML = body();
    form.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => modalClose && modalClose()));
    fieldsFor().forEach(paintField);
    anim(form.querySelector('.sps-panel'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
    setTimeout(() => {
      const first = [...form.querySelectorAll('.sps-panel input')].find((i) => !i.value) || form.querySelector('.sps-panel input');
      first?.focus();
    }, 80);
    next();
  }

  // the steps that need nothing from you run on their own, with the live bar
  async function next() {
    if (busy) return;
    if (step1() && !step2() && st && !st.portable && (!st.python || !st.evs)) {
      busy = true;
      startTask('prepare', st.python ? 'Installing castlabs’ tool' : 'Installing Python, then castlabs’ tool');
      const r = await evs.prepare().catch((e) => ({ ok: false, error: e.message }));
      endTask(r.ok);
      busy = false;
      if (!r.ok) { toast(r.error || 'Couldn’t get castlabs’ tool ready', true); return; }
      await refresh(); setTimeout(paint, 600); return;
    }
    if (step1() && step2() && !step3() && st && !st.portable) {
      busy = true;
      startTask('sign', 'Signing Glass for Spotify');
      const r = await evs.sign().catch((e) => ({ ok: false, error: e.message }));
      endTask(r.ok);
      busy = false;
      if (!r.ok) { toast(r.error || 'Signing didn’t work. Try again in a minute.', true); await refresh(); return; }
      await refresh();
      setTimeout(paint, 700);
      toast('Glass is signed for Spotify. Restarting…');
      S.ui.spSetupDone = true; save();
      setTimeout(() => evs.relaunch(), 2200);
    }
  }

  async function act(a) {
    if (busy) return;
    if (a === 'allow') {
      busy = true;
      const ok = await Spot.connect(Spot.status().clientId);
      busy = false;
      await refresh(); paint();
      if (!ok) toast('Spotify didn’t confirm. Try again.', true);
      return;
    }
    if (a === 'resend') {
      busy = true;
      const r = await evs.account({ action: 'resend', account: pending.account }).catch((e) => ({ ok: false, error: e.message }));
      busy = false;
      toast(r.ok ? 'Sent a new code' : r.error || 'Couldn’t send a new code', !r.ok);
      return;
    }
    // every field shows its problem now, and nothing is sent until they're all fine
    fieldsFor().forEach((k) => { touched[k] = true; paintField(k); });
    if (!allGood()) {
      const bad = form.querySelector('.sps-f.bad input');
      bad?.focus();
      anim(form.querySelector('.sps-form'), [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 380 });
      return;
    }
    const v = (k) => String(typed[k] || '').trim();
    let payload;
    if (a === 'signup') payload = { action: 'signup', email: v('email'), first: v('first'), last: v('last'), account: v('account'), password: typed.password };
    else if (a === 'login') payload = { action: 'login', account: v('account'), password: typed.password };
    else if (a === 'confirm') payload = { action: 'confirm', account: pending.account, password: pending.password, code: v('code') };
    else return;
    busy = true;
    const btn = form.querySelector(`[data-sps="${a}"]`);
    if (btn) { btn.disabled = true; btn.textContent = a === 'signup' ? 'Creating…' : a === 'login' ? 'Logging in…' : 'Confirming…'; }
    startTask(a, a === 'signup' ? 'Creating your castlabs account' : a === 'login' ? 'Logging in to castlabs' : 'Confirming your account');
    let r = await evs.account(payload).catch((e) => ({ ok: false, error: e.message }));
    // the name was taken: pick a new one by itself (your Spotify name with a number) and try again, once
    if (!r.ok && r.field === 'account' && a === 'signup' && nameAuto) {
      typed.account = autoName(true);
      const inp = form.querySelector('[name="sps_account"]');
      if (inp) { inp.value = typed.account; anim(inp, [{ backgroundColor: 'rgba(255,255,255,.22)' }, { backgroundColor: 'rgba(255,255,255,.08)' }], { duration: 900 }); }
      onProgress({ task: a, line: `“${payload.account}” is taken, trying “${typed.account}”` });
      payload.account = typed.account;
      r = await evs.account(payload).catch((e) => ({ ok: false, error: e.message }));
    }
    endTask(r.ok);
    busy = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = a === 'signup' ? 'Create account' : a === 'login' ? 'Log in' : 'Confirm'; }
    if (!r.ok) {
      // castlabs' answer goes on the field it's about; anything else is a toast
      if (r.field && form.querySelector(`[data-f="${r.field}"]`)) {
        serverErr[r.field] = r.error; touched[r.field] = true; paintField(r.field);
        form.querySelector(`[data-f="${r.field}"] input`)?.focus();
      } else toast(r.error || 'castlabs said no. Check the details.', true);
      if (r.needsCode) { pending = { account: payload.account, password: payload.password, email: '' }; typed.code = ''; touched = {}; serverErr = {}; await refresh(); paint(); }
      return;
    }
    if (a === 'signup') { pending = { account: payload.account, password: payload.password, email: payload.email }; typed.code = ''; touched = {}; serverErr = {}; }
    if (a === 'confirm') pending = null;
    await refresh();
    setTimeout(paint, 500);
  }

  async function open() {
    await refresh();
    typed = {}; touched = {}; serverErr = {}; nameAuto = true; pending = null; mode = 'create';
    openModal('', { onMount: (f) => {
      form = f;
      form.classList.add('sps');
      form.addEventListener('click', (e) => {
        const eye = e.target.closest('[data-eye]');
        if (eye) {
          const inp = eye.parentElement.querySelector('input');
          const show = inp.type === 'password';
          inp.type = show ? 'text' : 'password';
          eye.classList.toggle('on', show);
          eye.title = show ? 'Hide password' : 'Show password';
          inp.focus();
          return;
        }
        const m = e.target.closest('[data-sps-mode]');
        if (m) { mode = m.dataset.spsMode; touched = {}; serverErr = {}; if (mode === 'login') typed.account = st && st.cachedAccount || ''; else { nameAuto = true; typed.account = ''; } paint(); return; }
        const b = e.target.closest('[data-sps]');
        if (b) act(b.dataset.sps);
      });
      form.addEventListener('input', (e) => {
        const k = e.target.name && e.target.name.replace(/^sps_/, '');
        if (!k || !(k in RULES)) return;
        typed[k] = e.target.value;
        delete serverErr[k];
        if (k === 'account') nameAuto = false;
        if (typed[k]) touched[k] = true;
        paintField(k);
        // no Spotify name to use: the account name follows the first name until you type your own
        if (k === 'first' && nameAuto && !slug(sp && sp.user && sp.user.name)) {
          const inp = form.querySelector('[name="sps_account"]');
          typed.account = autoName();
          if (inp) inp.value = typed.account;
          paintField('account');
        }
      });
      form.addEventListener('focusout', (e) => {
        const k = e.target.name && e.target.name.replace(/^sps_/, '');
        if (k && k in RULES) { touched[k] = true; paintField(k); }
      });
      form.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('input')) return;
        e.preventDefault();
        form.querySelector('.sps-panel .btn.primary')?.click();
      });
      paint();
    } });
  }
  // what's still missing, for Settings and the first visit to Spotify
  async function needed() {
    await refresh();
    if (!sp || !sp.connected || sp.mock) return false;
    return !(step1() && step3());
  }
  window.SpSetup = { open, needed };
})();
