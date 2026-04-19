(() => {
  const content = document.querySelector('.content');
  if (!content) return;

  const pageKey = 'typed_' + location.pathname;
  const navEntry = performance.getEntriesByType('navigation')[0];
  const isReload = (navEntry && navEntry.type === 'reload') ||
                   performance.navigation.type === 1;
  if (isReload) sessionStorage.removeItem(pageKey);
  if (sessionStorage.getItem(pageKey)) return;
  sessionStorage.setItem(pageKey, '1');

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const originals = textNodes.map(n => n.textContent);
  textNodes.forEach(n => n.textContent = '');

  let nodeIdx = 0, charIdx = 0;
  const CHARS_PER_FRAME = 5;

  function type() {
    if (nodeIdx >= textNodes.length) return;
    for (let i = 0; i < CHARS_PER_FRAME; i++) {
      if (nodeIdx >= textNodes.length) break;
      const orig = originals[nodeIdx];
      charIdx++;
      textNodes[nodeIdx].textContent = orig.slice(0, charIdx);
      if (charIdx >= orig.length) {
        nodeIdx++;
        charIdx = 0;
      }
    }
    requestAnimationFrame(type);
  }

  requestAnimationFrame(type);
})();
