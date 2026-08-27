/* plxr — eigene Bedienelemente.

   Kein <select>, kein confirm(), kein alert(): die zeichnet das Betriebssystem,
   und damit ist jeder Skin an genau der Stelle durchbrochen, an der man ihn am
   meisten sieht. Alles hier ist gewöhnliches Markup, das der Skin gestaltet.

   Die <select>-Elemente bleiben im HTML stehen — sie halten weiterhin Wert und
   Optionen, und der übrige Code liest sie unverändert. Sichtbar ist nur die
   Hülle daneben. */

(function () {
  const $$ = (s, w = document) => w.querySelector(s);

  /* ---------- Auswahlliste ---------- */

  function auswahl(sel) {
    if (sel.dataset.eigen) return;
    sel.dataset.eigen = 'ja';
    sel.hidden = true;

    const wurzel = document.createElement('div');
    wurzel.className = 'select';
    wurzel.innerHTML = '<button type="button" class="selectButton"><span class="auswahlText"></span><i class="selectArrow">▾</i></button><div class="selectList" hidden></div>';
    sel.after(wurzel);

    const knopf = $$('.selectButton', wurzel);
    const text = $$('.auswahlText', wurzel);
    const liste = $$('.selectList', wurzel);
    if (sel.dataset.tip) knopf.dataset.tip = sel.dataset.tip;

    const zeichnen = () => {
      text.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      liste.innerHTML = '';
      for (const kind of sel.children) {
        if (kind.tagName === 'OPTGROUP') {
          const h = document.createElement('div');
          h.className = 'selectGroup';
          h.textContent = kind.label;
          liste.appendChild(h);
          for (const o of kind.children) liste.appendChild(zeile(o));
        } else {
          liste.appendChild(zeile(kind));
        }
      }
    };

    const zeile = (o) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'selectRow';
      d.textContent = o.textContent;
      d.dataset.wert = o.value;
      if (o.value === sel.value) d.dataset.gewaehlt = 'ja';
      d.addEventListener('click', () => {
        sel.value = o.value;
        // Der übrige Code hört auf 'change' des echten Elements.
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        zu();
        zeichnen();
      });
      return d;
    };

    const auf = () => {
      zeichnen();
      liste.hidden = false;
      wurzel.dataset.offen = 'ja';
      // Nach oben klappen, wenn unten kein Platz ist.
      const platz = window.innerHeight - knopf.getBoundingClientRect().bottom;
      wurzel.dataset.richtung = platz < Math.min(320, liste.scrollHeight + 16) ? 'tall' : 'runter';
      const g = $$('[data-gewaehlt]', liste);
      if (g) g.scrollIntoView({ block: 'nearest' });
    };
    const zu = () => { liste.hidden = true; delete wurzel.dataset.offen; };

    knopf.addEventListener('click', (e) => { e.stopPropagation(); liste.hidden ? auf() : zu(); });
    document.addEventListener('click', (e) => { if (!wurzel.contains(e.target)) zu(); });
    document.addEventListener('keydown', (e) => {
      // Nur wenn diese Liste offen ist — sonst schließt ein Escape irgendwo
      // im Fenster auch noch den Dialog darunter.
      if (e.key === 'Escape' && !liste.hidden) { e.stopPropagation(); zu(); }
    }, true);
    // Änderungen von außen (etwa beim Laden) müssen sichtbar werden.
    sel.addEventListener('change', zeichnen);
    new MutationObserver(zeichnen).observe(sel, { childList: true, subtree: true });
    zeichnen();
  }

  /* ---------- Rückfrage und Hinweis ---------- */

  let offen = null;

  function dialog(titel, text, knoepfe) {
    return new Promise((fertig) => {
      if (offen) offen.remove();
      const d = document.createElement('div');
      offen = d;
      // Bewusst dieselben Klassen wie die übrigen Dialoge: sonst gestaltet
      // sie kein Skin und die Rückfrage steht nackt auf der Seite.
      d.className = 'backdrop';
      d.innerHTML =
        '<div class="card"><b class="cardTitle"></b>' +
        '<p class="dialogText"></p><div class="cardButtons"></div></div>';
      $$('.cardTitle', d).textContent = titel;
      $$('.dialogText', d).textContent = text;

      const schliessen = (wert) => {
        d.remove();
        offen = null;
        document.removeEventListener('keydown', taste, true);
        fertig(wert);
      };

      const box = $$('.cardButtons', d);
      for (const k of knoepfe) {
        const b = document.createElement('button');
        b.className = 'btn' + (k.haupt ? ' primary' : '');
        b.textContent = k.text;
        b.addEventListener('click', () => schliessen(k.wert));
        box.appendChild(b);
      }

      // Klick neben die Karte bricht ab — wie bei jedem anderen Dialog auch.
      d.addEventListener('mousedown', (e) => { if (e.target === d) schliessen(false); });

      function taste(e) {
        if (e.key === 'Escape') { e.stopPropagation(); schliessen(false); }
        // Enter bricht ab, nicht bestätigt. Bei "Transkript löschen?" wäre die
        // Eingabetaste sonst die zerstörerische Antwort — und genau die drückt
        // man aus Gewohnheit.
        if (e.key === 'Enter') { e.preventDefault(); schliessen(false); }
      }
      // Vor dem Handler der Anwendung, damit Escape nicht zusätzlich das
      // darunterliegende Fenster schließt.
      document.addEventListener('keydown', taste, true);
      document.body.appendChild(d);
      // Der abbrechende Knopf bekommt den Fokus: wer blind bestätigt, soll
      // nichts kaputtmachen.
      box.firstElementChild?.focus();
    });
  }

  /* ---------- Farbwahl ----------

     Eigene statt <input type="color">: die native öffnet den Farbwähler des
     Systems, und der bricht jeden Skin. Aufbau: Fläche für Sättigung und
     Helligkeit, Regler für den Farbton, Feld für den Hex-Wert. */

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

  function farbwahl(feld, beiAenderung) {
    const wurzel = document.createElement('div');
    wurzel.className = 'colorPicker';
    wurzel.innerHTML =
      '<button type="button" class="swatch"></button>' +
      '<div class="swatchField" hidden>' +
      '  <div class="swatchArea"><i class="swatchDot"></i></div>' +
      '  <div class="swatchHue"><i class="swatchHueDot"></i></div>' +
      '  <input class="swatchHex" spellcheck="false" maxlength="7">' +
      '</div>';
    feld.after(wurzel);
    feld.hidden = true;

    const tupfer = $$('.swatch', wurzel);
    const kasten = $$('.swatchField', wurzel);
    const flaeche = $$('.swatchArea', wurzel);
    const punkt = $$('.swatchDot', wurzel);
    const ton = $$('.swatchHue', wurzel);
    const tonPunkt = $$('.swatchHueDot', wurzel);
    const hex = $$('.swatchHex', wurzel);

    let hsv = hexNachHsv(feld.value) || { h: 40, s: 1, v: 1 };

    const zeichnen = (melden) => {
      const wert = hsvNachHex(hsv.h, hsv.s, hsv.v);
      tupfer.style.background = wert;
      flaeche.style.background =
        `linear-gradient(to top, #000, transparent), ` +
        `linear-gradient(to right, #fff, ${hsvNachHex(hsv.h, 1, 1)})`;
      punkt.style.left = hsv.s * 100 + '%';
      punkt.style.top = (1 - hsv.v) * 100 + '%';
      tonPunkt.style.left = (hsv.h / 360) * 100 + '%';
      if (document.activeElement !== hex) hex.value = wert;
      feld.value = wert;
      if (melden !== false) beiAenderung?.(wert);
    };

    const ziehen = (el, beiPunkt) => {
      const los = (e) => {
        const r = el.getBoundingClientRect();
        beiPunkt(
          Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
        zeichnen();
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

    ziehen(flaeche, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    ziehen(ton, (x) => { hsv.h = x * 360; });

    hex.addEventListener('input', () => {
      const neu = hexNachHsv(hex.value);
      if (neu) { hsv = neu; zeichnen(); }
    });

    tupfer.addEventListener('click', (e) => {
      e.stopPropagation();
      kasten.hidden = !kasten.hidden;
      if (!kasten.hidden) zeichnen(false);
    });
    document.addEventListener('mousedown', (e) => {
      if (!wurzel.contains(e.target)) kasten.hidden = true;
    });

    zeichnen(false);
    return {
      setzen(wert) {
        const neu = hexNachHsv(wert);
        if (neu) { hsv = neu; zeichnen(false); }
      },
    };
  }

  /* Eigene Kurzhinweise statt title="".
     Ein title-Attribut lässt das Betriebssystem eine graue Kachel zeichnen —
     mitten in einer Oberfläche, die sonst nichts vom System übernimmt. Sie
     erscheint verzögert, ignoriert jeden Skin und lässt sich nicht platzieren.
     Deshalb data-tip: gleicher Zweck, aber gezeichnet wie alles andere. */
  let tippEl = null;
  let tippTimer = null;

  function tippZeigen(ziel) {
    const text = ziel.dataset.tip;
    if (!text) return;
    if (!tippEl) {
      tippEl = document.createElement('div');
      tippEl.className = 'tip';
      document.body.appendChild(tippEl);
    }
    tippEl.textContent = text;
    tippEl.hidden = false;

    // Erst messen, dann setzen: sonst schiebt ein langer Hinweis am Rand
    // das Fenster auf.
    const k = ziel.getBoundingClientRect();
    const t = tippEl.getBoundingClientRect();
    let x = k.left + k.width / 2 - t.width / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - t.width - 6));
    // Unter das Element, es sei denn dort ist kein Platz mehr.
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
      tippTimer = setTimeout(() => tippZeigen(ziel), 400);
    };
    document.addEventListener('mouseover', einstieg);
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('[data-tip]')) tippWeg();
    });
    // Beim Klicken und beim Rollen stört der Hinweis nur.
    document.addEventListener('mousedown', tippWeg, true);
    document.addEventListener('scroll', tippWeg, true);
    // Tastaturbedienung: beim Fokussieren sofort, ohne Verzögerung.
    document.addEventListener('focusin', (e) => {
      const ziel = e.target.closest?.('[data-tip]');
      if (ziel) tippZeigen(ziel);
    });
    document.addEventListener('focusout', tippWeg);
  }

  window.plxrUI = {
    farbwahl,
    tippBinden,
    auswahlAlle() { document.querySelectorAll('select').forEach(auswahl); },
    // Versalien wie im übrigen Markup: crt setzt text-transform, die anderen
    // Skins nicht — kleines "ja" neben großem "ABBRECHEN" fiel sofort auf.
    frage: (text, titel = 'Sicher?') =>
      dialog(titel, text, [{ text: 'ABBRECHEN', wert: false }, { text: 'JA', wert: true, haupt: true }]),
    hinweis: (text, titel = 'Hinweis') =>
      dialog(titel, text, [{ text: 'OK', wert: true, haupt: true }]),

    /* Nach einem Text fragen. Wie frage(), nur mit Eingabefeld — und hier
       darf Enter bestätigen, weil nichts Zerstörerisches daran hängt. */
    eingabe(text, titel = 'Eingabe', vorgabe = '') {
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
        const feld = $$('.promptInput', d);
        feld.value = vorgabe;

        const schliessen = (wert) => {
          d.remove();
          offen = null;
          document.removeEventListener('keydown', taste, true);
          fertig(wert);
        };
        for (const b of d.querySelectorAll('[data-w]')) {
          b.addEventListener('click', () => schliessen(b.dataset.w === '1' ? feld.value.trim() : null));
        }
        d.addEventListener('mousedown', (e) => { if (e.target === d) schliessen(null); });

        function taste(e) {
          if (e.key === 'Escape') { e.stopPropagation(); schliessen(null); }
          if (e.key === 'Enter') { e.preventDefault(); schliessen(feld.value.trim()); }
        }
        document.addEventListener('keydown', taste, true);

        document.body.appendChild(d);
        feld.focus();
        feld.select();
      });
    },
  };
})();
