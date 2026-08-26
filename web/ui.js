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
    wurzel.className = 'auswahl';
    wurzel.innerHTML = '<button type="button" class="auswahlKnopf"><span class="auswahlText"></span><i class="auswahlPfeil">▾</i></button><div class="auswahlListe" hidden></div>';
    sel.after(wurzel);

    const knopf = $$('.auswahlKnopf', wurzel);
    const text = $$('.auswahlText', wurzel);
    const liste = $$('.auswahlListe', wurzel);
    if (sel.title) knopf.title = sel.title;

    const zeichnen = () => {
      text.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      liste.innerHTML = '';
      for (const kind of sel.children) {
        if (kind.tagName === 'OPTGROUP') {
          const h = document.createElement('div');
          h.className = 'auswahlGruppe';
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
      d.className = 'auswahlZeile';
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
      wurzel.dataset.richtung = platz < Math.min(320, liste.scrollHeight + 16) ? 'hoch' : 'runter';
      const g = $$('[data-gewaehlt]', liste);
      if (g) g.scrollIntoView({ block: 'nearest' });
    };
    const zu = () => { liste.hidden = true; delete wurzel.dataset.offen; };

    knopf.addEventListener('click', (e) => { e.stopPropagation(); liste.hidden ? auf() : zu(); });
    document.addEventListener('click', (e) => { if (!wurzel.contains(e.target)) zu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zu(); });
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
      d.className = 'frageHof';
      d.innerHTML = '<div class="frage"><b class="frageTitel"></b><p class="frageText"></p><div class="frageKnoepfe"></div></div>';
      $$('.frageTitel', d).textContent = titel;
      $$('.frageText', d).textContent = text;

      const box = $$('.frageKnoepfe', d);
      for (const k of knoepfe) {
        const b = document.createElement('button');
        b.className = 'btn' + (k.haupt ? ' primary' : '');
        b.textContent = k.text;
        b.addEventListener('click', () => { d.remove(); offen = null; fertig(k.wert); });
        box.appendChild(b);
      }
      document.body.appendChild(d);
      box.lastElementChild?.focus();

      const taste = (e) => {
        if (e.key === 'Escape') { d.remove(); offen = null; document.removeEventListener('keydown', taste); fertig(false); }
        if (e.key === 'Enter') { d.remove(); offen = null; document.removeEventListener('keydown', taste); fertig(knoepfe[knoepfe.length - 1].wert); }
      };
      document.addEventListener('keydown', taste);
    });
  }

  window.plxrUI = {
    auswahlAlle() { document.querySelectorAll('select').forEach(auswahl); },
    frage: (text, titel = 'Sicher?') =>
      dialog(titel, text, [{ text: 'abbrechen', wert: false }, { text: 'ja', wert: true, haupt: true }]),
    hinweis: (text, titel = 'Hinweis') =>
      dialog(titel, text, [{ text: 'ok', wert: true, haupt: true }]),
  };
})();
