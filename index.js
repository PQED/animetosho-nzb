export async function search(query, config) {
  const url = `${config.apiUrl}?t=search&cat=5070&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  const data = await resp.json();

  return data.items.map(i => ({
    title: i.title,
    nzbUrl: i.link.replace('rss2', 'nzb')   // feed provides .nzb links
  }));
}
