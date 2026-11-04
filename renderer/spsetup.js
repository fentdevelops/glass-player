'use strict';
// "Play Spotify inside Glass" setup. Three steps, and Glass does the work itself:
//   1. Spotify permission: the browser opens Spotify's own consent page (one click there)
//   2. castlabs account: Glass gets castlabs' free tool ready (installs it if missing), then creates or logs
//      into the account from the details typed here; castlabs emails a code, typed here too
//   3. signing: Glass signs its own install (Widevine/VMP, which Spotify requires) and restarts
// Passwords are handed to castlabs' tool privately (main process → Python over stdin) and never stored by Glass.
// Uses app.js globals: $, $$, esc, toast, openModal, anim, S, save.
(() => {
  const evs = window.glass.evs;
  const OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  let st = null, sp = null, busy = false, mode = 'create', pending = null;   // pending: account waiting for its code

  async function refresh() {
    [st, sp] = await Promise.all([evs.status().catch(() => ({})), Promise.resolve(window.Spot ? Spot.status() : {})]);
  }
  const step1 = () => !!(sp && sp.canStream);
  const step2 = () => !!(st && st.account);
  const step3 = () => !!(st && st.signed);

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
      panel = `<p class="sps-text">Getting castlabs' free signing tool ready${st.python ? '' : ' (installing Python first)'}…</p><div class="sps-bar"><i></i></div>`;
    } else if (cur === 2 && pending) {
      panel = `<p class="sps-text">castlabs emailed a confirmation code to <b>${esc(pending.email)}</b>. Type it here:</p>
        <label class="field"><span>Code</span><input type="text" name="sps_code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 digits" /></label>
        <div class="modal-actions"><button type="button" class="btn ghost" data-sps="resend">Send it again</button><span class="grow"></span><button type="button" class="btn primary" data-sps="confirm">Confirm</button></div>`;
    } else if (cur === 2) {
      const create = mode === 'create';
      panel = `<p class="sps-text">Spotify only plays inside apps signed through castlabs. The account is free; Glass uses it once to sign itself.</p>
        <div class="set-chips sps-mode"><button type="button" class="schip${create ? ' on' : ''}" data-sps-mode="create">New account</button><button type="button" class="schip${create ? '' : ' on'}" data-sps-mode="login">I have one</button></div>
        <div class="sps-form">
          ${create ? `<label class="field"><span>Email</span><input type="text" name="sps_email" autocomplete="email" placeholder="you@example.com" /></label>
          <div class="sps-two"><label class="field"><span>First name</span><input type="text" name="sps_first" /></label><label class="field"><span>Last name</span><input type="text" name="sps_last" /></label></div>` : ''}
          <label class="field"><span>Account name</span><input type="text" name="sps_account" autocomplete="username" placeholder="${create ? 'Pick one, letters and digits' : 'Your castlabs account name'}" /></label>
          <label class="field"><span>Password${create ? ' (8 or more characters)' : ''}</span><input type="password" name="sps_pass" autocomplete="${create ? 'new-password' : 'current-password'}" /></label>
        </div>
        <div class="modal-actions"><span class="grow"></span><button type="button" class="btn primary" data-sps="${create ? 'signup' : 'login'}">${create ? 'Create account' : 'Log in'}</button></div>`;
    } else if (cur === 3) {
      panel = `<p class="sps-text">Signing Glass for Spotify. This takes a few seconds, then Glass restarts by itself.</p><div class="sps-bar"><i></i></div>`;
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
    anim(form.querySelector('.sps-panel'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
    setTimeout(() => form.querySelector('.sps-panel input')?.focus(), 80);
    next();
  }
  // the steps that need nothing from you run on their own
  async function next() {
    if (busy) return;
    if (step1() && !step2() && st && !st.portable && (!st.python || !st.evs)) {
      busy = true;
      const r = await evs.prepare().catch((e) => ({ ok: false, error: e.message }));
      busy = false;
      if (!r.ok) { toast(r.error || 'Couldn’t get castlabs’ tool ready', true); return; }
      await refresh(); paint(); return;
    }
    if (step1() && step2() && !step3() && st && !st.portable) {
      busy = true;
      const r = await evs.sign().catch((e) => ({ ok: false, error: e.message }));
      busy = false;
      if (!r.ok) { toast(r.error || 'Signing didn’t work. Try again in a minute.', true); await refresh(); paint(); return; }
      await refresh(); paint();
      toast('Glass is signed for Spotify. Restarting…');
      S.ui.spSetupDone = true; save();
      setTimeout(() => evs.relaunch(), 1600);
    }
  }
  const val = (n) => (form.querySelector(`[name="${n}"]`)?.value || '').trim();
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
    let payload = null;
    if (a === 'signup') {
      payload = { action: 'signup', email: val('sps_email'), first: val('sps_first'), last: val('sps_last'), account: val('sps_account'), password: form.querySelector('[name="sps_pass"]').value };
      if (!/^\S+@\S+\.\S+$/.test(payload.email)) return toast('Type the email castlabs should send the code to', true);
      if (!payload.first || !payload.last) return toast('castlabs asks for a first and last name', true);
      if (!/^[A-Za-z0-9._-]{3,}$/.test(payload.account)) return toast('Account name: 3 or more letters or digits', true);
      if (payload.password.length < 8) return toast('Password: 8 or more characters', true);
    } else if (a === 'login') {
      payload = { action: 'login', account: val('sps_account'), password: form.querySelector('[name="sps_pass"]').value };
      if (!payload.account || !payload.password) return toast('Type your castlabs account name and password', true);
    } else if (a === 'confirm') {
      payload = { action: 'confirm', account: pending.account, password: pending.password, code: val('sps_code') };
      if (!/^\d{4,8}$/.test(payload.code)) return toast('Type the code from castlabs’ email', true);
    } else if (a === 'resend') {
      payload = { action: 'resend', account: pending.account };
    } else return;
    busy = true;
    const btn = form.querySelector(`[data-sps="${a}"]`);
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Working…'; }
    const r = await evs.account(payload).catch((e) => ({ ok: false, error: e.message }));
    busy = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    if (!r.ok) { toast(r.error || 'castlabs said no. Check the details.', true); return; }
    if (a === 'signup') pending = { account: payload.account, password: payload.password, email: payload.email };
    if (a === 'confirm') pending = null;
    if (a === 'resend') { toast('Sent a new code'); return; }
    await refresh(); paint();
  }

  async function open() {
    await refresh();
    openModal('', { onMount: (f) => {
      form = f;
      form.classList.add('sps');
      form.addEventListener('click', (e) => {
        const m = e.target.closest('[data-sps-mode]');
        if (m) { mode = m.dataset.spsMode; paint(); return; }
        const b = e.target.closest('[data-sps]');
        if (b) act(b.dataset.sps);
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
