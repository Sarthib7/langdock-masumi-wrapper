/**
 * Login page HTML.
 *
 * Served at `/` when no active session cookie is present.
 * After successful login, the browser is redirected to `/dashboard`.
 */

export function loginHtml(error?: string): string {
  const effectiveMode = "login";
  const errorHtml = error
    ? `<div class="error-banner" role="alert">${escHtml(error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in — Langdock Masumi</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f4;
      --panel: #ffffff;
      --panel-soft: #f1f3ef;
      --text: #1a1a18;
      --muted: #5b605a;
      --border: #d9ddd5;
      --accent: #0f6a5f;
      --accent-soft: #e4f4f1;
      --accent-text: #ffffff;
      --error-bg: #fef2f2;
      --error-text: #991b1b;
      --error-border: #fecaca;
      --input-bg: transparent;
      --shadow: 0 1px 2px rgba(20, 24, 20, 0.05);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #131512;
        --panel: #1d1f1b;
        --panel-soft: #252821;
        --text: #eaeae6;
        --muted: #b9bbb3;
        --border: #3a3b35;
        --accent: #38b7a6;
        --accent-soft: #153b35;
        --accent-text: #061f1b;
        --error-bg: #1c0f0f;
        --error-text: #f5a0a0;
        --error-border: #4a2020;
        --input-bg: transparent;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .auth-shell {
      width: 100%;
      max-width: 460px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 28px;
    }
    @media (prefers-reduced-motion: no-preference) {
      .card {
        animation: cardIn 180ms cubic-bezier(0, 0, 0.2, 1) both;
      }
      @keyframes cardIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .logo-icon {
      width: 44px;
      height: 44px;
      background: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-text);
      font-weight: 900;
      font-size: 18px;
    }
    .logo-text {
      display: block;
      font-size: 21px;
      font-weight: 750;
      letter-spacing: 0;
      line-height: 1.2;
    }
    .eyebrow {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 22px;
      line-height: 1.5;
    }
    .security-note {
      margin-bottom: 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    form {
      display: grid;
      gap: 16px;
    }
    .field {
      display: grid;
      gap: 6px;
    }
    .field label {
      font-size: 13px;
      font-weight: 650;
    }
    .field label .required {
      color: var(--accent);
      margin-left: 2px;
    }
    input[type="text"],
    input[type="password"],
    input[type="email"] {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      font: inherit;
      font-size: 15px;
      background: color-mix(in srgb, var(--panel), var(--bg) 20%);
      color: var(--text);
      transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out;
    }
    input::placeholder {
      color: color-mix(in srgb, var(--muted), transparent 25%);
    }
    input:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent), transparent 75%);
    }
    input[aria-invalid="true"] {
      border-color: var(--error-border);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--error-text), transparent 80%);
    }
    .hint {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
    }
    .error-banner {
      background: var(--error-bg);
      color: var(--error-text);
      border: 1px solid var(--error-border);
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .password-wrap {
      position: relative;
    }
    .password-wrap input {
      padding-right: 48px;
    }
    .toggle-pw {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      padding: 6px 8px;
      border-radius: 6px;
      min-height: 36px;
      min-width: 44px;
      transition: color 120ms ease-out, background-color 120ms ease-out;
    }
    .toggle-pw:hover { color: var(--text); background: var(--panel-soft); }
    .toggle-pw:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent), transparent 50%);
    }
    .submit {
      min-height: 48px;
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 12px 20px;
      background: var(--accent);
      color: var(--accent-text);
      font: inherit;
      font-size: 15px;
      font-weight: 750;
      cursor: pointer;
      transition: background-color 120ms ease-out, transform 80ms ease-out;
      margin-top: 4px;
    }
    .submit:hover {
      background: color-mix(in srgb, var(--accent), black 10%);
    }
    .submit:active {
      transform: translateY(1px);
    }
    .submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .submit:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent), transparent 50%);
    }
    .footer {
      font-size: 12px;
      color: var(--muted);
      margin-top: 20px;
      line-height: 1.5;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }
    @media (max-width: 480px) {
      body { padding: 16px; align-items: flex-start; }
      .card { padding: 22px 18px; }
    }
  </style>
</head>
<body>
  <main class="auth-shell">
  <section class="card" aria-labelledby="loginTitle">
    <div class="logo">
      <div class="logo-icon" aria-hidden="true">LM</div>
      <div>
        <span class="eyebrow">Operator access</span>
        <h1 id="loginTitle" class="logo-text">Langdock Masumi</h1>
      </div>
    </div>
    <p class="subtitle">Sign in with the admin credentials configured on this server.</p>
    <p class="security-note">Browser registration is disabled. Admin credentials must be set in the deployment environment.</p>
    ${errorHtml}
    <form id="authForm" novalidate>
      <input type="hidden" name="mode" value="${effectiveMode}" />
      <div class="field" id="usernameGroup">
        <label for="username">Username <span class="required">*</span></label>
        <input
          id="username"
          name="username"
          type="text"
          autocomplete="username"
          spellcheck="false"
          required
          minlength="3"
          maxlength="32"
          placeholder="admin"
          value=""
        />
      </div>
      <div class="field">
        <label for="password">Password <span class="required">*</span></label>
        <div class="password-wrap">
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            minlength="8"
            spellcheck="false"
          />
          <button type="button" class="toggle-pw" id="togglePw" aria-label="Show password">Show</button>
        </div>
      </div>
      <div id="formError" class="error-banner" role="alert" style="display:none"></div>
      <button class="submit" type="submit" id="submitBtn">Sign in</button>
    </form>
    <p class="footer">
      Sessions use secure HTTP-only cookies. Failed login attempts are rate limited.
    </p>
  </section>
  </main>

  <script>
    (function() {
      var form = document.getElementById('authForm');
      var modeInput = form.elements.mode;
      var submitBtn = document.getElementById('submitBtn');
      var formError = document.getElementById('formError');

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        formError.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.textContent = 'Signing in...';

        var payload = {
          mode: modeInput.value,
          username: form.elements.username.value.trim(),
          password: form.elements.password.value
        };

        fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function(res) {
          return res.json().then(function(data) {
            if (!res.ok) {
              throw new Error(data.message || 'Authentication failed.');
            }
            window.location.href = '/dashboard';
          });
        }).catch(function(err) {
          formError.textContent = err instanceof Error ? err.message : 'Something went wrong.';
          formError.style.display = '';
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
          submitBtn.textContent = 'Sign in';
        });
      });

      document.getElementById('username').focus();

      var togglePw = document.getElementById('togglePw');
      var pwInput = document.getElementById('password');
      togglePw.addEventListener('click', function() {
        var showing = pwInput.type === 'text';
        pwInput.type = showing ? 'password' : 'text';
        togglePw.textContent = showing ? 'Show' : 'Hide';
        togglePw.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    })();
  </script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
