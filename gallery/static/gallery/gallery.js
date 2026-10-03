(() => {
  const $ = id => document.getElementById(id);
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const CHUNK = 80;
  let items = [], rendered = 0, selecting = false;
  const selected = new Set();
  const grid = $('grid');

  /* ---------- grid (rendered in chunks, thumbnails lazy-loaded) ---------- */
  fetch('/api/items/').then(r => r.json()).then(d => {
    items = d.items;
    $('count').textContent = items.length + ' items';
    $('empty').hidden = items.length > 0;
    $('playall').hidden = !items.length; $('selbtn').hidden = !items.length;
    renderMore();
    new IntersectionObserver(es => { if (es[0].isIntersecting) renderMore(); }, { rootMargin: '1200px' }).observe($('sentinel'));
  });

  function renderMore() {
    const frag = document.createDocumentFragment();
    for (const it of items.slice(rendered, rendered + CHUNK)) {
      const t = document.createElement('div');
      t.className = 'tile'; t.dataset.id = it.id; t.dataset.i = rendered++;
      if (it.t) {
        const img = new Image();
        img.loading = 'lazy'; img.decoding = 'async'; img.alt = it.n; img.src = it.t;
        img.onload = () => img.classList.add('in');
        t.appendChild(img);
      }
      if (it.k === 'video') {
        if (!it.t) t.insertAdjacentHTML('beforeend', '<div class="vid">&#127916;</div>');
        t.insertAdjacentHTML('beforeend', '<span class="badge">&#9654; video</span>');
      }
      t.insertAdjacentHTML('beforeend', '<span class="chk"></span>');
      frag.appendChild(t);
    }
    grid.appendChild(frag);
  }

  grid.addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    if (selecting) {
      const id = +t.dataset.id;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      t.classList.toggle('sel', selected.has(id));
      $('delbtn').textContent = `Delete (${selected.size})`;
    } else openShow(+t.dataset.i);
  });

  $('selbtn').onclick = () => {
    selecting = !selecting; selected.clear();
    grid.classList.toggle('selecting', selecting);
    grid.querySelectorAll('.sel').forEach(n => n.classList.remove('sel'));
    $('selbtn').textContent = selecting ? 'Cancel' : 'Select';
    $('delbtn').hidden = !selecting; $('delbtn').textContent = 'Delete (0)';
  };
  $('delbtn').onclick = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} item(s)? This cannot be undone.`)) return;
    await fetch('/api/delete/', { method: 'POST', headers: { 'X-CSRFToken': csrf }, body: JSON.stringify({ ids: [...selected] }) });
    location.reload();
  };
  $('playall').onclick = () => openShow(0);

  /* ---------- slideshow ---------- */
  const show = $('show'), layers = [$('layerA'), $('layerB')];
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem('ss.' + k)) ?? d; } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem('ss.' + k, JSON.stringify(v)); } catch (_) {} },
  };
  let order = [], pos = 0, playing = true, secs = store.get('secs', 5), cur = 0;
  let timer = null, uiTimer = null, token = 0;

  const secsSel = $('secs');
  function setSecsUI() {
    if (![...secsSel.options].some(o => o.value == secs)) {
      secsSel.insertBefore(new Option(secs + 's', secs), secsSel.lastElementChild);
    }
    secsSel.value = secs;
  }
  setSecsUI();
  $('shuffle').checked = store.get('shuffle', false);
  $('loop').checked = store.get('loop', true);

  secsSel.onchange = () => {
    if (secsSel.value === 'custom') {
      const v = parseFloat(prompt('Seconds per slide (0.5 – 600):', secs));
      if (v >= 0.5 && v <= 600) secs = v;
      setSecsUI();
    } else secs = +secsSel.value;
    store.set('secs', secs); secsSel.blur();
    if (playing) schedule();
  };

  function buildOrder(startIdx) {
    order = items.map((_, i) => i);
    if ($('shuffle').checked) {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [order[i], order[j]] = [order[j], order[i]]; }
      const k = order.indexOf(startIdx); [order[0], order[k]] = [order[k], order[0]];
      pos = 0;
    } else pos = startIdx;
  }
  $('shuffle').onchange = () => { store.set('shuffle', $('shuffle').checked); buildOrder(order[pos]); };
  $('loop').onchange = () => store.set('loop', $('loop').checked);

  function openShow(idx) {
    buildOrder(idx); playing = true; setPlaying(true);
    show.hidden = false; document.body.style.overflow = 'hidden';
    layers.forEach(l => { l.innerHTML = ''; l.classList.remove('on'); });
    go(pos); wakeUI();
  }
  function closeShow() {
    clearTimeout(timer); token++;
    layers.forEach(l => l.innerHTML = '');
    show.hidden = true; document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function makeEl(it) {
    if (it.k === 'video') {
      const v = document.createElement('video');
      v.src = it.s; v.playsInline = true; v.preload = 'auto';
      return v;
    }
    const img = new Image(); img.decoding = 'async'; img.src = it.s; return img;
  }
  function ready(el) {
    return new Promise(res => {
      if (el.tagName === 'VIDEO') { el.onloadeddata = res; el.onerror = res; }
      else if (el.complete && el.naturalWidth) res();
      else { el.onload = res; el.onerror = res; }
    });
  }

  async function go(newPos) {
    const n = items.length;
    if (newPos >= n) { if (!$('loop').checked) { setPlaying(false); return; } newPos = 0; }
    if (newPos < 0) newPos = n - 1;
    const my = ++token; clearTimeout(timer);
    const it = items[order[newPos]];
    const el = makeEl(it);
    await ready(el);
    if (my !== token) return;                     // user moved on while loading
    pos = newPos;

    const next = layers[1 - cur], old = layers[cur];
    old.querySelectorAll('video').forEach(v => v.pause());
    next.innerHTML = ''; next.appendChild(el);
    next.classList.add('on'); old.classList.remove('on');
    cur = 1 - cur;
    setTimeout(() => { if (my === token) old.innerHTML = ''; }, 600);

    $('pos').textContent = `${pos + 1} / ${n}  ·  ${it.n}`;
    preload();
    if (it.k === 'video') {
      // plays to the end, then advances (when auto mode is on)
      el.onended = () => { if (playing && my === token) go(pos + 1); };
      $('prog').style.transition = 'none'; $('prog').style.width = '0';
      if (playing) el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    } else if (playing) schedule();
  }

  const warm = [];
  function preload() {
    warm.length = 0;
    for (let d = 1; d <= 2; d++) {
      const it = items[order[(pos + d) % items.length]];
      if (it.k === 'image') { const i = new Image(); i.src = it.s; warm.push(i); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    const p = $('prog');
    p.style.transition = 'none'; p.style.width = '0';
    if (items[order[pos]].k === 'video') return;
    p.offsetWidth;
    p.style.transition = `width ${secs}s linear`; p.style.width = '100%';
    timer = setTimeout(() => go(pos + 1), secs * 1000);
  }

  function setPlaying(v) {
    playing = v;
    $('play').innerHTML = v ? '&#10074;&#10074;' : '&#9654;';
    if (show.hidden) return;
    const vid = layers[cur].querySelector('video');
    if (v) { if (vid) vid.play().catch(() => {}); else schedule(); }
    else {
      clearTimeout(timer);
      const p = $('prog'); p.style.transition = 'none'; p.style.width = '0';
      if (vid) vid.pause();
    }
  }

  $('play').onclick = () => setPlaying(!playing);
  $('next').onclick = () => go(pos + 1);
  $('prev').onclick = () => go(pos - 1);
  $('close').onclick = closeShow;
  $('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : show.requestFullscreen().catch(() => {});

  addEventListener('keydown', e => {
    if (show.hidden || e.target.tagName === 'SELECT') return;
    const k = e.key;
    if (k === 'ArrowRight') go(pos + 1);
    else if (k === 'ArrowLeft') go(pos - 1);
    else if (k === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (k === 'Escape' && !document.fullscreenElement) closeShow();
    else if (k === 'f' || k === 'F') $('fs').click();
    else return;
    wakeUI();
  });

  // auto-hide controls
  function wakeUI() {
    show.classList.add('ui'); clearTimeout(uiTimer);
    uiTimer = setTimeout(() => show.classList.remove('ui'), 2500);
  }
  show.addEventListener('mousemove', wakeUI);
  show.addEventListener('click', e => { if (!e.target.closest('.controls,.nav')) wakeUI(); });

  // swipe
  let tx = null;
  show.addEventListener('touchstart', e => { tx = e.touches[0].clientX; wakeUI(); }, { passive: true });
  show.addEventListener('touchend', e => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 50) go(pos + (dx < 0 ? 1 : -1));
  });
})();
