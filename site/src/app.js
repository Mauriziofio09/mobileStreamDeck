// "Kopieren"-Knöpfe an allen Befehlsblöcken (externes Skript wegen strikter CSP).
for (const pre of document.querySelectorAll('pre')) {
  const wrap = document.createElement('div');
  wrap.className = 'code';
  pre.replaceWith(wrap);
  wrap.append(pre);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = 'Kopieren';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText.trim());
      btn.textContent = 'Kopiert';
      btn.classList.add('done');
    } catch {
      btn.textContent = 'Markieren und kopieren';
    }
    setTimeout(() => {
      btn.textContent = 'Kopieren';
      btn.classList.remove('done');
    }, 1800);
  });
  wrap.append(btn);
}
