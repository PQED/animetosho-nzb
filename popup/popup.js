// ==== popup/popup.js ====
// ---------------------------------------------------------------
// UI element references
// ---------------------------------------------------------------
const $search  = document.getElementById('search');
const $refresh = document.getElementById('btnRefresh');
const $list    = document.getElementById('list');
const $status  = document.getElementById('status');

// ---------------------------------------------------------------
// Helper functions (status line, rendering)
// ---------------------------------------------------------------
function setStatus(msg, error = false) {
  $status.textContent = msg;
  $status.style.color = error ? '#c00' : '#666';
}

function render(providers) {
  $list.innerHTML = '';
  if (!providers.length) {
    $list.innerHTML = '<li>(no results)</li>';
    return;
  }
  providers.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.title} (${(p.size/1024/1024).toFixed(1)} MiB)`;
    li.title = new Date(p.date).toLocaleString();
    li.dataset.nzbUrl = p.nzb_url;
    li.dataset.title  = p.title;
    $list.appendChild(li);
  });
}

// ---------------------------------------------------------------
// Simple wrapper around chrome.runtime.sendMessage
// ---------------------------------------------------------------
function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

// ---------------------------------------------------------------
// 1️⃣  Load the cached list when the popup opens
// ---------------------------------------------------------------
async function loadInitial() {
  setStatus('Loading…');
  const resp = await sendMessage({type: 'list'});
  if (!resp.ok) {
    setStatus('Error: ' + resp.error, true);
    return;
  }
  render(resp.providers);
  setStatus(`Loaded ${resp.providers.length} releases`);
}
loadInitial();

// ---------------------------------------------------------------
// 2️⃣  Search (debounced)
// ---------------------------------------------------------------
let debounceTimer = null;
$search.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const query = $search.value.trim();
    // Empty query → show the cached list again
    if (!query) { loadInitial(); return; }

    setStatus('Searching…');
    const resp = await sendMessage({type: 'search', query});
    if (!resp.ok) {
      setStatus('Search error: ' + resp.error, true);
      return;
    }
    render(resp.providers);
    setStatus(`Found ${resp.providers.length} result(s)`);
  }, 300);
});

// ---------------------------------------------------------------
// 3️⃣  Refresh button – forces a fresh download of the remote feed
// ---------------------------------------------------------------
$refresh.addEventListener('click', async () => {
  setStatus('Refreshing…');
  const resp = await sendMessage({type: 'list', forceRefresh: true});
  if (!resp.ok) {
    setStatus('Refresh failed: ' + resp.error, true);
    return;
  }
  render(resp.providers);
  setStatus(`Refreshed – ${resp.providers.length} items`);
});

// ---------------------------------------------------------------
// 4️⃣  Click a list item → ask background to download the NZB
// ---------------------------------------------------------------
$list.addEventListener('click', async e => {
  const li = e.target.closest('li');
  if (!li) return;

  const nzbUrl = li.dataset.nzbUrl;
  const title  = li.dataset.title;

  li.style.opacity = '0.5';
  setStatus('Downloading NZB…');

  const resp = await sendMessage({type: 'download', nzb_url: nzbUrl, title});
  li.style.opacity = '';

  if (!resp.ok) {
    setStatus('Download error: ' + resp.error, true);
    return;
  }

  // Hayase automatically adds the NZB because we returned type:"nzb"
  setStatus('Added to Hayase queue');
  // Close the popup after a short delay (nice UX)
  setTimeout(() => window.close && window.close(), 600);
});
