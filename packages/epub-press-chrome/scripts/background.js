import Browser from './browser';

const BASE_API = 'https://epub.press/api/v1';
const TIMEOUT_ALARM = 'downloadTimeout';
const POLLING_ALARM = 'statusPolling';

function handleError(e) {
  chrome.alarms.clearAll();
  Browser.setLocalStorage({
    downloadState: false,
    publishStatus: '{}',
    pollingBookId: null,
    bookTitle: null,
  });
  Browser.sendMessage({ action: 'download', status: 'failed', error: e.message });
}

async function handleDownload(bookId) {
  try {
    const { email, filetype, bookTitle } = await Browser.getLocalStorage(['email', 'filetype', 'bookTitle']);
    const effectiveFiletype = filetype || 'epub';
    const title = bookTitle || 'ebook';

    if (email && email.trim()) {
      const emailUrl = `${BASE_API}/books/${bookId}/email?email=${encodeURIComponent(email.trim())}&filetype=${effectiveFiletype}`;
      const res = await fetch(emailUrl);
      if (!res.ok) throw new Error('Email delivery failed.');
    } else {
      const downloadUrl = `${BASE_API}/books/${bookId}/download?filetype=${effectiveFiletype}`;
      await Browser.download({
        filename: `${title}.${effectiveFiletype}`,
        url: downloadUrl,
      });
    }

    Browser.setLocalStorage({ downloadState: false, publishStatus: '{}' });
    Browser.sendMessage({ action: 'download', status: 'complete' });
  } catch (e) {
    handleError(e);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TIMEOUT_ALARM) {
    handleError(new Error('Download took too long to complete.'));
  } else if (alarm.name === POLLING_ALARM) {
    const { pollingBookId } = await Browser.getLocalStorage('pollingBookId');
    if (!pollingBookId) {
      chrome.alarms.clear(POLLING_ALARM);
      return;
    }

    try {
      const res = await fetch(`${BASE_API}/books/${pollingBookId}/status`);
      if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`);
      const status = await res.json();

      Browser.setLocalStorage({ publishStatus: JSON.stringify(status) });
      Browser.sendMessage({ action: 'statusUpdate', ...status });

      if (status.progress >= 100) {
        chrome.alarms.clearAll();
        Browser.setLocalStorage({ pollingBookId: null });
        handleDownload(pollingBookId);
      }
    } catch (e) {
      handleError(e);
    }
  }
});

Browser.onForegroundMessage(async (request) => {
  if (request.action === 'download') {
    await Browser.setLocalStorage({
      downloadState: true,
      publishStatus: '{}',
      bookTitle: request.book.title,
    });
    chrome.alarms.create(TIMEOUT_ALARM, { delayInMinutes: 5 });

    try {
      const res = await fetch(`${BASE_API}/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          title: request.book.title,
          description: request.book.description,
          sections: request.book.sections,
        }),
      });

      if (!res.ok) throw new Error(`Publish failed: ${res.statusText}`);
      const publishResponse = await res.json();
      const { id: bookId } = publishResponse;

      await Browser.setLocalStorage({ pollingBookId: bookId });
      chrome.alarms.create(POLLING_ALARM, { periodInMinutes: 1 / 12 }); // ~5 seconds
    } catch (e) {
      handleError(e);
    }
  }
});
