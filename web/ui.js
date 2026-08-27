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
    if (sel.dataset.eigen) return;
    sel.dataset.eigen = 'ja';
    sel.hidden = true;

    const wurzel = document.createElement('div');
    wurzel.className = 'select';
    wurzel.innerHTML = '<button type="button" class="selectButton"><span class="auswahlText"></span><i class="selectArrow">▾</i></button><div class="selectList" hidden></div>';
    sel.after(wurzel);

    const button = $$('.selectButton', wurzel);
    const text = $$('.auswahlText', wurzel);
    const list = $$('.selectList', wurzel);
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
      d.dataset.wert = o.value;
      if (o.value === sel.value) d.dataset.picked = 'ja';
      d.addEventListener('click', () => {
        sel.value = o.value;
        // The rest of the code listens for 'change' on the real element.
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        zu();
        render();
      });
      return d;
    };

    const auf = () => {
      render();
      list.hidden = false;
      wurzel.dataset.offen = 'ja';
      // Open upwards when there is no room below.
      const platz = window.innerHeight - button.getBoundingClientRect().bottom;
      wurzel.dataset.richtung = platz < Math.min(320, list.scrollHeight + 16) ? 'tall' : 'runter';
      const g = $$('[data-gewaehlt]', list);
      if (g) g.scrollIntoView({ block: 'nearest' });
    };
    const zu = () => { list.hidden = true; delete wurzel.dataset.offen; };

    button.addEventListener('click', (e) => { e.stopPropagation(); list.hidden ? auf() : zu(); });
    document.addEventListener('click', (e) => { if (!wurzel.contains(e.target)) zu(); });
    document.addEventListener('keydown', (e) => {
      // Only while this list is open — otherwise an Escape anywhere in the
      // window would close the dialog underneath as well.
      if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); zu(); }
    }, true);
    // Changes from outside (on load, say) have to become visible.
    sel.addEventListener('change', render);
    new MutationObserver(render).observe(sel, { childList: true, subtree: true });
    render();
  }

  /* ---------- Confirmation and notice ---------- */

  let offen = null;

  function dialog(titel, text, buttons) {
    return new Promise((fertig) => {
      if (offen) offen.remove();
      const d = document.createElement('div');
      offen = d;
      // Deliberately the same classes as the other dialogs: otherwise no skin
      // styles them and the confirmation stands naked on the page.
      d.className = 'backdrop';
      d.innerHTML =
        '<div class="card"><b class="cardTitle"></b>' +
        '<p class="dialogText"></p><div class="cardButtons"></div></div>';
      $$('.cardTitle', d).textContent = titel;
      $$('.dialogText', d).textContent = text;

      const close = (wert) => {
        d.remove();
        offen = null;
        document.removeEventListener('keydown', taste, true);
        fertig(wert);
      };

      const box = $$('.cardButtons', d);
      for (const k of buttons) {
        const b = document.createElement('button');
        b.className = 'btn' + (k.haupt ? ' primary' : '');
        b.textContent = k.text;
        b.addEventListener('click', () => close(k.wert));
        box.appendChild(b);
      }

      // A click beside the card cancels — as with every other dialog.
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });

      function taste(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); }
        // Enter cancels, it does not confirm. With "delete transcript?" the return
        // key would otherwise be the destructive answer — and that is exactly the one
        // people press out of habit.
        if (e.key === 'Enter') { e.preventDefault(); close(false); }
      }
      // Before the application's handler, so Escape does not also close the
      // window underneath.
      document.addEventListener('keydown', taste, true);
      document.body.appendChild(d);
      // The cancelling button gets the focus: anyone confirming blindly should
      // nichts kaputtmachen.
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
    const wurzel = document.createElement('div');
    wurzel.className = 'colorPicker';
    wurzel.innerHTML =
      '<button type="button" class="swatch"></button>' +
      '<div class="swatchField" hidden>' +
      '  <div class="swatchArea"><i class="swatchDot"></i></div>' +
      '  <div class="swatchHue"><i class="swatchHueDot"></i></div>' +
      '  <input class="swatchHex" spellcheck="false" maxlength="7">' +
      '</div>';
    field.after(wurzel);
    field.hidden = true;

    const tupfer = $$('.swatch', wurzel);
    const kasten = $$('.swatchField', wurzel);
    const pane = $$('.swatchArea', wurzel);
    const punkt = $$('.swatchDot', wurzel);
    const ton = $$('.swatchHue', wurzel);
    const tonPunkt = $$('.swatchHueDot', wurzel);
    const hex = $$('.swatchHex', wurzel);

    let hsv = hexNachHsv(field.value) || { h: 40, s: 1, v: 1 };

    const render = (melden) => {
      const wert = hsvNachHex(hsv.h, hsv.s, hsv.v);
      tupfer.style.background = wert;
      pane.style.background =
        `linear-gradient(to top, #000, transparent), ` +
        `linear-gradient(to right, #fff, ${hsvNachHex(hsv.h, 1, 1)})`;
      punkt.style.left = hsv.s * 100 + '%';
      punkt.style.top = (1 - hsv.v) * 100 + '%';
      tonPunkt.style.left = (hsv.h / 360) * 100 + '%';
      if (document.activeElement !== hex) hex.value = wert;
      field.value = wert;
      if (melden !== false) onChange?.(wert);
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
    ziehen(ton, (x) => { hsv.h = x * 360; });

    hex.addEventListener('input', () => {
      const neu = hexNachHsv(hex.value);
      if (neu) { hsv = neu; render(); }
    });

    tupfer.addEventListener('click', (e) => {
      e.stopPropagation();
      kasten.hidden = !kasten.hidden;
      if (!kasten.hidden) render(false);
    });
    document.addEventListener('mousedown', (e) => {
      if (!wurzel.contains(e.target)) kasten.hidden = true;
    });

    render(false);
    return {
      set(wert) {
        const neu = hexNachHsv(wert);
        if (neu) { hsv = neu; render(false); }
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

  function showTip(ziel) {
    const text = ziel.dataset.tip;
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
    const k = ziel.getBoundingClientRect();
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

  function tippBinden() {
    const einstieg = (e) => {
      const ziel = e.target.closest?.('[data-tip]');
      if (!ziel) return;
      clearTimeout(tippTimer);
      tippTimer = setTimeout(() => showTip(ziel), 400);
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
      const ziel = e.target.closest?.('[data-tip]');
      if (ziel) showTip(ziel);
    });
    document.addEventListener('focusout', tippWeg);
  }

  window.plxrUI = {
    colorPicker,
    tippBinden,
    replaceSelects() { document.querySelectorAll('select').forEach(makeSelect); },
    // Capitals as in the rest of the markup: crt sets text-transform, the other
    // skins do not — a small "ja" next to a large "ABBRECHEN" stood out at once.
    confirm: (text, titel = 'Sicher?') =>
      dialog(titel, text, [{ text: 'ABBRECHEN', wert: false }, { text: 'JA', wert: true, haupt: true }]),
    notice: (text, titel = 'Hinweis') =>
      dialog(titel, text, [{ text: 'OK', wert: true, haupt: true }]),

    /* Ask for a piece of text. Like confirm(), only with an input field — and here
       Enter may confirm, because nothing destructive hangs off it. */
    prompt(text, titel = 'Eingabe', vorgabe = '') {
      return new Promise((fertig) => {
        if (offen) offen.remove();
        const d = document.createElement('div');
        offen = d;
        d.className = 'backdrop';
        d.innerHTML =
          '<div class="card"><b class="cardTitle"></b>' +
          '<p class="dialogText"></p><input class="promptInput" spellcheck="false">' +
          '<div class="cardButtons">' +
          '<button class="btn" data-w="0">ABBRECHEN</button>' +
          '<button class="btn primary" data-w="1">OK</button></div></div>';
        $$('.cardTitle', d).textContent = titel;
        $$('.dialogText', d).textContent = text;
        const field = $$('.promptInput', d);
        field.value = vorgabe;

        const close = (wert) => {
          d.remove();
          offen = null;
          document.removeEventListener('keydown', taste, true);
          fertig(wert);
        };
        for (const b of d.querySelectorAll('[data-w]')) {
          b.addEventListener('click', () => close(b.dataset.w === '1' ? field.value.trim() : null));
        }
        d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });

        function taste(e) {
          if (e.key === 'Escape') { e.stopPropagation(); close(null); }
          if (e.key === 'Enter') { e.preventDefault(); close(field.value.trim()); }
        }
        document.addEventListener('keydown', taste, true);

        document.body.appendChild(d);
        field.focus();
        field.select();
      });
    },
  };
})();
