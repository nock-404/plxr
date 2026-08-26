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
      d.className = 'hof';
      d.innerHTML =
        '<div class="karte"><b class="kartentitel"></b>' +
        '<p class="fragetext"></p><div class="kartenknoepfe"></div></div>';
      $$('.kartentitel', d).textContent = titel;
      $$('.fragetext', d).textContent = text;

      const schliessen = (wert) => {
        d.remove();
        offen = null;
        document.removeEventListener('keydown', taste, true);
        fertig(wert);
      };

      const box = $$('.kartenknoepfe', d);
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

  window.plxrUI = {
    auswahlAlle() { document.querySelectorAll('select').forEach(auswahl); },
    // Versalien wie im übrigen Markup: crt setzt text-transform, die anderen
    // Skins nicht — kleines "ja" neben großem "ABBRECHEN" fiel sofort auf.
    frage: (text, titel = 'Sicher?') =>
      dialog(titel, text, [{ text: 'ABBRECHEN', wert: false }, { text: 'JA', wert: true, haupt: true }]),
    hinweis: (text, titel = 'Hinweis') =>
      dialog(titel, text, [{ text: 'OK', wert: true, haupt: true }]),
  };
})();
