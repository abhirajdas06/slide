(() => {
  const CONCURRENCY = 3;
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const OK = /\.(jpe?g|png|mp4|webm|mov|m4v|ogv)$/i;
  const $ = id => document.getElementById(id);
  const drop = $('drop'), list = $('list');
  let queue = [], active = 0, total = 0, finished = 0, failed = 0;

  function add(files) {
    for (const f of files) {
      if (!OK.test(f.name)) continue;
      const li = document.createElement('li');
      li.innerHTML = '<span></span><span class="st">queued</span>';
      li.firstChild.textContent = f.name;
      list.appendChild(li);
      queue.push({ f, st: li.lastChild });
      total++;
    }
    $('overall').hidden = false; $('done').hidden = true;
    pump();
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) send(queue.shift());
    update();
  }

  function send(job) {
    active++;
    const fd = new FormData(); fd.append('file', job.f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/');
    xhr.setRequestHeader('X-CSRFToken', csrf);
    xhr.upload.onprogress = e => { if (e.lengthComputable) job.st.textContent = Math.round(e.loaded / e.total * 100) + '%'; };
    xhr.onload = () => {
      if (xhr.status === 200) { job.st.textContent = 'done'; job.st.className = 'st ok'; }
      else {
        failed++; let m = 'failed';
        try { m = JSON.parse(xhr.responseText).error; } catch (_) {}
        job.st.textContent = m; job.st.className = 'st err';
      }
      end();
    };
    xhr.onerror = () => { failed++; job.st.textContent = 'network error'; job.st.className = 'st err'; end(); };
    xhr.send(fd);
    function end() { active--; finished++; pump(); }
  }

  function update() {
    $('obar').style.width = (total ? finished / total * 100 : 0) + '%';
    $('otext').textContent = `${finished} / ${total}` + (failed ? ` (${failed} failed)` : '');
    if (finished === total && total) $('done').hidden = false;
  }

  $('pick').onchange = e => { add(e.target.files); e.target.value = ''; };
  $('pickdir').onchange = e => { add(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => add(e.dataTransfer.files));
})();
