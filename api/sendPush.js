import webpush from 'web-push';

// Use environment variables in Vercel for these keys
const publicVapidKey = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  publicVapidKey,
  privateVapidKey
);

export default async function handler(req, res) {
  // Add CORS headers for testing
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { subscription, payload } = req.body;

    if (!subscription) {
      return res.status(400).json({ error: 'Subscription object is required' });
    }

    const pushPayload = JSON.stringify({
      title: payload.title || 'رسالة جديدة',
      body: payload.body || 'لديك رسالة جديدة',
      url: payload.url || '/'
    });

    await webpush.sendNotification(subscription, pushPayload);
    
    res.status(200).json({ success: true, message: 'Push sent successfully' });
  } catch (error) {
    console.error('Push error:', error);
    res.status(500).json({ error: 'Failed to send push notification', details: error.message });
  }
}
