/* plxr — our own controls.

   No <select>, no confirm(), no alert(): the operating system draws those, and
   that punches a hole through every skin at exactly the spot where it is most
   visible. Everything here is ordinary markup that the skin styles.

   The <select> elements stay in the HTML — they still hold value and options,
   and the rest of the code reads them unchanged. Only the shell beside them is
   what you see. */

(function () {
  const $$ = (s, w = document) => w.querySelector(s);

  /* ---------- Auswahlliste ---------- */

  function makeSelect(sel) {
    if (sel.dataset.wrapped) return;
    sel.dataset.wrapped = 'yes';
    sel.hidden = true;

    const root = document.createElement('div');
    root.className = 'select';
    root.innerHTML = '<button type="button" class="selectButton"><span class="auswahlText"></span><i class="selectArrow">▾</i></button><div class="selectList" hidden></div>';
    sel.after(root);

    const button = $$('.selectButton', root);
    const text = $$('.auswahlText', root);
    const list = $$('.selectList', root);
    if (sel.dataset.tip) button.dataset.tip = sel.dataset.tip;

    const render = () => {
      text.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      list.innerHTML = '';
      for (const kind of sel.children) {
        if (kind.tagName === 'OPTGROUP') {
          const h = document.createElement('div');
          h.className = 'selectGroup';
          h.textContent = kind.label;
          list.appendChild(h);
          for (const o of kind.children) list.appendChild(row(o));
        } else {
          list.appendChild(row(kind));
        }
      }
    };

    const row = (o) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'selectRow';
      d.textContent = o.textContent;
      d.dataset.value = o.value;
      if (o.value === sel.value) d.dataset.picked = 'yes';
      d.addEventListener('click', () => {
        sel.value = o.value;
        // The rest of the code listens for 'change' on the real element.
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        shut();
        render();
      });
      return d;
    };

    /* The list hangs in the body, not in the field.
       The reason: the settings are a scrolling card (.card.wide has
       overflow-y: auto). A list positioned absolutely inside it gets clipped
       at its edge — two out of ten themes were visible, the rest sat behind
       the edge. Something with a fixed position in the body cannot be clipped
       by any ancestor.

       The old direction logic fell away with it, and rightly so: it wrote
       data-richtung="tall" while the stylesheet asked for "hoch". So nothing
       ever opened upwards. */
    const platzieren = () => {
      const r = button.getBoundingClientRect();
      const margin = 8;
      list.style.right = 'auto';
      list.style.minWidth = r.width + 'px';
      const untenFrei = window.innerHeight - r.bottom - margin;
      const obenFrei = r.top - margin;
      const up = untenFrei < Math.min(320, list.scrollHeight + 8) && obenFrei > untenFrei;
      list.dataset.dir = up ? 'up' : 'down';
      list.style.maxHeight = Math.max(120, Math.min(320, up ? obenFrei : untenFrei)) + 'px';
      // Measure only after maxHeight, otherwise the scrollbar makes the width wrong.
      let leftPx = r.left;
      const width = list.offsetWidth;
      if (leftPx + width > window.innerWidth - margin) leftPx = window.innerWidth - width - margin;
      list.style.left = Math.max(margin, leftPx) + 'px';
      if (up) { list.style.top = 'auto'; list.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
      else { list.style.bottom = 'auto'; list.style.top = (r.bottom + 4) + 'px'; }
    };

    const openIt = () => {
      render();
      document.body.appendChild(list);
      list.hidden = false;
      root.dataset.open = 'yes';
      platzieren();
      const g = $$('[data-picked]', list);
      if (g) g.scrollIntoView({ block: 'nearest' });
      // If something underneath scrolls away, the list has to follow instead of sticking.
      window.addEventListener('scroll', platzieren, true);
      window.addEventListener('resize', platzieren);
    };
    const shut = () => {
      list.hidden = true;
      delete root.dataset.open;
      window.removeEventListener('scroll', platzieren, true);
      window.removeEventListener('resize', platzieren);
      // Back into the field: that is where render() looks for it, and it dies with it.
      root.appendChild(list);
    };

    button.addEventListener('click', (e) => { e.stopPropagation(); list.hidden ? openIt() : shut(); });
    document.addEventListener('click', (e) => { if (!root.contains(e.target) && !list.contains(e.target)) shut(); });
    document.addEventListener('keydown', (e) => {
      // Only while this list is open — otherwise an Escape anywhere in the
      // window would close the dialog underneath as well.
      if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); shut(); }
    }, true);
    // Changes from outside (on load, say) have to become visible.
    sel.addEventListener('change', render);
    new MutationObserver(render).observe(sel, { childList: true, subtree: true });
    render();
  }

  /* ---------- Confirmation and notice ---------- */

  let openDialog = null;

  function dialog(title, text, buttons) {
    return new Promise((done) => {
      if (openDialog) openDialog.remove();
      const d = document.createElement('div');
      openDialog = d;
      // Deliberately the same classes as the other dialogs: otherwise no skin
      // styles them and the confirmation stands naked on the page.
      d.className = 'backdrop';
      d.innerHTML =
        '<div class="card"><b class="cardTitle"></b>' +
        '<p class="dialogText"></p><div class="cardButtons"></div></div>';
      $$('.cardTitle', d).textContent = title;
      $$('.dialogText', d).textContent = text;

      const close = (value) => {
        d.remove();
        openDialog = null;
        document.removeEventListener('keydown', onKey, true);
        done(value);
      };

      const box = $$('.cardButtons', d);
      for (const k of buttons) {
        const b = document.createElement('button');
        b.className = 'btn' + (k.primary ? ' primary' : '');
        b.textContent = k.text;
        b.addEventListener('click', () => close(k.value));
        box.appendChild(b);
      }

      // A click beside the card cancels — as with every other dialog.
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); }
        // Enter cancels, it does not confirm. With "delete transcript?" the return
        // key would otherwise be the destructive answer — and that is exactly the one
        // people press out of habit.
        if (e.key === 'Enter') { e.preventDefault(); close(false); }
      }
      // Before the application's handler, so Escape does not also close the
      // window underneath.
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(d);
      // The cancelling button gets the focus: anyone confirming blindly should
      // not break anything.
      box.firstElementChild?.focus();
    });
  }

  /* ---------- Colour picker ----------

     Our own rather than <input type="color">: the native one opens the system
     colour picker, and that breaks every skin. Layout: an area for saturation
     and lightness, a slider for the hue, a field for the hex value. */

  function hsvNachHex(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(x * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(5) + f(3) + f(1);
  }

  function hexNachHsv(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function colorPicker(field, onChange) {
    const root = document.createElement('div');
    root.className = 'colorPicker';
    root.innerHTML =
      '<button type="button" class="swatch"></button>' +
      '<div class="swatchField" hidden>' +
      '  <div class="swatchArea"><i class="swatchDot"></i></div>' +
      '  <div class="swatchHue"><i class="swatchHueDot"></i></div>' +
      '  <input class="swatchHex" spellcheck="false" maxlength="7">' +
      '</div>';
    field.after(root);
    field.hidden = true;

    const swatch = $$('.swatch', root);
    const kasten = $$('.swatchField', root);
    const pane = $$('.swatchArea', root);
    const punkt = $$('.swatchDot', root);
    const hue = $$('.swatchHue', root);
    const tonPunkt = $$('.swatchHueDot', root);
    const hex = $$('.swatchHex', root);

    let hsv = hexNachHsv(field.value) || { h: 40, s: 1, v: 1 };

    const render = (announce) => {
      const color = hsvNachHex(hsv.h, hsv.s, hsv.v);
      swatch.style.background = color;
      pane.style.background =
        `linear-gradient(to top, #000, transparent), ` +
        `linear-gradient(to right, #fff, ${hsvNachHex(hsv.h, 1, 1)})`;
      punkt.style.left = hsv.s * 100 + '%';
      punkt.style.top = (1 - hsv.v) * 100 + '%';
      tonPunkt.style.left = (hsv.h / 360) * 100 + '%';
      if (document.activeElement !== hex) hex.value = color;
      field.value = color;
      if (announce !== false) onChange?.(color);
    };

    const ziehen = (el, beiPunkt) => {
      const los = (e) => {
        const r = el.getBoundingClientRect();
        beiPunkt(
          Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
        render();
      };
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        los(e);
        const bewegen = (ev) => los(ev);
        const ende = () => {
          document.removeEventListener('mousemove', bewegen);
          document.removeEventListener('mouseup', ende);
        };
        document.addEventListener('mousemove', bewegen);
        document.addEventListener('mouseup', ende);
      });
    };

    ziehen(pane, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    ziehen(hue, (x) => { hsv.h = x * 360; });

    hex.addEventListener('input', () => {
      const sheet = hexNachHsv(hex.value);
      if (sheet) { hsv = sheet; render(); }
    });

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      kasten.hidden = !kasten.hidden;
      if (!kasten.hidden) render(false);
    });
    document.addEventListener('mousedown', (e) => {
      if (!root.contains(e.target)) kasten.hidden = true;
    });

    render(false);
    return {
      set(color) {
        const sheet = hexNachHsv(color);
        if (sheet) { hsv = sheet; render(false); }
      },
    };
  }

  /* Our own tooltips instead of title="".
     A title attribute makes the operating system draw a grey box — in the
     middle of a UI that takes nothing else from the system. It appears with a
     delay, ignores every skin and cannot be placed. Hence data-tip: same
     purpose, but drawn like everything else. */
  let tippEl = null;
  let tippTimer = null;

  function showTip(el) {
    const text = el.dataset.tip;
    if (!text) return;
    if (!tippEl) {
      tippEl = document.createElement('div');
      tippEl.className = 'tip';
      document.body.appendChild(tippEl);
    }
    tippEl.textContent = text;
    tippEl.hidden = false;

    // Measure first, then place: otherwise a long tip at the edge pushes the
    // window open.
    const k = el.getBoundingClientRect();
    const t = tippEl.getBoundingClientRect();
    let x = k.left + k.width / 2 - t.width / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - t.width - 6));
    // Below the element, unless there is no room left there.
    const y = k.bottom + 8 + t.height > window.innerHeight ? k.top - t.height - 8 : k.bottom + 8;
    tippEl.style.left = Math.round(x) + 'px';
    tippEl.style.top = Math.round(Math.max(6, y)) + 'px';
  }

  function tippWeg() {
    clearTimeout(tippTimer);
    if (tippEl) tippEl.hidden = true;
  }

  function bindTips() {
    const einstieg = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (!el) return;
      clearTimeout(tippTimer);
      tippTimer = setTimeout(() => showTip(el), 400);
    };
    document.addEventListener('mouseover', einstieg);
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('[data-tip]')) tippWeg();
    });
    // While clicking and scrolling the tip only gets in the way.
    document.addEventListener('mousedown', tippWeg, true);
    document.addEventListener('scroll', tippWeg, true);
    // Keyboard use: on focus immediately, without the delay.
    document.addEventListener('focusin', (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el) showTip(el);
    });
    document.addEventListener('focusout', tippWeg);
  }

  window.plxrUI = {
    colorPicker,
    bindTips,
    replaceSelects() { document.querySelectorAll('select').forEach(makeSelect); },
    // Capitals as in the rest of the markup: crt sets text-transform, the other
    // skins do not — a small "ja" next to a large "ABBRECHEN" stood out at once.
    confirm: (text, title = window.tr ? window.tr('dialog.sureTitle') : 'Are you sure?') =>
      dialog(title, text, [{ text: window.tr ? window.tr('common.cancel') : 'CANCEL', value: false }, { text: window.tr ? window.tr('common.yes') : 'YES', value: true, primary: true }]),
    notice: (text, title = window.tr ? window.tr('dialog.noticeTitle') : 'Notice') =>
      dialog(title, text, [{ text: 'OK', value: true, primary: true }]),

    /* Ask for a piece of text. Like confirm(), only with an input field — and here
       Enter may confirm, because nothing destructive hangs off it. */
    prompt(text, title = window.tr ? window.tr('dialog.promptTitle') : 'Input', preset = '') {
      return new Promise((done) => {
        if (openDialog) openDialog.remove();
        const d = document.createElement('div');
        openDialog = d;
        d.className = 'backdrop';
        d.innerHTML =
          '<div class="card"><b class="cardTitle"></b>' +
          '<p class="dialogText"></p><input class="promptInput" spellcheck="false">' +
          '<div class="cardButtons">' +
          '<button class="btn" data-w="0">ABBRECHEN</button>' +
          '<button class="btn primary" data-w="1">OK</button></div></div>';
        $$('.cardTitle', d).textContent = title;
        $$('.dialogText', d).textContent = text;
        const field = $$('.promptInput', d);
        field.value = preset;

        const close = (value) => {
          d.remove();
          openDialog = null;
          document.removeEventListener('keydown', onKey, true);
          done(value);
        };
        for (const b of d.querySelectorAll('[data-w]')) {
          b.addEventListener('click', () => close(b.dataset.w === '1' ? field.value.trim() : null));
        }
        d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });

        function onKey(e) {
          if (e.key === 'Escape') { e.stopPropagation(); close(null); }
          if (e.key === 'Enter') { e.preventDefault(); close(field.value.trim()); }
        }
        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(d);
        field.focus();
        field.select();
      });
    },
  };
})();
