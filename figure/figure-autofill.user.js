// ==UserScript==
// @name         Figure HELOC autofill (from Zoho)
// @namespace    businessloans.com
// @version      1.0
// @description  Fills Figure's New HELOC Inquiry from data passed by the Zoho "Submit to Figure" button.
// @match        https://www.figure.com/leadportal/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://businessloans-larry.github.io/BLTermSheets/figure/figure-autofill.user.js
// @updateURL    https://businessloans-larry.github.io/BLTermSheets/figure/figure-autofill.user.js
// ==/UserScript==
(function () {
  'use strict';

  // Data arrives in the URL fragment (#bl=<base64 json>). Fragments are never
  // sent to the server, so the deal data never leaves the browser.
  // Prefill only — Larry reviews and drives from there.
  // Set to true if you ever want it to submit page 1 by itself.
  const AUTO_CONTINUE = false;

  function readPayload() {
    const m = /[#&]bl=([^&]+)/.exec(location.hash || '');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); }
    catch (e) { try { return JSON.parse(atob(m[1])); } catch (e2) { return null; } }
  }

  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function labelOf(el) {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = l.innerText; }
    if (!t) { const w = el.closest('label'); if (w) t = w.innerText; }
    if (!t) t = el.getAttribute('aria-label') || '';
    if (!t) { const c = el.closest('div'); const l = c && c.querySelector('label'); if (l) t = l.innerText; }
    return norm(t);
  }

  function findField(nameOrLabel) {
    const byName = document.querySelector(`[name="${nameOrLabel}"]`);
    if (byName) return byName;
    const want = norm(nameOrLabel);
    return [...document.querySelectorAll('input,select,textarea')]
      .find(el => labelOf(el).startsWith(want)) || null;
  }

  // React tracks its own value; set through the native setter then fire input.
  function setInput(el, value) {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function setSelect(el, wantedText) {
    if (!el || !wantedText) return false;
    const want = norm(wantedText);
    let opt = [...el.options].find(o => norm(o.text) === want)
           || [...el.options].find(o => norm(o.text).includes(want))
           || [...el.options].find(o => want.includes(norm(o.text)) && norm(o.text).length > 2);
    if (!opt) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, opt.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Date of Birth is a react-aria DateField: three contentEditable segments
  // that only reliably accept REAL keystrokes. Scripted events are refused,
  // so we try, and if it does not take we focus the month and let Larry type
  // the 8 digits — then Continue fires by itself once the date is complete.
  function dobText() {
    const g = document.querySelector('[data-test-id="dateOfBirth"]');
    if (!g) return '';
    return [...g.querySelectorAll('[role="spinbutton"]')].map(s => (s.textContent || '').trim()).join('');
  }
  function dobFilled() {
    const t = dobText();
    return t.length > 0 && !/mm|dd|yyyy/i.test(t);
  }
  function setDob(mmddyyyy) {
    const g = document.querySelector('[data-test-id="dateOfBirth"]');
    if (!g) return false;
    const segs = [...g.querySelectorAll('[role="spinbutton"]')];
    const digits = (mmddyyyy || '').replace(/[^0-9]/g, '');
    if (segs.length < 3 || digits.length !== 8) return false;
    const fire = (el, ch) => {
      try { const ev = document.createEvent('TextEvent'); ev.initTextEvent('textInput', true, true, window, ch); el.dispatchEvent(ev); }
      catch (e) { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); }
    };
    [digits.slice(0,2), digits.slice(2,4), digits.slice(4,8)].forEach((part, i) => {
      segs[i].focus();
      for (const ch of part) fire(segs[i], ch);
    });
    return dobFilled();
  }

  function setCheckbox(el) {
    if (!el) return false;
    if (!el.checked) el.click();
    return !!el.checked;
  }

  function banner(lines, ok, sticky) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:999999;top:12px;right:12px;max-width:360px;padding:14px 16px;'
      + 'border-radius:8px;font:13px/1.5 -apple-system,system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);'
      + 'background:' + (ok ? '#1f7a4d' : '#8a1f1f');
    const close = sticky ? '<div style="margin-top:10px"><button id="__bl_x" style="all:unset;cursor:pointer;'
      + 'background:rgba(255,255,255,.18);padding:5px 12px;border-radius:5px;font-weight:600">Dismiss</button></div>' : '';
    d.innerHTML = '<b>Zoho → Figure</b><br>' + lines.join('<br>') + close;
    document.body.appendChild(d);
    if (sticky) { const b = d.querySelector('#__bl_x'); if (b) b.onclick = () => d.remove(); }
    else setTimeout(() => d.remove(), 12000);
    return d;
  }

  function waitForForm(tries = 0) {
    const ready = document.querySelector('[name="propertyAddress.city"]');
    if (ready) return fill();
    if (tries > 60) return banner(['Form never appeared — fill it manually.'], false);
    setTimeout(() => waitForForm(tries + 1), 500);
  }

  function fill() {
    const p = readPayload();
    if (!p) return;
    // wipe the data out of the address bar / history straight away
    history.replaceState(null, '', location.pathname + location.search);

    const done = [], missed = [];
    const T = (key, val) => { if (val === '' || val == null) return;
      setInput(findField(key), val) ? done.push(key) : missed.push(key); };
    const S = (key, val) => { if (!val) return;
      setSelect(findField(key), val) ? done.push(key) : missed.push(key); };

    T('Property Address For Financing', p.propertyAddress);
    T('propertyAddress.city', p.city);
    S('propertyAddress.state', p.state);
    T('propertyAddress.zip', p.zip);
    S('propertyAddress.ownership', p.ownershipType);
    S('occupancyType', p.occupancyType);
    S('propertyListedForSale', p.forSale);

    T('name.firstName', p.firstName);
    T('name.lastName', p.lastName);
    const dobOK = setDob(p.dob);
    T('phoneNumber', p.phone);
    T('email', p.email);

    T('Personal Income (Annual)', p.personalIncome);
    T('Liquid Assets', p.liquidAssets);

    T('businessName', p.entityName);
    S('smbEntityType', p.entityType);
    T('Business Ownership %', p.ownershipPercent);
    T('Total Monthly Business Revenue', p.monthlyRevenue);

    S('leadSource', p.referralSource);
    setCheckbox(findField('pullSoftCreditConsent')) ? done.push('consent') : missed.push('consent');

    const clickContinue = () => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Continue');
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    };

    const lines = ['Filled ' + done.length + ' fields.'];
    if (missed.length) lines.push('<b>Check by hand:</b> ' + missed.join(', '));

    if (dobOK) {
      lines.push('Date of birth set. Review and continue.');
      if (AUTO_CONTINUE && !missed.length) { lines.push('Clicking Continue…'); setTimeout(clickContinue, 900); }
    } else {
      // focus the month segment so he can just type the 8 digits
      const seg = document.querySelector('[data-test-id="dateOfBirth_month"]');
      if (seg) seg.focus();
      lines.push('<div style="margin-top:8px;padding:10px;background:rgba(255,255,255,.15);border-radius:6px">'
        + 'Type this date of birth &mdash; the cursor is already in the box:'
        + '<div style="font-size:22px;font-weight:700;letter-spacing:1px;margin-top:4px">' + (p.dob || '') + '</div>'
        + '<div style="opacity:.85;margin-top:4px">Figure\'s date box only accepts real typing.</div></div>');
      if (AUTO_CONTINUE && !missed.length) {
        lines.push('Continue fires automatically once the date is in.');
        let waited = 0;
        const timer = setInterval(() => {
          waited += 500;
          if (dobFilled()) { clearInterval(timer); setTimeout(clickContinue, 400); }
          else if (waited > 120000) clearInterval(timer);
        }, 500);
      }
    }
    banner(lines, !missed.length, !dobOK);
  }

  waitForForm();
})();
