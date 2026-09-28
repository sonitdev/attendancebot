#!/usr/bin/env node

/**
 * Script to configure @site_attendantbot:
 * 1. Register bot commands (/start, /status, /help).
 * 2. Set the persistent chat menu button to launch the Mini App.
 */

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in environment or .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const webAppUrl =
  args.find((a) => a.startsWith('--url='))?.split('=')[1] ||
  process.env.TELEGRAM_MINI_APP_URL ||
  'https://example.com/mini-app';

console.log(`Configuring Telegram Bot (@site_attendantbot)...`);
console.log(`Mini App WebApp URL: ${webAppUrl}`);

async function api(method, body = {}) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  // 1. Get bot identity
  const me = await api('getMe');
  if (!me.ok) {
    console.error('Failed to connect to Telegram API:', me);
    process.exit(1);
  }
  console.log(`Connected to Telegram Bot: @${me.result.username} (${me.result.first_name})`);

  // 2. Set Bot Commands
  const commands = [
    {
      command: 'checkin',
      description: 'Record Check-In with native GPS location',
    },
    {
      command: 'checkout',
      description: 'Record Check-Out with native GPS location',
    },
    {
      command: 'status',
      description: 'Check your shift assignment and today status',
    },
    {
      command: 'start',
      description: 'Launch attendance check-in Mini App & keyboard',
    },
    {
      command: 'help',
      description: 'Site attendance rules and GPS assistance',
    },
  ];

  const cmdRes = await api('setMyCommands', { commands });
  if (cmdRes.ok) {
    console.log('✓ Bot commands registered successfully (/checkin, /checkout, /status, /start, /help)');
  } else {
    console.warn('Warning: setMyCommands returned:', cmdRes);
  }

  // Optional: Set Webhook if requested
  const webhookUrl = args.find((a) => a.startsWith('--webhook='))?.split('=')[1];
  if (webhookUrl) {
    const whRes = await api('setWebhook', {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
    });
    if (whRes.ok) {
      console.log(`✓ Telegram Webhook registered: ${webhookUrl}`);
    } else {
      console.warn('Warning: setWebhook returned:', whRes);
    }
  }

  // 3. Set Chat Menu Button to Web App
  const menuRes = await api('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Open Attendance',
      web_app: {
        url: webAppUrl,
      },
    },
  });

  if (menuRes.ok) {
    console.log(`✓ Persistent Chat Menu Button configured: "Open Attendance" -> ${webAppUrl}`);
  } else {
    console.warn('Warning: setChatMenuButton returned:', menuRes);
  }

  console.log('\nTelegram Bot setup completed successfully!');
}

main().catch((err) => {
  console.error('Fatal error during bot setup:', err);
  process.exit(1);
});
