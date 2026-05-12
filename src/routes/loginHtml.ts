/**
 * Login / Register page HTML.
 *
 * Served at `/` when no active session cookie is present.
 * After successful login/register, the browser is redirected to `/dashboard`.
 */

export function loginHtml(error?: string, mode?: string): string {
  const effectiveMode = mode || "login";
  const errorHtml = error
    ? `<div class="error-banner" role="alert">${escHtml(error)}</div>`
    : "";
  const isRegister = effectiveMode === "register";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${isRegister ? "Create account" : "Sign in"} — Langdock Masumi</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5f5f0;
      --panel: #ffffff;
      --text: #1a1a18;
      --muted: #6b6e65;
      --border: #d4d6cf;
      --accent: #0d6b5e;
      --accent-hover: #0a564c;
      --accent-text: #ffffff;
      --error-bg: #fef2f2;
      --error-text: #991b1b;
      --error-border: #fecaca;
      --input-bg: transparent;
      --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      --shadow-lg: 0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111110;
        --panel: #1c1c1a;
        --text: #eaeae6;
        --muted: #a0a299;
        --border: #353732;
        --accent: #34b8a6;
        --accent-hover: #2c9d8e;
        --accent-text: #061f1b;
        --error-bg: #1c0f0f;
        --error-text: #f5a0a0;
        --error-border: #4a2020;
        --input-bg: transparent;
        --shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
        --shadow-lg: 0 4px 24px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.2);
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
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow-lg);
      padding: 40px 32px 32px;
    }
    @media (prefers-reduced-motion: no-preference) {
      .card {
        animation: cardIn 300ms cubic-bezier(0, 0, 0.2, 1) both;
      }
      @keyframes cardIn {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .logo-icon {
      width: 36px;
      height: 36px;
      background: var(--accent);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-text);
      font-weight: 900;
      font-size: 18px;
    }
    .logo-text {
      font-size: 20px;
      font-weight: 750;
      letter-spacing: -0.02em;
    }
    .subtitle {
      text-align: center;
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      background: color-mix(in srgb, var(--border), transparent 60%);
      border-radius: 10px;
      margin-bottom: 24px;
    }
    .tab {
      min-height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--muted);
      transition: background 120ms ease-out, color 120ms ease-out;
    }
    .tab[aria-selected="true"] {
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .tab:hover:not([aria-selected="true"]) {
      color: var(--text);
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
      background: var(--input-bg);
      color: var(--text);
      transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
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
      margin-bottom: 8px;
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
      padding: 6px 4px;
      border-radius: 4px;
      min-height: 32px;
      min-width: 32px;
      transition: color 120ms ease-out;
    }
    .toggle-pw:hover { color: var(--text); }
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
      transition: background 120ms ease-out, transform 60ms ease-out;
      margin-top: 4px;
    }
    .submit:hover {
      background: var(--accent-hover);
    }
    .submit:active {
      transform: scale(0.985);
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
    .register-fields { display: none; }
    .register-fields.active { display: grid; gap: 16px; }
    .divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: var(--muted);
      margin-top: 20px;
    }
    @media (max-width: 480px) {
      .card { padding: 28px 20px 24px; border-radius: 12px; }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <div class="logo-icon" aria-hidden="true">LM</div>
      <span class="logo-text">Langdock Masumi</span>
    </div>
    <p class="subtitle">${
      isRegister
        ? "Create an operator account to manage your agents."
        : "Sign in to manage your Langdock Masumi agents."
    }</p>
    ${errorHtml}
    <div class="tabs" role="tablist">
      <button
        type="button"
        class="tab"
        role="tab"
        id="tab-login"
        aria-selected="${!isRegister}"
        aria-controls="panel-login"
      >Sign in</button>
      <button
        type="button"
        class="tab"
        role="tab"
        id="tab-register"
        aria-selected="${isRegister}"
        aria-controls="panel-register"
      >Create account</button>
    </div>
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
          placeholder="sarthi"
          ${isRegister ? "" : 'value=""'}
        />
      </div>
      <div class="field" id="emailGroup">
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          placeholder="you@example.com"
        />
        <span class="hint">Optional. Used for account recovery.</span>
      </div>
      <div class="field">
        <label for="password">Password <span class="required">*</span></label>
        <div class="password-wrap">
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="${isRegister ? "new-password" : "current-password"}"
            required
            minlength="8"
            spellcheck="false"
            placeholder="Min 8 characters"
          />
          <button type="button" class="toggle-pw" id="togglePw" aria-label="Show password">Show</button>
        </div>
      </div>
      <div class="field" id="displayNameGroup">
        <label for="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autocomplete="name"
          spellcheck="false"
          placeholder="Sarthi Borkar"
        />
      </div>
      <div id="formError" class="error-banner" role="alert" style="display:none"></div>
      <button class="submit" type="submit" id="submitBtn">${
        isRegister ? "Create account" : "Sign in"
      }</button>
    </form>
    <p class="footer">
      Credentials are stored locally in SQLite on this server.
    </p>
  </main>

  <script>
    (function() {
      var tabs = document.querySelectorAll('.tab');
      var form = document.getElementById('authForm');
      var modeInput = form.elements.mode;
      var submitBtn = document.getElementById('submitBtn');
      var formError = document.getElementById('formError');
      var usernameGroup = document.getElementById('usernameGroup');
      var emailGroup = document.getElementById('emailGroup');
      var displayNameGroup = document.getElementById('displayNameGroup');

      var isRegister = ${isRegister ? "true" : "false"};
      syncFields();

      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          var target = tab.id === 'tab-register';
          if (target === isRegister) return;
          isRegister = target;
          modeInput.value = isRegister ? 'register' : 'login';
          document.getElementById('tab-login').setAttribute('aria-selected', String(!isRegister));
          document.getElementById('tab-register').setAttribute('aria-selected', String(isRegister));
          submitBtn.textContent = isRegister ? 'Create account' : 'Sign in';
          syncFields();
        });
      });

      function syncFields() {
        emailGroup.style.display = isRegister ? '' : 'none';
        displayNameGroup.style.display = isRegister ? '' : 'none';
        var pw = document.getElementById('password');
        pw.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
        pw.setAttribute('placeholder', isRegister ? 'Min 8 characters' : '');
        if (!isRegister) {
          form.elements.email.value = '';
          form.elements.displayName.value = '';
        }
      }

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        formError.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = isRegister ? 'Creating account...' : 'Signing in...';

        var payload = {
          mode: modeInput.value,
          username: form.elements.username.value.trim(),
          password: form.elements.password.value,
          email: form.elements.email ? form.elements.email.value.trim() : '',
          displayName: form.elements.displayName ? form.elements.displayName.value.trim() : ''
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
            if (data.token) {
              document.cookie = 'session=' + encodeURIComponent(data.token) + '; path=/; max-age=86400; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
            }
            window.location.href = '/dashboard';
          });
        }).catch(function(err) {
          formError.textContent = err instanceof Error ? err.message : 'Something went wrong.';
          formError.style.display = '';
          submitBtn.disabled = false;
          submitBtn.textContent = isRegister ? 'Create account' : 'Sign in';
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
