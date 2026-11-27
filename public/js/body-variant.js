// Preview aid for comparing two looks of a page body: ?body=light marks the document so the light variant's CSS applies. Runs before the body paints.
if (new URLSearchParams(location.search).get('body') === 'light') document.documentElement.dataset.body = 'light';
