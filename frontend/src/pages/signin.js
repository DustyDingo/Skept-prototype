import { getMe, requestMagicLink } from '../api.js';

async function init() {
  const res = await getMe();
  if (res.ok) {
    window.location.href = '/verify.html';
    return;
  }

  const form = document.getElementById('signin-form');
  const emailInput = document.getElementById('email');
  const submitBtn = document.getElementById('submit-btn');
  const confirmation = document.getElementById('confirmation');
  const errorBox = document.getElementById('error-box');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    errorBox.style.display = 'none';

    try {
      const res = await requestMagicLink(email);
      if (res.ok) {
        form.style.display = 'none';
        confirmation.style.display = 'block';
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body.error === 'too_many_requests'
          ? 'Too many requests. Please wait an hour before trying again.'
          : body.error === 'invalid_email'
          ? 'Please enter a valid email address.'
          : 'Something went wrong. Please try again.';
        showError(msg);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send magic link';
      }
    } catch {
      showError('Network error. Please check your connection.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send magic link';
    }
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }
}

init();
